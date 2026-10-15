// src/services/labelNutrition.js
//
// A label photo's nutrition table is often PER SERVING only ("Amount per
// serving: Calories 82.55, Protein 6.33 g"). Everything downstream works per
// 100 g/ml, and the photo reader used to drop such a table entirely.
//
// Now: when the serving's weight is known -- printed on the label, or the
// pack's net weight divided by the servings per pack -- the numbers are
// scaled to per 100. When it isn't, they're kept aside as
// `nutritionPerServing` (never treated as per 100) so the admin form can
// convert them once someone types the serving size. The weight is never
// guessed.
//
// Pure -- no AI, no network.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const round = (v) => Math.round(v * 100) / 100;

/** Every number in a nutrition object multiplied by `factor` (others dropped). */
export function scaleNutrition(nutrition, factor) {
  const out = {};
  for (const [k, v] of Object.entries(nutrition || {})) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = round(v * factor);
  }
  return out;
}

/** Per-serving values -> per 100 g/ml, for a serving of `servingGrams`. */
export function perServingToPer100(nutrition, servingGrams) {
  const g = num(Number(servingGrams));
  return g ? scaleNutrition(nutrition, 100 / g) : null;
}

/**
 * What the photo reader returned, with `nutrition` always per 100.
 * Adds `convertedFromServingGrams` when it scaled, or `nutritionPerServing`
 * (and no `nutrition`) when the serving's weight is unknown.
 */
export function normalizeLabelNutrition(extracted) {
  if (!extracted) return extracted;
  const { nutritionBasis, packGrams, servingsPerPack, ...out } = extracted;
  if (!out.nutrition || Object.keys(out.nutrition).length === 0) {
    delete out.nutrition;
    return out;
  }
  if (nutritionBasis !== 'perServing') return out;

  const serving = num(out.servingGrams)
    || (num(packGrams) && num(servingsPerPack) ? round(packGrams / servingsPerPack) : null);
  if (serving) {
    out.nutrition = perServingToPer100(out.nutrition, serving);
    out.servingGrams = serving;
    out.convertedFromServingGrams = serving;
  } else {
    out.nutritionPerServing = out.nutrition;
    delete out.nutrition;
    delete out.servingGrams;
  }
  return out;
}
