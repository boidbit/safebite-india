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

export const COMPANY_PREFIX_LENGTH = 7;
const SKIP_WORDS = new Set(['the', 'a', 'an']);

/** First real word of a brand: "Sunfeast Farmlite" and "Sunfeast, ITC" -> "sunfeast". */
export function brandKey(brand) {
  const words = (brand || '').toLowerCase().split(',')[0].split(/[^a-z0-9]+/).filter((w) => w && !SKIP_WORDS.has(w));
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
 * @returns {Map<string, { safe: boolean, reasons: string[] }>} keyed "barcode|lookupKey"
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

    if (catalogBarcodes.has(link.barcode)) reasons.push('This barcode is already a product in our catalog');

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

    out.set(`${link.barcode}|${link.lookupKey}`, { safe: reasons.length === 0, reasons });
  }
  return out;
}
