import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSize, sizeLabel, profileProduct, groupFamilies, duplicateGroups, suggestKeep, completeness } from './productFamilies.js';

const brands = new Map([['parle', 40], ['amul', 60], ['kissan', 10], ['britannia', 80], ['coca', 20], ['sprite', 6]]);
const item = (id, productName, brand, packSize = null, extra = {}) => {
  const p = { id, productName, brand, packSize, scanCount: 0, ...extra };
  return { ...p, profile: profileProduct(p, brands) };
};

test('parseSize reads sizes in g and ml', () => {
  assert.deepEqual(parseSize('750ml'), { value: 750, unit: 'ml' });
  assert.deepEqual(parseSize('Sprite 2 ltr'), { value: 2000, unit: 'ml' });
  assert.deepEqual(parseSize('1.5 kg'), { value: 1500, unit: 'g' });
  assert.equal(parseSize('Parle-G Biscuit'), null);
  assert.equal(sizeLabel(parseSize('2 L')), '2 L');
  assert.equal(sizeLabel(parseSize('250 ml')), '250 ml');
});

test('the same packet under different names is one duplicate group', () => {
  const fams = groupFamilies([
    item('a', 'Parle-G Biscuit', 'Parle'),
    item('b', 'Parle G', 'PARLE'),
    item('c', 'parle - G', 'parle'),
  ]);
  const groups = duplicateGroups(fams);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].products.length, 3);
});

test('a wrong brand is spotted from the name', () => {
  const p = item('x', 'Parle-G', 'Britannia');
  assert.equal(p.profile.brandLooksWrong, true);
  assert.equal(p.profile.suggestedBrand, 'parle');
  assert.equal(p.profile.brandKey, 'parle');
});

test('a company and its own brand is not a wrong brand', () => {
  const counts = new Map([...brands, ['maggi', 30], ['nestle', 50]]);
  const p = { id: 'm', productName: 'Maggi Masala Noodles', brand: 'Nestlé' };
  assert.equal(profileProduct(p, counts).brandLooksWrong, false);
});

test('different flavours are different products', () => {
  const groups = duplicateGroups(groupFamilies([
    item('a', 'Kissan Fresh Tomato Ketchup', 'Kissan'),
    item('b', 'Kissan Mixed Fruit Jam', 'Kissan'),
  ]));
  assert.equal(groups.length, 0);
});

test('different pack sizes are one family but not duplicates', () => {
  const fams = groupFamilies([
    item('a', 'Sprite Lemon Lime Soft Drink', 'Sprite', '750 ml'),
    item('b', 'Sprite Lemon Lime Soft Drink 2 L', 'Sprite'),
  ]);
  assert.equal(fams.filter((f) => f.length > 1).length, 1);
  assert.equal(duplicateGroups(fams).length, 0);
});

test('a sub-brand in the brand field still tells products apart', () => {
  const groups = duplicateGroups(groupFamilies([
    item('g', 'Parle-G Biscuit', 'Parle'),
    item('m', 'Parle Monaco Classic Regular Biscuit', 'Parle Monaco'),
    item('r', 'Parle Marie Biscuits', 'Parle Marie'),
  ]));
  assert.equal(groups.length, 0);
});

test('a one-word name does not pull in a different product', () => {
  const groups = duplicateGroups(groupFamilies([
    item('a', 'Amul Masti Spiced Buttermilk', 'Amul'),
    item('b', 'Amul Masti Pouch Curd', 'Amul'),
  ]));
  assert.equal(groups.length, 0);
});

test('a size-unknown copy does not pull two pack sizes into one group', () => {
  const groups = duplicateGroups(groupFamilies([
    item('u', 'Britannia NutriChoice Digestive High Fibre', 'Britannia'),
    item('big', 'Britannia NutriChoice Digestive High Fibre', 'Britannia', '960 g'),
    item('small', 'Britannia NutriChoice Digestive High Fibre', 'Britannia', '250 g'),
  ]));
  for (const g of groups) {
    const sizes = new Set(g.products.map((p) => p.packSize).filter(Boolean));
    assert.ok(sizes.size <= 1, 'one group holds two pack sizes');
  }
});

test('suggestKeep prefers the most complete copy', () => {
  const thin = item('thin', 'Parle G', 'Parle', null, { hasImage: false, hasNutrition: false, ingredientCount: 2 });
  const full = item('full', 'Parle-G Gluco Biscuit', 'Parle', '250 g', { hasImage: true, hasNutrition: true, ingredientCount: 8, barcode: '8901719' });
  assert.ok(completeness(full) > completeness(thin));
  assert.equal(suggestKeep([thin, full]).id, 'full');
});
