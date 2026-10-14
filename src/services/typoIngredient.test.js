import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJunkIngredient, neutralizeJunk } from './typoIngredient.js';

test('typo / OCR leftovers are junk, whatever status they came with', () => {
  assert.equal(isJunkIngredient({ status: 'concerning', penalty: 30, recognized: true, reason: 'This appears to be a typo or non-standard ingredient name.' }), true);
  assert.equal(isJunkIngredient({ status: 'safe', penalty: 0, recognized: true, whatIsIt: 'An unrecognized or misspelled ingredient entry.' }), true);
  assert.equal(isJunkIngredient({ status: 'concerning', penalty: 20, recognized: false, reason: 'whatever' }), true);
  assert.equal(isJunkIngredient({ recognized: true, reason: 'This is a typographical error or formatting artifact, not an ingredient.' }), true);
});

test('real ingredients are left alone', () => {
  const sugar = { status: 'concerning', penalty: 15, recognized: true, reason: 'Refined sugar adds empty calories.' };
  assert.equal(isJunkIngredient(sugar), false);
  assert.equal(neutralizeJunk(sugar), sugar);
  const gold = { status: 'concerning', penalty: 25, recognized: true, reason: 'Gold is not a recognized food additive in modern food safety standards.' };
  assert.equal(isJunkIngredient(gold), false);
  assert.equal(isJunkIngredient(null), false);
});

test('junk is scored as nothing', () => {
  const out = neutralizeJunk({ name: 'Sod', status: 'concerning', penalty: 30, recognized: true, reason: 'This is likely a typo for sodium.' });
  assert.equal(out.status, 'safe');
  assert.equal(out.penalty, 0);
  assert.equal(out.recognized, false);
  assert.equal(out.name, 'Sod');
});
