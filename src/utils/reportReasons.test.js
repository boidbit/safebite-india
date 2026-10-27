// src/utils/reportReasons.test.js
//
// Run with: node --test src/utils/reportReasons.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyReasons } from './reportReasons.js';

const light = (levels) => ({ items: Object.entries(levels).map(([key, level]) => ({ key, level })) });
const flag = (name, tier = 'Concerning') => ({ ingredient: { name }, tier: { key: tier } });

test('a salty, fatty snack: two concerns and its one good thing', () => {
  const r = keyReasons(light({ fat: 'high', satFat: 'high', sugars: 'low', salt: 'high' }), [flag('Palmolein')], { ingredientCount: 12 });
  assert.deepEqual(r.map((x) => x.key), ['high_salt', 'high_satFat', 'low_sugars']);
});

test('high saturated fat replaces high total fat', () => {
  const r = keyReasons(light({ fat: 'high', satFat: 'high' }), []);
  assert.deepEqual(r.map((x) => x.key), ['high_satFat']);
});

test('a flagged ingredient shows by name; harmful reads as bad, the rest as a warning', () => {
  const r = keyReasons(null, [flag('Sodium Benzoate', 'Harmful'), flag('Maltodextrin', 'Highly processed')], { ingredientCount: 8 });
  assert.deepEqual(r.map((x) => [x.tone, x.name]), [['bad', 'Sodium Benzoate'], ['warn', 'Maltodextrin']]);
});

test('nothing flagged and no nutrition: one good chip', () => {
  assert.deepEqual(keyReasons(null, [], { ingredientCount: 5 }).map((x) => x.key), ['noneFlagged']);
});

test('never more than three, concerns before good things', () => {
  const r = keyReasons(light({ fat: 'low', satFat: 'low', sugars: 'high', salt: 'high' }), [flag('Palm Oil')], { ingredientCount: 9 });
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((x) => x.tone), ['bad', 'bad', 'good']);
});

test('no data at all: no chips', () => {
  assert.deepEqual(keyReasons(null, [], { ingredientCount: 0 }), []);
});
