// src/services/blinkitProductsRepo.js
//
// The Blinkit/JioMart scrape staging table (see
// supabase/blinkit_products_schema.sql, as later trimmed by
// blinkit_products_migration.sql). generate-reports.js reads the backlog
// here the same way it reads productsRepo.js's Open Food Facts backlog,
// turning each row into a real product_reports row so scraped products
// actually become searchable in the app.
//
// Neither Blinkit nor JioMart exposes a barcode, and this table's own
// upsert/uniqueness key is (brand, product_name) -- blinkit_id used to
// be that key but was deliberately dropped (see the migration above), so
// the lookup key here is derived from the same (source, brand,
// product_name) rather than any id column.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { toPer100, toServing } from './nutrientBasis.js';

function normalize(text) {
  return (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Blinkit's nutrition attributes are clean "<number> <unit>" strings
// (e.g. "16 mg", "4.4 g") -- confirmed against real scraped rows.
function parseAmount(raw) {
  if (!raw) return null;
  const match = String(raw).match(/([\d.]+)\s*(mg|g)/i);
  if (!match) return null;
  return { value: toNumber(match[1]), unit: match[2].toLowerCase() };
}

// "Energy" is the one nutrition field that isn't a plain mg/g amount --
// Blinkit's own label format is "<n> kcal" (unlike the mg/g fields
// above). Not independently confirmed against a live scraped row the
// way the others are (parseAmount's comment), since seeding is
// currently paused -- if this ever silently returns null on real data,
// check the actual scraped string format first.
function parseKcal(raw) {
  const match = raw && String(raw).match(/([\d.]+)\s*kcal/i);
  return match ? toNumber(match[1]) : null;
}

// A generic "<number> <unit>" parser -- used for serving_size ("200 ml",
// a REAL per-serving amount straight from Blinkit's own nutrition table,
// see extractNutrientsForHabitCheck below) and, separately, for
// pack_size text in a multipack shape ("2 x 250 ml") when something
// needs the per-unit amount rather than the combined total. kg/l
// normalize to g/ml (the two units the rest of the app -- Result.jsx,
// dailyHabitCheck.js -- actually knows how to display).
export function parseQuantityText(text) {
  if (!text) return null;
  // "ltr" is a real, common abbreviation on real scraped pack_size
  // values (21 of 831 populated rows use it, confirmed live) -- "l"
  // alone would miss all of them, since \b fails between "l" and the
  // "t" immediately after it.
  const UNIT = 'ml|ltr|l|kg|g';
  const multi = String(text).match(new RegExp(`^\\d+\\s*[x×]\\s*([\\d.]+)\\s*(${UNIT})\\b`, 'i'));
  const match = multi || String(text).match(new RegExp(`([\\d.]+)\\s*(${UNIT})\\b`, 'i'));
  if (!match) return null;

  let value = toNumber(match[1]);
  let unit = match[2].toLowerCase();
  if (value === null) return null;
  if (unit === 'kg') { value *= 1000; unit = 'g'; }
  if (unit === 'l' || unit === 'ltr') { value *= 1000; unit = 'ml'; }
  if (value <= 0) return null;
  return { value: Math.round(value), unit };
}

// Real, already-scraped nutrition-panel numbers -- never estimated.
// Originally built only for the "if this became a daily habit" feature
// (dailyHabitCheck.js); also now the primary signal for Personal
// FoodGuard's nutrition-priority matching (personalAssessment.js)
// whenever it's available.
//
// @param {string|null} servingSize - the row's own serving_size column
//   (Blinkit's real "Standard Serve Size" attribute, e.g. "200 ml" --
//   confirmed live on an actual page, printed right in the nutrition
//   table). Deliberately NOT pack_size/packSize -- that's the whole
//   pack/bottle (a 2.25 LITRE bottle's pack_size), a real bug this
//   replaces: this function briefly (and wrongly) treated pack_size as
//   the serving size, which produced nonsense like "if a 2.25 litre
//   serving became a daily habit" for a product whose real serving is
//   200ml. Falls back to "per 100g" -- the one figure FSSAI mandates
//   every Indian label state -- when no real serving size is known, same
//   honest fallback openFoodFacts.js uses for the same reason.
export function extractNutrientsForHabitCheck(nutrition, servingSize = null) {
  if (!nutrition || Object.keys(nutrition).length === 0) return null;

  const toMg = (parsed) => (!parsed ? null : parsed.unit === 'g' ? parsed.value * 1000 : parsed.value);
  const toG = (parsed) => (!parsed ? null : parsed.unit === 'mg' ? parsed.value / 1000 : parsed.value);

  // A real, confirmed Blinkit page bug (same family as the OFF one in
  // openFoodFacts.js): some listings print sodium with the wrong unit
  // suffix -- e.g. "710 g" where the real figure is 710mg. Confirmed live
  // on two Absolute Nuts makhana listings from the same seller (both
  // print sodium suffixed "g" at values in the hundreds) and Topnut
  // Sriracha Cashew ("710 g"). No real food can contain more sodium than
  // pure salt does (~39.3g/100g) -- a "g" reading already past that,
  // before any conversion, can only be a milligram figure with the wrong
  // unit attached, not a genuine gram measurement.
  const MAX_PLAUSIBLE_SODIUM_G_PER_SERVING = 40;
  const rawSodium = parseAmount(nutrition['Sodium']);
  const sodiumUnitLooksWrong = rawSodium?.unit === 'g' && rawSodium.value > MAX_PLAUSIBLE_SODIUM_G_PER_SERVING;
  const sodiumMg = sodiumUnitLooksWrong ? rawSodium.value : toMg(rawSodium);
  const addedSugarG = toG(parseAmount(nutrition['Added Sugar']) || parseAmount(nutrition['Total Sugar']));
  const saturatedFatG = toG(parseAmount(nutrition['Saturated Fat']));
  const transFatG = toG(parseAmount(nutrition['Trans Fat']));
  const caloriesKcal = parseKcal(nutrition['Energy']);
  const proteinG = toG(parseAmount(nutrition['Protein']));
  // The rest of the rows an FSSAI-mandated Indian panel prints -- shown
  // in the Nutrition section, not used by scoring. Same key names as
  // openFoodFacts.js produces, so the UI never has to care which source
  // a product's numbers came from.
  // Blinkit's own label is "Total Carbohydrates" (6,021 scraped rows) -- missing it here
  // left every Blinkit report without carbs until it was added.
  const carbohydrateG = toG(parseAmount(nutrition['Total Carbohydrates'] || nutrition['Carbohydrate'] || nutrition['Carbohydrates'] || nutrition['Total Carbohydrate']));
  const totalSugarG = toG(parseAmount(nutrition['Total Sugar'] || nutrition['Total Sugars'] || nutrition['Sugar']));
  const totalFatG = toG(parseAmount(nutrition['Total Fat'] || nutrition['Fat']));
  const fibreG = toG(parseAmount(nutrition['Dietary Fibre'] || nutrition['Dietary Fiber'] || nutrition['Fibre']));
  const cholesterolMg = toMg(parseAmount(nutrition['Cholesterol']));

  const nutrients = {};
  if (typeof sodiumMg === 'number') nutrients.sodiumMg = sodiumMg;
  if (typeof addedSugarG === 'number') nutrients.addedSugarG = addedSugarG;
  if (typeof saturatedFatG === 'number') nutrients.saturatedFatG = saturatedFatG;
  if (typeof transFatG === 'number') nutrients.transFatG = transFatG;
  if (typeof caloriesKcal === 'number') nutrients.caloriesKcal = caloriesKcal;
  if (typeof proteinG === 'number') nutrients.proteinG = proteinG;
  if (typeof carbohydrateG === 'number') nutrients.carbohydrateG = carbohydrateG;
  if (typeof totalFatG === 'number') nutrients.totalFatG = totalFatG;
  if (typeof fibreG === 'number') nutrients.fibreG = fibreG;
  if (typeof cholesterolMg === 'number') nutrients.cholesterolMg = cholesterolMg;
  // Same reason as openFoodFacts.js: addedSugarG already falls back to
  // the total when no added-sugar row exists, so keeping both would
  // print one measurement twice under two different names.
  if (typeof totalSugarG === 'number' && totalSugarG !== addedSugarG) {
    nutrients.totalSugarG = totalSugarG;
  }
  // Added sugar can't be more than total sugar. On Blinkit it is when the
  // "Added Sugar" row was copied from the pack's per-SERVING column while the
  // rest are per 100 (7UP Tropical: 38 g per can vs 10 g per 100 ml; checked
  // against the pack photos, 30 of 54 wrong Blinkit tables). The total is the
  // per-100 figure, so it stays as the one sugar figure and the added row goes.
  if (typeof nutrients.totalSugarG === 'number' && typeof nutrients.addedSugarG === 'number'
    && nutrients.addedSugarG > nutrients.totalSugarG * 1.05 + 0.1) {
    nutrients.addedSugarG = nutrients.totalSugarG;
    delete nutrients.totalSugarG;
  }

  if (Object.keys(nutrients).length === 0) return null;
  const parsedServing = parseQuantityText(servingSize);
  // Blinkit's nutrition table is per 100 g/ml -- that IS the canonical
  // basis. `nutrients` is the same table scaled to the real serving, so
  // "per {serving}" labels are true (they weren't when the raw per-100
  // numbers were labelled with the serving size).
  const servingGrams = parsedServing?.value ?? null;
  return {
    nutrients: servingGrams ? toServing(nutrients, servingGrams) : nutrients,
    nutrientsPer100: toPer100(nutrients, null),
    servingGrams,
    servingUnit: parsedServing?.unit || 'g',
  };
}

export function blinkitLookupKey(source, brand, productName) {
  return `${source}:${normalize(`${brand} ${productName}`)}`;
}

/** Oldest-first backlog of scraped rows that don't have a report yet. */
export async function getPendingBlinkitProducts(limit) {
  if (!isSupabaseConfigured) return [];

  const { data, error } = await supabase
    .from('blinkit_products')
    .select('id, source, product_name, brand, ingredients_text, image_url, optimized_image_url, nutrition, pack_size, serving_size')
    .is('report_generated_at', null)
    .order('scraped_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.warn('[blinkit_products] Could not read pending backlog:', error.message);
    return [];
  }
  return data || [];
}

/** Marks a scraped row as handled -- either a report was saved, or it's a permanent failure not worth retrying. */
export async function markBlinkitReportGenerated(id) {
  if (!isSupabaseConfigured) return;

  const { error } = await supabase
    .from('blinkit_products')
    .update({ report_generated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) console.warn('[blinkit_products] Could not mark report generated:', error.message);
}
