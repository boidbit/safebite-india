import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryIcon } from './categoryIcon.js';

test('protein icon follows the ingredient, never a steak for peanuts', () => {
  assert.equal(categoryIcon('protein', 'Roasted Peanuts'), '🥜');
  assert.equal(categoryIcon('protein', 'Moong Dal'), '🫘');
  assert.equal(categoryIcon('protein', 'Soy Protein Isolate'), '🫘');
  assert.equal(categoryIcon('protein', 'Whey Protein Concentrate'), '🥛');
  assert.equal(categoryIcon('protein', 'Egg Powder'), '🥚');
  assert.equal(categoryIcon('protein', 'Chicken (35%)'), '🍗');
  assert.equal(categoryIcon('Protein'), '🫘');
});

test('additives get food icons, not cosmetics', () => {
  assert.equal(categoryIcon('emulsifier', 'Stabilizer (INS 471)'), '🥣');
  assert.equal(categoryIcon('stabilizer'), '🫙');
  assert.equal(categoryIcon('something else'), '🔹');
});
