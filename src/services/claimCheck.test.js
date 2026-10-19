import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectClaims, checkClaims } from './claimCheck.js';

const ings = (...n) => n.map((name) => ({ name }));
const run = (productName, nutrientsPer100, ingredients = [], extra = {}) => checkClaims({ productName, nutrientsPer100, ingredients, ...extra });
const one = (productName, n, i, extra) => run(productName, n, i, extra)[0];
const states = (claim) => claim.checks.map((c) => `${c.kind}:${c.state}`);

test('claims are read from the name; "no sugar added" is not "sugar free"', () => {
  const ids = (t) => detectClaims(t).map((c) => c.id);
  assert.deepEqual(ids('Pepsi Max Cherry No Sugar Soft Drink'), ['sugarFree']);
  assert.deepEqual(ids('Real Thai Unsweetened Coconut Milk'), ['unsweetened']);
  assert.deepEqual(ids('Muesli - No Added Sugar'), ['noAddedSugar']);
  assert.deepEqual(ids('Muesli no sugar added'), ['noAddedSugar']);
  assert.deepEqual(ids('Amul Kesar Badam Ice Cream Cup (Sugar Free)'), ['sugarFree']);
  assert.deepEqual(ids('Sugar-Free Chocolate'), ['sugarFree']);
  assert.deepEqual(ids('Tata Salt Free Mix'), ['saltFree']);
  assert.deepEqual(ids('Unsalted Butter'), ['noAddedSalt']);
  assert.deepEqual(ids('Low Sodium Salt'), ['lowSodium']);
  assert.deepEqual(ids('Geofit High Fiber Aloevera Juice'), ['highFibre']);
  assert.deepEqual(ids('Maggi Masala Noodles'), []);
  assert.deepEqual(ids('Salted Peanuts'), []);
});

test('sugar free: the table decides, against 0.5 g per 100', () => {
  assert.equal(one('Sugar Free Mints', { totalSugarG: 0.2 }).verdict, 'match');
  assert.equal(one('Sugar Free Mints', { totalSugarG: 0.5 }).verdict, 'match');
  // Label figures are rounded: 0.53 g against a 0.5 g limit is not a clear miss, 0.7 g is.
  assert.equal(one('Amul Sugar free chocolate', { totalSugarG: 0.53 }).verdict, 'match');
  assert.equal(one('Sugar Free Mints', { totalSugarG: 0.7 }).verdict, 'mismatch');
  const bad = one('Amul Kesar Badam Ice Cream Cup (Sugar Free)', { totalSugarG: 5.7 });
  assert.equal(bad.verdict, 'mismatch');
  assert.deepEqual(bad.checks[0], { kind: 'figure', nutrient: 'sugars', value: 5.7, unit: 'g', state: 'bad' });
  assert.deepEqual(bad.limit, { cmp: 'atMost', value: 0.5, unit: 'g' });
});

test('sugar free: with no split, the single sugar figure is the sugar figure (as in the traffic lights)', () => {
  assert.equal(one('Sugar Free Biscuit', { addedSugarG: 3 }).verdict, 'mismatch');
  assert.equal(one('Pepsi Max No Sugar', { addedSugarG: 0 }).verdict, 'match');
  assert.equal(one('Sugar Free Biscuit', {}).verdict, 'unknown');
  assert.equal(one('Sugar Free Biscuit', null).verdict, 'unknown');
});

test('a natural-sugar failure says so: added 0 g, total high', () => {
  const honey = one('Honey Tasties 0% Sugar', { totalSugarG: 76, addedSugarG: 0 }, ings('Honey', 'Strawberry'));
  assert.equal(honey.verdict, 'mismatch');
  assert.ok(honey.checks.some((c) => c.kind === 'naturalOnly' && c.value === 76));
  // With real added sugar there is no such note.
  assert.ok(!one('Sugar Free Cake', { totalSugarG: 20, addedSugarG: 12 }).checks.some((c) => c.kind === 'naturalOnly'));
  // A single sugar figure (no split) can not tell natural from added.
  assert.ok(!one('Sugar Free Cake', { addedSugarG: 20 }).checks.some((c) => c.kind === 'naturalOnly'));
  assert.ok(one('Low Sugar Juice', { totalSugarG: 9, addedSugarG: 0 }).checks.some((c) => c.kind === 'naturalOnly'));
});

test('sugar free: sugar in the ingredient list against a table that says 0 is a conflict, not a mismatch', () => {
  const c = one('7UP Zero Sugar', { addedSugarG: 0 }, ings('Carbonated Water', 'Sugar', 'Citric Acid'));
  assert.equal(c.verdict, 'unknown');
  const conflict = c.checks.find((x) => x.kind === 'ingredients');
  assert.equal(conflict.state, 'conflict');
  assert.deepEqual(conflict.names, ['Sugar']);
  // Sugar listed and the table can't clear it, or the table agrees it is not free of sugar: both are real mismatches.
  assert.equal(one('Sugar Free Cookies', {}, ings('Wheat Flour', 'Sugar', 'Butter')).verdict, 'mismatch');
  assert.equal(one('Sugar Free Cookies', { totalSugarG: 12 }, ings('Wheat Flour', 'Sugar', 'Butter')).verdict, 'mismatch');
  // A sugar alcohol or a "sugar free" sweetener is not sugar.
  assert.equal(one('Sugar Free Cookies', { totalSugarG: 0 }, ings('Wheat Flour', 'Sugar Alcohol (Maltitol)', 'Butter')).verdict, 'match');
});

test('no added sugar: the ingredient list decides, natural sugar is allowed', () => {
  assert.equal(one('Peanut Butter No Added Sugar', {}, ings('Peanuts', 'Salt', 'Palm Oil')).verdict, 'match');
  const jag = one('Muesli No Added Sugar', {}, ings('Oats', 'Jaggery', 'Raisins'));
  assert.equal(jag.verdict, 'mismatch');
  assert.deepEqual(jag.checks[0].names, ['Jaggery']);
  assert.equal(one('Muesli No Added Sugar', {}, ings('Oats', 'Glucose Syrup')).verdict, 'mismatch');
  const natural = one('Date Bar No Added Sugar', { totalSugarG: 40, addedSugarG: 0 }, ings('Dates', 'Almonds'));
  assert.equal(natural.verdict, 'match');
  assert.ok(natural.checks.some((c) => c.kind === 'natural' && c.value === 40));
});

test('no added sugar: added sugar over zero is trusted only when the label also gave total sugars', () => {
  assert.equal(one('Juice No Added Sugar', { totalSugarG: 10, addedSugarG: 6 }, ings('Water', 'Mango Pulp')).verdict, 'mismatch');
  // Only one figure: it may be the total, natural sugar in an unsweetened product -- not a contradiction.
  assert.equal(one('Juice No Added Sugar', { addedSugarG: 10 }, ings('Water', 'Mango Pulp')).verdict, 'match');
  assert.equal(one('Juice No Added Sugar', { addedSugarG: 10 }, []).verdict, 'unknown');
});

test('unsweetened also rules out sweeteners', () => {
  assert.equal(one('Unsweetened Almond Milk', {}, ings('Water', 'Almonds', 'Sucralose')).verdict, 'mismatch');
  assert.equal(one('Real Thai Unsweetened Coconut Milk', { totalSugarG: 2 }, ings('Coconut Extract', 'Water')).verdict, 'match');
});

test('low sugar uses 5 g for food and 2.5 g for drinks', () => {
  assert.equal(one('Low Sugar Jam', { totalSugarG: 4.9 }).verdict, 'match');
  assert.equal(one('Low Sugar Jam', { totalSugarG: 5.4 }).verdict, 'match');
  assert.equal(one('Low Sugar Jam', { totalSugarG: 5.6 }).verdict, 'mismatch');
  assert.equal(one('Low Sugar Drink', { totalSugarG: 2.4 }, [], { isDrink: true }).verdict, 'match');
  assert.equal(one('Low Sugar Drink', { totalSugarG: 3 }, [], { isDrink: true }).verdict, 'mismatch');
});

test('salt / sodium claims', () => {
  assert.equal(one('Salt Free Seasoning', { sodiumMg: 3 }).verdict, 'match');
  assert.equal(one('Salt Free Seasoning', { sodiumMg: 80 }).verdict, 'mismatch');
  assert.equal(one('Salt Free Seasoning', { sodiumMg: 3 }, ings('Pepper', 'Rock Salt')).verdict, 'unknown'); // table and list disagree
  assert.equal(one('Salt Free Seasoning', { sodiumMg: 300 }, ings('Pepper', 'Rock Salt')).verdict, 'mismatch');
  assert.equal(one('Salt Free Seasoning', {}, ings('Pepper', 'Rock Salt')).verdict, 'mismatch');
  assert.equal(one('Low Sodium Cracker', { sodiumMg: 120 }).verdict, 'match');
  assert.equal(one('Low Sodium Cracker', { sodiumMg: 130 }).verdict, 'match');
  assert.equal(one('Low Sodium Cracker', { sodiumMg: 140 }).verdict, 'mismatch');
  assert.equal(one('Low Salt Cracker', {}).verdict, 'unknown');
});

test('no added salt: any sodium salt in the list breaks it', () => {
  assert.equal(one('Unsalted Butter', {}, ings('Cream', 'Milk Solids')).verdict, 'match');
  assert.equal(one('Unsalted Butter', {}, ings('Cream', 'Salt')).verdict, 'mismatch');
  assert.equal(one('No Added Salt Soup', {}, ings('Water', 'Tomato', 'Sodium Benzoate (INS 211)')).verdict, 'mismatch');
});

test('fibre claims', () => {
  assert.equal(one('High Fibre Bread', { fibreG: 6 }).verdict, 'match');
  assert.equal(one('High Fibre Bread', { fibreG: 5.5 }).verdict, 'match');
  assert.equal(one('High Fibre Bread', { fibreG: 5.3 }).verdict, 'mismatch');
  assert.equal(one('High Fibre Bread', {}).verdict, 'unknown');
  assert.equal(one('Source of Fibre Biscuit', { fibreG: 3.2 }).verdict, 'match');
});

test('several claims in one name are each checked; infant formula and claim-free names give nothing', () => {
  const both = run('Oats No Added Sugar and Low Sodium', { sodiumMg: 50 }, ings('Oats', 'Wheat'));
  assert.deepEqual(both.map((c) => `${c.id}:${c.verdict}`), ['noAddedSugar:match', 'lowSodium:match']);
  assert.deepEqual(run('Maggi Masala Noodles', { sodiumMg: 900 }), []);
  assert.deepEqual(run('Sugar Free Infant Formula', { totalSugarG: 9 }, [], { isInfantFormula: true }), []);
});

test('a junk ingredient list is not enough to say "none found"', () => {
  assert.equal(one('Muesli No Added Sugar', {}, ings('Oats')).verdict, 'unknown');
  assert.deepEqual(states(one('Muesli No Added Sugar', {}, ings('Oats'))), ['noIngredients:unknown']);
});
