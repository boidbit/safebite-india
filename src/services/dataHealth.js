// src/services/dataHealth.js
//
// Data-health checks for saved products. Each check looks at ONE product and
// returns a short piece of evidence when the saved data contradicts itself --
// "the nutrition table says 0 g sugar but the ingredient list names sugar", "the
// saturated fat is more than the total fat". None of them say which side is
// wrong; they say a person should look. Pure, no network: scripts/audit-data-health.js
// runs them over the catalog, and the same functions can run before a scraped
// product is saved.
import { hasValidChecksum } from './barcodeChecksum.js';
import { parsePack, nameTokens } from './productFamilies.js';
import { verdictFor } from './scoringEngine.js';

// The top tier used to be called "Very Healthy"; reports saved back then still carry that
// word. The product page works the verdict out from the score, so it is a stale label, not a wrong one.
const LEGACY_VERDICT = { 'very healthy': 'Excellent' };
const verdictName = (v) => LEGACY_VERDICT[String(v).toLowerCase()] || v;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Ingredient-text words. Phrases that say "not sugar" / "not fat" come out first.
const NOT_SUGAR = /sugar[\s-]*(free|alcohols?|substitutes?)/gi;
const SUGAR_WORD = /\b(sugar|sucrose|jaggery|honey|molasses|invert\s+(?:sugar|syrup)|corn\s+syrup)\b/i;
// Dextrose / glucose / fructose are often a trace (a coating, a binder) that rounds to 0 g, so they get a separate, lower check.
const TRACE_SUGAR_WORD = /\b(glucose|fructose|dextrose)\b/i;
const SALT_WORD = /\b(salt|sodium\s+chloride|namak)\b/i;
const NOT_FAT = /(fat[\s-]*free|low[\s-]*fat|skim(?:med)?)/gi;
const FAT_WORD = /\b(oil|butter|ghee|cream|cheese|lard|shortening|vanaspati|margarine)\b/i;

const find = (text, re, strip) => {
  const t = strip ? String(text || '').replace(strip, ' ') : String(text || '');
  const m = re.exec(t);
  return m ? m[0] : null;
};

/**
 * @typedef {object} HealthRow
 * @property {string} id
 * @property {string} lookupKey
 * @property {string} name
 * @property {string} [brand]
 * @property {string} [ingredientsText]
 * @property {object|null} [n]          nutrientsPer100
 * @property {string|null} [packSize]
 * @property {string|null} [imageUrl]
 * @property {string|null} [verdict]
 * @property {number|null} [score]
 * @property {string|null} [foodType]
 */

// ---- Structured findings: what the product page and the admin list show as remarks.

/**
 * Table says NONE of a nutrient, the ingredient list names it: { value, word } or null.
 * Zero only: a chapati with 0.4 g sugar can honestly list sugar, a table showing
 * 0 g while the list has sugar can't both be right.
 */
function zeroButListed(value, limit, text, word, strip) {
  if (value === null || value > limit) return null;
  const w = find(text, word, strip);
  return w ? { value, word: w } : null;
}
const ZERO_G = 0.05;
const ZERO_MG = 0.5;
const sugarZero = ({ n, ingredientsText }) => zeroButListed(num(n?.totalSugarG) ?? num(n?.addedSugarG), ZERO_G, ingredientsText, SUGAR_WORD, NOT_SUGAR);
const sodiumZero = ({ n, ingredientsText }) => zeroButListed(num(n?.sodiumMg), ZERO_MG, ingredientsText, SALT_WORD);
const fatZero = ({ n, ingredientsText }) => zeroButListed(num(n?.totalFatG), ZERO_G, ingredientsText, FAT_WORD, NOT_FAT);

/** Figures in a per-100 table that can't all be right: [{ kind, ...values }]. */
export function tableProblems(n) {
  if (!n || typeof n !== 'object') return [];
  const sat = num(n.saturatedFatG), fat = num(n.totalFatG), trans = num(n.transFatG);
  const total = num(n.totalSugarG), added = num(n.addedSugarG), carb = num(n.carbohydrateG), protein = num(n.proteinG);
  const out = [];
  for (const [k, v] of Object.entries(n)) if (num(v) !== null && v < 0) out.push({ kind: 'negative', nutrient: k, value: v });
  for (const k of ['proteinG', 'totalFatG', 'carbohydrateG', 'totalSugarG', 'addedSugarG', 'saturatedFatG', 'fibreG']) {
    if (num(n[k]) !== null && n[k] > 100.5) out.push({ kind: 'over100', nutrient: k, value: n[k] });
  }
  if (sat !== null && fat !== null && sat > fat * 1.05 + 0.1) out.push({ kind: 'satOverFat', sat, fat });
  if (trans !== null && fat !== null && trans > fat * 1.05 + 0.1) out.push({ kind: 'transOverFat', trans, fat });
  if (added !== null && total !== null && added > total * 1.05 + 0.1) out.push({ kind: 'addedOverTotal', added, total });
  if (total !== null && carb !== null && total > carb * 1.05 + 0.5) out.push({ kind: 'sugarOverCarb', sugar: total, carb });
  if (protein !== null && fat !== null && carb !== null && protein + fat + carb > 105) out.push({ kind: 'macrosOver100', sum: Math.round(protein + fat + carb) });
  return out;
}

function caloriesOff(n) {
  const kcal = num(n?.caloriesKcal), p = num(n?.proteinG), c = num(n?.carbohydrateG), f = num(n?.totalFatG);
  if (kcal === null || p === null || c === null || f === null) return null;
  const expected = 4 * p + 4 * c + 9 * f;
  return Math.abs(kcal - expected) > Math.max(40, expected * 0.35) ? { kcal: Math.round(kcal), expected: Math.round(expected) } : null;
}

/**
 * Why a product's nutrition figures can't be trusted yet -- empty when they look
 * right. Worked out from the saved data every time it's asked, never stored, so
 * the moment the figures are fixed the product drops out of review on its own.
 * @param {{ n: object|null, ingredientsText?: string }} row
 * @returns {Array<{ kind: string } & object>}
 */
export function nutritionIssues(row) {
  const out = [...tableProblems(row.n)];
  const cal = caloriesOff(row.n);
  if (cal) out.push({ kind: 'calories', ...cal });
  const s = sugarZero(row);
  if (s) out.push({ kind: 'sugarZeroListed', ...s });
  const na = sodiumZero(row);
  if (na) out.push({ kind: 'sodiumZeroSalt', ...na });
  const f = fatZero(row);
  if (f) out.push({ kind: 'fatZeroListed', ...f });
  return out;
}

export const CHECKS = [
  {
    id: 'sugarZeroButListed', severity: 'high', title: 'Table says no sugar, ingredient list names sugar',
    test: (row) => { const s = sugarZero(row); return s ? `sugar ${s.value} g, list has "${s.word}"` : null; },
  },
  {
    id: 'sugarZeroButDextrose', severity: 'low', title: 'Table says no sugar, list has dextrose / glucose / fructose (may be a trace)',
    test: ({ n, ingredientsText }) => {
      const sugar = num(n?.totalSugarG) ?? num(n?.addedSugarG);
      if (sugar === null || sugar > ZERO_G || find(ingredientsText, SUGAR_WORD, NOT_SUGAR)) return null;
      const w = find(ingredientsText, TRACE_SUGAR_WORD);
      return w ? `sugar ${sugar} g, list has "${w}"` : null;
    },
  },
  {
    id: 'sodiumZeroButSalt', severity: 'high', title: 'Table says no sodium, ingredient list names salt',
    test: (row) => { const s = sodiumZero(row); return s ? `sodium ${s.value} mg, list has "${s.word}"` : null; },
  },
  {
    id: 'fatZeroButFatListed', severity: 'high', title: 'Table says no fat, ingredient list names oil / butter / ghee',
    test: (row) => { const f = fatZero(row); return f ? `fat ${f.value} g, list has "${f.word}"` : null; },
  },
  {
    id: 'tableImpossible', severity: 'high', title: 'Nutrition table can’t be right',
    test: ({ n }) => {
      const text = {
        negative: (p) => `${p.nutrient} is negative`,
        over100: (p) => `${p.nutrient} ${p.value} g per 100 g`,
        satOverFat: (p) => `saturated fat ${p.sat} > total fat ${p.fat}`,
        transOverFat: (p) => `trans fat ${p.trans} > total fat ${p.fat}`,
        addedOverTotal: (p) => `added sugar ${p.added} > total sugar ${p.total}`,
        sugarOverCarb: (p) => `sugar ${p.sugar} > carbohydrate ${p.carb}`,
        macrosOver100: (p) => `protein+fat+carb = ${p.sum} g per 100 g`,
      };
      const problems = tableProblems(n).map((p) => text[p.kind](p));
      return problems.length ? problems.slice(0, 2).join('; ') : null;
    },
  },
  {
    id: 'barcodeChecksum', severity: 'high', title: 'Barcode fails its check digit',
    test: ({ lookupKey }) => {
      const m = /^barcode:(\d+)$/.exec(lookupKey || '');
      if (!m) return null;
      const format = { 13: 'ean_13', 8: 'ean_8', 12: 'upc_a' }[m[1].length];
      return format && !hasValidChecksum(m[1], format) ? `barcode ${m[1]}` : null;
    },
  },
  {
    id: 'caloriesMismatch', severity: 'medium', title: 'Calories don’t add up from protein, carbohydrate and fat',
    test: ({ n }) => { const c = caloriesOff(n); return c ? `${c.kcal} kcal, but protein/carb/fat give ~${c.expected}` : null; },
  },
  {
    id: 'packNameMismatch', severity: 'medium', title: 'Pack size in the name differs from the saved pack size',
    test: ({ name, packSize }) => {
      const a = parsePack(name), b = parsePack(packSize);
      return a && b && a.key !== b.key ? `name says ${a.label}, pack size says ${b.label}` : null;
    },
  },
  {
    id: 'verdictScoreMismatch', severity: 'medium', title: 'Verdict doesn’t match the score',
    test: ({ verdict, score }) => (verdict && num(score) !== null && verdictFor(score) !== verdictName(verdict) ? `score ${score} is "${verdictFor(score)}", saved verdict "${verdict}"` : null),
  },
  { id: 'noPhoto', severity: 'low', title: 'No product photo', test: ({ imageUrl }) => (imageUrl ? null : 'no photo') },
  { id: 'uncategorised', severity: 'low', title: 'No food type', test: ({ foodType }) => (!foodType || foodType === 'other' ? `food type "${foodType || 'none'}"` : null) },
];

/** Every check that fails for one product: [{ id, severity, title, evidence }]. */
export function checkProduct(row) {
  const out = [];
  for (const c of CHECKS) {
    const evidence = c.test(row);
    if (evidence) out.push({ id: c.id, severity: c.severity, title: c.title, evidence });
  }
  return out;
}

/**
 * Products that share an identical ingredient list but are different products
 * (different name words, pack size aside) -- a copied list is the usual cause,
 * e.g. one flavour's back-of-pack photo reused for another.
 * @returns {Array<{ rows: HealthRow[] }>}
 */
export function sameIngredientsDifferentProducts(rows) {
  const byText = new Map();
  for (const r of rows) {
    const key = String(r.ingredientsText || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key.length < 60) continue; // too short to be a fingerprint
    if (!byText.has(key)) byText.set(key, []);
    byText.get(key).push(r);
  }
  const groups = [];
  for (const group of byText.values()) {
    if (group.length < 2) continue;
    const sets = group.map((r) => nameTokens(r.name));
    const differ = sets.some((s) => s.size > 0 && sets.some((o) => o.size > 0 && (s.size !== o.size || [...s].some((w) => !o.has(w)))));
    if (differ) groups.push({ rows: group });
  }
  return groups;
}
