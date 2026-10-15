import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLabelNutrition, perServingToPer100 } from './labelNutrition.js';

test('a per-100 table passes through untouched', () => {
  const r = normalizeLabelNutrition({ nutrition: { energyKcal: 450, proteinG: 7 }, nutritionBasis: 'per100', servingGrams: 30 });
  assert.deepEqual(r.nutrition, { energyKcal: 450, proteinG: 7 });
  assert.equal(r.servingGrams, 30);
  assert.equal(r.nutritionBasis, undefined);
});

test('per serving with the serving weight printed is scaled to per 100', () => {
  const r = normalizeLabelNutrition({ nutrition: { energyKcal: 82.55, proteinG: 6.33, sodiumMg: 120 }, nutritionBasis: 'perServing', servingGrams: 25 });
  assert.deepEqual(r.nutrition, { energyKcal: 330.2, proteinG: 25.32, sodiumMg: 480 });
  assert.equal(r.convertedFromServingGrams, 25);
});

test('per serving with pack weight and servings per pack works it out', () => {
  const r = normalizeLabelNutrition({ nutrition: { energyKcal: 100 }, nutritionBasis: 'perServing', packGrams: 200, servingsPerPack: 8 });
  assert.equal(r.convertedFromServingGrams, 25);
  assert.deepEqual(r.nutrition, { energyKcal: 400 });
});

test('per serving with no weight anywhere is kept aside, never treated as per 100', () => {
  const r = normalizeLabelNutrition({ nutrition: { energyKcal: 82.55, proteinG: 6.33 }, nutritionBasis: 'perServing' });
  assert.equal(r.nutrition, undefined);
  assert.deepEqual(r.nutritionPerServing, { energyKcal: 82.55, proteinG: 6.33 });
  assert.deepEqual(perServingToPer100(r.nutritionPerServing, 25), { energyKcal: 330.2, proteinG: 25.32 });
  assert.equal(perServingToPer100(r.nutritionPerServing, ''), null);
});

test('no table at all stays no table', () => {
  assert.equal(normalizeLabelNutrition({ ingredientsText: 'Sugar, Salt' }).nutrition, undefined);
  assert.equal(normalizeLabelNutrition({ nutrition: {} }).nutrition, undefined);
});
