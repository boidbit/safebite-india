import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSugarProjection, accumulateSugar, GRAMS_PER_TEASPOON } from './sugarProjection.js';

const base = {
  productName: 'Frooti Fresh Mango Drink',
  foodType: 'beverage',
  realNutrientsServingGrams: 200,
  realNutrientsServingUnit: 'ml',
};

test('per-serving sugar is computed from per-100 and the label serving', () => {
  const p = buildSugarProjection({ ...base, nutrientsPer100: { addedSugarG: 14, totalSugarG: 15 } });
  assert.equal(p.gramsPerServing, 28); // 14g/100ml x 200ml
  assert.equal(p.teaspoonsPerServing, 7); // 28g / 4g
  assert.equal(p.servingUnit, 'ml');
  assert.equal(p.servingSource, 'label');
  assert.equal(p.isAddedSugar, true);
});

test('no label serving -> the typical serving is used, and flagged as an estimate', () => {
  const p = buildSugarProjection({ ...base, realNutrientsServingGrams: null, nutrientsPer100: { addedSugarG: 14, totalSugarG: 15 } });
  assert.equal(p.servingSource, 'standard');
  assert.equal(p.servingGrams, 180);
  assert.equal(p.gramsPerServing, 25.2);
});

test('an uncategorisable product with no serving shows nothing (no invented serving)', () => {
  const p = buildSugarProjection({ productName: 'Some Creme Sandwiches', foodType: 'other', nutrientsPer100: { addedSugarG: 30, totalSugarG: 32 } });
  assert.equal(p, null);
});

test('real case: Oreo with a bogus 100g "serving" now uses a typical biscuit serving, not 100g', () => {
  const oreo = { productName: 'Oreo Original', foodType: 'sweet-snack', realNutrientsServingGrams: 100 };
  const p = buildSugarProjection({ ...oreo, nutrientsPer100: { addedSugarG: 38.8, totalSugarG: 39 } });
  assert.equal(p.servingSource, 'standard');
  assert.equal(p.servingGrams, 20);
  assert.equal(p.gramsPerServing, 7.8); // was 38.8g / 9.7 tsp on the bogus 100g
});

test('real case: a 400g family pack is never shown as one serving', () => {
  const marie = { productName: 'Marie biscuits', foodType: 'sweet-snack', realNutrientsServingGrams: 300 };
  const p = buildSugarProjection({ ...marie, nutrientsPer100: { addedSugarG: 23, totalSugarG: 24 } });
  assert.equal(p.servingGrams, 20);
  assert.notEqual(p.servingSource, 'label');
});

test('a small single-serve pack is used as the serving', () => {
  const kitkat = { productName: 'Nestle KitKat', foodType: 'sweet-snack', packSize: '37.3 g' };
  const p = buildSugarProjection({ ...kitkat, nutrientsPer100: { addedSugarG: 29, totalSugarG: 30 } });
  assert.equal(p.servingSource, 'pack');
  assert.equal(p.gramsPerServing, 10.8);
});

test('condiments, supplements, oils and infant food are skipped', () => {
  for (const foodType of ['condiment', 'supplement', 'oil-fat', 'infant']) {
    assert.equal(buildSugarProjection({ ...base, foodType, nutrientsPer100: { addedSugarG: 30 } }), null, foodType);
  }
  assert.equal(buildSugarProjection({ ...base, isCondimentOrSeasoning: true, nutrientsPer100: { addedSugarG: 30 } }), null);
});

test('under one teaspoon per serving is not worth a card', () => {
  assert.equal(buildSugarProjection({ ...base, nutrientsPer100: { addedSugarG: 1.5, totalSugarG: 2 } }), null);
});

test('plain dairy with no added/total split is skipped -- could be all natural lactose', () => {
  const milk = { productName: 'Amul Taaza Toned Milk', foodType: 'dairy', realNutrientsServingGrams: 200, realNutrientsServingUnit: 'ml' };
  assert.equal(buildSugarProjection({ ...milk, nutrientsPer100: { addedSugarG: 4.8 } }), null);
});

test('flavoured dairy WITH a real added-sugar split is still shown', () => {
  const shake = { productName: 'Amul Kool Kesar Milk', foodType: 'dairy', realNutrientsServingGrams: 180, realNutrientsServingUnit: 'ml' };
  const p = buildSugarProjection({ ...shake, nutrientsPer100: { addedSugarG: 7, totalSugarG: 11.5 } });
  assert.equal(p.gramsPerServing, 12.6);
  assert.equal(p.isAddedSugar, true);
});

test('"100%"/"no added sugar" names with no split are skipped -- that sugar is the fruit\'s own', () => {
  for (const productName of ['Real 100% Orange Juice', 'Paper Boat Coconut Water No Added Sugar', 'Unsweetened Almond Drink']) {
    assert.equal(buildSugarProjection({ ...base, productName, nutrientsPer100: { addedSugarG: 10 } }), null, productName);
  }
});

test('a "100%" that isn\'t about sugar ("100% VEG", "100% eggless") doesn\'t hide the sugar', () => {
  for (const productName of ['CAKE 100% VEG Gobbles fruity fun', 'Swiss Roll 100% Vegetarian', 'Choco Cake 100% Eggless']) {
    assert.ok(buildSugarProjection({ ...base, foodType: 'sweet-snack', realNutrientsServingGrams: 60, realNutrientsServingUnit: 'g', productName, nutrientsPer100: { addedSugarG: 26 } }), productName);
  }
});

test('without a split, a normal sweetened product is still shown -- just not called "added" sugar', () => {
  const p = buildSugarProjection({ ...base, nutrientsPer100: { addedSugarG: 12 } });
  assert.equal(p.gramsPerServing, 24);
  assert.equal(p.isAddedSugar, false);
});

test('no split: a savory item with a little of its own sugar is skipped (needs 2+ tsp)', () => {
  const biryani = { productName: 'OK Hyderabadi Veg Biriyani', foodType: 'ready-meal', realNutrientsServingGrams: 250 };
  assert.equal(buildSugarProjection({ ...biryani, nutrientsPer100: { addedSugarG: 2.8 } }), null);
  const p = buildSugarProjection({ ...biryani, nutrientsPer100: { addedSugarG: 2.8, totalSugarG: 4 } });
  assert.equal(p.gramsPerServing, 7);
});

test('powders/mixes/soups/condensed milk are skipped -- not eaten as packed', () => {
  const knorr = { productName: 'Knorr International Mexican Tomato Corn Soup', foodType: 'ready-meal', realNutrientsServingGrams: 163 };
  assert.equal(buildSugarProjection({ ...knorr, nutrientsPer100: { addedSugarG: 28, totalSugarG: 30 } }), null);
  const condensed = { productName: 'Amul Mithaimate Sweetened Condensed Milk', foodType: 'dairy' };
  assert.equal(buildSugarProjection({ ...condensed, nutrientsPer100: { addedSugarG: 45, totalSugarG: 55 } }), null);
  const juice = { productName: 'Real Mixed Fruit Juice', foodType: 'beverage', realNutrientsServingGrams: 200, realNutrientsServingUnit: 'ml' };
  assert.ok(buildSugarProjection({ ...juice, nutrientsPer100: { addedSugarG: 12, totalSugarG: 13 } }), '"mixed" is not "mix"');
});

test('a drink with an impossible sugar density is skipped (per-bottle figure saved as per-100)', () => {
  const mogu = { productName: 'Mogu Mogu Pineapple Fruit Drink', foodType: 'beverage', realNutrientsServingGrams: 320, realNutrientsServingUnit: 'ml' };
  assert.equal(buildSugarProjection({ ...mogu, nutrientsPer100: { addedSugarG: 32, totalSugarG: 33 } }), null);
});

test('an added-sugar figure of 0 (with a split) shows nothing', () => {
  assert.equal(buildSugarProjection({ ...base, nutrientsPer100: { addedSugarG: 0, totalSugarG: 9 } }), null);
});

test('accumulateSugar is plain multiplication: week, 30-day month, 52-week year', () => {
  const daily = accumulateSugar(28, 7);
  assert.equal(daily.week.grams, 196);
  assert.equal(daily.month.grams, 840);
  assert.equal(daily.year.grams, 10192);
  assert.equal(daily.year.kg, 10.2);
  assert.equal(daily.year.teaspoons, Math.round(10192 / GRAMS_PER_TEASPOON));
  assert.equal(accumulateSugar(28, 1).year.grams, 1456);
});

test('real cases from the live catalog that must never show a number', () => {
  const cases = [
    // sugar/sweetener sold as a product
    { productName: 'Mawana Premium Brown Sugar', foodType: 'staple', nutrientsPer100: { addedSugarG: 99 } },
    { productName: "I'm Lite Sugar with Stevia", foodType: 'staple', nutrientsPer100: { addedSugarG: 99 } },
    { productName: 'Puramate Icing Sugar', foodType: 'other', nutrientsPer100: { addedSugarG: 97 } },
    // cocktail mixer
    { productName: 'Absolut Mixers (Lime & Mint Mojito Flavoured)', foodType: 'beverage', packSize: '250 ml', nutrientsPer100: { addedSugarG: 18, totalSugarG: 18.5 } },
    // impossible sugar density (>100g per 100g)
    { productName: 'Loca Boca Mango Rasberry Heart Cake', foodType: 'sweet-snack', nutrientsPer100: { addedSugarG: 240, totalSugarG: 241 } },
  ];
  for (const c of cases) assert.equal(buildSugarProjection(c), null, c.productName);
});

test('a "sugar free" product is NOT mistaken for a sugar packet', () => {
  const p = buildSugarProjection({ productName: 'Sugar Free Choco Chip Cookies', foodType: 'sweet-snack', nutrientsPer100: { addedSugarG: 21, totalSugarG: 22 } });
  assert.ok(p);
});

test('real case: Milk Bikis is a biscuit (20g), not a 180ml milk drink', () => {
  const p = buildSugarProjection({ productName: 'Britannia Milk Bikis', foodType: 'dairy', nutrientsPer100: { addedSugarG: 22, totalSugarG: 23 } });
  assert.equal(p.servingGrams, 20);
  assert.equal(p.servingUnit, 'g');
});

test('real case: a 50g tin of candies is a couple of pieces, not one serving', () => {
  const p = buildSugarProjection({ productName: 'Barkleys Aniseed Intense Mint Candies', foodType: 'sweet-snack', packSize: '50 g', nutrientsPer100: { addedSugarG: 85, totalSugarG: 86 } });
  assert.equal(p.servingSource, 'standard');
  assert.equal(p.servingGrams, 10);
});

test('dry tea/coffee is skipped, a ready-to-drink iced tea is not', () => {
  assert.equal(buildSugarProjection({ productName: 'Lipton GREEN TEA CLEAR & LIGHT 250 g', foodType: 'beverage', nutrientsPer100: { addedSugarG: 18.4 } }), null);
  const iced = buildSugarProjection({ productName: 'Himalayan Brew Kangra Iced Tea', foodType: 'beverage', packSize: '330 ml', nutrientsPer100: { addedSugarG: 10.8, totalSugarG: 11 } });
  assert.ok(iced);
});
