import test from 'node:test';
import assert from 'node:assert/strict';
import { nameTokens, searchTokens, matchScore, rankMatches, MIN_MATCH_SCORE } from './productMatch.js';

test('tokens drop units, pack sizes and filler words', () => {
  assert.deepEqual(nameTokens('Parle-G Gluco Biscuits 250 g Pack'), ['parle', 'gluco', 'biscuits']);
});

test('search words: distinctive first, generic product-type words last', () => {
  assert.deepEqual(searchTokens('Parle-G Gluco Biscuits 250 g'), ['parle', 'gluco', 'biscuits']);
  assert.equal(searchTokens('Sunfeast Dark Fantasy Choco Fills')[0], 'sunfeast');
});

test('a differently-worded name still matches the right product', () => {
  const query = { productName: 'PARLE-G GLUCO BISCUITS 250 G' };
  const right = { productName: 'Parle-G Original Gluco Biscuits', packSize: '250 g' };
  const wrongBrand = { productName: 'Britannia Marie Gold Biscuits', packSize: '250 g' };
  assert.ok(matchScore(query, right) > matchScore(query, wrongBrand));
  assert.ok(matchScore(query, right) >= MIN_MATCH_SCORE);
});

test('same product, different pack size ranks below the exact pack', () => {
  const query = { productName: 'Maggi 2-Minute Masala Noodles', packSize: '70 g' };
  const ranked = rankMatches(query, [
    { lookupKey: 'big', productName: 'Maggi 2-Minute Masala Noodles', packSize: '280 g' },
    { lookupKey: 'exact', productName: 'Maggi 2-Minute Masala Noodles', packSize: '70 g' },
  ]);
  assert.deepEqual(ranked.map((r) => r.lookupKey), ['exact', 'big']);
});

test('a brand-only overlap is not offered as a match', () => {
  const ranked = rankMatches({ productName: 'Haldiram Aloo Bhujia' }, [{ productName: 'Haldiram Rasgulla Tin Sweet' }]);
  assert.equal(ranked.length, 0);
});

test('real front-of-pack reads: brand spacing and a misread brand still match', () => {
  const cases = [
    [{ brand: 'KRUMB KRAFT', productName: 'SOURDOUGH MIXED HERB CRACKERS' }, { productName: 'KrumbKraft Mixed Herb Sourdough Crackers', brand: 'KrumbKraft' }],
    [{ brand: 'Cake Tale', productName: 'Choco-chips LOAF CAKE', packSize: '75g' }, { productName: 'Caketale Premium Chocochip Dry Cake', brand: 'Caketale' }],
    [{ brand: 'IAGS', productName: 'Kharif Rose Tea', packSize: '50g' }, { productName: 'Kharif Rose Tea Bags', brand: 'Kharif' }],
  ];
  for (const [q, c] of cases) assert.ok(matchScore(q, c) >= MIN_MATCH_SCORE, `${c.productName}: ${matchScore(q, c)}`);
});
