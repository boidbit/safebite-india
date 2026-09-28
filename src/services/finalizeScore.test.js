import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from './scoringEngine.js';
import { finalizeScore } from './finalizeScore.js';

// A short, "clean" ingredient list -- scores high on ingredients alone.
const chipsIngredients = [
  { name: 'Potato', status: 'safe', penalty: 2, percentage: 60 },
  { name: 'Sunflower Oil', status: 'safe', penalty: 4, percentage: 35 },
  { name: 'Salt', status: 'safe', penalty: 1, percentage: 2 },
];
const chipsPer100 = { totalFatG: 35, saturatedFatG: 4, sodiumMg: 700, addedSugarG: 1, caloriesKcal: 540, proteinG: 6, fibreG: 3 };

function scoreChips(existing = {}) {
  const base = buildReport(chipsIngredients, { productName: 'Potato Chips Salted' });
  const report = { ...existing, ...base, productName: 'Potato Chips Salted', foodType: 'fried-snack', isDeepFried: true, nutrientsPer100: chipsPer100 };
  return finalizeScore(report, { nutrientsInfo: { nutrients: chipsPer100, nutrientsPer100: chipsPer100 } });
}

test('a fried snack keeps its density ceiling -- the admin recalculate bug', () => {
  const ingredientOnly = buildReport(chipsIngredients, {}).overallScore;
  const finalScore = scoreChips().overallScore;
  assert.ok(finalScore < ingredientOnly, `expected the ceiling to lower ${ingredientOnly}, got ${finalScore}`);
});

test('re-scoring an already-scored report gives the same result (no stale fields carried over)', () => {
  const first = scoreChips();
  const again = scoreChips({ ...first }); // exactly what Recalculate does: spread the old report back in
  assert.equal(again.overallScore, first.overallScore);
  assert.equal(again.verdict, first.verdict);
  assert.equal(again.overallScoreBeforeDensity, first.overallScoreBeforeDensity);
});

test('a stale Quick Health Check is dropped when the nutrition no longer earns one', () => {
  const report = { ...buildReport(chipsIngredients, {}), productName: 'Plain Rice', foodType: 'staple', dailyHabitCheck: { nutrientKey: 'sodiumMg', percent: 90 } };
  finalizeScore(report, {}); // no nutrition data at all now
  assert.equal(report.dailyHabitCheck, undefined);
});

test('the nutrient cap applies when one serving is over the bar', () => {
  const per100 = { saturatedFatG: 30, sodiumMg: 100 };
  const report = { ...buildReport([{ name: 'Palm Fat', status: 'safe', penalty: 1, percentage: 90 }], {}), productName: 'Some Spread Bar', foodType: 'sweet-snack', nutrientsPer100: per100 };
  const before = report.overallScore;
  finalizeScore(report, { nutrientsInfo: { nutrients: per100, nutrientsPer100: per100 } });
  assert.ok(report.dailyHabitCheck, 'expected a Quick Health Check');
  assert.ok(report.overallScore <= 64 && report.overallScore < before);
});
