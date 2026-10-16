// src/services/productCache.js
// Shared cache so repeat scans of the same product reuse a saved AI
// report instead of paying for a fresh AI call every time.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { searchTokens, rankMatches } from './productMatch.js';
import { recordJunkIssue } from './junkIssues.js';
// The keyword-only data, not categories.js -- that file also imports
// each category's .png, which plain-Node scripts importing this module
// (generate-reports.js, discover-off-products.js) can't load outside Vite.
import { CATEGORY_KEYWORDS, INDIAN_SWEET_KEYWORDS } from '../data/categoryKeywords.js';

// "Alternative"/"similar" only means something if the two products are
// actually substitutable -- the browse page's own 'essentials' bucket
// (oil, atta, flour, rice, sauce, ketchup, all in one) is fine for
// browsing, but real report: a bottle of oil was surfacing a chilli
// garlic SAUCE as its "safer alternative", which nobody would ever
// treat as a substitute for the other. Split into groups that are each
// genuinely one kind of pantry staple, used only for this matching --
// categories.js/the browse page keeps the single broader bucket, since
// splitting it there would need real illustrated art for each new
// piece that doesn't exist yet.
//
// Indian sweets come FIRST: "Desi Ghee Motichoor Laddu" would otherwise land
// in dairy (ghee) and be offered ghee and butter as alternatives. The browse
// page has no sweets bucket, so this group exists only here.
const ALTERNATIVES_CATEGORY_KEYWORDS = [
  { id: 'indian-sweets', keywords: INDIAN_SWEET_KEYWORDS },
  ...CATEGORY_KEYWORDS.filter((c) => c.id !== 'essentials'),
  { id: 'oil', keywords: ['oil'] },
  { id: 'atta-flour', keywords: ['atta', 'flour', 'maida', 'besan', 'sooji', 'rava'] },
  { id: 'rice-grains', keywords: ['rice', 'poha', 'daliya'] },
  { id: 'sauces-condiments', keywords: ['sauce', 'ketchup', 'chutney', 'pickle', 'achar'] },
  // Whole-word matching (findCategoryForProduct) no longer finds "milk" in
  // "Buttermilk" or "tea" in an "Herbal Infusion" -- named here instead.
  { id: 'dairy', keywords: ['buttermilk', 'milkshake', 'lassi', 'chaas'] },
  { id: 'beverages', keywords: ['infusion'] },
];

function normalizeText(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Admin review (supabase/product_reports_review_status_migration.sql): a
// newly added product is 'pending' until an admin approves it, and only
// 'live' (published before review existed) and 'approved' ones appear
// anywhere someone browses -- search, categories, alternatives, recently
// analyzed, today's picks, popular searches, the catalog counts. An EXACT
// lookup (getCachedReport, by the barcode/text someone just scanned, or a
// share link) is deliberately not filtered: the person who scanned a
// product still gets their result.
export const VISIBLE_REVIEW_STATUSES = ['live', 'approved'];

export function barcodeKey(barcode) {
  return `barcode:${barcode.trim()}`;
}

export function textKey(ingredientsText) {
  return `text:${normalizeText(ingredientsText)}`;
}

/**
 * Catalog products that are probably the one described by a name from
 * elsewhere -- Open Food Facts' name for a scanned barcode, Gemini's read
 * of a front-of-pack photo, or what someone typed. Word-based (see
 * productMatch.js), so "Parle-G Gluco Biscuits 250 g" still finds
 * "Parle-G Original Gluco Biscuits". Only published products.
 */
// A product's whole report is ~12 KB (every ingredient, its breakdown, the
// story...) but the lists on Home, Category, search and matching show only a
// few fields. Asking for just those cuts what each list downloads about 10x
// (Supabase's free egress limit was being used up by this and the admin
// pages). Rows keep the shape callers already read: row.report.brand etc.
const LIST_FIELDS = 'brand:report->>brand, packSize:report->>packSize, imageUrl:report->>imageUrl, overallScore:report->overallScore, verdict:report->>verdict, isInfantFormula:report->isInfantFormula';
const listColumns = (extra = '') => `lookup_key, product_name, ${extra}${LIST_FIELDS}`;
function slimRow(row) {
  const { brand, packSize, imageUrl, overallScore, verdict, isInfantFormula, ...rest } = row;
  return { ...rest, report: { brand, packSize, imageUrl, overallScore, verdict, isInfantFormula } };
}

export async function findProductMatches({ productName, brand = '', packSize = '' }, { limit = 5 } = {}) {
  if (!isSupabaseConfigured) return [];
  const tokens = searchTokens(`${brand} ${productName}`);
  if (tokens.length === 0) return [];
  // The brand with its spaces taken out finds "KrumbKraft" from "KRUMB
  // KRAFT" -- only used for the wide fallback below.
  const brandJoined = String(brand || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  // Tokens are letters/digits only (nameTokens strips everything else),
  // so they're safe to put straight into the filter -- no LIKE wildcards
  // or PostgREST separators can get through.
  const base = () => supabase
    .from('product_reports')
    .select(listColumns())
    .in('review_status', VISIBLE_REVIEW_STATUSES);
  // First every distinctive word at once (narrow, usually the right
  // product and its pack sizes); only if that finds too little, any of
  // them (wide, ranked below).
  let all = base();
  for (const t of tokens) all = all.ilike('product_name', `%${t}%`);
  const { data: strict } = await all.limit(40);
  let data = (strict || []).map(slimRow);
  if (data.length < limit) {
    // One small query per word rather than one big OR -- a common word
    // ("choco") would otherwise fill the whole result and crowd out the
    // rarer one that actually identifies the product.
    const words = [...new Set([...(brandJoined.length >= 4 ? [brandJoined] : []), ...tokens])];
    const results = await Promise.all(words.map((t) => base().ilike('product_name', `%${t}%`).limit(25)));
    const seen = new Set(data.map((r) => r.lookup_key));
    for (const { data: rows } of results) {
      for (const r of rows || []) if (!seen.has(r.lookup_key)) { seen.add(r.lookup_key); data.push(slimRow(r)); }
    }
  }
  const candidates = data.filter((row) => row.product_name).map((row) => ({
    lookupKey: row.lookup_key,
    productName: row.product_name,
    brand: row.report?.brand || null,
    packSize: row.report?.packSize || null,
    imageUrl: row.report?.imageUrl || null,
    score: typeof row.report?.overallScore === 'number' ? row.report.overallScore : null,
    isInfantFormula: row.report?.isInfantFormula === true,
  }));
  return rankMatches({ productName, brand, packSize }, candidates, limit);
}

// --- Barcode links (supabase/barcode_links_schema.sql) ---------------
// A scanned barcode the catalog doesn't know, tied by a person to a
// product we DO have (found by name or a front-of-pack photo). Saved as
// pending; only an admin-approved link is used for lookups. Both calls are
// best-effort -- before the table exists they just do nothing.

const DEVICE_ID_KEY = 'foodguard-device-id';

/** A random id for this device -- counts independent confirmations of a link. Not tied to any person. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2)) + '';
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

export async function recordBarcodeLink({ barcode, lookupKey, productName, source }) {
  if (!isSupabaseConfigured || !barcode || !lookupKey) return;
  try {
    await supabase.from('barcode_links').upsert(
      { barcode: barcode.trim(), lookup_key: lookupKey, product_name: productName || null, device_id: getDeviceId(), source: source || null },
      { onConflict: 'barcode,lookup_key,device_id', ignoreDuplicates: true },
    );
  } catch {
    // Best-effort -- the person already has their result either way.
  }
}

/** The product an admin-approved link points this barcode at, or null. */
export async function getLinkedLookupKey(barcode) {
  if (!isSupabaseConfigured || !barcode) return null;
  try {
    const { data, error } = await supabase
      .from('barcode_links')
      .select('lookup_key')
      .eq('barcode', barcode.trim())
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
      .limit(1);
    if (error || !data?.length) return null;
    return data[0].lookup_key;
  } catch {
    return null;
  }
}

/**
 * Find already-analyzed products by name, for the search suggestions.
 * These are free and instant to open (the report is already saved), so
 * they're worth showing above live database results.
 */
export async function searchCachedProducts(query, { limit = 5 } = {}) {
  return (await searchProductsPage(query, { limit })).items;
}

/**
 * Ranked product search (supabase/product_search_migration.sql): every
 * word matched on its own and in any order, close spellings accepted,
 * whole-name and popular products first, poorly named ones last. Falls back
 * to the old exact-text match if that function isn't installed yet.
 * @returns {Promise<{ items: Array, total: number }>}
 */
export async function searchProductsPage(query, { limit = 20, offset = 0 } = {}) {
  if (!isSupabaseConfigured) return { items: [], total: 0 };
  const cleaned = (query || '').trim();
  if (cleaned.length < 2) return { items: [], total: 0 };

  const { data, error } = await supabase.rpc('search_products', { q: cleaned, max_results: limit, skip: offset });
  if (!error && Array.isArray(data)) {
    return {
      items: data.map((row) => ({
        lookupKey: row.lookup_key,
        productName: row.product_name,
        brand: row.brand || null,
        score: typeof row.score === 'number' ? row.score : null,
        verdict: row.verdict || null,
        imageUrl: row.image_url || null,
        packSize: row.pack_size || null, // only once product_search_pack_size_migration.sql has run
      })),
      total: Number(data[0]?.total || 0),
    };
  }
  const items = offset === 0 ? await exactTextSearch(cleaned, limit) : [];
  return { items, total: items.length };
}

// The original search: the typed text, as typed, inside the name or brand.
async function exactTextSearch(cleaned, limit) {
  // Escape LIKE wildcards so a typed "%" searches for a literal "%"
  // instead of silently matching everything. Also strip "," and "()" --
  // this value now sits inside an unquoted .or() filter string below,
  // where those characters are structural syntax (condition separator /
  // grouping), not literal search characters. A product search has no
  // legitimate need for them anyway, so dropping them is simpler and
  // safer than trying to escape them correctly for that mini-language.
  const pattern = `%${cleaned.replace(/[,()]/g, ' ').replace(/[\\%_]/g, '\\$&')}%`;

  // Match on brand too, not just product name -- searching "Nestlé"
  // should find Maggi/KitKat even though neither name contains the
  // word "Nestlé". Brand lives inside the report JSON, not its own
  // column, hence the report->>brand path in the OR filter.
  const { data, error } = await supabase
    .from('product_reports')
    .select(listColumns())
    .in('review_status', VISIBLE_REVIEW_STATUSES)
    .or(`product_name.ilike.${pattern},report->>brand.ilike.${pattern}`)
    .limit(limit);

  if (error || !data) return [];

  return data
    .map(slimRow)
    .filter((row) => row.product_name)
    .map((row) => ({
      lookupKey: row.lookup_key,
      productName: row.product_name,
      brand: row.report?.brand || null,
      score: typeof row.report?.overallScore === 'number' ? row.report.overallScore : null,
      verdict: row.report?.verdict || null,
    }));
}

/**
 * Browse already-scored products matching any of the given keywords
 * against their product name -- the home screen's "browse by category"
 * feature. Keywords are our own fixed list (src/data/categories.js),
 * never user input, so building the OR filter directly is safe here
 * (unlike searchCachedProducts, which has to escape a typed query).
 */
export async function browseCategoryProducts(keywords, { limit = 24 } = {}) {
  if (!isSupabaseConfigured || !keywords?.length) return [];

  const orFilter = keywords.map((k) => `product_name.ilike.%${k}%`).join(',');

  const { data, error } = await supabase
    .from('product_reports')
    .select(listColumns())
    .in('review_status', VISIBLE_REVIEW_STATUSES)
    .or(orFilter)
    // Fetched with room to spare: the substring ilike above lets through
    // names that only CONTAIN a keyword ("Haldiram's" for haldi, "Khatta"
    // for atta), and those are dropped below.
    .limit(limit * 3);

  if (error || !data) return [];

  return data
    .map(slimRow)
    .filter((row) => {
      const name = (row.product_name || '').toLowerCase();
      if (!name || !keywords.some((k) => hasKeyword(name, k))) return false;
      // A laddu is browsed with the sweets, not wherever "ghee" puts it.
      const browsingSweets = keywords.some((k) => INDIAN_SWEET_KEYWORDS.includes(k));
      return browsingSweets || !INDIAN_SWEET_KEYWORDS.some((k) => hasKeyword(name, k));
    })
    .slice(0, limit)
    .map((row) => ({
      lookupKey: row.lookup_key,
      productName: row.product_name,
      brand: row.report?.brand || null,
      imageUrl: row.report?.imageUrl || null,
      score: typeof row.report?.overallScore === 'number' ? row.report.overallScore : null,
      verdict: row.report?.verdict || null,
    }));
}

/**
 * The most-scanned products, reduced to short search terms (brand name
 * when we have one, otherwise the full product name) for the home
 * screen's "Popular searches" pills. Real usage data, not a hardcoded
 * guess -- it'll naturally shift over time as more people scan things.
 */
// Brand text comes straight from Open Food Facts' crowdsourced data, so
// casing is inconsistent ("bingo", "ITC", "Parle"). Only fix the clearly
// broken cases (all one case) -- a genuine mixed-case brand name is
// more likely right than a generic title-case pass would be.
function normalizeCasing(label) {
  if (label === label.toUpperCase() || label === label.toLowerCase()) {
    return label.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  }
  return label;
}

export async function getPopularSearchTerms(limit = 8) {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from('product_reports')
    .select('product_name, scan_count')
    .in('review_status', VISIBLE_REVIEW_STATUSES)
    .order('scan_count', { ascending: false })
    .limit(limit * 6); // over-fetch so de-duping brands + skipping long names still leaves enough

  if (error || !data) return [];

  const seen = new Set();
  const terms = [];
  for (const row of data) {
    // Product name, not brand -- "Parle-G Gluco Biscuits" tells you what
    // it actually is; "Parle" alone doesn't. Still skip anything too long
    // to read as a pill.
    const label = row.product_name?.length <= 32 ? row.product_name : null;
    if (!label) continue;
    // Collapses trivial near-duplicates from different scan sources --
    // "Parle-G" vs "Parle G" vs "parle  g" -- that plain lowercasing
    // let through as separate pills for what's visibly the same search.
    const key = label.toLowerCase().replace(/[-\s]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(normalizeCasing(label));
    if (terms.length >= limit) break;
  }
  return terms;
}

/**
 * The most recently added products -- home screen's "Recently added"
 * feed, so the app has something fresh to show even to a visitor who
 * never types a search. Ordered by when the product went live in the app
 * (approved), not when it was saved: a scraped product waits days in the
 * review queue, and ordering by save time buried every one approved today
 * under that day's scans. 'live' products (published before review
 * existed) have no approval time and come after.
 */
export async function getRecentlyAddedProducts(limit = 10) {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from('product_reports')
    .select(listColumns('created_at, '))
    .in('review_status', VISIBLE_REVIEW_STATUSES)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data
    .map(slimRow)
    .filter((row) => row.product_name)
    .map((row) => ({
      lookupKey: row.lookup_key,
      productName: row.product_name,
      brand: row.report?.brand || null,
      imageUrl: row.report?.imageUrl || null,
      score: typeof row.report?.overallScore === 'number' ? row.report.overallScore : null,
      verdict: row.report?.verdict || null,
      // So the homepage strip can show "Specialized" instead of a raw
      // score badge for infant formula -- see ProductStripCard.jsx.
      isInfantFormula: row.report?.isInfantFormula === true,
    }));
}

// A stable number for "today" -- the same all day, different tomorrow --
// used to rotate the daily spotlight and tip without a real backend
// scheduler. Deliberately NOT random: a random pick on every page load
// would mean two visits in the same day show different things, which
// reads as broken rather than "daily".
export function dayOfYearSeed(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

/**
 * One high-scoring and one low-scoring product, rotating daily from a
 * pool of the catalog's best/worst so it isn't the literal same two
 * products forever. Selects only the score/verdict/brand/image fields
 * via a JSON-path select (not the whole `report`, which would also drag
 * along every product's full ingredient list just to pick two of them).
 */
export async function getDailySpotlight() {
  if (!isSupabaseConfigured) return { best: null, worst: null };

  // The picks only change at midnight, so a visitor who comes back the same
  // day (or opens Home twice) gets them from this device -- the spotlight
  // used to cost 1.8 MB a visit.
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `foodguard-spotlight-${today}`;
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey));
    if (hit && (hit.best || hit.worst)) return hit;
  } catch { /* no storage here (or nothing cached yet) */ }

  // Step 1: just enough to rank -- name and score, ~100 KB for 1000 rows.
  const { data, error } = await supabase
    .from('product_reports')
    .select('id, product_name, score:report->overallScore, isInfantFormula:report->>isInfantFormula')
    .in('review_status', VISIBLE_REVIEW_STATUSES)
    .limit(1000);

  if (error || !data?.length) return { best: null, worst: null };

  // Infant formula is excluded from the pool entirely, not just relabelled
  // -- "today's pick" is exactly the kind of "this is our best/healthiest"
  // framing a specially regulated infant-nutrition product shouldn't be
  // used to illustrate (see Result.jsx's isInfantFormula branch for why).
  const withScore = data
    .filter((row) => row.product_name && row.score !== null && row.isInfantFormula !== 'true')
    .map((row) => ({ ...row, score: Number(row.score) }))
    .filter((row) => Number.isFinite(row.score));
  if (!withScore.length) return { best: null, worst: null };

  const sorted = [...withScore].sort((a, b) => b.score - a.score);
  const poolSize = Math.min(20, sorted.length);
  const seed = dayOfYearSeed();
  const bestRow = sorted[seed % poolSize];
  const worstRow = sorted[sorted.length - 1 - (seed % poolSize)];

  // Step 2: the card's own details, for the two products picked.
  const { data: details } = await supabase
    .from('product_reports')
    .select('id, lookup_key, brand:report->>brand, imageUrl:report->>imageUrl, verdict:report->>verdict, flags:report->flags, positives:report->positives')
    .in('id', [...new Set([bestRow.id, worstRow.id])]);
  const detailOf = (row) => (details || []).find((d) => d.id === row.id) || {};

  // Up to 2 reasons each -- the positives/flags a real report already
  // computed (scoringEngine.js), not a new classification invented for
  // this card. Best shows what went RIGHT (positives); worst shows what
  // went WRONG (flags) -- picking whichever field happens to be non-empty
  // would show a low scorer's positives instead of why it's actually flagged.
  const toItem = (row, reasonField) => {
    const d = detailOf(row);
    return {
      lookupKey: d.lookup_key,
      productName: row.product_name,
      brand: d.brand || null,
      imageUrl: d.imageUrl || null,
      score: row.score,
      verdict: d.verdict || null,
      reasons: (d[reasonField] || []).slice(0, 2),
    };
  };

  const result = { best: toItem(bestRow, 'positives'), worst: toItem(worstRow, 'flags') };
  if (result.best.lookupKey || result.worst.lookupKey) {
    try { localStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* private mode / no storage */ }
  }
  return result;
}

/**
 * Same category-keyword matching Category.jsx browses by, applied to a
 * single product name -- lets us place a product into one of the fixed
 * categories without asking the user or calling the AI again.
 */
// Exported for testing -- the real bug this exists to catch (an oil
// showing a sauce as its "safer alternative") only shows up by checking
// real product-name pairs against this function's actual output.
//
// Whole words only (a plural "s"/"es" allowed): a plain substring match put
// every Haldiram's product in Spices -- "haldi" is inside "Haldiram's" -- so a
// Motichoor Laddu was offered chai masala and biryani masala as alternatives.
const keywordPattern = new Map();
function hasKeyword(name, keyword) {
  if (!keywordPattern.has(keyword)) {
    // Keywords are plain lowercase words, nothing to escape.
    keywordPattern.set(keyword, new RegExp(`(?:^|[^a-z])${keyword}(?:s|es)?(?![a-z])`));
  }
  return keywordPattern.get(keyword).test(name);
}

export function findCategoryForProduct(productName) {
  const name = (productName || '').toLowerCase();
  return ALTERNATIVES_CATEGORY_KEYWORDS.find((c) => c.keywords.some((k) => hasKeyword(name, k))) || null;
}

// "Safe" here means the same bar the Result page already displays as
// the "Good" tier and above (see SCORE_TIERS in utils/storage.js) --
// there's no separate threshold invented just for this feature.
const SAFE_SCORE_THRESHOLD = 65;

/**
 * Shared by getSaferAlternatives and getSimilarProducts below -- both
 * are "other real, already-scored products in this same category",
 * they just differ on whether a minimum score is required. Deliberately
 * not an AI call: every candidate already has a real, verified score
 * sitting in the catalog, so picking by category (+ score, when asked)
 * is both free and more trustworthy than asking a model to name a
 * product that may not even be in our database.
 */
// The top-scoring products of each category, kept for 10 minutes and shared
// by every product viewed in that category (and by the safer/similar lists).
// It used to be one 60-full-report query per product view -- 600 KB -- for
// three cards. Now: a halves-of-a-kilobyte list of names and scores first,
// full reports only for the pool that is actually used, once per category.
export const CATEGORY_POOL_SIZE = 30;
const CATEGORY_POOL_TTL_MS = 10 * 60 * 1000;
const categoryPools = new Map(); // category id -> { at, promise }

async function loadCategoryPool(category) {
  const orFilter = category.keywords.map((k) => `product_name.ilike.%${k}%`).join(',');

  // Ordered server-side by score -- a category like "chocolates" has 250+
  // real rows, so without an explicit order Postgres hands back an arbitrary
  // few that can miss every qualifying row purely by chance (confirmed live).
  const { data: ranked, error } = await supabase
    .from('product_reports')
    .select('id, product_name, score:report->overallScore')
    .in('review_status', VISIBLE_REVIEW_STATUSES)
    .or(orFilter)
    .order('report->overallScore', { ascending: false })
    .limit(CATEGORY_POOL_SIZE * 3); // the ilike is a substring match; some rows are dropped below
  if (error || !ranked) return [];

  // Whole-word match, as everywhere else (findCategoryForProduct): "Haldiram's"
  // is not a spice just because it contains "haldi".
  const pool = ranked
    .filter((r) => r.product_name && typeof r.score === 'number' && findCategoryForProduct(r.product_name)?.id === category.id)
    .slice(0, CATEGORY_POOL_SIZE);
  if (!pool.length) return [];

  const { data: full, error: fullError } = await supabase
    .from('product_reports')
    .select('id, lookup_key, product_name, report')
    .in('id', pool.map((r) => r.id));
  if (fullError || !full) return [];
  const byId = new Map(full.map((row) => [row.id, row]));

  return pool
    .map((r) => byId.get(r.id))
    .filter(Boolean)
    .map((row) => ({
      lookupKey: row.lookup_key,
      productName: row.product_name,
      brand: row.report?.brand || null,
      imageUrl: row.report?.imageUrl || null,
      score: typeof row.report?.overallScore === 'number' ? row.report.overallScore : null,
      verdict: row.report?.verdict || null,
      // Passed through so the caller can re-rank these by a specific
      // person's priorities (see personalAssessment.js) without a second
      // query.
      ingredients: row.report?.ingredients || [],
      realNutrients: row.report?.realNutrients || null,
      // For the "swap and save" comparison (swapSavings.js).
      nutrientsPer100: row.report?.nutrientsPer100 || null,
      realNutrientsServingGrams: row.report?.realNutrientsServingGrams ?? null,
      nutritionPanel: row.report?.nutritionPanel || null,
      foodType: row.report?.foodType || null,
      isCondimentOrSeasoning: row.report?.isCondimentOrSeasoning || false,
    }))
    .filter((p) => typeof p.score === 'number');
}

function categoryPool(category) {
  const hit = categoryPools.get(category.id);
  if (hit && Date.now() - hit.at < CATEGORY_POOL_TTL_MS) return hit.promise;
  const promise = loadCategoryPool(category);
  categoryPools.set(category.id, { at: Date.now(), promise });
  // Never keep an empty or failed answer around: the next view tries again.
  promise.then((rows) => { if (!rows.length) categoryPools.delete(category.id); }, () => categoryPools.delete(category.id));
  return promise;
}

async function getCategoryProducts({ productName, lookupKey, limit, minScore }) {
  if (!isSupabaseConfigured) return [];

  const category = findCategoryForProduct(productName);
  if (!category) return [];

  const pool = await categoryPool(category);
  return pool
    .filter((p) => p.lookupKey !== (lookupKey || ''))
    .filter((p) => minScore == null || p.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Better-scoring products in the same category as a low-scoring one -- the Result page's "Safer alternatives" section. */
export async function getSaferAlternatives({ productName, lookupKey, limit = 3 }) {
  return getCategoryProducts({ productName, lookupKey, limit, minScore: SAFE_SCORE_THRESHOLD });
}

/**
 * Other products in the same category, any score -- shown instead of
 * getSaferAlternatives when the scanned product is already "Good" or
 * better, so the Result page always has something to keep browsing to
 * rather than dead-ending after a good score. No score filter: this is
 * plain discovery, not a health suggestion, so a lower-scoring product
 * can still show up here (each card shows its own real score, so
 * nothing dishonest is implied either way).
 */
export async function getSimilarProducts({ productName, lookupKey, limit = 3 }) {
  return getCategoryProducts({ productName, lookupKey, limit, minScore: null });
}

/**
 * Total products in the catalog, and how many were added today -- a
 * simple progress counter for the home screen so growth is visible
 * without digging into Supabase directly. `head: true` on a count
 * query returns just the number, not the matching rows.
 */
export async function getCatalogStats() {
  if (!isSupabaseConfigured) return { total: 0, addedToday: 0 };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalRes, todayRes] = await Promise.all([
    supabase.from('product_reports').select('*', { count: 'exact', head: true }).in('review_status', VISIBLE_REVIEW_STATUSES),
    supabase
      .from('product_reports')
      .select('*', { count: 'exact', head: true })
      .in('review_status', VISIBLE_REVIEW_STATUSES)
      .gte('created_at', startOfToday.toISOString()),
  ]);

  return {
    total: totalRes.count ?? 0,
    addedToday: todayRes.count ?? 0,
  };
}

/**
 * Look up a cached report by its key. Returns null on a cache miss,
 * on error, or if Supabase isn't configured yet — callers should treat
 * null the same as "no cache, go ahead and call the AI".
 */
/**
 * The cached report's short, stable row id -- what a shared link
 * carries instead of the lookup key, which for a text/photo scan is the
 * entire ingredients label and far too long to put in a WhatsApp link.
 * Null when the product was never saved to the shared cache.
 */
export async function getReportIdByLookupKey(lookupKey) {
  if (!isSupabaseConfigured || !lookupKey) return null;

  const { data, error } = await supabase
    .from('product_reports')
    .select('id')
    .eq('lookup_key', lookupKey)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

/**
 * Opens a shared link (see pages/SharedProduct.jsx). Same shape as
 * getCachedReport, plus the lookup key, so the recipient's copy behaves
 * exactly like one they'd found through search. Deliberately doesn't
 * bump scan_count -- that counter drives "Popular searches", and a link
 * forwarded around a family group chat isn't a search.
 */
export async function getReportById(id) {
  if (!isSupabaseConfigured || !id) return null;

  const { data, error } = await supabase
    .from('product_reports')
    .select('lookup_key, report, ingredients_text')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return { ...data.report, ingredientsText: data.ingredients_text, lookupKey: data.lookup_key };
}

export async function getCachedReport(lookupKey) {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from('product_reports')
    .select('id, scan_count, report, ingredients_text, review_status')
    .eq('lookup_key', lookupKey)
    .maybeSingle();

  if (error || !data) return null;

  // Bump the hit counter in the background — doesn't need to block the user.
  supabase
    .from('product_reports')
    .update({ scan_count: data.scan_count + 1, updated_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {}, () => {});

  // The raw label text lives in its own column, not inside the report
  // JSON -- attach it here so callers get it the same way whether this
  // was a fresh analysis or a cache hit.
  return { ...data.report, ingredientsText: data.ingredients_text, reviewStatus: data.review_status };
}

/**
 * Rename the product on an already-cached report — e.g. fixing
 * "Unknown Product" once a human actually knows what it is. Updates
 * both the product_name column and the name inside the saved report
 * JSON, so every future cache hit shows the corrected name too.
 * Safe to call even if Supabase isn't configured — it just no-ops.
 */
export async function updateProductName(lookupKey, productName) {
  if (!isSupabaseConfigured || !lookupKey || !productName) return;

  try {
    const { data } = await supabase
      .from('product_reports')
      .select('report')
      .eq('lookup_key', lookupKey)
      .maybeSingle();

    if (!data) return;

    await supabase
      .from('product_reports')
      .update({
        product_name: productName,
        report: { ...data.report, productName },
        updated_at: new Date().toISOString(),
      })
      .eq('lookup_key', lookupKey);
  } catch {
    // Best-effort — the user's local copy is already renamed either way.
  }
}

/**
 * Remove a cached report so the next lookup for it is a genuine cache
 * miss — used by "Refresh analysis" to throw away a report that was
 * built before a parser/scoring fix, rather than leaving stale columns
 * around for the follow-up saveReport() to only partially overwrite.
 * Safe to call even if Supabase isn't configured — it just no-ops.
 */
export async function deleteReport(lookupKey) {
  if (!isSupabaseConfigured || !lookupKey) return;

  try {
    await supabase.from('product_reports').delete().eq('lookup_key', lookupKey);
  } catch {
    // Best-effort — the fresh report below still gets saved either way.
  }
}

/**
 * Mirrors report.realNutrients (see analyzeText.js) into its own
 * queryable table (see supabase/product_nutrition_schema.sql) whenever
 * it's present -- the app itself still reads report.realNutrients
 * directly at runtime (personalAssessment.js never queries this
 * table), this is purely so the same real numbers are visible/browsable
 * in Supabase's dashboard instead of buried inside a jsonb column.
 * Best-effort, same as saveReport below: never blocks the user's report.
 */
export async function upsertProductNutrition(lookupKey, productName, report) {
  const n = report?.realNutrients;
  if (!n) return;

  try {
    await supabase.from('product_nutrition').upsert(
      {
        lookup_key: lookupKey,
        product_name: productName || null,
        sodium_mg: n.sodiumMg ?? null,
        added_sugar_g: n.addedSugarG ?? null,
        saturated_fat_g: n.saturatedFatG ?? null,
        trans_fat_g: n.transFatG ?? null,
        calories_kcal: n.caloriesKcal ?? null,
        protein_g: n.proteinG ?? null,
        // The rest of the printed panel (see openFoodFacts.js /
        // blinkitProductsRepo.js) -- shown in the app's Nutrition
        // section already; mirrored here so the same numbers are
        // browsable in Supabase's dashboard too, matching the six
        // original columns.
        carbohydrate_g: n.carbohydrateG ?? null,
        total_sugar_g: n.totalSugarG ?? null,
        total_fat_g: n.totalFatG ?? null,
        fibre_g: n.fibreG ?? null,
        cholesterol_mg: n.cholesterolMg ?? null,
        serving_grams: report.realNutrientsServingGrams ?? null,
        // Only ever populated from one of these two real sources (see
        // analyzeText.js) -- text/photo scans never reach this function
        // at all, since they never have realNutrients to begin with.
        source: lookupKey?.startsWith('barcode:') ? 'openfoodfacts' : 'blinkit',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'lookup_key' },
    );
  } catch {
    // This table is a bonus visibility layer, not a requirement.
  }
}

/**
 * Save a freshly-generated AI report to the shared cache so the next
 * person (or the same person, next time) skips the AI call entirely.
 * Safe to call even if Supabase isn't configured — it just no-ops.
 */
export async function saveReport({ lookupKey, source, productName, ingredientsText, report }) {
  if (!isSupabaseConfigured) return;

  try {
    await supabase.from('product_reports').upsert(
      {
        lookup_key: lookupKey,
        source,
        product_name: productName || null,
        ingredients_text: ingredientsText,
        report,
      },
      { onConflict: 'lookup_key' }
    );
  } catch {
    // Caching is a bonus, not a requirement — never block the user's report on this.
  }

  await upsertProductNutrition(lookupKey, productName, report);

  // Typo / OCR junk still on the list -> the admin's manual review (Data Issues).
  await recordJunkIssue({ lookupKey, source, productName, report });
}
