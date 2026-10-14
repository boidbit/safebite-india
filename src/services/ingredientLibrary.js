// src/services/ingredientLibrary.js
//
// The ingredient knowledge base: look each ingredient up in our database
// first, and only pay for AI research on the ones we've genuinely never
// seen before — then save those so we never pay for them again.

import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { researchIngredients } from './geminiService.js';
import { isJunkIngredient, neutralizeJunk } from './typoIngredient.js';

/**
 * Fetch every ingredient we already know about, matching on either the
 * normalized name or the INS code. One round trip, not one per ingredient.
 */
async function fetchKnown(parsed) {
  if (!isSupabaseConfigured || parsed.length === 0) return [];

  const keys = [...new Set(parsed.flatMap((p) => p.lookupKeys))];
  const codes = [...new Set(parsed.map((p) => p.insCode).filter(Boolean))];

  const queries = [
    supabase.from('ingredients').select('*').in('canonical_name', keys),
  ];
  if (codes.length > 0) {
    queries.push(supabase.from('ingredients').select('*').in('ins_code', codes));
  }

  const results = await Promise.all(queries);

  const rows = [];
  for (const { data, error } of results) {
    if (!error && data) rows.push(...data);
  }
  return rows;
}

/** Match a parsed label entry against the rows we got back. */
function matchRow(parsedItem, rows) {
  if (parsedItem.insCode) {
    const byCode = rows.find((r) => r.ins_code === parsedItem.insCode);
    if (byCode) return byCode;
  }
  for (const key of parsedItem.lookupKeys) {
    const byName = rows.find((r) => r.canonical_name === key);
    if (byName) return byName;
  }
  return null;
}

/** Turn a database row into the shape the report UI already expects. */
function rowToIngredient(row, parsedItem) {
  // Typo / OCR junk already in the table (saved before the junk rule) scores nothing.
  return neutralizeJunk({
    name: parsedItem.displayName,
    status: row.status,
    fssaiStatus: row.fssai_status,
    euStatus: row.eu_status,
    reason: row.reason,
    category: row.category,
    whatIsIt: row.what_is_it,
    healthEffects: row.health_effects,
    commonlyFoundIn: row.commonly_found_in || [],
    insCode: row.ins_code,
    scientificName: row.scientific_name,
    penalty: row.penalty,
    confidence: row.confidence,
    evidenceType: row.evidence_type,
    percentage: parsedItem.percentage,
    estimatedPercentage: parsedItem.estimatedPercentage,
    recognized: row.recognized !== false,
    fromCache: true,
  });
}

/** Save newly-researched ingredients so future scans get them for free. */
async function saveResearched(records) {
  if (!isSupabaseConfigured || records.length === 0) return;

  // Typos and OCR leftovers are never kept (see typoIngredient.js).
  const rows = records.filter((r) => !isJunkIngredient(r)).map((r) => ({
    canonical_name: r.canonicalName,
    display_name: r.displayName,
    ins_code: r.insCode || null,
    scientific_name: r.scientificName || null,
    category: r.category || null,
    status: r.status || 'safe',
    fssai_status: r.fssaiStatus || null,
    eu_status: r.euStatus || null,
    reason: r.reason || null,
    what_is_it: r.whatIsIt || null,
    health_effects: r.healthEffects || null,
    commonly_found_in: r.commonlyFoundIn || [],
    synonyms: r.synonyms || [],
    penalty: typeof r.penalty === 'number' ? r.penalty : 0,
    confidence: r.confidence || null,
    evidence_type: r.evidenceType || null,
    recognized: r.recognized !== false,
  }));

  if (rows.length === 0) return;

  try {
    await supabase.from('ingredients').upsert(rows, { onConflict: 'canonical_name' });
  } catch {
    // Never block a user's report because the cache write failed.
  }
}

/** Bump lookup counters in the background so we can see what's paying off. */
function bumpCounts(rows) {
  if (!isSupabaseConfigured) return;
  for (const row of rows) {
    supabase
      .from('ingredients')
      .update({ lookup_count: (row.lookup_count || 0) + 1 })
      .eq('id', row.id)
      .then(() => {}, () => {});
  }
}

/**
 * Resolve a parsed ingredient list into full ingredient details.
 *
 * Known ingredients come straight from the database (free, instant).
 * Unknown ones are researched in a SINGLE batched AI call, saved, and
 * then served from the database forever after.
 *
 * Returns { ingredients, knownCount, researchedCount }.
 */
export async function resolveIngredients(parsed) {
  const rows = await fetchKnown(parsed);

  const resolved = new Array(parsed.length).fill(null);
  const unknown = [];
  const hitRows = [];

  parsed.forEach((item, i) => {
    const row = matchRow(item, rows);
    if (row) {
      resolved[i] = rowToIngredient(row, item);
      hitRows.push(row);
    } else {
      unknown.push({ index: i, item });
    }
  });

  bumpCounts(hitRows);

  let researchedCount = 0;
  if (unknown.length > 0) {
    const researched = await researchIngredients(
      unknown.map(({ item }) => ({
        name: item.displayName,
        insCode: item.insCode,
        canonicalName: item.lookupKeys[0],
      })),
    );

    // Pair results back up by canonical name, falling back to position.
    unknown.forEach(({ index, item }, n) => {
      const record =
        researched.find((r) => r.canonicalName === item.lookupKeys[0]) || researched[n];
      if (!record) return;

      resolved[index] = neutralizeJunk({
        name: item.displayName,
        status: record.status,
        fssaiStatus: record.fssaiStatus,
        euStatus: record.euStatus,
        reason: record.reason,
        category: record.category,
        whatIsIt: record.whatIsIt,
        healthEffects: record.healthEffects,
        commonlyFoundIn: record.commonlyFoundIn || [],
        insCode: record.insCode || item.insCode,
        scientificName: record.scientificName,
        penalty: record.penalty,
        confidence: record.confidence,
        evidenceType: record.evidenceType,
        percentage: item.percentage,
        estimatedPercentage: item.estimatedPercentage,
        recognized: record.recognized !== false,
        fromCache: false,
      });
      researchedCount++;
    });

    await saveResearched(
      unknown
        .map(({ item }, n) => {
          const record =
            researched.find((r) => r.canonicalName === item.lookupKeys[0]) || researched[n];
          if (!record) return null;
          return { ...record, canonicalName: item.lookupKeys[0], displayName: item.displayName };
        })
        .filter(Boolean),
    );
  }

  return {
    ingredients: resolved.filter(Boolean),
    knownCount: hitRows.length,
    researchedCount,
  };
}
