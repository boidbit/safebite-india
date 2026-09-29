// src/services/packNormalize.js
//
// Blinkit lists the same product as a multi-pack: "3 x 250 ml", "Nestle
// Milkmaid Mini - Pack of 2", "... - Buy 1 Get 1 Free". Same product, same
// ingredients and barcode -- only the number of units differs. We keep ONE
// unit: "3 x 250 ml" -> "250 ml", and the pack/offer part comes off the
// name, so the multi-pack becomes (or merges into) the single product.
//
// Pure -- used by scripts/normalize-pack-listings.js.
import { isBundleListing } from './bundleListing.js';

// "3 x 250 ml", "2 × 450 g", "10 x 1 pcs"
const MULTIPLIED = /^\s*(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i;

// Name suffixes that only say how many units are in the listing.
const UNIT_WORDS = '(?:\\s+(?:cans?|bottles?|pouches|pouch|packets?|packs?|sachets?|units?|pcs|pieces|tins?|jars?|cups?|bars?))?';
const NAME_PACK_PARTS = [
  /\s*[-–,]?\s*pack\s+of\s*\(\s*\d+\s*[x×]\s*\d+(?:\.\d+)?\s*[a-z]+\s*\)/gi, // "- Pack of (2 x 250 ml)"
  new RegExp(`\\s*[-–,]?\\s*\\(\\s*pack\\s+of\\s+\\d+${UNIT_WORDS}\\s*\\)`, 'gi'), // "(Pack of 2)"
  new RegExp(`\\s*[-–,]\\s*pack\\s+of\\s+\\d+${UNIT_WORDS}\\b`, 'gi'),          // "- Pack of 4 Cans"
  new RegExp(`\\s+pack\\s+of\\s+\\d+${UNIT_WORDS}\\s*$`, 'gi'),                  // "... Pack of 2"
  /\s*[-–,]\s*buy\s+\d+\s+get\s+\d+(\s+free)?\b/gi,     // "- Buy 1 Get 1 Free"
  /\s*\(\s*\d+\s*[x×]\s*\d+(?:\.\d+)?\s*[a-z]+\s*\)/gi, // "(2 x 250 ml)"
];

/**
 * @returns {{ packSize: string|null, units: number|null, clear: boolean }}
 *   clear=false when it's a shape we won't guess at ("2 x 500 g + 100 g",
 *   "3 packs").
 */
const SINGLE = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i;

export function singleUnitPackSize(packSize) {
  const raw = (packSize || '').trim();
  if (!raw) return { packSize: null, units: null, clear: true };
  if (/^1\s*packs?$/i.test(raw)) return { packSize: raw, units: 1, clear: true };
  // "2 x 290.4 g + 290.4 g", "150 g + 150 g": every unit the same size.
  const terms = raw.split('+').map((t) => {
    const m = t.match(MULTIPLIED) || t.match(SINGLE);
    // "3 packs" says how many, not how big one is.
    if (!m || /^packs?$/i.test(m[m.length - 1])) return null;
    return m.length === 4 ? { units: Number(m[1]), size: `${m[2]} ${m[3].toLowerCase()}` } : { units: 1, size: `${m[1]} ${m[2].toLowerCase()}` };
  });
  if (terms.every(Boolean) && new Set(terms.map((t) => t.size)).size === 1) {
    return { packSize: terms[0].size, units: terms.reduce((s, t) => s + t.units, 0), clear: true };
  }
  return { packSize: raw, units: null, clear: false };
}

/** The name without its "Pack of N" / "Buy N Get N Free" / "(2 x 250 ml)" part. */
export function singleUnitName(name) {
  let out = String(name || '');
  for (const re of NAME_PACK_PARTS) out = out.replace(re, '');
  return out.replace(/\s{2,}/g, ' ').replace(/\s*[-–,]\s*$/, '').trim();
}

/**
 * A listing of several units of one product ("3 x 250 ml", "- Pack of 2",
 * "Buy 1 Get 1 Free", "1 ltr + 200 ml"). The scraper skips these: the
 * single-unit listing is the product.
 */
export function isMultiPackListing(name, packSize) {
  if (singleUnitName(name) !== String(name || '')) return true;
  const pack = singleUnitPackSize(packSize);
  return !pack.clear || (pack.units || 1) > 1;
}

/**
 * What to do with one listing. `packInName` = the name said how many units
 * (so a plain pack size like "500 g" could be the whole pack's weight).
 * @returns {{ name, packSize, changed: boolean, needsLook: string|null }}
 */
export function normalizeListing({ product_name: name, pack_size: packSize }) {
  const newName = singleUnitName(name);
  // A gift pack / hamper / "A + B" combo is several DIFFERENT products --
  // not ours to shrink to one unit (bundleListing.js / remove-bundle-listings.js).
  if (isBundleListing(newName)) return { name, packSize: packSize || null, changed: false, needsLook: null, bundle: true };
  const pack = singleUnitPackSize(packSize);
  const packInName = newName !== name;
  let needsLook = null;
  if (!pack.clear) needsLook = `Pack size "${packSize}" isn't a plain "N x size" -- set the single unit's size by hand`;
  else if (packInName && pack.units === 1) needsLook = `Name said it's a multi-pack but the size "${packSize}" may be the whole pack's -- check the single unit's size`;
  return {
    name: newName,
    packSize: pack.packSize,
    changed: newName !== name || (pack.clear && pack.packSize !== (packSize || null)),
    needsLook,
  };
}
