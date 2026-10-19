// src/services/claimCheck.js
//
// "Sugar free" on the name -- is it? Reads the claims in a product's name and
// compares each with what we saved for it: the nutrition table (per 100 g/ml)
// and the ingredient list. Pure, no network: it runs on the report the page
// already has.
//
// Limits are FSSAI's Advertising & Claims rules (2018, restated in the June
// 2019 direction): sugar free <= 0.5 g sugars per 100 g/ml, low sugar <= 5 g
// per 100 g (2.5 g per 100 ml), sodium free <= 5 mg, low sodium <= 120 mg,
// high fibre >= 6 g, source of fibre >= 3 g. "No added sugar / salt" has no
// number: it means none was added as an ingredient, so the ingredient list
// decides.
//
// Three outcomes per claim: 'match', 'mismatch', 'unknown' (not enough data).
// A figure that is missing is never guessed -- that is 'unknown'.
//
// Sugar convention (see trafficLight.js): totalSugarG is the label's "total
// sugars" and only exists when the label splits total from added; otherwise
// addedSugarG holds the label's single sugar figure. The sugar figure is
// therefore totalSugarG, else addedSugarG -- the same one the traffic lights
// above use, so the two never disagree on one screen. addedSugarG only counts
// as "added sugar" (for "no added sugar") when totalSugarG is there too.

// Label figures are rounded ("0.53 g" for a 0.5 g limit), so a figure within
// 10% of the limit still counts as meeting it. Only a clear miss is a mismatch.
export const TOLERANCE = 0.1;
const within = (value, limit) => value <= limit * (1 + TOLERANCE);
const atLeast = (value, limit) => value >= limit * (1 - TOLERANCE);

export const LIMITS = {
  sugarFree: 0.5,
  lowSugarFood: 5,
  lowSugarDrink: 2.5,
  sodiumFreeMg: 5,
  lowSodiumMg: 120,
  highFibre: 6,
  sourceOfFibre: 3,
};

// Order matters only for display. "no sugar added" is a no-added-sugar claim,
// not a sugar-free one, so sugarFree refuses a trailing "added".
const CLAIMS = [
  { id: 'sugarFree', re: /\b(sugar[\s-]?free|sugarless|zero[\s-]?sugars?|no[\s-]?sugars?(?!\s+added)|0\s?%\s?sugars?)\b/i },
  { id: 'noAddedSugar', re: /\b(no\s+added\s+sugars?|without\s+added\s+sugars?|no\s+sugars?\s+added)\b/i },
  { id: 'unsweetened', re: /\bunsweeten(?:ed)?\b/i },
  { id: 'lowSugar', re: /\blow[\s-]?sugars?\b/i },
  { id: 'saltFree', re: /\b(salt[\s-]?free|sodium[\s-]?free|zero[\s-]?salt|no[\s-]?salt(?!\s+added))\b/i },
  { id: 'noAddedSalt', re: /\b(no\s+added\s+salt|without\s+added\s+salt|no\s+salt\s+added|unsalted)\b/i },
  { id: 'lowSodium', re: /\blow[\s-]?(?:sodium|salt)\b/i },
  { id: 'highFibre', re: /\b(?:high|rich)[\s-]?(?:in\s+)?fib(?:re|er)\b/i },
  { id: 'sourceOfFibre', re: /\bsource\s+of\s+fib(?:re|er)\b/i },
];

/** The claims written in a name: [{ id, text }] -- `text` is the words as printed. */
export function detectClaims(text) {
  const found = [];
  for (const { id, re } of CLAIMS) {
    const m = re.exec(String(text || ''));
    if (m) found.push({ id, text: m[0] });
  }
  return found;
}

// Ingredient words. "Free / substitute / alcohol" in the same name ("Sugar
// Alcohol", "Sugar Free Sweetener") means it is not sugar.
const SUGAR_ING = /\b(sugar|sucrose|jaggery|gur|honey|molasses|glucose|fructose|dextrose|treacle|agave|invert\s+(?:sugar|syrup)|(?:corn|golden|maple|date|rice|cane)\s+syrup|cane\s+juice)\b/i;
const NOT_SUGAR = /\b(free|substitute|alcohols?|replacer|alternative)\b/i;
const SWEETENER_ING = /\b(aspartame|sucralose|acesulfame|stevia|steviol|saccharin|erythritol|xylitol|sorbitol|maltitol|isomalt|mannitol|neotame|advantame|cyclamate|thaumatin|monk\s+fruit)\b/i;
const SALT_ING = /\b(salt|salted|sodium\s+chloride|namak)\b/i;
const SODIUM_SALT_ING = /\b(salt|salted|sodium|monosodium|msg|baking\s+soda|namak)\b/i;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const names = (ingredients) => (Array.isArray(ingredients) ? ingredients.map((i) => String(i?.name || '').trim()).filter(Boolean) : []);

/** Ingredient names matching `re`; `state` is 'unknown' when there is no real list to look in. */
function scanIngredients(ingredients, re, { skip } = {}) {
  const all = names(ingredients);
  if (all.length < 2) return { state: 'unknown', found: [] };
  const found = all.filter((n) => re.test(n) && !(skip && skip.test(n)));
  return { state: found.length ? 'bad' : 'ok', found: found.slice(0, 3) };
}

const figureCheck = (nutrient, value, unit, ok) => ({ kind: 'figure', nutrient, value, unit, state: ok ? 'ok' : 'bad' });
const noFigure = (nutrient) => ({ kind: 'noFigure', nutrient, state: 'unknown' });
const ingredientCheck = (what, scan) => (scan.state === 'unknown'
  ? { kind: 'noIngredients', state: 'unknown' }
  : { kind: 'ingredients', what, state: scan.state, names: scan.found });

/** The label's sugar figure against a limit (g per 100). */
function sugarLimit(n, limit) {
  const sugar = num(n?.totalSugarG) ?? num(n?.addedSugarG);
  return sugar === null ? noFigure('sugars') : figureCheck('sugars', sugar, 'g', within(sugar, limit));
}

function sodiumLimit(n, limitMg) {
  const sodium = num(n?.sodiumMg);
  return sodium === null ? noFigure('sodium') : figureCheck('sodium', sodium, 'mg', within(sodium, limitMg));
}

function fibreAtLeast(n, limit) {
  const fibre = num(n?.fibreG) ?? num(n?.fiberG);
  return fibre === null ? noFigure('fibre') : figureCheck('fibre', fibre, 'g', atLeast(fibre, limit));
}

// bad anywhere -> mismatch; else a figure/ingredient check that came out ok -> match; else unknown.
function verdictOf(checks) {
  if (checks.some((c) => c.state === 'bad')) return 'mismatch';
  if (checks.some((c) => c.state === 'ok')) return 'match';
  return 'unknown';
}

function evaluate(id, p) {
  const n = p.nutrientsPer100;
  const sugarIng = () => scanIngredients(p.ingredients, SUGAR_ING, { skip: NOT_SUGAR });

  switch (id) {
    case 'sugarFree': {
      const table = sugarLimit(n, LIMITS.sugarFree);
      const checks = [table];
      const ing = sugarIng();
      if (ing.state === 'bad') checks.push(ingredientCheck('sugar', ing));
      return { limit: { cmp: 'atMost', value: LIMITS.sugarFree, unit: 'g' }, checks };
    }
    case 'lowSugar': {
      const limit = p.isDrink ? LIMITS.lowSugarDrink : LIMITS.lowSugarFood;
      return { limit: { cmp: 'atMost', value: limit, unit: 'g' }, checks: [sugarLimit(n, limit)] };
    }
    case 'noAddedSugar':
    case 'unsweetened': {
      const checks = [ingredientCheck('sugar', sugarIng())];
      const total = num(n?.totalSugarG);
      const added = num(n?.addedSugarG);
      if (total !== null && added !== null) checks.push(figureCheck('addedSugars', added, 'g', added <= 0));
      if (id === 'unsweetened') {
        const sweet = scanIngredients(p.ingredients, SWEETENER_ING);
        if (sweet.state === 'bad') checks.push({ kind: 'ingredients', what: 'sweetener', state: 'bad', names: sweet.found });
      }
      const verdict = verdictOf(checks);
      // Natural sugars are allowed to remain; say so when there are some.
      if (verdict !== 'mismatch' && total !== null && total > 0) checks.push({ kind: 'natural', value: total, state: 'info' });
      return { limit: { cmp: 'notAdded', what: 'sugar' }, checks };
    }
    case 'saltFree': {
      const checks = [sodiumLimit(n, LIMITS.sodiumFreeMg)];
      const ing = scanIngredients(p.ingredients, SALT_ING);
      if (ing.state === 'bad') checks.push(ingredientCheck('salt', ing));
      return { limit: { cmp: 'atMost', value: LIMITS.sodiumFreeMg, unit: 'mg' }, checks };
    }
    case 'lowSodium':
      return { limit: { cmp: 'atMost', value: LIMITS.lowSodiumMg, unit: 'mg' }, checks: [sodiumLimit(n, LIMITS.lowSodiumMg)] };
    case 'noAddedSalt':
      return { limit: { cmp: 'notAdded', what: 'salt' }, checks: [ingredientCheck('salt', scanIngredients(p.ingredients, SODIUM_SALT_ING))] };
    case 'highFibre':
      return { limit: { cmp: 'atLeast', value: LIMITS.highFibre, unit: 'g' }, checks: [fibreAtLeast(n, LIMITS.highFibre)] };
    case 'sourceOfFibre':
      return { limit: { cmp: 'atLeast', value: LIMITS.sourceOfFibre, unit: 'g' }, checks: [fibreAtLeast(n, LIMITS.sourceOfFibre)] };
    default:
      return null;
  }
}

/**
 * @param {object} p
 * @param {string} p.productName
 * @param {string} [p.brand]
 * @param {object|null} p.nutrientsPer100 - per 100 g/ml
 * @param {Array<{ name: string }>} p.ingredients
 * @param {boolean} [p.isDrink] - drinks use the per-100 ml limit for low sugar
 * @param {boolean} [p.isInfantFormula] - never checked
 * @returns {Array<{ id, text, verdict: 'match'|'mismatch'|'unknown', limit, checks }>}
 */
export function checkClaims(p) {
  if (!p || p.isInfantFormula) return [];
  const brand = String(p.brand || '').trim();
  const name = String(p.productName || '').trim();
  const text = brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${name}` : name;
  return detectClaims(text).map(({ id, text: claimText }) => {
    const { limit, checks } = evaluate(id, p);
    return { id, text: claimText, verdict: verdictOf(checks), limit, checks };
  });
}
