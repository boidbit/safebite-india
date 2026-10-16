// src/services/compareProducts.test.js
//
// Run with: node --test src/services/compareProducts.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonRows, describeDifferences, personalFitLabels } from './compareProducts.js';

// Three real-shape instant noodle products, numbers in the plausible
// real range for this category (Maggi's own label lists sodium in the
// 1000-1200mg/100g range; the other two are constructed to have a real,
// describable spread against it without inventing an unrealistic product).
// realNutrients uses "caloriesKcal", not "energyKcal" -- confirmed by
// reading openFoodFacts.js and blinkitProductsRepo.js, the two real
// places this object is actually built; getting this wrong in
// compareProducts.js itself was a real bug (Energy row always showed
// "--" for every real product) caught by re-reading those sources.
const MAGGI = {
  lookupKey: 'barcode:maggi',
  productName: 'Maggi 2 Minute Noodles Masala',
  brand: 'Nestle',
  overallScore: 48,
  realNutrients: { caloriesKcal: 457, proteinG: 9.5, carbohydrateG: 60.3, addedSugarG: 6.1, totalFatG: 17.2, saturatedFatG: 7.9, sodiumMg: 890 },
  ingredients: [
    { name: 'Palm Oil', insCode: null, category: 'oil', status: 'concerning' },
    { name: 'Wheat Flour', insCode: null, category: 'natural', status: 'safe' },
    { name: 'Flavour Enhancer', insCode: '635', category: 'flavour', status: 'concerning' },
    { name: 'Acidity Regulator', insCode: '501', category: 'acidity regulator', status: 'safe' },
    { name: 'Palm Oil Blend', insCode: null, category: 'oil', status: 'concerning' },
  ],
};

const YIPPEE = {
  lookupKey: 'barcode:yippee',
  productName: 'Sunfeast Yippee Noodles Magic Masala',
  brand: 'Sunfeast',
  overallScore: 61,
  realNutrients: { caloriesKcal: 430, proteinG: 8.2, carbohydrateG: 62.1, addedSugarG: 4.2, totalFatG: 15.1, saturatedFatG: 6.8, sodiumMg: 620 },
  ingredients: [
    { name: 'Wheat Flour', insCode: null, category: 'natural', status: 'safe' },
    { name: 'Salt', insCode: null, category: 'other', status: 'safe' },
  ],
};

const TOP_RAMEN = {
  lookupKey: 'barcode:topramen',
  productName: 'Top Ramen Masala Noodles',
  brand: 'Nissin',
  overallScore: 58,
  realNutrients: { caloriesKcal: 444, proteinG: 9.1, carbohydrateG: 61.0, addedSugarG: 4.8, totalFatG: 16.8, saturatedFatG: 7.1, sodiumMg: 720 },
  ingredients: [
    { name: 'Wheat Flour', insCode: null, category: 'natural', status: 'safe' },
    { name: 'Flavour Enhancer', insCode: '621', category: 'flavour', status: 'concerning' },
    { name: 'Preservative', insCode: '211', category: 'preservative', status: 'concerning' },
  ],
};

// Real scenario reported live: Masala Oats vs a digestive biscuit,
// profile selected ONLY lowerSugar + lowerCalories.
const MASALA_OATS = {
  lookupKey: 'barcode:oats',
  productName: 'Masala Oats - Peppy Tomato',
  brand: 'Saffola',
  overallScore: 58,
  realNutrients: { caloriesKcal: 380, proteinG: 3.3, totalSugarG: 2.8, totalFatG: 2.9, saturatedFatG: 0.5, sodiumMg: 728 },
  ingredients: [{ name: 'Oats', insCode: null, category: 'natural', status: 'safe' }],
};

const DIGESTIVE = {
  lookupKey: 'barcode:digestive',
  productName: 'Britannia Nutrichoice Digestive',
  brand: 'Britannia',
  overallScore: 59,
  realNutrients: { caloriesKcal: 460, proteinG: 1.4, totalSugarG: 1.8, totalFatG: 3.1, saturatedFatG: 1.6, sodiumMg: 55 },
  ingredients: [{ name: 'Refined Wheat Flour', insCode: null, category: 'natural', status: 'concerning' }],
};

test('buildComparisonRows pulls the full nutrient set from realNutrients', () => {
  const [maggi] = buildComparisonRows([MAGGI]);
  assert.equal(maggi.energyKcal, 457);
  assert.equal(maggi.proteinG, 9.5);
  assert.equal(maggi.totalCarbG, 60.3);
  assert.equal(maggi.sugarG, 6.1);
  assert.equal(maggi.totalFatG, 17.2);
  assert.equal(maggi.saturatedFatG, 7.9);
  assert.equal(maggi.sodiumMg, 890);
});

test('buildComparisonRows computes additives count + label', () => {
  const [maggi, yippee] = buildComparisonRows([MAGGI, YIPPEE]);
  assert.equal(maggi.additives, 2); // insCode 635 and 501
  assert.equal(maggi.additivesLabel, 'Some');
  assert.equal(yippee.additives, 0);
  assert.equal(yippee.additivesLabel, 'None');
});

test('buildComparisonRows computes a processing label from the "Highly processed" severity tier', () => {
  const rows = buildComparisonRows([MAGGI, YIPPEE]);
  // Both rows must get SOME label (Low/Medium/High), not null, given real ingredients.
  assert.ok(['Low', 'Medium', 'High'].includes(rows[0].processing));
  assert.ok(['Low', 'Medium', 'High'].includes(rows[1].processing));
});

test('personalFitLabels marks the best/worst personal score within the SET, not an absolute tier', () => {
  const profile = { nickname: 'Ibbu', priorities: ['lowerSodium', 'fewerAdditives'] };
  const rows = buildComparisonRows([MAGGI, YIPPEE, TOP_RAMEN], profile);
  const labels = personalFitLabels(rows);
  const yippeeRow = rows.find((r) => r.lookupKey === 'barcode:yippee');
  const maggiRow = rows.find((r) => r.lookupKey === 'barcode:maggi');
  assert.equal(labels[yippeeRow.lookupKey], 'Better fit');
  assert.equal(labels[maggiRow.lookupKey], 'Lower fit');
});

test('describeDifferences names real, large gaps as bullets with actual values', () => {
  const rows = buildComparisonRows([MAGGI, YIPPEE, TOP_RAMEN]);
  const { bullets } = describeDifferences(rows);
  const sugarBullet = bullets.find((b) => b.includes('sugar'));
  assert.match(sugarBullet, /Sunfeast Yippee Noodles Magic Masala has lower sugar \(4\.2g vs 6\.1g\) than Maggi 2 Minute Noodles Masala\./);

  const sodiumBullet = bullets.find((b) => b.includes('sodium'));
  assert.match(sodiumBullet, /Sunfeast Yippee Noodles Magic Masala has lower sodium \(620mg vs 890mg\) than Maggi 2 Minute Noodles Masala\./);
});

test('describeDifferences includes a personal-fit bullet naming a real concern only the worse product tripped', () => {
  const profile = { nickname: 'Ibbu', priorities: ['fewerAdditives'] };
  const rows = buildComparisonRows([MAGGI, YIPPEE], profile);
  const { bullets } = describeDifferences(rows, profile);
  const fitBullet = bullets.find((b) => b.startsWith('For Ibbu'));
  assert.match(fitBullet, /Sunfeast Yippee Noodles Magic Masala is a better fit due to fewer flagged additive-related concerns\./);
});

test('take.text never credits a metric the profile never selected as a priority -- real bug found via live testing', () => {
  // Ibbu's real profile: prioritize protein, fewer additives, more
  // whole-food ingredients -- deliberately NOT lowerSugar or
  // lowerSodium. Maggi wins personalScore (fewest matched AVOID
  // concerns) while also happening to have the lowest sugar/sodium of
  // the three -- the take text must not cite sugar/sodium as "why",
  // since Ibbu never asked to watch either one.
  const profile = { nickname: 'Ibbu', priorities: ['higherProtein', 'fewerAdditives', 'moreWholeFood'] };
  const rows = buildComparisonRows([MAGGI, YIPPEE, TOP_RAMEN], profile);
  const { take } = describeDifferences(rows, profile);
  assert.equal(take.label, 'For Ibbu');
  assert.doesNotMatch(take.text, /sugar/);
  assert.doesNotMatch(take.text, /sodium/);
});

test('take.text DOES credit a metric the profile explicitly selected, when the winner wins on ALL of them', () => {
  const profile = { nickname: 'Ibbu', priorities: ['lowerSugar', 'lowerSodium'] };
  const rows = buildComparisonRows([MAGGI, YIPPEE, TOP_RAMEN], profile);
  const { take } = describeDifferences(rows, profile);
  // Yippee is both the personal-score winner here and the real sugar/
  // sodium winner -- now that those ARE selected priorities, citing
  // them is correct, not a bug.
  assert.match(take.text, /Sunfeast Yippee Noodles Magic Masala has the higher Personal Fit/);
  assert.match(take.text, /sugar/);
  assert.match(take.text, /sodium/);
});

test('take.text names BOTH sides when selected priorities pull in different directions -- real reported scenario (Talib)', () => {
  // Talib's real profile: lowerSugar + lowerCalories only. Britannia
  // has lower sugar (1.8g vs 2.8g) AND wins personalScore, but Masala
  // Oats has FEWER calories (380 vs 460) -- both are selected
  // priorities, so the take must name both sides, not just credit the
  // personal-score winner with a clean sweep it didn't actually have.
  const profile = { nickname: 'Talib', priorities: ['lowerSugar', 'lowerCalories'] };
  const rows = buildComparisonRows([MASALA_OATS, DIGESTIVE], profile);
  const { take } = describeDifferences(rows, profile);
  assert.equal(take.label, 'For Talib');
  assert.match(take.text, /perform differently across Talib's priorities/);
  assert.match(take.text, /Britannia Nutrichoice Digestive has lower sugar/);
  assert.match(take.text, /Masala Oats - Peppy Tomato has fewer calories/);
});

test('buildComparisonRows exposes calories under energyKcal, sourced from realNutrients.caloriesKcal', () => {
  const [oats] = buildComparisonRows([MASALA_OATS]);
  assert.equal(oats.energyKcal, 380);
});

test('describeDifferences never claims a metric the lower-scoring product is actually better on', () => {
  // Yippee scores higher overall but this time has MORE sodium than Maggi
  // -- the sodium bullet must not claim Yippee "has lower sodium".
  const higherScoreMoreSodium = { ...YIPPEE, overallScore: 70, realNutrients: { ...YIPPEE.realNutrients, sodiumMg: 1400 } };
  const rows = buildComparisonRows([MAGGI, higherScoreMoreSodium]);
  const { bullets } = describeDifferences(rows);
  const sodiumBullet = bullets.find((b) => b.includes('sodium'));
  assert.match(sodiumBullet, /^Maggi 2 Minute Noodles Masala has lower sodium/);
});

test('describeDifferences returns a take naming the top scorer and its real winning metrics, with no active profile', () => {
  const rows = buildComparisonRows([MAGGI, YIPPEE, TOP_RAMEN]);
  const { take } = describeDifferences(rows);
  assert.equal(take.label, 'Our take');
  assert.match(take.text, /^If choosing among these, Sunfeast Yippee Noodles Magic Masala has the highest score/);
});

test('describeDifferences returns a "too close to call" take when every product ties', () => {
  const tied = buildComparisonRows([MAGGI, { ...YIPPEE, overallScore: MAGGI.overallScore }]);
  const { take, bullets } = describeDifferences(tied);
  assert.match(take.text, /close enough in score/);
  // No numeric bullets either -- ties on score don't retroactively make
  // real nutrient gaps stop being real, but there's nothing to declare
  // a "winner" over, so this asserts the tie case doesn't crash, not
  // that bullets must be empty.
  assert.ok(Array.isArray(bullets));
});

test('describeDifferences returns empty bullets and null take for fewer than 2 products', () => {
  const rows = buildComparisonRows([MAGGI]);
  const { bullets, take } = describeDifferences(rows);
  assert.deepEqual(bullets, []);
  assert.equal(take, null);
});

test('buildComparisonRows compares on a per-100 basis even when realNutrients is per serving', () => {
  // A 16 g serving with 80 kcal is 500 kcal per 100 g -- that's the number
  // that must appear next to another product's per-100 figure.
  const perServing = { productName: 'Cookie', ingredients: [], realNutrients: { caloriesKcal: 80 }, realNutrientsServingGrams: 16 };
  const [row] = buildComparisonRows([perServing]);
  assert.equal(row.energyKcal, 500);
});

// ---- the verdict and the scoreboard ----

import { buildVerdict, buildScoreboard, scoreFitLabels, CLOSE_GAP } from './compareProducts.js';

const row = (name, overallScore, extra = {}) => ({
  lookupKey: `k:${name}`, productName: name, overallScore, personalScore: null, matchedConcerns: [],
  energyKcal: null, proteinG: null, totalCarbG: null, sugarG: null, totalFatG: null, saturatedFatG: null, sodiumMg: null,
  additives: 0, additivesLabel: 'None', processing: null, ...extra,
});

test('scores within CLOSE_GAP are "Similar", not Better/Lower (real: bhujia 50, 52, 52, 51)', () => {
  const rows = [row('Haldiram', 50), row('Brij', 52), row('Bikano', 52), row('Balaji', 51)];
  const labels = scoreFitLabels(rows);
  assert.deepEqual(Object.values(labels), ['Similar', 'Similar', 'Similar', 'Similar']);
});

test('labels still separate a real gap, and a top group shares "Better"', () => {
  const rows = [row('A', 90), row('B', 88), row('C', 40), row('D', 64)];
  const labels = scoreFitLabels(rows);
  assert.equal(labels['k:A'], 'Better');
  assert.equal(labels['k:B'], 'Better'); // 2 points behind the best
  assert.equal(labels['k:C'], 'Lower');
  assert.equal(labels['k:D'], 'Moderate');
});

test('buildVerdict: a lead of 5+ points is clear and names the winner', () => {
  const v = buildVerdict([row('Alpha', 80, { proteinG: 14 }), row('Beta', 60, { proteinG: 5 })]);
  assert.equal(v.kind, 'clear');
  assert.match(v.headline, /Alpha comes out ahead/);
  assert.match(v.sub, /80 vs 60 — 20 points higher/);
  assert.match(v.why, /more protein/i);
});

test('buildVerdict: 53 vs 52 is "too close to call", never a winner', () => {
  const v = buildVerdict([row('Alpha', 53), row('Beta', 52)]);
  assert.equal(v.kind, 'close');
  assert.equal(v.headline, 'Too close to call');
  assert.match(v.sub, /within 1 point/);
});

test('buildVerdict: equal scores say they score the same', () => {
  assert.equal(buildVerdict([row('A', 60), row('B', 60)]).headline, 'They score the same');
});

test('buildVerdict: two tied leaders are both named (real: Brij 52 and Bikano 52 above two lower ones)', () => {
  const v = buildVerdict([row('Brij', 52), row('Bikano', 52), row('Low', 30)]);
  assert.equal(v.kind, 'tie');
  assert.match(v.headline, /Brij and Bikano lead together/);
});

test('buildVerdict: a lead of 1-4 over the runner-up is an "edge", not a landslide', () => {
  const v = buildVerdict([row('Top', 70), row('Next', 66), row('Far', 30)]);
  assert.equal(v.kind, 'edge');
  assert.match(v.headline, /Top edges ahead/);
  assert.ok(CLOSE_GAP > 4);
});

test('buildVerdict ranks on the personal score when a profile is active', () => {
  const rows = [row('Gen-best', 80, { personalScore: 50 }), row('Fit-best', 60, { personalScore: 70 })];
  const v = buildVerdict(rows, { nickname: 'Dad', priorities: [] });
  assert.equal(v.who, 'For Dad');
  assert.match(v.headline, /Fit-best/);
});

test('buildVerdict needs two scored products', () => {
  assert.equal(buildVerdict([row('Only', 70)]), null);
  assert.equal(buildVerdict([row('A', null), row('B', 70)]), null);
});

test('buildScoreboard credits each product with what it really leads, and skips thin gaps', () => {
  const rows = [
    row('Atta', 80, { sugarG: 0, saturatedFatG: 1.2, sodiumMg: 300, proteinG: 14, additives: 0, processing: 'Low' }),
    row('Namkeen', 50, { sugarG: 0, saturatedFatG: 9, sodiumMg: 310, proteinG: 8, additives: 4, processing: 'High' }),
  ];
  const { rowWinners, entries } = buildScoreboard(rows);
  assert.ok(rowWinners.saturatedFatG.has('k:Atta'));
  assert.ok(rowWinners.proteinG.has('k:Atta'));
  assert.equal(rowWinners.sodiumMg, undefined); // 300 vs 310 is noise
  assert.equal(rowWinners.sugarG, undefined);   // 0 vs 0
  assert.ok(rowWinners.additives.has('k:Atta'));
  assert.ok(rowWinners.processing.has('k:Atta'));
  const atta = entries.find((e) => e.row.productName === 'Atta');
  assert.ok(atta.wins.some((w) => w.label === 'Less saturated fat' && w.text === '1.2g · vs 9g'));
  assert.equal(entries.find((e) => e.row.productName === 'Namkeen').wins.length, 0);
});

test('buildScoreboard with 3+ products shows the range of the others', () => {
  const rows = [row('A', 70, { sodiumMg: 100 }), row('B', 60, { sodiumMg: 500 }), row('C', 55, { sodiumMg: 800 })];
  const a = buildScoreboard(rows).entries[0];
  assert.equal(a.wins[0].text, '100mg · others 500mg–800mg');
});

test('buildScoreboard: 0 vs 1 additives is not a real difference', () => {
  const rows = [row('A', 70, { additives: 0 }), row('B', 60, { additives: 1 })];
  assert.equal(buildScoreboard(rows).rowWinners.additives, undefined);
});
