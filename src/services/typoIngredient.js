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

// "This is a typo for 'rice flour'", "a common misspelling of Arachidonic Acid",
// "likely intended to be 'milk solids'". Only a single named answer counts --
// "typo for 'cardamom' or 'curd'" is a guess between two, not a correction.
const QUOTED = /(?:typo(?:graphical error)?|misspel\w*|mis-?spelt)\s+(?:for|of)\s+['"‘“]([^'"’”]{2,40})['"’”]|(?:meant|intended)\s+to\s+be\s+['"‘“]([^'"’”]{2,40})['"’”]/i;
const BARE = /(?:typo(?:graphical error)?|misspel\w*)\s+(?:for|of)\s+([a-z0-9][a-z0-9 ]{1,30}?)(?=\s*[,.;(]|\s+which|\s+and\b|\s+that\b|$)/i;

/**
 * The real ingredient a junk entry is a typo of, when its own explanation names
 * exactly one -- or null.
 */
export function suggestedName(record) {
  if (!record) return null;
  for (const text of [record.reason, record.whatIsIt]) {
    if (!text) continue;
    const m = text.match(QUOTED) || text.match(BARE);
    if (!m) continue;
    const name = (m[1] || m[2]).trim();
    const after = text.slice(m.index + m[0].length);
    if (/^\s*(?:or|\/)\s/i.test(after)) return null; // "'cardamom' or 'curd'"
    if (!/[a-z]/i.test(name) || name.split(/\s+/).length > 5) return null;
    if (/^(?:a|an|the)\s/i.test(name)) return null; // "a standard food additive code" describes, doesn't name
    return name;
  }
  return null;
}
