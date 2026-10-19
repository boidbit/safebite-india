import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProduct, sameIngredientsDifferentProducts } from './dataHealth.js';

const ids = (row) => checkProduct({ name: 'X', imageUrl: 'p.jpg', foodType: 'beverage', ...row }).map((c) => c.id);

test('table says no sugar but the ingredient list names sugar', () => {
  assert.deepEqual(ids({ n: { totalSugarG: 0 }, ingredientsText: 'Carbonated Water, Sugar, Acids' }), ['sugarZeroButListed']);
  assert.deepEqual(ids({ n: { totalSugarG: 0 }, ingredientsText: 'Water, Sugar Free Sweetener, Sugar Alcohol (Maltitol)' }), []);
  assert.deepEqual(ids({ n: { totalSugarG: 12 }, ingredientsText: 'Water, Sugar' }), []);
  assert.deepEqual(ids({ n: { addedSugarG: 0 }, ingredientsText: 'Water, Honey' }), ['sugarZeroButListed']);
  // dextrose / glucose / fructose are a lower, separate check (often a trace)
  assert.deepEqual(ids({ n: { totalSugarG: 0 }, ingredientsText: 'Chicken, Water, Dextrose' }), ['sugarZeroButDextrose']);
  assert.deepEqual(ids({ n: { totalSugarG: 0 }, ingredientsText: 'Water, Sugar, Dextrose' }), ['sugarZeroButListed']);
});

test('table says no sodium or no fat but the list has salt / oil', () => {
  assert.deepEqual(ids({ n: { sodiumMg: 0 }, ingredientsText: 'Peanuts, Salt' }), ['sodiumZeroButSalt']);
  assert.deepEqual(ids({ n: { sodiumMg: 300 }, ingredientsText: 'Peanuts, Salt' }), []);
  assert.deepEqual(ids({ n: { totalFatG: 0 }, ingredientsText: 'Wheat Flour, Palm Oil' }), ['fatZeroButFatListed']);
  assert.deepEqual(ids({ n: { totalFatG: 0 }, ingredientsText: 'Skimmed Milk Powder, Wheat' }), []);
});

test('a nutrition table that cannot be right', () => {
  const bad = (n) => checkProduct({ name: 'X', imageUrl: 'p.jpg', foodType: 'beverage', n }).find((c) => c.id === 'tableImpossible');
  assert.match(bad({ saturatedFatG: 12, totalFatG: 5 }).evidence, /saturated fat 12 > total fat 5/);
  assert.match(bad({ addedSugarG: 30, totalSugarG: 10 }).evidence, /added sugar/);
  assert.match(bad({ totalSugarG: 40, carbohydrateG: 20 }).evidence, /sugar 40 > carbohydrate 20/);
  assert.match(bad({ proteinG: 50, totalFatG: 40, carbohydrateG: 30 }).evidence, /protein\+fat\+carb/);
  assert.match(bad({ proteinG: -1 }).evidence, /negative/);
  assert.equal(bad({ saturatedFatG: 3, totalFatG: 10, totalSugarG: 5, carbohydrateG: 20 }), undefined);
});

test('calories that do not add up, and a barcode with a bad check digit', () => {
  assert.deepEqual(ids({ n: { caloriesKcal: 500, proteinG: 5, carbohydrateG: 10, totalFatG: 2 } }), ['caloriesMismatch']);
  assert.deepEqual(ids({ n: { caloriesKcal: 120, proteinG: 3, carbohydrateG: 20, totalFatG: 3 } }), []);
  assert.deepEqual(ids({ lookupKey: 'barcode:8901058000290' }), []);
  assert.deepEqual(ids({ lookupKey: 'barcode:8901058000291' }), ['barcodeChecksum']);
  assert.deepEqual(ids({ lookupKey: 'blinkit:maggi' }), []);
});

test('pack size in the name against the saved pack size', () => {
  assert.deepEqual(ids({ name: 'Mountain dew 250ml', packSize: '2.25 l' }), ['packNameMismatch']);
  assert.deepEqual(ids({ name: 'Mountain dew 250ml', packSize: '250 ml' }), []);
  assert.deepEqual(ids({ name: 'Mountain dew', packSize: '2.25 l' }), []);
});

test('verdict against score, missing photo and food type', () => {
  assert.deepEqual(ids({ score: 90, verdict: 'Very Poor' }), ['verdictScoreMismatch']);
  assert.deepEqual(ids({ score: 99, verdict: 'Very Healthy' }), []); // the old name of the top tier
  assert.deepEqual(ids({ score: 99, verdict: 'Excellent' }), []);
  assert.deepEqual(ids({ imageUrl: null }), ['noPhoto']);
  assert.deepEqual(ids({ foodType: null }), ['uncategorised']);
  assert.deepEqual(ids({}), []);
});

test('identical long ingredient lists on different products are flagged; pack sizes of one product are not', () => {
  const text = 'Carbonated Water, Sugar, Acidity Regulators (330, 331, 296), Flavour (Natural Flavouring Substances), Preservative (211)';
  const rows = [
    { id: 'a', name: '7UP Lemon', ingredientsText: text },
    { id: 'b', name: '7UP Zero Sugar', ingredientsText: text },
    { id: 'c', name: 'Maggi Masala 70 g', ingredientsText: `${text} extra` },
    { id: 'd', name: 'Maggi Masala 280 g', ingredientsText: `${text} extra` },
    { id: 'e', name: 'Short', ingredientsText: 'Salt' },
    { id: 'f', name: 'Other', ingredientsText: 'Salt' },
  ];
  const groups = sameIngredientsDifferentProducts(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['a', 'b']);
});
