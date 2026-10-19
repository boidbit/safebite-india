// src/utils/duplicateNames.js
//
// Admin > Products > "Same name saved more than once". The strictest duplicate
// check: the product name is the same, apart from capitals and spacing. Two
// products with the same name but DIFFERENT pack sizes ("Maggi Masala 70 g" /
// "Maggi Masala 280 g" both saved as "Maggi Masala") are different products and
// are not counted. A product with no readable pack size can't be shown to
// differ, so it counts as a possible duplicate of every same-named product.
import { parsePack } from '../services/productFamilies.js';

/** "  Maggi  MASALA " -> "maggi masala" */
export const exactNameKey = (name) => String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * @param {Array<{ id: string, productName: string, packSize?: string|null }>} products
 * @returns {Set<string>} ids of the products that have a same-named twin of the same (or unknown) pack size
 */
export function duplicateNameIds(products) {
  const byName = new Map();
  for (const p of products) {
    const key = exactNameKey(p.productName);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ id: p.id, pack: parsePack(p.packSize)?.key ?? null });
  }
  const dupes = new Set();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const a of group) {
      // Twin = another row whose pack size is the same, or that either side doesn't give.
      if (group.some((b) => b !== a && (a.pack === null || b.pack === null || a.pack === b.pack))) dupes.add(a.id);
    }
  }
  return dupes;
}
