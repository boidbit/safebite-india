// src/utils/homeHooks.js
//
// The words on the home screen's hook cards (ShockReel, LooksHealthyStrip,
// GuessGame) -- pure, so they're tested on their own. Everything here
// reads what a report already computed (flags, dailyHabitCheck); nothing
// re-scores or re-judges a product.

// Words a pack sells health with. Longest first, so "Whole Wheat" wins
// over "Wheat" and "Sugar Free" over "Sugar".
const HEALTH_CLAIMS = [
  'No Added Sugar', 'High Protein', 'High Fibre', 'High Fiber', 'Whole Wheat', 'Whole Grain', 'Sugar Free',
  'Gluten Free', 'Low Fat', 'Multigrain', 'Multi Grain', 'Digestive', 'Protein', 'Fibre', 'Fiber', 'Baked',
  'Oats', 'Millet', 'Ragi', 'Jowar', 'Quinoa', 'Diet', 'Lite', 'Light', 'Nutri', 'Herbal', 'Organic', 'Natural',
  'Honey', 'Fruit', 'Keto', 'Vegan', 'Vitamin', 'Immunity', 'Healthy', 'Fit', 'Slim', 'Zero', 'Real',
];

/** The health word a product's own name leads with, e.g. "Multigrain" -- or null. */
export function detectClaim(productName) {
  const name = ` ${String(productName || '').toLowerCase().replace(/[-_]/g, ' ')} `;
  for (const claim of HEALTH_CLAIMS) {
    if (name.includes(` ${claim.toLowerCase()} `) || name.includes(` ${claim.toLowerCase()}s `)) return claim;
  }
  return null;
}

/**
 * A report's flags (its worst-first ingredient concerns) tidied for a card:
 * "Noodles: Refined Wheat Flour Maida" -> "Refined Wheat Flour Maida",
 * duplicates and fragments ("Lt") dropped.
 */
export function cleanFlags(flags, max = 2) {
  const out = [];
  for (const raw of flags || []) {
    const flag = String(raw || '').replace(/^[^:]{1,30}:\s*/, '').trim();
    if (flag.replace(/[^a-z]/gi, '').length < 4) continue;
    if (out.some((f) => f.toLowerCase() === flag.toLowerCase())) continue;
    out.push(flag);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The card's one line: the admin's own words when given; otherwise the
 * report's "one serving is X% of a day's limit" (the most striking true
 * number it has), otherwise its top flags.
 * @param {{ hook?: string, habit?: { percent: number, nutrientKey: string }, flags?: string[] }} item
 * @param {(key: string, vars?: object) => string} t
 */
export function hookLine(item, t) {
  if (item.hook && item.hook.trim()) return item.hook.trim();
  const habit = item.habit;
  if (habit && Number.isFinite(habit.percent) && habit.percent >= 15) {
    return t('hookHabit', { percent: Math.round(habit.percent), nutrient: t(`nutrient_${habit.nutrientKey}`) });
  }
  const flags = cleanFlags(item.flags);
  if (flags.length) return t('hookFlags', { flags: flags.join(' · ') });
  return '';
}

/**
 * How close a guess was: 'bullseye' (within 5), 'close' (within 15),
 * 'off' (within 30) or 'way' (further). `higher` says which side the
 * real score was on.
 */
export function judgeGuess(guess, actual) {
  const diff = Math.abs(guess - actual);
  const level = diff <= 5 ? 'bullseye' : diff <= 15 ? 'close' : diff <= 30 ? 'off' : 'way';
  return { level, diff, higher: actual > guess };
}

/** Today's slice of a pool -- the same all day, the next items tomorrow. */
export function dailySlice(pool, count, daySeed) {
  if (!pool.length) return [];
  const start = (daySeed * count) % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(start + i) % pool.length]);
}
