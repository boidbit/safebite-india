import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sugarFromCarbs } from './sugarProxy.js';
import { finalizeScore } from './finalizeScore.js';

const jaggery = (n, main = 'Jaggery') => ({ productName: 'Utpanna Date Palm Jaggery', ingredients: [{ name: main }], nutrientsPer100: n, overallScore: 95, verdict: 'Excellent', foodType: 'staple' });

test('carbohydrate counts as sugar only for a sugar-led product with no sugar figure', () => {
  assert.equal(sugarFromCarbs(jaggery({ carbohydrateG: 86.27, caloriesKcal: 354 })), 86.27);
  assert.equal(sugarFromCarbs(jaggery({ carbohydrateG: 80 }, 'Honey')), 80);
  // the label gives sugar: its own figure is used
  assert.equal(sugarFromCarbs(jaggery({ carbohydrateG: 86, addedSugarG: 0, totalSugarG: 84 })), null);
  // main ingredient isn't a sugar, or too little carbohydrate to be mostly sugar
  assert.equal(sugarFromCarbs(jaggery({ carbohydrateG: 75 }, 'Wheat Flour')), null);
  assert.equal(sugarFromCarbs(jaggery({ carbohydrateG: 30 })), null);
  assert.equal(sugarFromCarbs(jaggery({ carbohydrateG: 80 }, 'Sugar Free Sweetener')), null);
});

test('a jaggery with only carbohydrate on the pack no longer scores as if it had no sugar', () => {
  const per100 = { carbohydrateG: 86.27, caloriesKcal: 353.86, proteinG: 1.22, totalFatG: 0.4 };
  const r = jaggery(per100);
  finalizeScore(r, { nutrientsInfo: { nutrients: per100, nutrientsPer100: per100, servingGrams: null, servingUnit: 'g' } });
  assert.ok(r.overallScore < 95, `score ${r.overallScore}`);
  assert.equal(r.sugarCountedFromCarbs, 86.27);
  // what the app shows stays the label's figures
  assert.equal(r.nutrientsPer100.addedSugarG, undefined);
});
