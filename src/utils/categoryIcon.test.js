import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryIcon } from './categoryIcon.js';

test('the icon follows the ingredient, never a steak for veg protein', () => {
  assert.equal(categoryIcon('protein', 'Roasted Peanuts'), '🥜');
  assert.equal(categoryIcon('protein', 'Moong Dal'), '🫘');
  assert.equal(categoryIcon('protein', 'Soy Protein Isolate'), '🫘');
  assert.equal(categoryIcon('protein', 'Whey Protein Concentrate'), '🥛');
  assert.equal(categoryIcon('protein', 'Egg Powder'), '🥚');
  assert.equal(categoryIcon('protein', 'Chicken (35%)'), '🍗');
  assert.equal(categoryIcon('protein'), '🫘');
});

test('everyday ingredients get their own picture, whatever their category', () => {
  assert.equal(categoryIcon('natural', 'Water'), '💧');
  assert.equal(categoryIcon('other', 'Iodised Salt'), '🧂');
  assert.equal(categoryIcon('sweetener', 'Sugar'), '🍬');
  assert.equal(categoryIcon('other', 'Refined Wheat Flour (Maida)'), '🌾');
  assert.equal(categoryIcon('protein', 'Gram Flour (Besan)'), '🫘');
  assert.equal(categoryIcon('oil', 'Peanut Oil'), '🫗');
  assert.equal(categoryIcon('other', 'Milk Chocolate'), '🍫');
  assert.equal(categoryIcon('natural', 'Onion Powder'), '🧅');
  assert.equal(categoryIcon('other', 'Corn Flakes'), '🌽');
  assert.equal(categoryIcon('other', 'Graham Flour'), '🌾'); // "ham" inside a word is not meat
});

test('additives show what they do, not a cosmetic', () => {
  assert.equal(categoryIcon('emulsifier', 'Emulsifier (INS 471)'), '🥣');
  assert.equal(categoryIcon('emulsifier', 'Stabilizer (INS 471)'), '🫙');
  assert.equal(categoryIcon('preservative', 'Preservative (Sodium Benzoate)'), '🧪');
  assert.equal(categoryIcon('color', 'Natural Colour (INS 150d)'), '🎨');
  assert.equal(categoryIcon('stabilizer'), '🫙');
  assert.equal(categoryIcon('something else'), '🔹');
});
