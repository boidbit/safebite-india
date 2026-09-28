// src/services/productMatch.js
//
// "Is it one of these?" -- ranking catalog products against a product
// name that came from somewhere else: Open Food Facts' name for a scanned
// barcode, Gemini's read of a front-of-pack photo, or what someone typed.
// Those names rarely match ours character for character ("Parle-G Gluco
// Biscuits 250 g" vs our "Parle-G Original Gluco Biscuits"), so this works
// word by word, and treats the pack size separately: the same product in a
// different size is a different barcode, so it's ranked lower, not dropped.
// Pure -- the query that fetches candidates lives in productCache.js.
import { parsePackSize } from './servingResolver.js';

// Words that say nothing about WHICH product it is.
const STOPWORDS = new Set([
  'and', 'with', 'the', 'of', 'for', 'in', 'a', 'an', '&', 'pack', 'packet', 'pouch', 'jar', 'box', 'bottle',
  'new', 'combo', 'free', 'offer', 'value', 'family', 'mini', 'pc', 'pcs', 'piece', 'pieces', 'x',
]);
const UNIT_RE = /^\d+(\.\d+)?(g|gm|gms|kg|ml|l|ltr|pcs?)?$/;

/** The words that identify a product, lowercased, units and filler removed. */
export function nameTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !UNIT_RE.test(w));
}

// Product-type words: true of hundreds of products, so they're the worst
// words to FETCH candidates by (they'd crowd out the real one) -- still
// counted when scoring.
const GENERIC = new Set([
  'biscuits', 'biscuit', 'cookies', 'cookie', 'chips', 'noodles', 'noodle', 'chocolate', 'chocolates', 'masala',
  'juice', 'drink', 'milk', 'tea', 'coffee', 'flavour', 'flavor', 'flavoured', 'cream', 'snacks', 'snack',
  'namkeen', 'powder', 'instant', 'sauce', 'bar', 'cake', 'bread', 'oil', 'atta', 'rice', 'dal', 'ghee',
  'butter', 'cheese', 'paneer', 'curd', 'water', 'soft', 'mix', 'spicy', 'sweet', 'salted', 'classic', 'original',
]);

/**
 * The few words worth sending to the database to fetch candidates:
 * distinctive ones first (brand, sub-brand), longest first among those,
 * generic product-type words last.
 */
export function searchTokens(name, max = 3) {
  const unique = [...new Set(nameTokens(name))];
  const rank = (w) => (GENERIC.has(w) ? 1 : 0);
  return unique.sort((a, b) => rank(a) - rank(b) || b.length - a.length).slice(0, max);
}

// The whole name as one run of letters/digits -- so "Krumb Kraft" and
// "KrumbKraft", or "Cake Tale" and "Caketale", read the same.
const joined = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// A word counts as present if it appears inside the other side's joined
// name (short words must match exactly, or "tea" would be found in "steam").
function present(word, otherTokens, otherJoined) {
  if (otherTokens.has(word)) return true;
  if (word.length >= 4 && otherJoined.includes(word)) return true;
  // "chips" vs "chip", "biscuits" vs "biscuit"
  const stem = word.replace(/(es|s)$/, '');
  return stem.length >= 4 && otherJoined.includes(stem);
}

/**
 * 0-1: how likely `candidate` is the product described by `query`.
 * @param {{ productName: string, brand?: string, packSize?: string }} query
 * @param {{ productName: string, brand?: string, packSize?: string }} candidate
 */
export function matchScore(query, candidate) {
  const qText = `${query.brand || ''} ${query.productName || ''}`;
  const cText = `${candidate.brand || ''} ${candidate.productName || ''}`;
  const qTokens = new Set(nameTokens(qText));
  const cTokens = new Set(nameTokens(cText));
  if (qTokens.size === 0 || cTokens.size === 0) return 0;
  const qJoined = joined(qText);
  const cJoined = joined(cText);

  // How much of what we were told is in the candidate, and how much of the
  // candidate is explained by it -- both matter ("Parle" alone matches
  // every Parle product).
  const recall = [...qTokens].filter((w) => present(w, cTokens, cJoined)).length / qTokens.size;
  const precision = [...cTokens].filter((w) => present(w, qTokens, qJoined)).length / cTokens.size;
  let score = 0.65 * recall + 0.35 * precision;

  // Brands that clearly disagree -- neither found anywhere in the other
  // side's name -- halve it. (A misread brand on a photo, with the real
  // brand still in the product name, isn't a disagreement.)
  const qb = joined(query.brand);
  const cb = joined(candidate.brand);
  if (qb.length >= 3 && cb.length >= 3 && !cJoined.includes(qb) && !qJoined.includes(cb)) score *= 0.5;

  // Same pack size: small boost. A clearly different one: rank it lower.
  const qp = parsePackSize(query.packSize || query.productName);
  const cp = parsePackSize(candidate.packSize || candidate.productName);
  if (qp && cp && qp.unit === cp.unit) {
    if (Math.abs(qp.value - cp.value) / Math.max(qp.value, cp.value) < 0.05) score = Math.min(1, score + 0.1);
    else score *= 0.85;
  }
  return Math.round(score * 100) / 100;
}

// Below this it's a guess, not a match worth offering.
export const MIN_MATCH_SCORE = 0.45;

/** Best candidates first, weak ones dropped. */
export function rankMatches(query, candidates, limit = 5) {
  return candidates
    .map((c) => ({ ...c, matchScore: matchScore(query, c) }))
    .filter((c) => c.matchScore >= MIN_MATCH_SCORE)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}
