// src/services/adminBarcodeLinksRepo.js
//
// Admin side of barcode_links (supabase/barcode_links_schema.sql): people
// tie a scanned barcode the catalog doesn't know to a product we have; an
// admin approves the pair here, after which scanning that barcode opens the
// product. Each row is one device's confirmation -- grouped per pair here.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { logActivity } from './adminActivityRepo.js';

function requireSupabase() {
  if (!isSupabaseConfigured) throw new Error('Supabase isn’t configured.');
}

/** One entry per (barcode, product) pair, most-confirmed first. */
export async function adminListBarcodeLinks({ status = 'pending', limit = 500 } = {}) {
  requireSupabase();
  const { data, error } = await supabase
    .from('barcode_links')
    .select('barcode, lookup_key, product_name, device_id, source, status, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const pairs = new Map();
  for (const r of data || []) {
    const k = `${r.barcode}|${r.lookup_key}`;
    const p = pairs.get(k) || { barcode: r.barcode, lookupKey: r.lookup_key, productName: r.product_name, devices: new Set(), sources: new Set(), lastAt: r.created_at };
    p.devices.add(r.device_id);
    if (r.source) p.sources.add(r.source);
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

export async function adminRejectBarcodeLink({ barcode, lookupKey, productName }) {
  requireSupabase();
  const { error } = await supabase.from('barcode_links').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('barcode', barcode).eq('lookup_key', lookupKey);
  if (error) throw new Error(error.message);
  logActivity({ action: 'reject_barcode_link', targetType: 'barcode', targetId: barcode, productName, details: { lookupKey } });
}
