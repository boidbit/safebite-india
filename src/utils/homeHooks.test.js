// src/utils/homeHooks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaim, cleanFlags, hookLine, judgeGuess, dailySlice } from './homeHooks.js';

const t = (key, vars = {}) => `${key}${Object.entries(vars).map(([k, v]) => `|${k}=${v}`).join('')}`;

test('detectClaim finds the health word a name sells with, longest first', () => {
  assert.equal(detectClaim('Britannia NutriChoice Digestive Biscuits'), 'Digestive');
  assert.equal(detectClaim('Aashirvaad Multigrain Atta'), 'Multigrain');
  assert.equal(detectClaim('Kissan Whole Wheat Bread'), 'Whole Wheat');
  assert.equal(detectClaim('Max Protein Bar - Choco'), 'Protein');
  assert.equal(detectClaim('Quaker Oats'), 'Oats');
  assert.equal(detectClaim('Parle-G Gluco Biscuits'), null);
  assert.equal(detectClaim(''), null);
});

test('cleanFlags drops group prefixes, fragments and repeats', () => {
  assert.deepEqual(cleanFlags(['Noodles: Refined Wheat Flour Maida', 'Refined Wheat Flour Maida', 'Palm Oil']), ['Refined Wheat Flour Maida', 'Palm Oil']);
  assert.deepEqual(cleanFlags(['Lt', 'Edible Vegetable Fats', 'Palm Oil', 'Sugar']), ['Edible Vegetable Fats', 'Palm Oil']);
  assert.deepEqual(cleanFlags(null), []);
});

test('hookLine prefers the admin line, then a striking daily-limit number, then flags', () => {
  assert.equal(hookLine({ hook: '  Ek packet = aadhe din ka namak ' }, t), 'Ek packet = aadhe din ka namak');
  assert.equal(hookLine({ habit: { percent: 36.4, nutrientKey: 'sodiumMg' }, flags: ['Palm Oil'] }, t), 'hookHabit|percent=36|nutrient=nutrient_sodiumMg');
  // A small share of the day isn't the hook -- the flags are.
  assert.equal(hookLine({ habit: { percent: 8, nutrientKey: 'sodiumMg' }, flags: ['Palm Oil', 'Sugar'] }, t), 'hookFlags|flags=Palm Oil · Sugar');
  assert.equal(hookLine({}, t), '');
});

test('judgeGuess grades by distance and says which way the real score lay', () => {
  assert.deepEqual(judgeGuess(40, 38), { level: 'bullseye', diff: 2, higher: false });
  assert.equal(judgeGuess(50, 38).level, 'close');
  assert.equal(judgeGuess(70, 45).level, 'off');
  assert.deepEqual(judgeGuess(80, 31), { level: 'way', diff: 49, higher: false });
  assert.equal(judgeGuess(20, 90).higher, true);
});

test('dailySlice is stable for a day and moves on the next', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(dailySlice(pool, 3, 10), dailySlice(pool, 3, 10));
  assert.notDeepEqual(dailySlice(pool, 3, 10), dailySlice(pool, 3, 11));
  assert.equal(dailySlice(pool, 3, 7).length, 3);
  assert.deepEqual(dailySlice(['x'], 3, 4), ['x']);
  assert.deepEqual(dailySlice([], 3, 4), []);
});
