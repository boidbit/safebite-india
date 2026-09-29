// src/services/adminBarcodeLinksRepo.js
//
// Admin side of barcode_links (supabase/barcode_links_schema.sql): people
// tie a scanned barcode the catalog doesn't know to a product we have; an
// admin approves the pair here, after which scanning that barcode opens the
// product. Each row is one device's confirmation -- grouped per pair here.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { logActivity } from './adminActivityRepo.js';
import { assessBarcodeLinks } from './barcodeLinkSafety.js';

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

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/**
 * Pending pairs judged by barcodeLinkSafety.js. Fills in a missing brand
 * from the product's own report (links saved before the brand column).
 * @returns {Promise<Map<string, { safe: boolean, reasons: string[] }>>}
 */
export async function adminAssessBarcodeLinks(pairs) {
  requireSupabase();
  if (pairs.length === 0) return new Map();

  const missingBrand = [...new Set(pairs.filter((p) => !p.brand).map((p) => p.lookupKey))];
  const brandOf = {};
  for (const keys of chunks(missingBrand, 100)) {
    const { data } = await supabase.from('product_reports').select('lookup_key, brand:report->>brand').in('lookup_key', keys);
    for (const r of data || []) brandOf[r.lookup_key] = r.brand;
  }
  const links = pairs.map((p) => ({ ...p, brand: p.brand || brandOf[p.lookupKey] || null }));

  const [otherLinks, catalog] = await Promise.all([
    allRows(() => supabase.from('barcode_links').select('barcode, lookup_key, brand').in('status', ['pending', 'approved'])),
    allRows(() => supabase.from('product_reports').select('lookup_key, brand:report->>brand').like('lookup_key', 'barcode:%')),
  ]);
  const catalogBarcodes = new Set(catalog.map((r) => r.lookup_key.slice('barcode:'.length)));
  const knownBarcodes = [
    ...catalog.map((r) => ({ barcode: r.lookup_key.slice('barcode:'.length), lookupKey: r.lookup_key, brand: r.brand })),
    ...otherLinks.filter((l) => l.brand).map((l) => ({ barcode: l.barcode, lookupKey: l.lookup_key, brand: l.brand })),
  ];
  return assessBarcodeLinks(links, {
    otherLinks: otherLinks.map((l) => ({ barcode: l.barcode, lookupKey: l.lookup_key })),
    catalogBarcodes,
    knownBarcodes,
  });
}

/** Approves each pair in turn; `onProgress(done, total)` after each. */
export async function adminApproveBarcodeLinks(pairs, onProgress = () => {}) {
  for (const [i, pair] of pairs.entries()) {
    await adminApproveBarcodeLink(pair);
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
