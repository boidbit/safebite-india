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

test('suggestedName reads the one real ingredient a typo stands for', async () => {
  const { suggestedName } = await import('./typoIngredient.js');
  assert.equal(suggestedName({ reason: "This is a typo for 'rice flour', which is a common, safe grain product." }), 'rice flour');
  assert.equal(suggestedName({ reason: 'This appears to be a typo for \'Black Pepper\', a standard spice.' }), 'Black Pepper');
  assert.equal(suggestedName({ reason: 'This is likely a misspelling of sodium sesquicarbonate (INS 500iii), safe.' }), 'sodium sesquicarbonate');
  assert.equal(suggestedName({ reason: 'This is likely a typo for INS 200 (Sorbic Acid), a common preservative.' }), 'INS 200');
  assert.equal(suggestedName({ reason: "The word is likely intended to be 'milk solids'." }), 'milk solids');
  assert.equal(suggestedName({ reason: "This is likely a typo for 'cardamom' or 'curd', but as written it is not recognized." }), null);
  assert.equal(suggestedName({ reason: 'This appears to be a typo or non-standard ingredient name.' }), null);
  assert.equal(suggestedName({ reason: 'This is a random word or incomplete label fragment, not a food ingredient.' }), null);
  assert.equal(suggestedName({ reason: 'This is likely a typo for a standard food additive code.' }), null);
  assert.equal(suggestedName(null), null);
});
