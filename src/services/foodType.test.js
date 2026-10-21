import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFoodType, normalizeFoodType } from './foodType.js';

const t = (productName, ingredientNames = []) => classifyFoodType({ productName, ingredientNames });

test('the reported over-scored fried snacks are all classified fried', () => {
  for (const name of [
    'Bingo Kitchen Style Ribbon Pakoda Namkeen Snacks',
    'Whole Foods Diet Chivda Namkeen',
    'Prabhuji Bhujia - Muchy Masti',
    'Salted Banana Chips',
    'Too Yumm Spicy Korean Banana Chips (No Palm Oil)',
  ]) {
    const r = t(name);
    assert.equal(r.foodType, 'fried-snack', name);
    assert.equal(r.isDeepFried, true, name);
  }
});

test('baked / roasted snacks are not treated as fried', () => {
  assert.equal(t('Roasted Chana Chivda').foodType, 'baked-snack');
  assert.equal(t('Baked Multigrain Chips').isDeepFried, false);
  assert.equal(t('Act II Popcorn').foodType, 'baked-snack');
});

test('oils, nuts, staples and supplements are their own types', () => {
  assert.equal(t('Fortune Sunflower Oil').foodType, 'oil-fat');
  assert.equal(t('Amul Ghee').foodType, 'oil-fat');
  assert.equal(t('California Almonds').foodType, 'nuts-seeds');
  assert.equal(t('Aashirvaad Atta').foodType, 'staple');
  assert.equal(t('Whey Protein Powder Chocolate').foodType, 'supplement');
});

test('butter cookies are a sweet snack, not a fat', () => {
  assert.equal(t('Unibic Butter cookies').foodType, 'sweet-snack');
  assert.equal(t('Peanut Butter Creamy').foodType, 'condiment');
});

test('beverages and infant foods', () => {
  assert.equal(t('Devbhog Masala Buttermilk').foodType, 'beverage');
  assert.equal(t('Furilac Advance Stage 1 Infant Formula').foodType, 'infant');
});

test('an oddly named snack with frying oil is still fried', () => {
  const r = t('Crunchy Bites', ['Rice flour', 'Refined Palmolein Oil', 'Salt']);
  assert.equal(r.isDeepFried, true);
  assert.equal(r.foodType, 'fried-snack');
});

test('normalizeFoodType accepts only known values', () => {
  assert.equal(normalizeFoodType(' Fried-Snack '), 'fried-snack');
  assert.equal(normalizeFoodType('pizza'), null);
});

test('names that merely contain a snack word are not fried snacks', () => {
  assert.equal(t('Bingo Chatpat Kairi Kaccha Mango Drink').foodType, 'beverage');
  assert.equal(t('Bingo Tedhe Medhe Masala Tadka Buttermilk').foodType, 'beverage');
  assert.equal(t("Kellogg's Multigrain Chocos Crunchy Bites Kids Cereal").foodType, 'staple');
  assert.equal(t('KitKat Rich Chocolate Coated Wafer').foodType, 'sweet-snack');
  assert.equal(t('Harveys Dark Compound Choco Chips').foodType, 'sweet-snack');
  assert.equal(t('Mangat Ram Unpolished Moong Dal (Chilka)').foodType, 'staple');
  assert.equal(t('Creamy Dark Chocolate Peanut Butter').foodType, 'condiment');
});

test('branded fried moong dal is a fried snack; raw dal is not', () => {
  assert.equal(t("Haldiram's Moong Dal").foodType, 'fried-snack');
  assert.equal(t('Tenali Double Horse Moong Dal (Chilka)').foodType, 'staple');
});

test('potato wafers and plain chips remain fried', () => {
  assert.equal(t('Balaji Wafers Rumbles Potato Chips').foodType, 'fried-snack');
  assert.equal(t('POTATO WAFERS').foodType, 'fried-snack');
});

test('a full meal seasoned with masala/spices is NOT a condiment -- real bug: this wrongly suppressed legitimate high-sodium warnings', () => {
  assert.equal(t('Maggi Masala Noodles').foodType, 'ready-meal');
  assert.equal(t('Saffola Masala Oats').foodType, 'staple');
  assert.equal(t('Knorr soupy noodles mast masala').foodType, 'ready-meal');
  assert.equal(t('Masala Oats and Millets').foodType, 'staple');
  assert.equal(t('Yippee Magic Masala Instant Noodles with Added Veggies').foodType, 'ready-meal');
  assert.equal(t('Cookd Ambur Masala Biryani Paste - Ready to Cook').foodType, 'condiment'); // paste, not the biryani itself
});

test('real masala/spice/condiment products are unaffected by the meal exclusion', () => {
  assert.equal(t('Everest Chaat Masala').foodType, 'condiment');
  assert.equal(t('MTR Sambar Masala').foodType, 'condiment');
  assert.equal(t('Ginger Garlic Paste').foodType, 'condiment');
  assert.equal(t('Kissan Tomato Ketchup').foodType, 'condiment');
});

test('names that say what they are without the generic word', () => {
  const t = (productName) => classifyFoodType({ productName }).foodType;
  assert.equal(t('Cadbury Dairy Milk'), 'sweet-snack');
  assert.equal(t('Mother Dairy Milk'), 'dairy');
  assert.equal(t('Dharwad Peda by Daadi\'s'), 'sweet-snack');
  assert.equal(t('Kinley Water 500ml'), 'beverage');
  assert.equal(t('Rose Water'), 'other');
  assert.equal(t('Chamomile Herbal Infusion Bags'), 'beverage');
  assert.equal(t('Belse Black Roasted Ground Coffee'), 'beverage');
  assert.equal(t('Aashirvaad Double Roasted Sooji Rava'), 'staple');
  assert.equal(t('Tata Sampann Unpolished Toor Dal'), 'staple');
  assert.equal(t('Kashvik Idly Batter'), 'staple');
  assert.equal(t('Brown Hing Powder'), 'condiment');
  assert.equal(t('Chilli Flakes'), 'condiment');
  assert.equal(t("Kellogg's Corn Flakes Original"), 'staple');
  assert.equal(t('Pintola All Natural Crunchy Almond Butter'), 'condiment');
  assert.equal(t('Bonne Maman Blackberry Preserve'), 'condiment');
  assert.equal(t('Godrej Yummiez French Fries'), 'fried-snack');
  assert.equal(t('OK Hyderabadi Veg Biriyani'), 'ready-meal');
  assert.equal(t('Nestle NAN Excellapro'), 'infant');
});

test('the new words do not pull existing products into the wrong type', () => {
  const t = (productName) => classifyFoodType({ productName }).foodType;
  assert.equal(t('Maggi Masala Noodles'), 'ready-meal');
  assert.equal(t("Haldiram's Aloo Bhujia"), 'fried-snack');
  assert.equal(t('Lay\'s Chile Limon Chips'), 'fried-snack');
  assert.equal(t('Amul Butter'), 'oil-fat');
  assert.equal(t('Chicken Masala'), 'condiment');
});

test('the kind a summary names, and what it maps to', async () => {
  const { kindFromSummary } = await import('./foodType.js');
  assert.equal(kindFromSummary('This popcorn is mostly simple corn, though it uses palmolein.'), 'popcorn');
  assert.equal(kindFromSummary('These edamame beans are a simple, protein-rich snack.'), 'edamame beans');
  assert.equal(kindFromSummary('Not the healthiest option on the shelf, but not the worst either.'), null);
  const t = (productName) => classifyFoodType({ productName }).foodType;
  assert.equal(t('chocolate bar'), 'sweet-snack');
  assert.equal(t('digestive mint'), 'sweet-snack');
  assert.equal(t('cooking medium'), 'oil-fat');
  assert.equal(t('Chyawanprash'), 'supplement');
  assert.equal(t('pitted green olives'), 'condiment');
});

test('a Blinkit shelf maps to a food type, a mixed shelf to none', async () => {
  const { foodTypeForBlinkitCategory } = await import('../data/blinkitCategoryFoodType.js');
  assert.equal(foodTypeForBlinkitCategory('namkeen-snacks'), 'fried-snack');
  assert.equal(foodTypeForBlinkitCategory('cakes-rolls'), 'sweet-snack');
  assert.equal(foodTypeForBlinkitCategory('ghee-vanaspati'), 'oil-fat');
  assert.equal(foodTypeForBlinkitCategory('gourmet-bakery'), null);
  assert.equal(foodTypeForBlinkitCategory(null), null);
});
