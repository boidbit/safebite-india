// src/services/typoIngredient.js
//
// Label photos (OCR) and messy text leave junk "ingredients" -- "ing", "der",
// "ii", "sod", "quot", a nutrition fragment, a stray word. The research step
// usually says so in its own explanation ("This appears to be a typo...") but
// still hands back a status and a penalty, and a "concerning" junk entry both
// costs points and caps a product's score at 64.
//
// The rule: junk is neutral. It keeps showing on the label so nothing is
// hidden, but it scores nothing (safe, penalty 0), never counts as a concern,
// and is never saved to the ingredients table, so it can't pile up there.
import { looksSelfDisqualifying } from './geminiService.js';

const TYPO_WORDS = /typo|misspell|nonsens|placeholder|label error|formatting artifact|gibberish|fragment of|not an ingredient|not a food ingredient/i;

/** True when a researched/saved ingredient is a typo, OCR leftover or non-food text. */
export function isJunkIngredient(record) {
  if (!record) return false;
  if (record.recognized === false) return true;
  if (looksSelfDisqualifying(record)) return true;
  const text = [record.reason, record.whatIsIt].filter(Boolean).join(' ');
  return TYPO_WORDS.test(text);
}

/** The same ingredient, scored as nothing. Real ingredients are returned unchanged. */
export function neutralizeJunk(record) {
  if (!isJunkIngredient(record)) return record;
  return { ...record, status: 'safe', penalty: 0, recognized: false };
}
