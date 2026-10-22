import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscover, RANKINGS_URL } from './discoverRepo.js';

const p = (id, score) => ({ id, name: `Product ${id}`, score, verdict: 'Good' });

test('reads rankings from the website root', () => {
  assert.equal(RANKINGS_URL, 'https://foodguards.space/rankings.json');
});

test('keeps well-formed categories and products', () => {
  const out = parseDiscover({ categories: [{ id: 'biscuits', label: 'Biscuits & Cookies', total: 40, items: [p('a', 80), p('b', 70)] }], swaps: [] });
  assert.equal(out.categories.length, 1);
  assert.equal(out.categories[0].total, 40);
  assert.deepEqual(out.categories[0].items.map((i) => i.id), ['a', 'b']);
});

test('drops malformed products, and categories left empty', () => {
  const out = parseDiscover({ categories: [
    { id: 'noodles', label: 'Instant Noodles', items: [p('a', 60), { id: 'b', name: 'No score' }] },
    { id: 'empty', label: 'Empty', items: [{ id: 'x' }] },
  ] });
  assert.deepEqual(out.categories.map((c) => c.id), ['noodles']);
  assert.equal(out.categories[0].items.length, 1);
});

test('keeps only swaps that go up in score', () => {
  const out = parseDiscover({ swaps: [
    { category: 'biscuits', from: p('a', 40), to: p('b', 80) },
    { category: 'noodles', from: p('c', 70), to: p('d', 60) },
    { category: 'juice', from: p('e', 40) },
  ] });
  assert.deepEqual(out.swaps.map((s) => s.category), ['biscuits']);
});

test('an empty or missing file gives empty lists, not an error', () => {
  assert.deepEqual(parseDiscover(null), { categories: [], swaps: [] });
  assert.deepEqual(parseDiscover({}), { categories: [], swaps: [] });
});
