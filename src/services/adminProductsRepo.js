// src/services/adminProductsRepo.js
//
// Admin-panel-only reads/writes against product_reports -- separate
// from productCache.js's saveReport() because editing needs to update
// the SAME row by its id even when the edit changes the lookup_key
// (e.g. correcting the ingredients text also changes textKey()'s hash
// of it). saveReport()'s upsert-on-lookup_key would instead leave the
// old row behind as an orphaned duplicate in that case.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { barcodeKey, upsertProductNutrition } from './productCache.js';
import { logActivity } from './adminActivityRepo.js';

function requireSupabase() {
  if (!isSupabaseConfigured) throw new Error('Supabase isn’t configured.');
}

/**
 * @param {object} opts
 * @param {string} [opts.search] - matched against product_name
 * @param {string} [opts.brand] - matched against report->brand (case-insensitive contains)
 * @param {string[]} [opts.categoryKeywords] - OR-matched against product_name (see categoryKeywords.js)
 * @param {string[]} [opts.lookupKeys] - restrict to exactly these lookup_keys (the flagged-only filter)
 * @param {string} [opts.source] - exact match on product_reports.source ('barcode'|'blinkit'|'search'|'image'|'text')
 * @param {number} [opts.scoreMin]
 * @param {number} [opts.scoreMax]
 * @param {string} [opts.barcode] - matched against the digits inside a "barcode:..." lookup_key
 * @param {'yes'|'no'} [opts.hasBarcode] - whether lookup_key starts with "barcode:" at all
 */
export async function adminListProducts({
  search = '',
  brand = '',
  categoryKeywords = null,
  lookupKeys = null,
  source = '',
  scoreMin = null,
  scoreMax = null,
  barcode = '',
  hasBarcode = '',
  limit = 30,
  offset = 0,
} = {}) {
  requireSupabase();
  let query = supabase
    .from('product_reports')
    .select('id, lookup_key, source, product_name, ingredients_text, report, updated_at', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const cleanedSearch = search.trim();
  if (cleanedSearch) query = query.ilike('product_name', `%${cleanedSearch}%`);

  const cleanedBrand = brand.trim();
  if (cleanedBrand) query = query.ilike('report->>brand', `%${cleanedBrand}%`);

  if (categoryKeywords?.length) {
    query = query.or(categoryKeywords.map((k) => `product_name.ilike.%${k}%`).join(','));
  }

  if (lookupKeys) {
    if (lookupKeys.length === 0) return { rows: [], count: 0 }; // nothing is flagged -- an empty IN() would match everything instead
    query = query.in('lookup_key', lookupKeys);
  }

  if (source) query = query.eq('source', source);
  if (typeof scoreMin === 'number') query = query.gte('report->overallScore', scoreMin);
  if (typeof scoreMax === 'number') query = query.lte('report->overallScore', scoreMax);

  const cleanedBarcode = barcode.trim();
  if (cleanedBarcode) query = query.ilike('lookup_key', `barcode:%${cleanedBarcode}%`);

  if (hasBarcode === 'yes') query = query.ilike('lookup_key', 'barcode:%');
  else if (hasBarcode === 'no') query = query.not('lookup_key', 'ilike', 'barcode:%');

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: data || [], count: count || 0 };
}

export async function adminGetProduct(id) {
  requireSupabase();
  const { data, error } = await supabase.from('product_reports').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Another product with this exact name, other than `excludeId` itself when editing. */
export async function adminFindByName(productName, excludeId = null) {
  requireSupabase();
  const cleaned = productName.trim();
  if (!cleaned) return null;
  let query = supabase.from('product_reports').select('id, product_name').ilike('product_name', cleaned).limit(1);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) return null; // a duplicate-name check failing silently is better than blocking a save over it
  return data;
}

/** Another product with this exact barcode, other than `excludeId` itself when editing. */
export async function adminFindByBarcode(barcode, excludeId = null) {
  requireSupabase();
  const cleaned = barcode.trim();
  if (!cleaned) return null;
  let query = supabase.from('product_reports').select('id, product_name').eq('lookup_key', barcodeKey(cleaned)).limit(1);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data;
}

/** Throws a plain, admin-readable message on a duplicate lookup_key. */
function rethrowFriendly(error) {
  if (error.code === '23505') {
    throw new Error('A product with this exact barcode or ingredients text already exists. Search for it and edit that one instead.');
  }
  throw new Error(error.message);
}

export async function adminCreateProduct({ lookupKey, source, productName, ingredientsText, report }) {
  requireSupabase();
  const { data, error } = await supabase
    .from('product_reports')
    .insert({ lookup_key: lookupKey, source, product_name: productName, ingredients_text: ingredientsText, report })
    .select('id')
    .single();
  if (error) rethrowFriendly(error);
  await upsertProductNutrition(lookupKey, productName, report);
  logActivity({
    action: 'create',
    targetType: 'product',
    targetId: data.id,
    productName,
    details: { score: report?.overallScore ?? null, verdict: report?.verdict ?? null },
  });
  return data.id;
}

/**
 * Field-by-field [before, after] pairs for whatever actually changed --
 * this is what makes the history page useful ("Score: 45 → 60"),
 * rather than just "someone edited this at some point".
 */
function diffProductChange(before, after) {
  const changes = {};
  const add = (key, beforeVal, afterVal) => {
    if (beforeVal !== afterVal) changes[key] = [beforeVal ?? null, afterVal ?? null];
  };
  add('productName', before.product_name, after.productName);
  add('barcode', before.lookup_key, after.lookupKey);
  add('score', before.report?.overallScore, after.report?.overallScore);
  add('verdict', before.report?.verdict, after.report?.verdict);
  add('brand', before.report?.brand, after.report?.brand);
  if (before.ingredients_text !== after.ingredientsText) changes.ingredientsText = 'changed';
  return changes;
}

export async function adminUpdateProduct(id, { lookupKey, source, productName, ingredientsText, report }) {
  requireSupabase();
  const { data: before } = await supabase.from('product_reports').select('product_name, lookup_key, ingredients_text, report').eq('id', id).maybeSingle();

  // product_nutrition.lookup_key is a foreign key into product_reports
  // (no ON UPDATE CASCADE) -- if this edit changes the barcode/lookup
  // key, the old nutrition row would be left pointing at a value that's
  // about to stop existing, and Postgres rejects the parent update
  // outright ("violates foreign key constraint ... on table
  // product_nutrition"). Deleting it first, then re-creating it under
  // the new key below, is simpler than a migration -- this table is
  // documented as a bonus dashboard mirror, not a read path anything
  // depends on.
  if (before && lookupKey !== before.lookup_key) {
    await supabase.from('product_nutrition').delete().eq('lookup_key', before.lookup_key);
  }

  const { error } = await supabase
    .from('product_reports')
    .update({
      lookup_key: lookupKey,
      source,
      product_name: productName,
      ingredients_text: ingredientsText,
      report,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) rethrowFriendly(error);

  // Keep the dashboard-mirror table current too -- not just on a
  // lookup_key change (handled above), but on every save, the same way
  // saveReport() does for a real scan. Harmless no-op when report has
  // no realNutrients at all (see upsertProductNutrition's own guard).
  await upsertProductNutrition(lookupKey, productName, report);

  const changes = before ? diffProductChange(before, { productName, lookupKey, ingredientsText, report }) : null;
  logActivity({ action: 'update', targetType: 'product', targetId: id, productName, details: changes && Object.keys(changes).length ? { changes } : null });
}

export async function adminDeleteProduct(id, productName = null) {
  requireSupabase();
  const { data: before } = await supabase.from('product_reports').select('report').eq('id', id).maybeSingle();
  // .select() after delete so we get back the actually-deleted rows --
  // a missing RLS delete policy makes Postgres quietly filter the row
  // out of the delete's target set, which PostgREST reports as a plain
  // success (no error) even though nothing was removed. Confirmed live
  // against product_reports itself (see the delete-policy migration).
  const { data: deleted, error } = await supabase.from('product_reports').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!deleted || deleted.length === 0) {
    throw new Error('Delete had no effect — the database rejected it silently (likely a missing RLS delete policy).');
  }
  logActivity({
    action: 'delete',
    targetType: 'product',
    targetId: id,
    productName,
    details: before ? { score: before.report?.overallScore ?? null } : null,
  });
}

/**
 * Every barcode-sourced product's id/name/brand/barcode -- feeds the
 * "Barcode check" tool (AdminBarcodeCheck.jsx), which resolves each
 * barcode's GS1 country prefix client-side (gs1CountryPrefixes.js).
 * Filtered server-side to barcode: rows only, so this is a small
 * fraction of the full catalog rather than everything.
 */
export async function adminListAllBarcodeProductsLight() {
  requireSupabase();
  const PAGE = 1000;
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('product_reports')
      .select('id, product_name, lookup_key, brand:report->brand')
      .ilike('lookup_key', 'barcode:%')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...data.map((row) => ({
      id: row.id,
      productName: row.product_name,
      brand: row.brand || null,
      barcode: row.lookup_key.slice('barcode:'.length),
    })));
    if (data.length < PAGE) break;
  }
  return all;
}

