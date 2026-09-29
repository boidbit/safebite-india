import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleUnitPackSize, singleUnitName, normalizeListing, isMultiPackListing } from './packNormalize.js';

test('N x size keeps one unit', () => {
  assert.deepEqual(singleUnitPackSize('3 x 250 ml'), { packSize: '250 ml', units: 3, clear: true });
  assert.deepEqual(singleUnitPackSize('2 × 450 g'), { packSize: '450 g', units: 2, clear: true });
  assert.equal(singleUnitPackSize('10 x 99 g').packSize, '99 g');
  assert.equal(singleUnitPackSize('2 x 1.5 Ltr').packSize, '1.5 ltr');
});

test('same-size units joined with + keep one unit', () => {
  assert.deepEqual(singleUnitPackSize('150 g + 150 g'), { packSize: '150 g', units: 2, clear: true });
  assert.deepEqual(singleUnitPackSize('2 x 290.4 g + 290.4 g'), { packSize: '290.4 g', units: 3, clear: true });
});

test('plain sizes stay, odd shapes are not guessed', () => {
  assert.deepEqual(singleUnitPackSize('500 g'), { packSize: '500 g', units: 1, clear: true });
  assert.equal(singleUnitPackSize('1 pack').packSize, '1 pack');
  assert.equal(singleUnitPackSize('2 x 500 g + 100 g').clear, false);
  assert.equal(singleUnitPackSize('1 ltr + 200 ml').clear, false);
  assert.equal(singleUnitPackSize('3 packs').clear, false);
  assert.deepEqual(singleUnitPackSize(null), { packSize: null, units: null, clear: true });
});

test('pack and offer parts come off the name', () => {
  assert.equal(singleUnitName('Nestle Milkmaid Mini Sweetened Liquid Condensed Milk - Pack of 2'), 'Nestle Milkmaid Mini Sweetened Liquid Condensed Milk');
  assert.equal(singleUnitName('Popular Fit Eats Fardh Dates - Pack of 2 (Khajur)'), 'Popular Fit Eats Fardh Dates (Khajur)');
  assert.equal(singleUnitName('Kellogg’s Muesli (Pack of 3)'), 'Kellogg’s Muesli');
  assert.equal(singleUnitName('Nestle Gold Corn Flakes - Buy 1 Get 1 Free'), 'Nestle Gold Corn Flakes');
  assert.equal(singleUnitName('Coke Zero (2 x 250 ml)'), 'Coke Zero');
  assert.equal(singleUnitName('Aruba Premium Mocktail (Naughty Cosmopolitan) - Pack of 4 Cans'), 'Aruba Premium Mocktail (Naughty Cosmopolitan)');
  assert.equal(singleUnitName('Coca-Cola Soft Drink - Pack of (2 x 250 ml)'), 'Coca-Cola Soft Drink');
  assert.equal(singleUnitName('Cadbury Chocobakes Choc Layered Cake (pack of 12)'), 'Cadbury Chocobakes Choc Layered Cake');
  assert.equal(singleUnitName('Yu Cranberry Juice with Berry Pieces - 100% Fruit Juice'), 'Yu Cranberry Juice with Berry Pieces - 100% Fruit Juice');
});

test('normalizeListing flags what it will not guess', () => {
  assert.deepEqual(normalizeListing({ product_name: 'Yu Cranberry Juice', pack_size: '2 x 250 ml' }), { name: 'Yu Cranberry Juice', packSize: '250 ml', changed: true, needsLook: null });
  assert.match(normalizeListing({ product_name: 'Amul Butter - Pack of 2', pack_size: '500 g' }).needsLook, /whole pack/);
  assert.match(normalizeListing({ product_name: 'Ghee', pack_size: '2 x 500 g + 100 g' }).needsLook, /by hand/);
  assert.equal(normalizeListing({ product_name: 'Amul Butter', pack_size: '100 g' }).changed, false);
});

test('isMultiPackListing spots multi-packs and offers', () => {
  assert.equal(isMultiPackListing('Yu Cranberry Juice', '2 x 250 ml'), true);
  assert.equal(isMultiPackListing('Amul Butter - Pack of 2', '100 g'), true);
  assert.equal(isMultiPackListing('Nestle Gold Flakes - Buy 1 Get 1 Free', null), true);
  assert.equal(isMultiPackListing('Jivo Olive Oil', '1 ltr + 200 ml'), true);
  assert.equal(isMultiPackListing('Amul Butter', '100 g'), false);
  assert.equal(isMultiPackListing('Amul Butter', '1 x 100 g'), false);
  assert.equal(isMultiPackListing('Amul Butter', null), false);
  assert.equal(isMultiPackListing('Bournvita 2x Nutrition Drink Mix', '500 g'), false);
});

test('bundles of different products are left alone', () => {
  const r = normalizeListing({ product_name: 'Nuturge Premium Almond Chocolate Gift Pack - Pack of 5', pack_size: null });
  assert.equal(r.changed, false);
  assert.equal(r.bundle, true);
  assert.equal(normalizeListing({ product_name: 'Yu Tomato Soup + Kimchi Noodles Combo', pack_size: null }).bundle, true);
});
