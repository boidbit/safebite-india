import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessBarcodeLinks, brandKey, conflictHint } from './barcodeLinkSafety.js';

const link = (barcode, lookupKey, brand, sources = ['blinkit_photo']) => ({ barcode, lookupKey, brand, sources });
const judge = (links, context) => assessBarcodeLinks(links, context);
const verdict = (result, l) => result.get(`${l.barcode}|${l.lookupKey}`);

test('brandKey takes the first real word', () => {
  assert.equal(brandKey('Sunfeast Farmlite'), 'sunfeast');
  assert.equal(brandKey('Sunfeast, ITC'), 'sunfeast');
  assert.equal(brandKey('Parle-G'), 'parle');
  assert.equal(brandKey('The Health Factory'), 'health');
  assert.equal(brandKey(''), null);
});

test('safe when the company code matches the brand’s other barcodes', () => {
  const l = link('8901725004620', 'blinkit:sunfeast farmlite nuts', 'Sunfeast Farmlite');
  const r = judge([l], { knownBarcodes: [{ barcode: '8901725004910', lookupKey: 'barcode:8901725004910', brand: 'Sunfeast' }] });
  assert.deepEqual(verdict(r, l), { safe: true, reasons: [], conflicts: [] });
});

test('two pending links of the same brand vouch for each other', () => {
  const a = link('8901725004620', 'blinkit:a', 'Sunfeast');
  const b = link('8901725012984', 'blinkit:b', 'Sunfeast Marie Light');
  const r = judge([a, b]);
  assert.equal(verdict(r, a).safe, true);
  assert.equal(verdict(r, b).safe, true);
});

test('not safe when the same barcode was found for two products', () => {
  const choc = link('8901725004620', 'blinkit:choco', 'Sunfeast');
  const van = link('8901725004620', 'blinkit:vanilla', 'Sunfeast');
  const known = [{ barcode: '8901725004910', lookupKey: 'barcode:8901725004910', brand: 'Sunfeast' }];
  const r = judge([choc, van], { knownBarcodes: known });
  assert.equal(verdict(r, choc).safe, false);
  assert.match(verdict(r, choc).reasons[0], /also found for 1 other product/);
});

test('not safe when an approved link already ties it to another product', () => {
  const l = link('8901725004620', 'blinkit:a', 'Sunfeast');
  const r = judge([l], {
    otherLinks: [{ barcode: '8901725004620', lookupKey: 'blinkit:other' }],
    knownBarcodes: [{ barcode: '8901725004910', lookupKey: 'x', brand: 'Sunfeast' }],
  });
  assert.equal(verdict(r, l).safe, false);
});

test('not safe when the barcode is already a catalog product', () => {
  const l = link('8901725004620', 'blinkit:a', 'Sunfeast');
  const r = judge([l], { catalogBarcodes: new Set(['8901725004620']), knownBarcodes: [{ barcode: '8901725004910', lookupKey: 'x', brand: 'Sunfeast' }] });
  assert.equal(verdict(r, l).safe, false);
  assert.match(verdict(r, l).reasons.join(), /already a product in our catalog/);
});

test('not safe when the company code differs from the brand’s', () => {
  const l = link('8906186161820', 'blinkit:a', 'Sunfeast');
  const r = judge([l], { knownBarcodes: [{ barcode: '8901725004910', lookupKey: 'x', brand: 'Sunfeast' }] });
  assert.equal(verdict(r, l).safe, false);
  assert.match(verdict(r, l).reasons[0], /doesn’t match/);
});

test('not safe when there is nothing of the brand to compare with', () => {
  const l = link('8906186161820', 'blinkit:a', 'OVS Guruvayur');
  assert.equal(verdict(judge([l]), l).safe, false);
  // ...and the brand has other products in the catalog it could belong to
  assert.equal(verdict(judge([l], { productsByBrand: new Map([['ovs', 3]]) }), l).safe, false);
});

test('safe when the brand has just this one product in the catalog', () => {
  const l = link('8906186161820', 'blinkit:a', 'OVS Guruvayur');
  assert.deepEqual(verdict(judge([l], { productsByBrand: new Map([['ovs', 1]]) }), l), { safe: true, reasons: [], conflicts: [] });
});

test('a single-product brand is still not safe when another rule fails', () => {
  const l = link('8906186161820', 'blinkit:a', 'OVS Guruvayur');
  const r = judge([l], { productsByBrand: new Map([['ovs', 1]]), catalogBarcodes: new Set(['8906186161820']) });
  assert.equal(verdict(r, l).safe, false);
});

test('a link a person made is never auto-approved', () => {
  const l = link('8901725004620', 'blinkit:a', 'Sunfeast', ['name_search']);
  const r = judge([l], { knownBarcodes: [{ barcode: '8901725004910', lookupKey: 'x', brand: 'Sunfeast' }] });
  assert.equal(verdict(r, l).safe, false);
});

test('the other products sharing the barcode are listed, not just counted', () => {
  const choc = link('8901725004620', 'blinkit:choco', 'Sunfeast');
  const van = link('8901725004620', 'blinkit:vanilla', 'Sunfeast');
  const r = judge([choc, van], { otherLinks: [{ barcode: '8901725004620', lookupKey: 'blinkit:old' }] });
  assert.deepEqual(verdict(r, choc).conflicts.sort(), ['blinkit:old', 'blinkit:vanilla']);
});

test('a barcode that is already a catalog product lists that product as the conflict', () => {
  const l = link('8901725004620', 'blinkit:a', 'Sunfeast');
  const r = judge([l], { catalogBarcodes: new Set(['8901725004620']) });
  assert.deepEqual(verdict(r, l).conflicts, ['barcode:8901725004620']);
});

test('two different pack sizes cannot share one barcode', () => {
  const h = conflictHint({ name: 'Sunfeast Marie Light', pack: '75 g' }, { name: 'Sunfeast Marie Light', pack: '600 g' });
  assert.equal(h.kind, 'different-pack');
  assert.match(h.text, /75 g vs 600 g/);
});

test('same pack size and name is the same product saved twice', () => {
  assert.equal(conflictHint({ name: 'Maggi Masala Noodles', pack: '70 g' }, { name: 'MAGGI MASALA NOODLES', pack: '70g' }).kind, 'same-product');
});

test('same pack size but a different name needs a photo check', () => {
  assert.equal(conflictHint({ name: 'Oreo Vanilla', pack: '120 g' }, { name: 'Oreo Chocolate', pack: '120 g' }).kind, 'same-pack');
});

test('a pack size written only in the name still counts, and a missing one is called out', () => {
  assert.equal(conflictHint({ name: 'Mountain dew 250ml', pack: null }, { name: 'Mountain Dew', pack: '2.25 l' }).kind, 'different-pack');
  assert.equal(conflictHint({ name: 'Mountain Dew', pack: null }, { name: 'Mountain Dew', pack: '2.25 l' }).kind, 'unknown-pack');
});
