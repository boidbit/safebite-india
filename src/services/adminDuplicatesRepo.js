// src/services/adminDuplicatesRepo.js
//
// Data for Admin > Inbox > Duplicates: the same product saved more than once
// (src/utils/productFamilies.js), with everything needed to pick the copy to
// keep -- photo, pack size, barcode(s), score, nutrition, ingredients,
// source, status, scans, open flags. Resolving a group keeps one copy and
// HIDES the rest (review status 'rejected' -- reversible from Products >
// Rejected), moving their barcodes to the kept copy so scanning still works.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { logActivity } from './adminActivityRepo.js';
import { adminSetReviewStatus } from './adminReviewRepo.js';
import { adminApproveBarcodeLink } from './adminBarcodeLinksRepo.js';
import { brandCounts, profileProduct, groupFamilies, duplicateGroups, completeness, suggestKeep, sizeLabel, nameDifference } from '../utils/productFamilies.js';

function requireSupabase() {
  if (!isSupabaseConfigured) throw new Error('Supabase isn’t configured.');
}

async function allRows(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

// The label text's own list, roughly: commas outside brackets.
function ingredientCount(text) {
  if (!text) return 0;
  let depth = 0;
  let n = 1;
  for (const ch of String(text).replace(/^\s*ingredients?\s*[:-]?/i, '')) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) n++;
  }
  return n;
}

// Reads the whole catalog (~12 MB), so it's remembered for 5 minutes --
// reopening the page or switching tabs doesn't download it again.
// adminResolveDuplicates() and adminForgetDuplicates() clear it.
const GROUPS_TTL_MS = 5 * 60 * 1000;
let groupsCache = { at: 0, value: null };
let groupsInflight = null; // a load already running is shared, not repeated
export function adminForgetDuplicates() {
  groupsCache = { at: 0, value: null };
  groupsInflight = null;
}

export async function adminLoadDuplicateGroups({ fresh = false } = {}) {
  if (!fresh && groupsCache.value && Date.now() - groupsCache.at < GROUPS_TTL_MS) return groupsCache.value;
  if (groupsInflight && !fresh) return groupsInflight;
  const promise = loadDuplicateGroupsUncached().then((value) => {
    groupsCache = { at: Date.now(), value };
    return value;
  }).finally(() => { if (groupsInflight === promise) groupsInflight = null; });
  groupsInflight = promise;
  return promise;
}

/**
 * @returns {Promise<Array<{ key, brand, variant, size, otherSizes, products }>>}
 *   products enriched and sorted with the suggested keeper first
 */
async function loadDuplicateGroupsUncached() {
  requireSupabase();
  const [reports, links, flags, issues] = await Promise.all([
    allRows(() => supabase.from('product_reports').select(
      'id, lookup_key, source, product_name, ingredients_text, review_status, scan_count, created_at, updated_at, '
      + 'brand:report->>brand, pack:report->>packSize, score:report->overallScore, verdict:report->>verdict, '
      + 'image:report->>imageUrl, per100:report->nutrientsPer100',
    ).neq('review_status', 'rejected')),
    allRows(() => supabase.from('barcode_links').select('barcode, lookup_key, status').neq('status', 'rejected')),
    allRows(() => supabase.from('product_flags').select('lookup_key').eq('status', 'open')),
    allRows(() => supabase.from('product_data_issues').select('lookup_key').eq('status', 'open')),
  ]);

  const linkedBarcodes = new Map();
  for (const l of links) {
    if (!linkedBarcodes.has(l.lookup_key)) linkedBarcodes.set(l.lookup_key, []);
    linkedBarcodes.get(l.lookup_key).push({ barcode: l.barcode, status: l.status });
  }
  const problems = new Map();
  for (const r of [...flags, ...issues]) if (r.lookup_key) problems.set(r.lookup_key, (problems.get(r.lookup_key) || 0) + 1);

  const rows = reports.filter((r) => r.product_name).map((r) => {
    const own = r.lookup_key.startsWith('barcode:') ? r.lookup_key.slice('barcode:'.length) : null;
    const barcodes = [...(own ? [{ barcode: own, status: 'own' }] : []), ...(linkedBarcodes.get(r.lookup_key) || [])];
    return {
      id: r.id,
      lookupKey: r.lookup_key,
      source: r.source,
      productName: r.product_name,
      brand: r.brand || null,
      packSize: r.pack || null,
      score: typeof r.score === 'number' ? r.score : null,
      verdict: r.verdict || null,
      imageUrl: r.image || null,
      hasImage: Boolean(r.image),
      hasNutrition: Boolean(r.per100 && Object.keys(r.per100).length),
      per100: r.per100 || null,
      ingredientsText: r.ingredients_text || '',
      ingredientCount: ingredientCount(r.ingredients_text),
      reviewStatus: r.review_status,
      scanCount: r.scan_count || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      barcodes,
      barcode: barcodes.find((b) => b.status === 'own' || b.status === 'approved')?.barcode || null,
      openProblems: problems.get(r.lookup_key) || 0,
    };
  });
  const known = brandCounts(rows);
  const items = rows.map((r) => ({ ...r, profile: profileProduct(r, known) }));
  const groups = duplicateGroups(groupFamilies(items));

  return groups.map(({ products, family }) => {
    const enriched = products.map((p) => ({ ...p, completeness: completeness(p) }));
    const keep = suggestKeep(enriched);
    // A different barcode is usually a different pack size (or another
    // SKU) whose size just isn't in our data -- not hidden by default.
    const codesOf = (p) => p.barcodes.filter((b) => b.status === 'own' || b.status === 'approved').map((b) => b.barcode);
    const keepCodes = new Set(codesOf(keep));
    for (const p of enriched) p.differentBarcode = p.id !== keep.id && codesOf(p).length > 0 && !codesOf(p).some((c) => keepCodes.has(c));
    const scores = enriched.map((p) => p.score).filter((s) => typeof s === 'number');
    const sizes = [...new Set(products.map((p) => sizeLabel(p.profile.size)).filter(Boolean))];
    const otherSizes = [...new Set(family.filter((p) => !products.includes(p)).map((p) => sizeLabel(p.profile.size)).filter(Boolean))];
    return {
      key: products.map((p) => p.id).sort().join('|'),
      brand: products.find((p) => p.brand && !p.profile.brandLooksWrong)?.brand || products[0].profile.brandKey,
      variant: products[0].profile.variant,
      size: sizes[0] || null,
      someSizeUnknown: products.some((p) => !p.profile.size),
      otherSizes,
      distinctBarcodes: new Set(enriched.flatMap(codesOf)).size,
      scoreMin: scores.length ? Math.min(...scores) : null,
      scoreMax: scores.length ? Math.max(...scores) : null,
      suggestedKeepId: keep.id,
      products: [keep, ...enriched.filter((p) => p.id !== keep.id)],
    };
  });
}

/**
 * Keep one copy; hide the others (review status 'rejected', reversible) and
 * tie each of their barcodes to the kept copy, approved, so scanning any of
 * them opens it.
 */
export async function adminResolveDuplicates(keep, hide) {
  requireSupabase();
  if (hide.length === 0) return;
  adminForgetDuplicates();
  await adminSetReviewStatus(hide.map((p) => ({ id: p.id, productName: p.productName })), 'rejected');

  const keepCodes = new Set(keep.barcodes.map((b) => b.barcode));
  const move = [...new Set(hide.flatMap((p) => p.barcodes.filter((b) => b.status === 'own' || b.status === 'approved').map((b) => b.barcode)))]
    .filter((code) => !keepCodes.has(code));
  for (const barcode of move) {
    const { error } = await supabase.from('barcode_links').upsert({
      barcode,
      lookup_key: keep.lookupKey,
      product_name: keep.productName,
      brand: keep.brand,
      device_id: 'admin-merge',
      source: 'merge',
      status: 'pending',
    }, { onConflict: 'barcode,lookup_key,device_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    await adminApproveBarcodeLink({ barcode, lookupKey: keep.lookupKey, productName: keep.productName });
  }
  logActivity({
    action: 'merge_duplicates',
    targetType: 'product',
    targetId: keep.id,
    productName: keep.productName,
    details: { hidden: hide.map((p) => ({ id: p.id, name: p.productName })), barcodesMoved: move },
  });
}
