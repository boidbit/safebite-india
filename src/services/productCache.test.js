import test from 'node:test';
import assert from 'node:assert/strict';
import { findCategoryForProduct } from './productCache.js';

test('real bug: an oil and a sauce no longer land in the same alternatives bucket', () => {
  // The exact pair a real report flagged -- "Pantai Chilli Garlic Sauce"
  // was showing up as a "safer alternative" to unrelated cooking-
  // essentials products because the old single 'essentials' bucket
  // covered oil/atta/flour/rice/sauce/ketchup all at once.
  const oil = findCategoryForProduct('Fortune Sunlite Refined Sunflower Oil');
  const sauce = findCategoryForProduct('Pantai Chilli Garlic Sauce');
  assert.notEqual(oil?.id, sauce?.id);
});

test('oil, atta, rice and sauces are four distinct buckets, not one', () => {
  assert.equal(findCategoryForProduct('Saffola Gold Refined Oil')?.id, 'oil');
  assert.equal(findCategoryForProduct('Aashirvaad Select Atta')?.id, 'atta-flour');
  assert.equal(findCategoryForProduct('India Gate Basmati Rice')?.id, 'rice-grains');
  assert.equal(findCategoryForProduct('Kissan Fresh Tomato Ketchup')?.id, 'sauces-condiments');
});

test('every other existing category still matches as before (unaffected by the split)', () => {
  assert.equal(findCategoryForProduct('Parle-G Glucose Biscuits')?.id, 'biscuits');
  assert.equal(findCategoryForProduct('Maggi 2-Minute Noodles')?.id, 'noodles');
  assert.equal(findCategoryForProduct('Real Mixed Fruit Juice')?.id, 'beverages');
  assert.equal(findCategoryForProduct('Lay\'s India\'s Magic Masala Chips')?.id, 'snacks');
  assert.equal(findCategoryForProduct('Cadbury Dairy Milk Chocolate')?.id, 'chocolates');
  assert.equal(findCategoryForProduct('Everest Garam Masala')?.id, 'spices');
  assert.equal(findCategoryForProduct('Amul Gold Milk')?.id, 'dairy');
});

test('a product matching nothing returns null, not a wrong guess', () => {
  assert.equal(findCategoryForProduct('Some Entirely Unrelated Item'), null);
  assert.equal(findCategoryForProduct(''), null);
  assert.equal(findCategoryForProduct(null), null);
});

test('keywords match whole words: Haldiram\'s is not haldi, a laddu is a sweet', () => {
  assert.equal(findCategoryForProduct("Desi Ghee Motichoor Laddu by Haldiram's")?.id, 'indian-sweets');
  assert.notEqual(findCategoryForProduct("Haldiram's Aloo Bhujia")?.id, 'spices');
  assert.equal(findCategoryForProduct("Haldiram's Aloo Bhujia")?.id, 'snacks');
  assert.equal(findCategoryForProduct('Catch Haldi Powder')?.id, 'spices');
  assert.equal(findCategoryForProduct('Bikano Soan Papdi')?.id, 'indian-sweets');
  assert.equal(findCategoryForProduct('Britannia Good Day Cookies')?.id, 'biscuits'); // plural still matches
  assert.equal(findCategoryForProduct('Amul Pure Ghee')?.id, 'dairy');
});
