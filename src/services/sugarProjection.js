// src/services/sugarProjection.js
//
// "If you have this every day, how much sugar does it add up to?" --
// pure arithmetic on the product's own label figures, nothing else.
// Deliberately NOT a prediction of what happens to anyone's body: one
// product's label can't know the rest of someone's diet, activity or
// health, so any "this causes X" framing would be inventing certainty
// the data doesn't have (and is exactly the unsubstantiated-harm-claim
// pattern a food brand sued another label app over). What IS knowable
// is plain quantity -- and research on sugar labelling found exactly
// that works best: teaspoons of sugar rated most effective and read as
// "factual and objective", where a vague "high in sugar" did not.
//
// The SUGAR figure is always the label's own, never estimated. The
// SERVING it's multiplied by comes from servingResolver.js, which says
// where it came from -- the label, the pack itself, or a typical
// serving for the category (an estimate the UI labels as such).
// No AI call, no network -- null whenever there's no honest story.
import { getNutrientsPer100 } from './nutrientBasis.js';
import { resolveServing, isNotEatenAsPackedName } from './servingResolver.js';

// The standard conversion WHO/public-health sugar messaging uses.
export const GRAMS_PER_TEASPOON = 4;

// Under one teaspoon per serving, "every day" doesn't add up to
// anything worth a whole card -- same idea as dailyHabitCheck.js's own
// MIN_PERCENT_TO_SHOW bar.
const MIN_GRAMS_PER_SERVING = GRAMS_PER_TEASPOON;

// Higher bar when the label gives no added-vs-total split: that one
// figure then includes the food's own sugars too, and on a savory item
// a small amount is mostly just that (a real ready-to-eat biryani
// showed 5.6g -- onions and rice, not a sugar habit worth a card).
// Two teaspoons is where it's reliably a genuinely sweet product.
const MIN_GRAMS_PER_SERVING_NO_SPLIT = GRAMS_PER_TEASPOON * 2;

// Eaten a pinch/spoonful at a time, or not ordinary food at all --
// "a year of sugar from your ketchup" would be a statement about the
// 100g unit, not anyone's real habit.
const EXCLUDED_FOOD_TYPES = new Set(['condiment', 'supplement', 'infant', 'oil-fat']);

// Sugar/sweeteners sold AS a product -- an ingredient spooned into
// something else, not a food eaten by the serving (live: "Mawana Brown
// Sugar", "Puramate Icing Sugar", "I'm Lite Sugar with Stevia" all read
// as ~10 tsp "per serving"). A plain "sugar" in the name only counts on
// a staple/other item, never when it's "sugar free"/"no added sugar".
const SWEETENER_PRODUCT_RE = /\b(jaggery|gur|mishri|khand|shakkar|stevia|sweeteners?|honey|icing sugar|brown sugar|cane sugar|caster sugar|castor sugar|coconut sugar|palm sugar|demerara|sugar cubes?|sugar sachets?)\b/i;
const PLAIN_SUGAR_RE = /\bsugar\b/i;
const SUGAR_CLAIM_RE = /\b(sugar[\s-]*free|no added sugar|less sugar|low sugar|zero sugar|without (?:added )?sugar|reduced sugar|sugarless)\b/i;
const isSweetenerProduct = (name, foodType) =>
  SWEETENER_PRODUCT_RE.test(name)
  || (PLAIN_SUGAR_RE.test(name) && !SUGAR_CLAIM_RE.test(name) && (!foodType || foodType === 'staple' || foodType === 'other'));

// Names that say the sugar in them is the food's own (fruit, milk)
// rather than added -- only matters when the label gives no separate
// added-sugar figure to tell the two apart (see below).
// A "100%" that says nothing about sugar -- "CAKE 100% VEG Gobbles", "100%
// whole wheat" -- doesn't count; it hid a cake's 16 g of sugar a serving.
const NATURAL_SUGAR_NAME_RE = /(\b100\s*%(?!\s*(?:pure\s+)?(?:veg|vegetarian|eggless|atta|whole|wheat|millet|oats?|ragi)\b)|\bno added sugar|\bwithout added sugar|\bzero added sugar|\bunsweetened\b)/i;

// A ready-to-drink with more sugar than this per 100ml isn't real --
// Coke is ~10.6g, sweetened juices ~12-14g. Live: a Mogu Mogu at 32g/100ml
// (25.6 tsp a bottle), almost certainly its per-bottle figure saved as
// per-100.
const MAX_PLAUSIBLE_BEVERAGE_SUGAR_PER_100 = 20;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Shared by every 'what this adds up to' projection (sugar here; salt and
 * fat in nutrientProjection.js): true for anything not eaten the way it's
 * packed -- spooned in, dosed, made up with water, or not ordinary food --
 * where multiplying a serving out would describe the unit, not a habit.
 */
export function isNotEatenAsPacked(report) {
  if (report.isCondimentOrSeasoning || report.isInfantFormula) return true;
  if (EXCLUDED_FOOD_TYPES.has(report.foodType)) return true;
  return isNotEatenAsPackedName(report.productName);
}

/**
 * @param {object} report - a saved product report.
 * @returns {null | {
 *   gramsPerServing: number, teaspoonsPerServing: number,
 *   isAddedSugar: boolean, servingGrams: number, servingUnit: string,
 *   servingSource: 'label'|'pack'|'standard',
 * }}
 */
export function buildSugarProjection(report) {
  if (!report || isNotEatenAsPacked(report)) return null;
  if (isSweetenerProduct(report.productName || '', report.foodType)) return null;

  const per100 = getNutrientsPer100(report);
  if (!per100) return null;

  // How the pipeline stores sugar (openFoodFacts.js/blinkitProductsRepo.js):
  // addedSugarG is the label's added-sugar figure, falling back to its
  // TOTAL sugar when no added figure exists; totalSugarG is only stored
  // when it genuinely differs -- i.e. when the label actually split the
  // two. So totalSugarG present = addedSugarG really is added sugar.
  const hasSplit = typeof per100.totalSugarG === 'number';
  const sugarPer100 = per100.addedSugarG;
  if (typeof sugarPer100 !== 'number' || !Number.isFinite(sugarPer100) || sugarPer100 <= 0) return null;
  if (report.foodType === 'beverage' && sugarPer100 > MAX_PLAUSIBLE_BEVERAGE_SUGAR_PER_100) return null;
  // Physically impossible -- nothing is more than 100% sugar (live: a
  // cake at 240g/100g, 24 tsp in a 40g slice, a data-entry error).
  if (sugarPer100 > 100) return null;

  // Without that split, the one figure could be entirely natural sugar
  // (a glass of plain milk's own lactose, a 100% juice's own fruit
  // sugar) -- stacking that up as "spoons of sugar a year" would
  // mislead, so skip rather than guess.
  if (!hasSplit && (report.foodType === 'dairy' || NATURAL_SUGAR_NAME_RE.test(report.productName || ''))) return null;

  const serving = resolveServing(report);
  if (!serving) return null;

  const gramsPerServing = round1((sugarPer100 * serving.grams) / 100);
  if (gramsPerServing < (hasSplit ? MIN_GRAMS_PER_SERVING : MIN_GRAMS_PER_SERVING_NO_SPLIT)) return null;

  return {
    gramsPerServing,
    teaspoonsPerServing: round1(gramsPerServing / GRAMS_PER_TEASPOON),
    isAddedSugar: hasSplit,
    servingGrams: serving.grams,
    servingUnit: serving.unit,
    servingSource: serving.source,
  };
}

/**
 * Total sugar over a week/month/year at a given frequency -- plain
 * multiplication, no rounding tricks. A "month" is 30 days, a "year" 52
 * weeks, both stated plainly in the UI.
 *
 * @param {number} gramsPerServing
 * @param {number} timesPerWeek - e.g. 7 (every day), 3, 1
 */
export function accumulateSugar(gramsPerServing, timesPerWeek) {
  const perWeek = gramsPerServing * timesPerWeek;
  const totals = {
    week: perWeek,
    month: (perWeek / 7) * 30,
    year: perWeek * 52,
  };
  const out = {};
  for (const [period, grams] of Object.entries(totals)) {
    out[period] = {
      grams: Math.round(grams),
      teaspoons: Math.round(grams / GRAMS_PER_TEASPOON),
      kg: round1(grams / 1000),
    };
  }
  return out;
}
