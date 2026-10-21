// src/services/nutritionPhotoRead.test.js
//
// Run with: node --test src/services/nutritionPhotoRead.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readsAgree, asBlinkitAttributes, per100FromPhoto } from './nutritionPhotoRead.js';

test('two reads that match (within rounding) agree', () => {
  assert.equal(readsAgree({ caloriesKcal: 267, proteinG: 7.1, totalFatG: 0.65 }, { caloriesKcal: 268, proteinG: 7.1, totalFatG: 0.7 }), true);
});

test('one figure off means the reads disagree', () => {
  assert.equal(readsAgree({ caloriesKcal: 267, proteinG: 7.1, totalFatG: 6.5 }, { caloriesKcal: 267, proteinG: 7.1, totalFatG: 0.65 }), false);
});

test('fewer than 3 shared figures is not a confirmation', () => {
  assert.equal(readsAgree({ caloriesKcal: 267, proteinG: 7.1 }, { caloriesKcal: 267, proteinG: 7.1 }), false);
});

test('a photo table comes out in Blinkit attribute names', () => {
  assert.deepEqual(asBlinkitAttributes({ caloriesKcal: 267, carbohydrateG: 55.123, sodiumMg: 310 }), {
    Energy: '267 kcal', 'Total Carbohydrates': '55.12 g', Sodium: '310 mg',
  });
});

test('per-serving-only table without a serving size gives no per-100 table', () => {
  assert.equal(per100FromPhoto({ perServing: { caloriesKcal: 100, proteinG: 2 }, servingSize: null }, null).table, null);
});
