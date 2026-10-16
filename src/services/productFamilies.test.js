import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePack, packOf, nameTokens, groupIntoFamilies } from './productFamilies.js';

const row = (productName, extra = {}) => ({ lookupKey: `k:${productName}:${extra.packSize || ''}`, productName, brand: null, packSize: null, score: 50, imageUrl: null, ...extra });
const names = (families) => families.map((f) => f.members.map((m) => m.item.productName));

test('pack sizes are read the way they are saved and written the same way', () => {
  assert.equal(parsePack('250ml').label, '250 ml');
  assert.equal(parsePack('250 ml').label, '250 ml');
  assert.equal(parsePack('1.25 l').label, '1.25 L');
  assert.equal(parsePack('2.25 L').label, '2.25 L');
  assert.equal(parsePack('1000 ml').label, '1 L');
  assert.equal(parsePack('72.5g').label, '72.5 g');
  assert.equal(parsePack('1 kg').label, '1 kg');
  assert.equal(parsePack('1 Litre').label, '1 L');
  assert.equal(parsePack('1 L').key, parsePack('1000 ml').key);
  assert.equal(parsePack(null), null);
  assert.equal(parsePack('family pack'), null);
});

test('a pack size can come from the name when none was saved', () => {
  assert.equal(packOf(row('Mountain dew 250ml')).label, '250 ml');
  assert.equal(packOf(row('Mountain Dew', { packSize: '400 ml' })).label, '400 ml');
  assert.equal(packOf(row('Mountain Dew')), null);
});

test('name words ignore pack size, emoji, accents and filler words', () => {
  assert.deepEqual([...nameTokens('MEWATI 🔔 Mountain Dew 250ml')].sort(), ['dew', 'mewati', 'mountain']);
  assert.deepEqual([...nameTokens('Mountain Dew Soft Drink')].sort(), ['dew', 'mountain']);
  assert.deepEqual([...nameTokens('Nestlé Maggi Noodles')].sort(), ['maggi', 'nestle', 'noodle']);
});

test('Mountain Dew rows become one card with one chip per pack size, smallest first', () => {
  const families = groupIntoFamilies([
    row('PepsiCo Mountain Dew', { brand: 'PepsiCo', packSize: '400 ml', score: 51 }),
    row('Mountain Dew', { packSize: '2.25 l', score: 64 }),
    row('MEWATI 🔔 Mountain Dew', { brand: 'MEWATI', packSize: '1.25 l', score: 54 }),
    row('Mountain Dew Soft Drink', { score: 52 }),
    row('Mountain dew 250ml', { score: 51 }),
    row('PepsiCo Mountain Dew', { brand: 'PepsiCo', packSize: '250 ml', score: 51 }),
  ]);
  assert.equal(families.length, 1);
  const labels = families[0].members.map((m) => m.pack?.label ?? null);
  // 250 ml appears twice in the data but gets one chip; the row with no size goes last.
  assert.deepEqual(labels, ['250 ml', '400 ml', '1.25 L', '2.25 L', null]);
});

test('different flavours and variants stay on their own cards', () => {
  const families = groupIntoFamilies([
    row('Coca-Cola', { brand: 'Coca-Cola', packSize: '250 ml' }),
    row('Coca-Cola Zero Sugar Soft Drink', { brand: 'Coca-Cola', packSize: '750 ml' }),
    row('Coca-Cola Diet Coke', { brand: 'Coca-Cola', packSize: '300 ml' }),
    row('Coca-Cola Cherry Flavoured Soft Drink', { brand: 'Coca-Cola' }),
    row('Coca-Cola Zero Soft Drink', { brand: 'Coca-Cola', packSize: '600 ml' }),
  ]);
  assert.equal(families.length, 5);
});

test('the same words from different brands are not merged', () => {
  const families = groupIntoFamilies([
    row('Real Orange Juice', { brand: 'Real' }),
    row('Tropicana Orange Juice', { brand: 'Tropicana' }),
  ]);
  assert.equal(families.length, 2);
});

test('Maggi flavours are not folded into each other', () => {
  const families = groupIntoFamilies([
    row('Maggi Masala Noodles', { brand: 'Maggi', packSize: '70 g' }),
    row('Maggi Masala Veg Atta Noodles', { brand: 'Maggi', packSize: '72.5 g' }),
    row('Maggi Spicy Garlic Instant Noodles', { brand: 'Maggi', packSize: '248 g' }),
    row('Maggi Rich Tomato Ketchup', { brand: 'Maggi', packSize: '960 g' }),
  ]);
  assert.equal(families.length, 4);
});

test('families keep the order of their best-ranked row and the card uses a row with a photo', () => {
  const families = groupIntoFamilies([
    row('Sprite', { packSize: '250 ml' }),
    row('Thums Up', { packSize: '250 ml', imageUrl: 'a.jpg' }),
    row('Thums Up', { packSize: '2 l', imageUrl: 'b.jpg' }),
    row('Sprite', { packSize: '2 l', imageUrl: 'c.jpg' }),
  ]);
  assert.deepEqual(names(families), [['Sprite', 'Sprite'], ['Thums Up', 'Thums Up']]);
  assert.equal(families[0].leader.imageUrl, 'c.jpg');
});

test('a row with no usable name words is never merged', () => {
  const families = groupIntoFamilies([row('250 ml'), row('500 ml')]);
  assert.equal(families.length, 2);
});

test('a brand word in the middle of a name is a product line, not a brand prefix', () => {
  const families = groupIntoFamilies([
    row("Lay's Potato Chips", { brand: "Lay's", packSize: '50 g' }),
    row("Lay's Gourmet Potato Chips", { brand: "Lay's Gourmet", packSize: '80 g' }),
  ]);
  assert.equal(families.length, 2);
});

test('a brand prefix is still ignored: "Parle Agro Appy Fizz" is "Appy Fizz"', () => {
  const families = groupIntoFamilies([
    row('Appy Fizz Apple Flavoured Sparkling Drink', { brand: 'Appy Fizz', packSize: '250 ml' }),
    row('Parle Agro Appy Fizz Apple Flavoured Sparkling Drink', { brand: 'Parle Agro' }),
  ]);
  assert.equal(families.length, 1);
});

test('Cadbury Dairy Milk (chocolate) is not Mother Dairy Milk (milk)', () => {
  const families = groupIntoFamilies([
    row('Dairy Milk', { brand: 'Cadbury', packSize: '23 g' }),
    row('Cadbury Dairy Milk', { brand: 'Cadbury', packSize: '100 g' }),
    row('Mother Dairy Milk', { brand: 'Mother Dairy', packSize: '500 ml' }),
  ]);
  assert.equal(families.length, 2);
  // Even with no pack size on either, the two makers stay apart.
  assert.equal(groupIntoFamilies([
    row('Dairy Milk', { brand: 'Cadbury' }),
    row('Mother Dairy Milk', { brand: 'Mother Dairy' }),
  ]).length, 2);
});
