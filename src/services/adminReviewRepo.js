// src/services/adminReviewRepo.js
//
// The admin review queue: every product in product_reports with its
// review_status (see supabase/product_reports_review_status_migration.sql).
//   pending  -- newly added, hidden from the app until approved
//   live     -- published before review existed, still to be reviewed
//   approved -- reviewed and published
//   rejected -- reviewed and kept out of the app
// Changing a status only works from a signed-in admin session: a
// database trigger ignores the change from the public key.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { logActivities } from './adminActivityRepo.js';
import { chunk } from '../utils/chunk.js';
import { duplicateNameIds, exactNameKey } from '../utils/duplicateNames.js';
import { parsePack } from './productFamilies.js';
import { nutritionIssues } from './dataHealth.js';

const UPDATE_BATCH = 100; // ids per request (a uuid is ~37 characters of URL)

function requireSupabase() {
  if (!isSupabaseConfigured) throw new Error('Supabase isn’t configured.');
}

export const REVIEW_STATUSES = ['pending', 'live', 'approved', 'rejected'];

// The scraper's source -- newly scraped products get their own list,
// apart from new products that came from someone's scan.
const SCRAPED_SOURCE = 'blinkit';

// What each review tab means: which review_status values, and whether
// it's limited to (or excludes) scraped products.
export const REVIEW_TABS = {
  newScraped: { statuses: ['pending'], source: SCRAPED_SOURCE },
  newScans: { statuses: ['pending'], notSource: SCRAPED_SOURCE },
  live: { statuses: ['live'] },
  approved: { statuses: ['approved'] },
  rejected: { statuses: ['rejected'] },
  all: { statuses: null },
};
export const DEFAULT_REVIEW_TAB = 'newScraped';

const SORTS = {
  newest: { column: 'created_at', ascending: false },
  oldest: { column: 'created_at', ascending: true },
  scoreAsc: { column: 'report->overallScore', ascending: true },
  scoreDesc: { column: 'report->overallScore', ascending: false },
  updated: { column: 'updated_at', ascending: false },
};

// Lookup keys with an open data-quality issue or an open user flag --
// both are reasons to look harder before approving.
async function lookupKeysWithOpenProblems() {
  const [issues, flags] = await Promise.all([
    supabase.from('product_data_issues').select('lookup_key').eq('status', 'open').not('lookup_key', 'is', null),
    supabase.from('product_flags').select('lookup_key').eq('status', 'open').not('lookup_key', 'is', null),
  ]);
  if (issues.error) throw new Error(issues.error.message);
  if (flags.error) throw new Error(flags.error.message);
  return [...new Set([...(issues.data || []), ...(flags.data || [])].map((r) => r.lookup_key))];
}

// Ids of every product that shares its exact name with another one of the same
// pack size (utils/duplicateNames.js). The whole catalog, slim fields only, is
// read once and kept 5 minutes -- changing a filter doesn't read it again.
// Rejected products are left out: those are copies already hidden.
const DUPES_TTL_MS = 5 * 60 * 1000;
let dupesCache = { at: 0, ids: null };
async function idsWithDuplicateNames() {
  if (dupesCache.ids && Date.now() - dupesCache.at < DUPES_TTL_MS) return dupesCache.ids;
  const products = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('product_reports')
      .select('id, product_name, packSize:report->>packSize')
      .neq('review_status', 'rejected')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    products.push(...(data || []).map((r) => ({ id: r.id, productName: r.product_name, packSize: r.packSize })));
    if (!data || data.length < 1000) break;
  }
  const ids = [...duplicateNameIds(products)];
  dupesCache = { at: Date.now(), ids };
  return ids;
}

// Products whose nutrition figures can't all be right (dataHealth.js
// nutritionIssues), with the reasons -- the "Nutrition under review" filter.
// Worked out from the saved figures, never stored: a product whose figures were
// corrected simply isn't in the next list. Kept 5 minutes; an edit or a status
// change clears it (adminForgetNutritionReview) so a fixed product leaves at once.
let reviewCache = { at: 0, map: null };
async function nutritionIssueMap() {
  if (reviewCache.map && Date.now() - reviewCache.at < DUPES_TTL_MS) return reviewCache.map;
  const map = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('product_reports')
      .select('id, ingredients_text, n:report->nutrientsPer100')
      .neq('review_status', 'rejected')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      const issues = r.n ? nutritionIssues({ n: r.n, ingredientsText: r.ingredients_text }) : [];
      if (issues.length) map.set(r.id, issues);
    }
    if (!data || data.length < 1000) break;
  }
  reviewCache = { at: Date.now(), map };
  return map;
}

export function adminForgetNutritionReview() {
  reviewCache = { at: 0, map: null };
}

/** Forget the remembered duplicates -- after products were merged, hidden or renamed. */
export function adminForgetDuplicateNames() {
  dupesCache = { at: 0, ids: null };
}

/**
 * @param {object} opts
 * @param {keyof REVIEW_TABS} [opts.status] - which review tab
 * @param {string} [opts.search] - product name contains
 * @param {string} [opts.brand] - brand contains
 * @param {string} [opts.foodType] - exact report.foodType
 * @param {string} [opts.source] - exact product_reports.source
 * @param {string[]} [opts.categoryKeywords] - OR-matched against product_name
 * @param {number} [opts.scoreMin]
 * @param {number} [opts.scoreMax]
 * @param {''|'yes'|'no'} [opts.hasImage]
 * @param {''|'yes'|'no'} [opts.hasNutrition]
 * @param {''|'yes'|'no'} [opts.hasPackSize] - report.packSize filled in (empty text counts as missing)
 * @param {boolean} [opts.problemsOnly] - only products with an open data issue or user flag
 * @param {number} [opts.addedWithinDays] - created in the last N days
 * @param {string} [opts.barcode] - digits; matches a barcode in the product's key
 *   ("barcode:...") or a barcode matched to it in Barcode matches (a Blinkit
 *   product's barcode lives there)
 * @param {''|'yes'|'no'} [opts.hasBarcode] - whether the key itself is a barcode
 * @param {keyof SORTS} [opts.sort]
 * @param {number} [opts.limit] - rows per page; Infinity for every match
 * @returns rows, each with `barcode` (its key's, or an approved match's) or
 *   null, and a slim `report` ({ brand, overallScore, foodType,
 *   nutrientsPer100 }) -- the photo and ingredients come from
 *   adminProductThumb, since a report with its photo inlined runs to 100 KB+
 *   and 25 of them made the list take seconds.
 */
export async function adminListReviewQueue({
  status = DEFAULT_REVIEW_TAB,
  search = '',
  brand = '',
  foodType = '',
  source = '',
  categoryKeywords = null,
  scoreMin = null,
  scoreMax = null,
  hasImage = '',
  hasNutrition = '',
  hasPackSize = '',
  problemsOnly = false,
  needsPhoto = false,
  duplicateNames = false,
  nutritionReview = false,
  addedWithinDays = null,
  barcode = '',
  hasBarcode = '',
  sort = 'newest',
  limit = 25,
  offset = 0,
} = {}) {
  requireSupabase();
  const order = SORTS[sort] || SORTS.newest;
  const problemIds = problemsOnly ? await idsForLookupKeys(await lookupKeysWithOpenProblems()) : null;
  if (problemIds && problemIds.length === 0) return { rows: [], count: 0 }; // an empty IN() would match everything
  const photoIds = needsPhoto ? await idsForLookupKeys(await lookupKeysNeedingPhoto()) : null;
  if (photoIds && photoIds.length === 0) return { rows: [], count: 0 };
  const digits = barcode.replace(/\D/g, '');
  const barcodeIds = digits ? await productIdsWithBarcode(digits) : null;
  if (barcodeIds && barcodeIds.length === 0) return { rows: [], count: 0 };
  const dupIds = duplicateNames ? await idsWithDuplicateNames() : null;
  if (dupIds && dupIds.length === 0) return { rows: [], count: 0 };
  const reviewMap = nutritionReview ? await nutritionIssueMap() : null;
  // The id-list filters, combined: a product has to be in every list that's on.
  let idList = dupIds;
  if (reviewMap) idList = idList ? idList.filter((id) => reviewMap.has(id)) : [...reviewMap.keys()];
  for (const ids of [problemIds, photoIds]) {
    if (!ids) continue;
    const set = new Set(ids);
    idList = idList ? idList.filter((id) => set.has(id)) : ids;
  }
  if (idList && idList.length === 0) return { rows: [], count: 0 };
  // Fixed once, so every chunk of "All" asks about the same moment.
  const addedSince = typeof addedWithinDays === 'number' && addedWithinDays > 0
    ? new Date(Date.now() - addedWithinDays * 86400000).toISOString()
    : null;

  // Step one finds the page's ids (and the total) without reading any
  // report; step two reads only the small fields the list shows. A fresh
  // query per chunk: a builder is mutable, so chunks fetched side by side
  // can't share one.
  const build = () => {
    let query = supabase
      .from('product_reports')
      .select('id', { count: 'exact' })
      .order(order.column, { ascending: order.ascending, nullsFirst: false })
      .order('id', { ascending: true }); // stable paging when the sort column ties

    const tab = REVIEW_TABS[status] || REVIEW_TABS[DEFAULT_REVIEW_TAB];
    if (tab.statuses) query = query.in('review_status', tab.statuses);
    if (tab.source) query = query.eq('source', tab.source);
    if (tab.notSource) query = query.neq('source', tab.notSource);

    if (search.trim()) query = query.ilike('product_name', `%${search.trim()}%`);
    if (brand.trim()) query = query.ilike('report->>brand', `%${brand.trim()}%`);
    if (foodType === '__none') query = query.is('report->>foodType', null);
    else if (foodType) query = query.eq('report->>foodType', foodType);
    if (source) query = query.eq('source', source);
    if (categoryKeywords?.length) {
      // Whole words (plural allowed), same rule as the app's category page:
      // a plain ilike put every "Haldiram's" product under Spices (haldi).
      query = query.or(categoryKeywords.map((k) => `product_name.imatch."(^|[^a-z])${k}(s|es)?([^a-z]|$)"`).join(','));
    }
    if (typeof scoreMin === 'number') query = query.gte('report->overallScore', scoreMin);
    if (typeof scoreMax === 'number') query = query.lte('report->overallScore', scoreMax);
    if (hasImage === 'yes') query = query.not('report->>imageUrl', 'is', null);
    else if (hasImage === 'no') query = query.is('report->>imageUrl', null);
    if (hasNutrition === 'yes') query = query.not('report->nutrientsPer100', 'is', null);
    else if (hasNutrition === 'no') query = query.is('report->nutrientsPer100', null);
    if (hasPackSize === 'yes') query = query.not('report->>packSize', 'is', null).neq('report->>packSize', '');
    else if (hasPackSize === 'no') query = query.or('report->>packSize.is.null,report->>packSize.eq.');
    if (addedSince) query = query.gte('created_at', addedSince);
    if (hasBarcode === 'yes') query = query.ilike('lookup_key', 'barcode:%');
    else if (hasBarcode === 'no') query = query.not('lookup_key', 'ilike', 'barcode:%');
    if (barcodeIds) query = query.in('id', barcodeIds);
    return query;
  };

  // The first chunk of ids also brings the total; "All" then fetches the
  // rest a thousand at a time (the API's own cap), side by side.
  let ids;
  let count;
  if (idList) {
    // The duplicates are a few hundred ids -- too many for one URL ("Bad
    // Request"), so ask 100 at a time (the other filters still apply) and
    // order and page them here, by name, so the copies sit next to each other.
    const found = await inParallel(chunk(idList, 100), async (piece) => {
      const { data, error } = await build().in('id', piece).range(0, 99);
      if (error) throw new Error(error.message);
      return data || [];
    });
    ids = found.flat().map((r) => r.id);
    count = ids.length;
  } else {
    const pageEnd = Number.isFinite(limit) ? offset + limit : Infinity;
    const first = await build().range(offset, Math.min(pageEnd, offset + 1000) - 1);
    if (first.error) throw new Error(first.error.message);
    count = first.count || 0;
    const end = Math.min(pageEnd, count);
    const starts = [];
    for (let from = offset + 1000; from < end; from += 1000) starts.push(from);
    const rest = await inParallel(starts, async (from) => {
      const { data, error } = await build().range(from, Math.min(end, from + 1000) - 1);
      if (error) throw new Error(error.message);
      return data || [];
    });
    ids = [first.data || [], ...rest].flat().map((r) => r.id);
  }

  const byId = new Map();
  const chunks = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  await inParallel(chunks, async (chunk) => {
    const { data, error } = await supabase
      .from('product_reports')
      .select('id, lookup_key, source, product_name, review_status, reviewed_at, created_at, updated_at, '
        + 'brand:report->>brand, packSize:report->>packSize, overallScore:report->overallScore, foodType:report->>foodType, nutrientsPer100:report->nutrientsPer100')
      .in('id', chunk);
    if (error) throw new Error(error.message);
    for (const r of data || []) byId.set(r.id, r);
  });
  let rows = ids.map((id) => byId.get(id)).filter(Boolean).map(({ brand, packSize, overallScore, foodType, nutrientsPer100, ...r }) => ({
    ...r,
    report: { brand, packSize, overallScore, foodType, nutrientsPer100 },
  }));
  if (idList) {
    const size = (r) => parsePack(r.report.packSize)?.size ?? Infinity;
    rows.sort((a, b) => exactNameKey(a.product_name).localeCompare(exactNameKey(b.product_name)) || size(a) - size(b) || a.id.localeCompare(b.id));
    rows = rows.slice(offset, Number.isFinite(limit) ? offset + limit : undefined);
  }

  // Each row's barcode: its own key's, or one approved in Barcode matches.
  const linked = new Map();
  const linkKeys = rows.filter((r) => !r.lookup_key.startsWith('barcode:')).map((r) => r.lookup_key);
  const keyChunks = [];
  for (let i = 0; i < linkKeys.length; i += 100) keyChunks.push(linkKeys.slice(i, i + 100));
  await inParallel(keyChunks, async (keys) => {
    const { data: links } = await supabase.from('barcode_links').select('lookup_key, barcode').eq('status', 'approved').in('lookup_key', keys);
    for (const l of links || []) if (!linked.has(l.lookup_key)) linked.set(l.lookup_key, l.barcode);
  });
  // The latest approve/reject note for each row on this page (activity log).
  const reasons = new Map();
  await inParallel(chunk(rows.map((r) => String(r.id)), 100), async (ids) => {
    const { data: logs } = await supabase.from('admin_activity_log').select('target_id, action, details, created_at')
      .eq('target_type', 'product').in('target_id', ids).in('action', ['approve_product', 'reject_product'])
      .order('created_at', { ascending: false });
    for (const l of logs || []) if (!reasons.has(l.target_id)) reasons.set(l.target_id, l);
  });
  return {
    rows: rows.map((r) => ({
      ...r,
      reviewNote: reasons.get(String(r.id))?.details?.reason || null,
      barcode: r.lookup_key.startsWith('barcode:') ? r.lookup_key.slice('barcode:'.length) : linked.get(r.lookup_key) || null,
      nutritionIssues: reviewMap?.get(r.id) || null,
    })),
    count: count || 0,
  };
}

// Runs fn over every item, six requests at a time; results in input order.
async function inParallel(items, fn, width = 6) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** One list row's photo and ingredient count -- loaded when the row is on screen. */
export async function adminProductThumb(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from('product_reports')
    .select('imageUrl:report->>imageUrl, ingredients:report->ingredients')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return { imageUrl: data.imageUrl || null, ingredientCount: Array.isArray(data.ingredients) ? data.ingredients.length : 0 };
}

/** The whole row, for an edit made from the list (cropping the photo). */
export async function adminGetProductRow(id) {
  requireSupabase();
  const { data, error } = await supabase
    .from('product_reports')
    .select('id, lookup_key, source, product_name, ingredients_text, report')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// Products whose key holds these digits, or that a (not rejected) Barcode
// matches link ties them to.
async function productIdsWithBarcode(digits) {
  const { data: links } = await supabase.from('barcode_links').select('lookup_key').ilike('barcode', `%${digits}%`).neq('status', 'rejected').limit(200);
  const keys = [...new Set((links || []).map((l) => l.lookup_key))];
  const [byKey, byLink] = await Promise.all([
    supabase.from('product_reports').select('id').ilike('lookup_key', `barcode:%${digits}%`).limit(200),
    keys.length ? supabase.from('product_reports').select('id').in('lookup_key', keys) : { data: [] },
  ]);
  if (byKey.error) throw new Error(byKey.error.message);
  return [...new Set([...(byKey.data || []), ...(byLink.data || [])].map((r) => r.id))];
}

/** How many products sit in each review tab -- for the tab counts. */
export async function adminReviewCounts() {
  requireSupabase();
  const ids = Object.keys(REVIEW_TABS);
  const results = await Promise.all(ids.map((id) => {
    const tab = REVIEW_TABS[id];
    let q = supabase.from('product_reports').select('*', { count: 'exact', head: true });
    if (tab.statuses) q = q.in('review_status', tab.statuses);
    if (tab.source) q = q.eq('source', tab.source);
    if (tab.notSource) q = q.neq('source', tab.notSource);
    return q;
  }));
  const counts = {};
  ids.forEach((id, i) => {
    if (results[i].error) throw new Error(results[i].error.message);
    counts[id] = results[i].count || 0;
  });
  return counts;
}

/**
 * Set the review status of one or more products. Approve publishes them in
 * the app; reject keeps them out; 'pending' puts one back in the queue.
 *
 * @param {Array<{ id: string, productName?: string }>} products
 * @param {'approved'|'rejected'|'pending'} status
 */
/**
 * Open data issues that start with this are "the nutrition table is wrong and
 * only the pack photo can fix it" (scripts/flag-needs-pack-photo.js) -- the
 * "Needs pack photo" filter. Approving the product closes it.
 */
export const NEEDS_PHOTO_PREFIX = 'Needs pack photo';

// A lookup key with a quote, comma or bracket ('crispy "n" crunchy nachos
// (cheese)') breaks a PostgREST IN() list -- the whole list then matches only
// part of what it should. Those keys are asked one at a time.
const ODD_KEY = /[",()]/;
async function idsForLookupKeys(keys) {
  const ids = new Set();
  const plain = keys.filter((k) => !ODD_KEY.test(k));
  for (const piece of chunk(plain, 100)) {
    const { data, error } = await supabase.from('product_reports').select('id').in('lookup_key', piece);
    if (error) throw new Error(error.message);
    for (const r of data || []) ids.add(r.id);
  }
  for (const k of keys.filter((x) => ODD_KEY.test(x))) {
    const { data } = await supabase.from('product_reports').select('id').eq('lookup_key', k);
    for (const r of data || []) ids.add(r.id);
  }
  return [...ids];
}

async function lookupKeysNeedingPhoto() {
  const { data, error } = await supabase.from('product_data_issues').select('lookup_key')
    .eq('status', 'open').like('reason', `${NEEDS_PHOTO_PREFIX}%`).not('lookup_key', 'is', null);
  if (error) throw new Error(error.message);
  return [...new Set((data || []).map((r) => r.lookup_key))];
}

/**
 * @param {Array<{ id: string, productName?: string }>} products
 * @param {'approved'|'rejected'|'pending'} status
 * @param {string} [reason] - why (optional), kept with the approve/reject in the activity log
 */
export async function adminSetReviewStatus(products, status, reason = '') {
  requireSupabase();
  if (!['approved', 'rejected', 'pending'].includes(status)) throw new Error(`Unknown review status: ${status}`);
  if (products.length === 0) return;

  const { data: session } = await supabase.auth.getSession();
  const reviewed = status !== 'pending';
  const reviewedAt = reviewed ? new Date().toISOString() : null;
  const reviewedBy = reviewed ? session?.session?.user?.id || null : null;
  const action = { approved: 'approve_product', rejected: 'reject_product', pending: 'unreview_product' }[status];

  // The ids travel in the URL, so a long list (1,317 selected at once) is
  // rejected as "Bad Request" -- send them 100 at a time. Each piece is
  // logged as soon as it's saved, so a failure partway leaves an honest
  // record of what did change.
  let done = 0;
  for (const piece of chunk(products, UPDATE_BATCH)) {
    const { data, error } = await supabase
      .from('product_reports')
      .update({ review_status: status, reviewed_at: reviewedAt, reviewed_by: reviewedBy })
      .in('id', piece.map((p) => p.id))
      .select('id, lookup_key, review_status');
    const progress = done ? ` ${done} of ${products.length} were already changed; run it again to finish the rest.` : '';
    if (error) throw new Error(`${error.message}.${progress}`);

    // The database trigger silently keeps the old status for anyone who
    // isn't a signed-in admin -- catch that instead of reporting success.
    const notChanged = (data || []).filter((r) => r.review_status !== status);
    if ((data || []).length < piece.length || notChanged.length > 0) {
      throw new Error(`The review status didn’t change — sign in again as admin and retry.${progress}`);
    }
    const note = String(reason || '').trim();
    await logActivities(piece.map((p) => ({ action, targetType: 'product', targetId: p.id, productName: p.productName || null, details: note ? { reason: note } : null })));
    if (status === 'approved') {
      // Fixed and approved: it no longer needs the pack photo.
      const closed = { status: 'resolved', resolved_at: new Date().toISOString() };
      const keys = data.map((r) => r.lookup_key);
      const plain = keys.filter((k) => !ODD_KEY.test(k));
      if (plain.length) await supabase.from('product_data_issues').update(closed).in('lookup_key', plain).eq('status', 'open').like('reason', `${NEEDS_PHOTO_PREFIX}%`);
      for (const k of keys.filter((x) => ODD_KEY.test(x))) {
        await supabase.from('product_data_issues').update(closed).eq('lookup_key', k).eq('status', 'open').like('reason', `${NEEDS_PHOTO_PREFIX}%`);
      }
    }
    done += piece.length;
  }
}
