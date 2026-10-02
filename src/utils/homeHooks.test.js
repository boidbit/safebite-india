// src/utils/homeHooks.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaim, cleanFlags, hookLine, judgeGuess, sectionCandidates, weightedSample, ADMIN_WEIGHT } from './homeHooks.js';

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

const pool = [
  { lookupKey: 'maggi', productName: 'Maggi Masala Noodles', score: 42 },
  { lookupKey: 'marie', productName: 'Sugar Free Marie', score: 37 },
  { lookupKey: 'atta', productName: 'Multigrain Atta', score: 100 },
  { lookupKey: 'dew', productName: 'Mountain Dew', score: 64 },
];

test('sectionCandidates applies each section’s rule to the approved pool', () => {
  const keys = (kind, picks = []) => sectionCandidates(pool, picks, kind).map((c) => c.lookupKey).sort();
  assert.deepEqual(keys('shock'), ['maggi', 'marie']);
  assert.deepEqual(keys('healthy'), ['marie']); // a health word AND a low score
  assert.deepEqual(keys('guess'), ['atta', 'dew', 'maggi', 'marie']);
});

test('admin picks are weighted up, kept outside the rule, and switched-off ones are left out', () => {
  const picks = [
    { kind: 'shock', lookup_key: 'dew', active: true, hook: 'Sugar bomb' }, // 64: outside the shock rule, kept
    { kind: 'shock', lookup_key: 'maggi', active: false }, // switched off
    { kind: 'guess', lookup_key: 'marie', active: false }, // only off for the game
  ];
  const shock = sectionCandidates(pool, picks, 'shock');
  assert.deepEqual(shock.map((c) => c.lookupKey).sort(), ['dew', 'marie']);
  assert.deepEqual(shock.find((c) => c.lookupKey === 'dew'), { lookupKey: 'dew', weight: ADMIN_WEIGHT, hook: 'Sugar bomb', claim: null });
  assert.ok(!sectionCandidates(pool, picks, 'guess').some((c) => c.lookupKey === 'marie'));
  assert.ok(sectionCandidates(pool, picks, 'healthy').some((c) => c.lookupKey === 'marie'));
});

test('weightedSample draws without repeats and favours heavier items', () => {
  const items = [{ lookupKey: 'a', weight: 1 }, { lookupKey: 'b', weight: 1 }, { lookupKey: 'c', weight: 3 }];
  const once = weightedSample(items, 3);
  assert.deepEqual(once.map((i) => i.lookupKey).sort(), ['a', 'b', 'c']);
  assert.equal(weightedSample(items, 5).length, 3);
  assert.deepEqual(weightedSample([], 2), []);
  // rand() = 0.99 lands in the last (heaviest) item's share.
  assert.equal(weightedSample(items, 1, () => 0.99)[0].lookupKey, 'c');
  assert.equal(weightedSample(items, 1, () => 0)[0].lookupKey, 'a');
  let heavy = 0;
  for (let i = 0; i < 2000; i++) if (weightedSample(items, 1)[0].lookupKey === 'c') heavy++;
  assert.ok(heavy > 1000 && heavy < 1400, `c drawn ${heavy}/2000, expected ~1200`);
});
