// src/services/productFamilies.js
//
// Search lists one row per saved product, so "Mountain Dew" shows up as six
// near-identical rows (one per pack size, some named "PepsiCo Mountain Dew",
// some "Mountain dew 250ml"). groupIntoFamilies() folds those into one card
// with a chip per pack size.
//
// The one rule that matters: never merge two different products. Rows are
// the same family only when the words that name the product are identical,
// or one name's words are inside the other's and every extra word is part of
// a brand ("PepsiCo Mountain Dew" = "Mountain Dew"; but "Coca-Cola Zero Sugar"
// is NOT "Coca-Cola", and "Real Orange Juice" is NOT "Tropicana Orange Juice").
// A row that can't be matched stays on its own card -- a miss only costs a
// duplicate card, a wrong merge would hide a product.

const UNITS = { ml: 'ml', l: 'l', ltr: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l', g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', kg: 'kg', kgs: 'kg' };
const PACK_RE = /(\d+(?:\.\d+)?)\s*(ml|ltrs?|litres?|liters?|l|gms?|grams?|g|kgs?)(?![a-z])/i;
const PACK_RE_GLOBAL = new RegExp(PACK_RE.source, 'gi');

// Words that describe the product type rather than name it.
const DESCRIPTORS = new Set([
  'soft', 'drink', 'drinks', 'cold', 'carbonated', 'beverage', 'flavoured', 'flavored', 'flavour', 'flavor',
  'pack', 'bottle', 'pet', 'can', 'pouch', 'the', 'and', 'with', 'of', 'new',
]);

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const num = (n) => String(Math.round(n * 100) / 100);

/**
 * "250ml", "1.25 l", "2.25 L", "72.5g", "1 kg" -> { label, key } or null.
 * `key` is the size in ml or g, so "1000 ml" and "1 L" compare equal; `label`
 * is how it is shown ("250 ml", "1.25 L", "72.5 g", "1 kg").
 */
export function parsePack(text) {
  const m = PACK_RE.exec(String(text || ''));
  if (!m) return null;
  const amount = parseFloat(m[1]);
  const unit = UNITS[m[2].toLowerCase().replace(/s$/, '')] || UNITS[m[2].toLowerCase()];
  if (!unit || !(amount > 0)) return null;
  const liquid = unit === 'ml' || unit === 'l';
  const base = unit === 'l' || unit === 'kg' ? amount * 1000 : amount;
  const label = liquid
    ? (base >= 1000 ? `${num(base / 1000)} L` : `${num(base)} ml`)
    : (base >= 1000 ? `${num(base / 1000)} kg` : `${num(base)} g`);
  return { label, key: `${liquid ? 'ml' : 'g'}${base}`, size: base };
}

/** The pack size of a row: its saved pack size, else one written in its name. */
export function packOf(item) {
  return parsePack(item.packSize) || parsePack(item.productName);
}

const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

function tokens(text) {
  return fold(text).split(/[^a-z0-9]+/).filter(Boolean).map(stem);
}

/** The words that name a product, in order: pack size, descriptors and emoji taken out. */
export function nameWords(name) {
  const withoutPack = fold(name).replace(PACK_RE_GLOBAL, ' ');
  return [...new Set(tokens(withoutPack).filter((w) => !DESCRIPTORS.has(w) && !/^\d+$/.test(w)))];
}

export const nameTokens = (name) => new Set(nameWords(name));

const isSubset = (small, big) => [...small].every((w) => big.has(w));

// A liquid (ml) and a solid (g) are never the same product: "Dairy Milk" the
// chocolate (g) and "Mother Dairy Milk" the milk (ml).
const unitClass = (r) => (r.pack ? (r.pack.key.startsWith('ml') ? 'ml' : 'g') : null);

function sameFamily(a, b) {
  if (a.names.size === 0 || b.names.size === 0) return false;
  if (unitClass(a) && unitClass(b) && unitClass(a) !== unitClass(b)) return false;
  if (isSubset(a.names, b.names) && isSubset(b.names, a.names)) return true;
  const [small, big] = a.names.size <= b.names.size ? [a, b] : [b, a];
  if (!isSubset(small.names, big.names)) return false;
  // The shorter row's own brand has to show up in the longer one, or they are
  // two makers' products that share a name ("Dairy Milk" by Cadbury is not
  // "Mother Dairy Milk").
  if ([...small.brand].some((w) => !big.names.has(w) && !big.brand.has(w))) return false;
  // The extra words must be brand words that open the longer name ("PepsiCo"
  // in "PepsiCo Mountain Dew"). A brand word in the middle is a product line
  // ("Gourmet" in "Lay's Gourmet Potato Chips") and keeps the products apart.
  const extra = big.words.filter((w) => !small.names.has(w));
  return extra.every((w, i) => big.words[i] === w && (big.brand.has(w) || small.brand.has(w)));
}

/**
 * @param {Array<{ lookupKey: string, productName: string, brand?: string|null, packSize?: string|null, score?: number|null, imageUrl?: string|null }>} items
 *   in rank order (best match first)
 * @returns {Array<{ leader: object, members: Array<{ item: object, pack: object|null }> }>}
 *   families in the order their best row appeared; members sorted by pack size,
 *   one per size (the best-ranked row for that size), sizeless rows last.
 */
export function groupIntoFamilies(items) {
  const rows = items.map((item) => ({ item, words: nameWords(item.productName), names: nameTokens(item.productName), brand: new Set(tokens(item.brand)), pack: packOf(item) }));
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (sameFamily(rows[i], rows[j])) parent[find(j)] = find(i);
    }
  }

  const byRoot = new Map();
  rows.forEach((row, i) => {
    const root = find(i);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(row);
  });

  return [...byRoot.values()].map((group) => {
    // One chip per pack size: the first (best-ranked) row seen for it.
    const seen = new Set();
    const members = group.filter((r) => {
      const k = r.pack ? r.pack.key : `row:${r.item.lookupKey}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    members.sort((a, b) => (a.pack ? a.pack.size : Infinity) - (b.pack ? b.pack.size : Infinity));
    // The card shows the best-ranked row that has a photo, else the best-ranked row.
    const leader = (group.find((r) => r.item.imageUrl) || group[0]).item;
    return { leader, members: members.map((r) => ({ item: r.item, pack: r.pack })) };
  });
}
