// src/utils/reportReasons.js
//
// The few plain reasons shown right under the score ("High salt", "Palmolein",
// "Low sugar"), so the first screen of a report says WHY and not only how much.
// Built only from what the report already shows further down -- the traffic
// lights and the flagged ingredients -- nothing new is worked out here.

const NUTRIENT_ORDER = ['sugars', 'salt', 'satFat', 'fat'];
const SHOWN = 3;
const TONE_RANK = { bad: 0, warn: 1, good: 2 };

/**
 * @param {{ items: Array<{ key: string, level: 'low'|'medium'|'high' }> } | null} trafficLight - buildTrafficLight() output
 * @param {Array<{ ingredient: { name: string }, tier: { key: string } }>} flagged - ingredients that pulled the score down, worst first
 * @param {{ ingredientCount?: number }} [opts]
 * @returns {Array<{ tone: 'bad'|'warn'|'good', key: string, name?: string }>} at most 3, concerns first
 */
export function keyReasons(trafficLight, flagged = [], { ingredientCount = 0 } = {}) {
  const items = trafficLight?.items || [];
  const level = (key) => items.find((i) => i.key === key)?.level;
  // Saturated fat says more than total fat: one chip, not both.
  const high = NUTRIENT_ORDER.filter((k) => level(k) === 'high' && !(k === 'fat' && level('satFat') === 'high'));
  const low = NUTRIENT_ORDER.filter((k) => level(k) === 'low');

  const concerns = [
    ...high.map((k) => ({ tone: 'bad', key: `high_${k}` })),
    ...flagged.slice(0, 2).map(({ ingredient, tier }) => ({ tone: tier.key === 'Harmful' ? 'bad' : 'warn', key: 'ingredient', name: ingredient.name })),
  ];
  const goods = [
    ...low.map((k) => ({ tone: 'good', key: `low_${k}` })),
    ...(flagged.length === 0 && ingredientCount > 0 ? [{ tone: 'good', key: 'noneFlagged' }] : []),
  ];

  // Two concerns, then one good thing when there is one -- a fair picture --
  // then whatever is left.
  const picked = [...concerns.slice(0, 2), ...goods.slice(0, 1)];
  for (const r of [...concerns.slice(2), ...goods.slice(1)]) if (picked.length < SHOWN) picked.push(r);
  return picked
    .slice(0, SHOWN)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => TONE_RANK[a.r.tone] - TONE_RANK[b.r.tone] || a.i - b.i)
    .map(({ r }) => r);
}
