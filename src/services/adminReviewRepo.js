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
import { logActivity } from './adminActivityRepo.js';

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
 * @param {boolean} [opts.problemsOnly] - only products with an open data issue or user flag
 * @param {number} [opts.addedWithinDays] - created in the last N days
 * @param {keyof SORTS} [opts.sort]
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
  problemsOnly = false,
  addedWithinDays = null,
  sort = 'newest',
  limit = 25,
  offset = 0,
} = {}) {
  requireSupabase();
  const order = SORTS[sort] || SORTS.newest;
  let query = supabase
    .from('product_reports')
    .select('id, lookup_key, source, product_name, report, review_status, reviewed_at, created_at, updated_at', { count: 'exact' })
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .order('id', { ascending: true }) // stable paging when the sort column ties
    .range(offset, offset + limit - 1);

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
    query = query.or(categoryKeywords.map((k) => `product_name.ilike.%${k}%`).join(','));
  }
  if (typeof scoreMin === 'number') query = query.gte('report->overallScore', scoreMin);
  if (typeof scoreMax === 'number') query = query.lte('report->overallScore', scoreMax);
  if (hasImage === 'yes') query = query.not('report->>imageUrl', 'is', null);
  else if (hasImage === 'no') query = query.is('report->>imageUrl', null);
  if (hasNutrition === 'yes') query = query.not('report->nutrientsPer100', 'is', null);
  else if (hasNutrition === 'no') query = query.is('report->nutrientsPer100', null);
  if (typeof addedWithinDays === 'number' && addedWithinDays > 0) {
    query = query.gte('created_at', new Date(Date.now() - addedWithinDays * 86400000).toISOString());
  }
  if (problemsOnly) {
    const keys = await lookupKeysWithOpenProblems();
    if (keys.length === 0) return { rows: [], count: 0 }; // an empty IN() would match everything
    query = query.in('lookup_key', keys);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: data || [], count: count || 0 };
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
export async function adminSetReviewStatus(products, status) {
  requireSupabase();
  if (!['approved', 'rejected', 'pending'].includes(status)) throw new Error(`Unknown review status: ${status}`);
  if (products.length === 0) return;

  const { data: session } = await supabase.auth.getSession();
  const reviewed = status !== 'pending';
  const { data, error } = await supabase
    .from('product_reports')
    .update({
      review_status: status,
      reviewed_at: reviewed ? new Date().toISOString() : null,
      reviewed_by: reviewed ? session?.session?.user?.id || null : null,
    })
    .in('id', products.map((p) => p.id))
    .select('id, review_status');
  if (error) throw new Error(error.message);

  // The database trigger silently keeps the old status for anyone who
  // isn't a signed-in admin -- catch that instead of reporting success.
  const notChanged = (data || []).filter((r) => r.review_status !== status);
  if ((data || []).length < products.length || notChanged.length > 0) {
    throw new Error('The review status didn’t change — sign in again as admin and retry.');
  }

  const action = { approved: 'approve_product', rejected: 'reject_product', pending: 'unreview_product' }[status];
  await Promise.all(products.map((p) => logActivity({ action, targetType: 'product', targetId: p.id, productName: p.productName || null })));
}
