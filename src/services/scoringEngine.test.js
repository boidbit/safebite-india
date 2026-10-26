// src/services/scoringEngine.test.js
//
// Run with: node --test src/services/scoringEngine.test.js
// (or `npm test`, which runs every *.test.js file under src/).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, applyRealNutrientCap } from './scoringEngine.js';

function ing(overrides) {
  return { name: 'Ingredient', status: 'safe', category: null, penalty: 0, insCode: null, ...overrides };
}

test('a clean ingredient list with no real nutrient data scores unaffected', () => {
  const report = buildReport([ing({ name: 'Potato' }), ing({ name: 'Salt', penalty: 3 })], {});
  const before = report.overallScore;
  applyRealNutrientCap(report, null);
  assert.equal(report.overallScore, before);
});

test('a real saturated-fat number that clears the "worth mentioning" bar caps an otherwise-clean product at Moderate, at most', () => {
  // Regression for a real scanned product: Bingo Potato Chips Salted --
  // ingredients are just potato/oil/salt (nothing artificial to flag),
  // scoring 92 ("Very Healthy") on ingredients alone, while its OWN
  // Quick Health Check section already said 75% of the daily saturated
  // fat limit in one serving. The score never reflected that until now.
  const report = buildReport(
    [ing({ name: 'Potato' }), ing({ name: 'Edible Vegetable Oil', category: 'oil', penalty: 12 }), ing({ name: 'Iodized Salt', penalty: 3 })],
    {}
  );
  assert.ok(report.overallScore >= 85); // confirms the "clean ingredients" starting point
  const habitCheck = { nutrientKey: 'saturatedFatG', nutrientLabel: 'saturated fat', amount: 16.6, limit: 22, unit: 'g', percent: 75, servingGrams: null };
  applyRealNutrientCap(report, habitCheck);
  assert.ok(report.overallScore <= 64);
  assert.equal(report.verdict, 'Moderate');
});

test('a real nutrient number that does NOT clear the 30% bar (dailyHabitCheck.js already returns null) never triggers the cap', () => {
  const report = buildReport([ing({ name: 'Potato' })], {});
  const before = report.overallScore;
  applyRealNutrientCap(report, null); // buildDailyHabitCheck already returned null upstream
  assert.equal(report.overallScore, before);
});

test('the nutrient cap never RAISES a score that ingredients already put lower', () => {
  const report = buildReport(
    [ing({ name: 'Tartrazine', status: 'harmful', penalty: 40 })],
    {}
  );
  const before = report.overallScore;
  const habitCheck = { nutrientKey: 'sodiumMg', nutrientLabel: 'sodium', amount: 1500, limit: 2000, unit: 'mg', percent: 75, servingGrams: null };
  applyRealNutrientCap(report, habitCheck);
  assert.equal(report.overallScore, before); // squeezeToCap is a no-op when already below the cap
});

test('a flagged artificial sweetener (sucralose) does not force the Moderate cap, but still costs its penalty and stays flagged', () => {
  // Regression: a whey protein with a trace of sucralose was held at 64 no
  // matter how clean the rest of the list was.
  const clean = [
    ing({ name: 'Whey Protein Concentrate', category: 'protein', penalty: 2 }),
    ing({ name: 'Cocoa Powder', penalty: 1 }),
  ];
  const sucralose = ing({ name: 'Sweetener Sucralose', category: 'sweetener', status: 'concerning', penalty: 15 });
  const without = buildReport(clean, {});
  const withSweetener = buildReport([...clean, sucralose], {});
  assert.ok(withSweetener.overallScore > 64);
  assert.ok(withSweetener.overallScore < without.overallScore); // penalty still applies
  assert.ok(withSweetener.flags.some((f) => /sucralose/i.test(JSON.stringify(f)))); // still flagged
});

test('a product whose only flag is a sweetener never reaches "Excellent" (84 at most), but scores below that stay untouched', () => {
  const sucralose = ing({ name: 'Sucralose', category: 'sweetener', status: 'concerning', penalty: 1 });
  const clean = buildReport([ing({ name: 'Water' }), sucralose], {});
  assert.ok(clean.overallScore <= 84);
  assert.notEqual(clean.verdict, 'Excellent');
  const heavier = buildReport([ing({ name: 'Whey', penalty: 10 }), ing({ name: 'Cocoa', penalty: 8 }), { ...sucralose, penalty: 15 }], {});
  assert.ok(heavier.overallScore > 64 && heavier.overallScore < 84);
  assert.equal(heavier.overallScore, 100 - (10 + 8 + 15)); // full penalties, no squeeze applied
});

test('sweeteners are matched by INS code too (e.g. 955 / 950)', () => {
  const report = buildReport(
    [ing({ name: 'Potato' }), ing({ name: 'Sweetener', insCode: 'INS 955', category: 'sweetener', status: 'concerning', penalty: 5 })],
    {}
  );
  assert.ok(report.overallScore > 64);
});

test('plain sugar (also category "sweetener") still triggers the Moderate cap', () => {
  const report = buildReport(
    [ing({ name: 'Potato' }), ing({ name: 'Sugar', category: 'sweetener', status: 'concerning', penalty: 1 })],
    {}
  );
  assert.ok(report.overallScore <= 64);
});

test('a sweetener does not hide the cap when another concerning ingredient is present', () => {
  const report = buildReport(
    [
      ing({ name: 'Potato' }),
      ing({ name: 'Sucralose', category: 'sweetener', status: 'concerning', penalty: 5 }),
      ing({ name: 'Palm Oil', category: 'oil', status: 'concerning', penalty: 1 }),
    ],
    {}
  );
  assert.ok(report.overallScore <= 64);
});

test('applyRealNutrientCap with no habitCheck at all leaves the report untouched', () => {
  const report = buildReport([ing({ name: 'Potato' })], {});
  const before = { score: report.overallScore, verdict: report.verdict };
  const result = applyRealNutrientCap(report, undefined);
  assert.equal(result.overallScore, before.score);
  assert.equal(result.verdict, before.verdict);
});
