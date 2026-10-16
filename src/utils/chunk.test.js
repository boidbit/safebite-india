import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk } from './chunk.js';

test('splits a list into pieces of at most the given size, keeping order', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});

test('an empty list gives no pieces and a short list gives one', () => {
  assert.deepEqual(chunk([], 100), []);
  assert.deepEqual(chunk([1, 2], 100), [[1, 2]]);
});

test('1317 ids in pieces of 100 make 14 requests, none over 100 ids', () => {
  const pieces = chunk(Array.from({ length: 1317 }, (_, i) => i), 100);
  assert.equal(pieces.length, 14);
  assert.equal(Math.max(...pieces.map((p) => p.length)), 100);
  assert.equal(pieces.flat().length, 1317);
});
