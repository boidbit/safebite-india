// src/services/adminBarcodeLinksRepo.js
//
// Admin side of barcode_links (supabase/barcode_links_schema.sql): people
// tie a scanned barcode the catalog doesn't know to a product we have; an
// admin approves the pair here, after which scanning that barcode opens the
// product. Each row is one device's confirmation -- grouped per pair here.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { logActivity } from './adminActivityRepo.js';
import { assessBarcodeLinks, brandKey } from './barcodeLinkSafety.js';
import { blinkitLookupKey } from './blinkitProductsRepo.js';

function requireSupabase() {
  if (!isSupabaseConfigured) throw new Error('Supabase isn’t configured.');
}

// Every row of a query, 1000 at a time (PostgREST's page size).
async function allRows(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

/** One entry per (barcode, product) pair, most-confirmed first. */
export async function adminListBarcodeLinks({ status = 'pending' } = {}) {
  requireSupabase();
  const data = await allRows(() => supabase
    .from('barcode_links')
    .select('barcode, lookup_key, product_name, brand, device_id, source, status, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false }));
  const pairs = new Map();
  for (const r of data) {
    const k = `${r.barcode}|${r.lookup_key}`;
    const p = pairs.get(k) || { barcode: r.barcode, lookupKey: r.lookup_key, productName: r.product_name, brand: r.brand, devices: new Set(), sources: new Set(), lastAt: r.created_at };
    p.devices.add(r.device_id);
    if (r.source) p.sources.add(r.source);
    if (!p.brand && r.brand) p.brand = r.brand;
    pairs.set(k, p);
  }
  // How many different products each barcode was tied to -- more than one
  // means people disagree and it needs a closer look.
  const perBarcode = {};
  for (const p of pairs.values()) perBarcode[p.barcode] = (perBarcode[p.barcode] || 0) + 1;
  return [...pairs.values()]
    .map((p) => ({ ...p, devices: undefined, confirmations: p.devices.size, sources: [...p.sources], competing: perBarcode[p.barcode] - 1 }))
    .sort((a, b) => b.confirmations - a.confirmations || (a.lastAt < b.lastAt ? 1 : -1));
}

/**
 * Approve one barcode -> product pair. Any other product that barcode was
 * still waiting to be tied to is rejected at the same time: one barcode is
 * one product.
 */
export async function adminApproveBarcodeLink({ barcode, lookupKey, productName }) {
  requireSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase.from('barcode_links').update({ status: 'approved', reviewed_at: now }).eq('barcode', barcode).eq('lookup_key', lookupKey);
  if (error) throw new Error(error.message);
  await supabase.from('barcode_links').update({ status: 'rejected', reviewed_at: now }).eq('barcode', barcode).neq('lookup_key', lookupKey).eq('status', 'pending');
  logActivity({ action: 'approve_barcode_link', targetType: 'barcode', targetId: barcode, productName, details: { lookupKey } });
}

/** The barcode approved for this product in Barcode matches, or null. */
export async function adminApprovedBarcodeFor(lookupKey) {
  if (!isSupabaseConfigured || !lookupKey) return null;
  const { data } = await supabase
    .from('barcode_links')
    .select('barcode')
    .eq('lookup_key', lookupKey)
    .eq('status', 'approved')
    .order('reviewed_at', { ascending: false })
    .limit(1);
  return data?.[0]?.barcode || null;
}

/**
 * Pending pairs judged by barcodeLinkSafety.js, plus each pair's brand
 * (filled in for links saved before the brand column) and product photo.
 * @returns {Promise<{ verdicts: Map<string, { safe: boolean, reasons: string[] }>,
 *   brandOf: Map<string, string|null>, imageOf: Map<string, string|null> }>}
 *   verdicts/brandOf keyed "barcode|lookupKey", imageOf by lookupKey
 */
// The check reads the whole catalog (~9 MB). It's remembered for 5 minutes so
// the Dashboard, this page and a reload don't each download it again -- and
// Supabase's free egress limit stays safe. Cleared by adminForgetBarcodeCheck().
const ASSESS_TTL_MS = 5 * 60 * 1000;
let assessCache = { at: 0, key: '', value: null };
let assessInflight = { key: '', promise: null }; // the same check already running -- share it
const pairsKey = (pairs) => `${pairs.length}:${pairs.map((p) => `${p.barcode}|${p.lookupKey}`).sort().join(',')}`;

export function adminForgetBarcodeCheck() {
  assessCache = { at: 0, key: '', value: null };
  assessInflight = { key: '', promise: null };
}

/** The last barcode check's number of safe pairs, if one ran in the last 5 minutes. */
export function adminCachedSafeBarcodeCount() {
  if (!assessCache.value || Date.now() - assessCache.at > ASSESS_TTL_MS) return null;
  return [...assessCache.value.verdicts.values()].filter((v) => v.safe).length;
}

export async function adminAssessBarcodeLinks(pairs) {
  const key = pairsKey(pairs);
  if (assessCache.value && assessCache.key === key && Date.now() - assessCache.at < ASSESS_TTL_MS) return assessCache.value;
  if (assessInflight.key === key && assessInflight.promise) return assessInflight.promise;
  const promise = assessBarcodeLinksUncached(pairs).then((value) => {
    assessCache = { at: Date.now(), key, value };
    return value;
  }).finally(() => { if (assessInflight.promise === promise) assessInflight = { key: '', promise: null }; });
  assessInflight = { key, promise };
  return promise;
}

async function assessBarcodeLinksUncached(pairs) {
  requireSupabase();
  const empty = { verdicts: new Map(), brandOf: new Map(), imageOf: new Map() };
  if (pairs.length === 0) return empty;

  const [otherLinks, reports, blinkit] = await Promise.all([
    allRows(() => supabase.from('barcode_links').select('barcode, lookup_key, brand').in('status', ['pending', 'approved'])),
    allRows(() => supabase.from('product_reports').select('lookup_key, brand:report->>brand, image:report->>imageUrl')),
    allRows(() => supabase.from('blinkit_products').select('source, brand, product_name, optimized_image_url')),
  ]);
  const reportByKey = new Map(reports.map((r) => [r.lookup_key, r]));
  const blinkitByKey = new Map(blinkit.map((b) => [blinkitLookupKey(b.source, b.brand, b.product_name), b]));

  // Each pair's brand (links saved before the brand column have none) and
  // photo -- from its report, or the scraped row if no report exists yet.
  const brandOf = new Map();
  const imageOf = new Map();
  for (const p of pairs) {
    const report = reportByKey.get(p.lookupKey);
    const row = blinkitByKey.get(p.lookupKey);
    brandOf.set(`${p.barcode}|${p.lookupKey}`, p.brand || report?.brand || row?.brand || null);
    imageOf.set(p.lookupKey, report?.image || row?.optimized_image_url || null);
  }
  const links = pairs.map((p) => ({ ...p, brand: brandOf.get(`${p.barcode}|${p.lookupKey}`) }));

  // Catalog products per brand: every scraped Blinkit row, plus every
  // report that isn't one of those (barcode / text / photo scans).
  const productsByBrand = new Map();
  const count = (brand) => { const b = brandKey(brand); if (b) productsByBrand.set(b, (productsByBrand.get(b) || 0) + 1); };
  for (const b of blinkit) count(b.brand);
  for (const r of reports) if (!r.lookup_key.startsWith('blinkit:')) count(r.brand);

  const catalog = reports.filter((r) => r.lookup_key.startsWith('barcode:'));
  const catalogBarcodes = new Set(catalog.map((r) => r.lookup_key.slice('barcode:'.length)));
  const knownBarcodes = [
    ...catalog.map((r) => ({ barcode: r.lookup_key.slice('barcode:'.length), lookupKey: r.lookup_key, brand: r.brand })),
    ...otherLinks.filter((l) => l.brand).map((l) => ({ barcode: l.barcode, lookupKey: l.lookup_key, brand: l.brand })),
  ];
  const verdicts = assessBarcodeLinks(links, {
    otherLinks: otherLinks.map((l) => ({ barcode: l.barcode, lookupKey: l.lookup_key })),
    catalogBarcodes,
    knownBarcodes,
    productsByBrand,
  });
  return { verdicts, brandOf, imageOf };
}

/**
 * Approves each pair in turn; `onProgress(done, total)` after each. Only
 * the first pair of any one barcode -- approving it rejects the barcode's
 * other waiting products, and approving a second would leave the barcode
 * approved for two products.
 */
export async function adminApproveBarcodeLinks(pairs, onProgress = () => {}) {
  const done = new Set();
  for (const [i, pair] of pairs.entries()) {
    if (!done.has(pair.barcode)) {
      await adminApproveBarcodeLink(pair);
      done.add(pair.barcode);
    }
    onProgress(i + 1, pairs.length);
  }
}

/** Rejects each pair in turn; `onProgress(done, total)` after each. */
export async function adminRejectBarcodeLinks(pairs, onProgress = () => {}) {
  for (const [i, pair] of pairs.entries()) {
    await adminRejectBarcodeLink(pair);
    onProgress(i + 1, pairs.length);
  }
}

/** Live numbers for Admin > Barcode backfill (scripts/backfill-blinkit-barcodes.js). */
export async function adminBarcodeBackfillProgress() {
  requireSupabase();
  const countLinks = (status) => supabase.from('barcode_links').select('id', { count: 'exact', head: true }).eq('source', 'blinkit_photo').eq('status', status);
  const [progress, recent, pending, approved, rejected, products] = await Promise.all([
    supabase.from('barcode_backfill_progress').select('*').order('updated_at', { ascending: false }),
    supabase.from('barcode_links').select('barcode, product_name, brand, status, created_at').eq('source', 'blinkit_photo').order('created_at', { ascending: false }).limit(20),
    countLinks('pending'),
    countLinks('approved'),
    countLinks('rejected'),
    supabase.from('blinkit_products').select('id', { count: 'exact', head: true }).eq('source', 'blinkit'),
  ]);
  if (progress.error) throw new Error(progress.error.message);
  const byStatus = { pending: pending.count || 0, approved: approved.count || 0, rejected: rejected.count || 0 };
  return {
    run: (progress.data || []).find((r) => r.category === '__run__') || null,
    categories: (progress.data || []).filter((r) => r.category !== '__run__'),
    recent: recent.data || [],
    byStatus,
    totalProducts: products.count || 0,
  };
}

export async function adminRejectBarcodeLink({ barcode, lookupKey, productName }) {
  requireSupabase();
  const { error } = await supabase.from('barcode_links').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('barcode', barcode).eq('lookup_key', lookupKey);
  if (error) throw new Error(error.message);
  logActivity({ action: 'reject_barcode_link', targetType: 'barcode', targetId: barcode, productName, details: { lookupKey } });
}
