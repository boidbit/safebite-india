// src/services/barcodeLinkSafety.js
//
// Whether a barcode read off a Blinkit photo is safe to approve without a
// closer look (Admin > Barcode matches > "Approve all safe"). Reading it the
// same twice (barcodeReader.js) only rules out a MISREAD number; the checks
// here catch the right number on the wrong product -- Blinkit reusing one
// flavour's back-of-pack photo for another, a multipack's outer code, a
// code that's already one of our products.
//
// Safe only when all of these hold:
//   1. read the same twice          -- every blinkit_photo link is
//   2. no other product has this barcode (any link that isn't rejected)
//   3. it isn't already a barcode product in our catalog
//   4. its company code (first 7 digits) matches another barcode of the
//      same brand we already know -- or the brand has just this one product
//      in our catalog, so there's no sibling flavour/pack it could belong to
// Pure: the caller loads the data (adminBarcodeLinksRepo.js).

import { parsePack, nameTokens } from './productFamilies.js';

export const COMPANY_PREFIX_LENGTH = 7;
const SKIP_WORDS = new Set(['the', 'a', 'an']);

/** First real word of a brand: "Sunfeast Farmlite" and "Sunfeast, ITC" -> "sunfeast". */
export function brandKey(brand) {
  // Accents folded first: "Nestlé" -> "nestle", not "nestl".
  const plain = (brand || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const words = plain.split(',')[0].split(/[^a-z0-9]+/).filter((w) => w && !SKIP_WORDS.has(w));
  return words[0] || null;
}

const prefixOf = (barcode) => barcode.slice(0, COMPANY_PREFIX_LENGTH);

/**
 * @param {Array<{ barcode, lookupKey, brand, sources }>} links - pending pairs to judge
 * @param {object} context
 * @param {Array<{ barcode, lookupKey }>} context.otherLinks - every link that isn't rejected
 * @param {Set<string>} context.catalogBarcodes - barcodes already a product_reports key ("barcode:<code>")
 * @param {Array<{ barcode, lookupKey, brand }>} context.knownBarcodes - barcodes with a known brand
 * @param {Map<string, number>} [context.productsByBrand] - catalog products per brandKey()
 * @returns {Map<string, { safe: boolean, reasons: string[], conflicts: string[] }>} keyed "barcode|lookupKey";
 *   `conflicts` are the lookup keys of the OTHER products this barcode is also tied to (or is) --
 *   so the admin can see which ones, not just how many.
 */
export function assessBarcodeLinks(links, { otherLinks = [], catalogBarcodes = new Set(), knownBarcodes = [], productsByBrand = new Map() } = {}) {
  const productsByBarcode = new Map();
  for (const l of [...otherLinks, ...links]) {
    if (!productsByBarcode.has(l.barcode)) productsByBarcode.set(l.barcode, new Set());
    productsByBarcode.get(l.barcode).add(l.lookupKey);
  }
  const byBrand = new Map();
  for (const k of [...knownBarcodes, ...links]) {
    const b = brandKey(k.brand);
    if (!b) continue;
    if (!byBrand.has(b)) byBrand.set(b, []);
    byBrand.get(b).push(k);
  }

  const out = new Map();
  for (const link of links) {
    const reasons = [];
    if (!(link.sources || []).includes('blinkit_photo')) reasons.push('Tied by a person, not read off the photos');

    const others = [...(productsByBarcode.get(link.barcode) || [])].filter((k) => k !== link.lookupKey);
    if (others.length) reasons.push(`This barcode was also found for ${others.length} other product${others.length === 1 ? '' : 's'}`);

    const conflicts = new Set(others);
    if (catalogBarcodes.has(link.barcode)) {
      reasons.push('This barcode is already a product in our catalog');
      conflicts.add(`barcode:${link.barcode}`); // the catalog product IS this barcode
    }
    conflicts.delete(link.lookupKey);

    const brand = brandKey(link.brand);
    const sameBrand = (byBrand.get(brand) || []).filter((k) => k.lookupKey !== link.lookupKey && k.barcode !== link.barcode);
    if (!brand) reasons.push('Brand unknown, so the company code can’t be checked');
    else if (sameBrand.length === 0) {
      // Nothing to compare with -- fine only if the brand has no other
      // product in the catalog this barcode could really belong to.
      const products = productsByBrand.get(brand);
      if (products === undefined || products > 1) reasons.push(`No other ${link.brand} barcode yet to compare the company code with`);
    }
    else if (!sameBrand.some((k) => prefixOf(k.barcode) === prefixOf(link.barcode))) {
      reasons.push(`Company code ${prefixOf(link.barcode)} doesn’t match ${link.brand}’s other barcodes (${[...new Set(sameBrand.map((k) => prefixOf(k.barcode)))].slice(0, 3).join(', ')})`);
    }

    out.set(`${link.barcode}|${link.lookupKey}`, { safe: reasons.length === 0, reasons, conflicts: [...conflicts] });
  }
  return out;
}

/**
 * What to make of two products sharing one barcode. A barcode is one pack of
 * one product, so two different pack sizes can't both be right; the same pack
 * and name is the same product saved twice.
 * @param {{ name?: string, pack?: string|null }} own   the product the barcode is being tied to
 * @param {{ name?: string, pack?: string|null }} other the product that already has / is also tied to it
 * @returns {{ kind: 'different-pack'|'same-product'|'same-pack'|'unknown-pack', text: string }}
 */
export function conflictHint(own, other) {
  const a = parsePack(own.pack) || parsePack(own.name);
  const b = parsePack(other.pack) || parsePack(other.name);
  if (a && b && a.key !== b.key) {
    return { kind: 'different-pack', text: `Different pack sizes (${a.label} vs ${b.label}). One barcode is one pack, so one of the two is probably on the wrong barcode.` };
  }
  if (a && b) {
    const x = nameTokens(own.name), y = nameTokens(other.name);
    const same = x.size > 0 && x.size === y.size && [...x].every((w) => y.has(w));
    return same
      ? { kind: 'same-product', text: `Same pack size (${a.label}) and same name — most likely the same product saved twice. Keep one.` }
      : { kind: 'same-pack', text: `Same pack size (${a.label}) but different names — compare the photos: the same product named two ways, or a different flavour.` };
  }
  return { kind: 'unknown-pack', text: 'Pack size is missing on one of them — compare the photos and names.' };
}
