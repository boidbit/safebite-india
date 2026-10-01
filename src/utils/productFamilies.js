// src/utils/productFamilies.js
//
// "Is this the same product?" across the whole catalog -- the same packet
// saved more than once from different places (a Blinkit scrape, an Open
// Food Facts barcode, someone's scan), under different names ("Parle-G
// Biscuit", "Parle G", "parle - G") and often with different scores.
//
//   family    -- same brand, same variant words (flavour / formulation),
//                same identifying words; pack size ignored
//   duplicate -- same family AND the same pack size (or one not known):
//                the same product saved twice
// Different pack sizes of one product are a family, not duplicates.
// Pure -- the Duplicates page (AdminDuplicates.jsx) and
// scripts/audit-product-families.js both use it.
import { nameTokens } from '../services/productMatch.js';
import { brandKey } from '../services/barcodeLinkSafety.js';

// "750ml", "2 ltr", "75g", "1.25 L" -> { value, unit } in g or ml.
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|gram|grams|mg|l|ltr|ltrs|litre|litres|liter|liters|ml)\b/i;
export function parseSize(text) {
  const m = String(text || '').match(SIZE_RE);
  if (!m) return null;
  const v = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u.startsWith('kg')) return { value: v * 1000, unit: 'g' };
  if (u === 'mg') return { value: v / 1000, unit: 'g' };
  if (u.startsWith('g')) return { value: v, unit: 'g' };
  if (u === 'ml') return { value: v, unit: 'ml' };
  return { value: v * 1000, unit: 'ml' };
}
export const sizeLabel = (s) => {
  if (!s) return '';
  if (s.value >= 1000) return `${+(s.value / 1000).toFixed(2)} ${s.unit === 'g' ? 'kg' : 'L'}`;
  return `${+s.value.toFixed(1)} ${s.unit}`;
};

// Words that make it a DIFFERENT product (flavour, formulation, line).
const VARIANT = new Set(['masala', 'salted', 'chocolate', 'choco', 'strawberry', 'mango', 'orange', 'lemon', 'lime', 'vanilla',
  'cheese', 'onion', 'tomato', 'chilli', 'chili', 'pudina', 'mint', 'elaichi', 'kesar', 'zero', 'diet', 'lite', 'light', 'sugarfree',
  'atta', 'oats', 'gold', 'cashew', 'almond', 'badam', 'peri', 'tangy', 'spicy', 'hot', 'garlic', 'pepper', 'coffee', 'cola', 'jeera',
  'pista', 'butterscotch', 'caramel', 'honey', 'multigrain', 'brown', 'white', 'dark', 'milk', 'fruit', 'nut', 'nuts', 'veg', 'chicken',
  'paneer', 'mutton', 'egg', 'cream', 'sour', 'bbq', 'cherry', 'apple', 'guava', 'litchi', 'pineapple', 'berry', 'mixed', 'special',
  'smoked', 'malai', 'achaari', 'achari', 'ragi', 'barista', 'truffle', 'kesari', 'saffron', 'ginger', 'tulsi', 'lemongrass', 'hazelnut']);
// Words that say nothing about which product it is.
const GENERIC = new Set(['biscuit', 'biscuits', 'cookie', 'cookies', 'noodles', 'noodle', 'drink', 'drinks', 'soft', 'juice', 'chips',
  'namkeen', 'snack', 'snacks', 'bar', 'original', 'classic', 'regular', 'plain', 'new', 'flavour', 'flavor', 'flavoured', 'flavored',
  'taste', 'instant', 'minute', 'pack', 'bottle', 'can', 'tin', 'pet', 'packet', 'pouch', 'family', 'value', 'combo', 'brand',
  'refreshing', 'carbonated', 'beverage', 'premium', 'fresh', 'tasty', 'delicious', 'india', 'indian', 'ml', 'ltr', 'gm', 'kg']);
const STEM = { glucose: 'gluco', biscuits: 'biscuit', cookies: 'cookie', noodles: 'noodle', chips: 'chip', nuts: 'nut', chilli: 'chili' };
const stem = (w) => STEM[w] || w;

// A company and its own brands: "Maggi" with brand "Nestlé" isn't a wrong
// brand, "Parle-G" with brand "Britannia" is.
const PARENT_BRANDS = {
  nestle: ['maggi', 'kitkat', 'munch', 'milkybar', 'everyday', 'milkmaid', 'nescafe', 'cerelac', 'polo', 'bar'],
  hindustan: ['kissan', 'knorr', 'bru', 'horlicks', 'brooke', 'boost', 'lipton', 'kwality'],
  hul: ['kissan', 'knorr', 'bru', 'horlicks', 'brooke', 'boost', 'lipton', 'kwality'],
  itc: ['sunfeast', 'bingo', 'aashirvaad', 'yippee', 'natural', 'candyman', 'fabelle', 'master', 'kitchens'],
  pepsico: ['lays', 'kurkure', 'uncle', 'doritos', 'quaker', 'tropicana', 'cheetos', 'pepsi', 'mountain', 'sting', 'gatorade'],
  pepsi: ['lays', 'kurkure', 'doritos', 'tropicana', 'mountain', 'sting'],
  coca: ['sprite', 'thums', 'maaza', 'limca', 'fanta', 'minute', 'kinley', 'charged', 'smartwater', 'schweppes', 'coke'],
  mondelez: ['cadbury', 'oreo', 'bournvita', 'tang', 'gems', 'perk', 'dairy', 'silk', 'fuse', 'bournville'],
  cadbury: ['oreo', 'bournvita', 'gems', 'perk', 'dairy', 'silk', 'fuse', 'bournville', 'chocobakes'],
  parle: ['frooti', 'appy', 'bailley', 'monaco', 'krackjack', 'hide', 'fab', 'kismi', 'melody', 'happy'],
  dabur: ['real', 'hajmola'],
  britannia: ['good', 'marie', 'little', 'tiger', 'treat', 'nutrichoice', 'milk', 'bourbon', 'pure', 'nice', 'laughing', 'winkin'],
  tata: ['sampann', 'tetley', 'himalayan', 'soulfull', 'gluco'],
  kelloggs: ['chocos', 'muesli'],
  marico: ['saffola', 'parachute'],
  adani: ['fortune'],
  haldiram: ['haldirams'],
  haldirams: ['haldiram'],
};
const sameCompany = (a, b) => (PARENT_BRANDS[a] || []).includes(b) || (PARENT_BRANDS[b] || []).includes(a);

/** How many catalog products each brand key has -- feeds profileProduct. */
export function brandCounts(rows) {
  const counts = new Map();
  for (const r of rows) { const b = brandKey(r.brand); if (b) counts.set(b, (counts.get(b) || 0) + 1); }
  return counts;
}

/**
 * @param {{ id, productName, brand, packSize }} p
 * @param {Map<string, number>} knownBrands - from brandCounts()
 */
export function profileProduct(p, knownBrands) {
  const name = p.productName || '';
  const words = nameTokens(name).map(stem).filter((w) => !/^\d/.test(w));
  const first = words[0];
  const fromName = first && (knownBrands.get(first) || 0) >= 5 ? first : null;
  const fromBrand = brandKey(p.brand);
  // The name names a known brand the brand field doesn't mention
  // ("Parle-G" with brand "Britannia").
  const brandLooksWrong = Boolean(fromName && fromBrand && fromName !== fromBrand
    && !nameTokens(p.brand || '').includes(fromName) && !sameCompany(fromName, fromBrand));
  const family = fromName || fromBrand || first || '?';
  // Only the brand itself comes out of the name, not every word of the
  // brand field: with brand "Parle Monaco", "monaco" is what tells Monaco
  // apart from Parle-G.
  const brandWords = new Set([family, fromBrand].filter(Boolean));
  const core = new Set(words.filter((w) => !brandWords.has(w) && !GENERIC.has(w) && !VARIANT.has(w) && w.length >= 2));
  const variant = [...new Set(words.filter((w) => VARIANT.has(w)))].sort().join('+');
  const fromPack = parseSize(p.packSize);
  const size = fromPack || parseSize(name);
  return { brandKey: family, brandLooksWrong, suggestedBrand: brandLooksWrong ? fromName : null, core, variant, size, sizeFrom: fromPack ? 'pack size' : size ? 'name' : '' };
}

const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter);
};
// One name inside the other counts only when the shorter one says enough
// on its own (2+ words) -- "Masti" alone would pull Masti curd into Masti buttermilk.
const subset = (a, b) => a.size >= 2 && [...a].every((x) => b.has(x));

export function sameFamily(x, y) {
  return x.brandKey === y.brandKey && x.variant === y.variant
    && (jaccard(x.core, y.core) >= 0.6 || subset(x.core, y.core) || subset(y.core, x.core));
}

export function sameSize(x, y) {
  if (!x.size || !y.size) return true;
  return x.size.unit === y.size.unit && Math.abs(x.size.value - y.size.value) / Math.max(x.size.value, y.size.value) < 0.03;
}

/**
 * Families: each product joins the first family whose FIRST member it
 * matches directly (joining any member chained unrelated products: A ~ B
 * and B ~ C put A with C). Most-scanned products seed families.
 * @param {Array<{ id, scanCount, profile }>} items - profile from profileProduct
 */
export function groupFamilies(items) {
  const families = [];
  const byBrand = new Map();
  for (const x of [...items].sort((a, b) => (b.scanCount || 0) - (a.scanCount || 0))) {
    const key = x.profile.brandKey;
    if (!byBrand.has(key)) byBrand.set(key, []);
    const fams = byBrand.get(key);
    const home = fams.find((fam) => sameFamily(fam[0].profile, x.profile));
    if (home) home.push(x); else { const fam = [x]; fams.push(fam); families.push(fam); }
  }
  return families;
}

/**
 * The identifying words one name has and the other doesn't --
 * { added, missing } relative to `base`. Nothing either way means the names
 * say the same thing ("Kissan Tomato Ketchup" / "Kissan Fresh Tomato Ketchup").
 */
export function nameDifference(base, other) {
  const words = (p) => new Set([...p.core, ...(p.variant ? p.variant.split('+') : [])]);
  const a = words(base);
  const b = words(other);
  return { added: [...b].filter((w) => !a.has(w)), missing: [...a].filter((w) => !b.has(w)) };
}

/** Within each family, products of the same (or an unknown) size: groups of 2+. */
export function duplicateGroups(families) {
  const groups = [];
  for (const fam of families) {
    if (fam.length < 2) continue;
    const placed = new Set();
    // Products with a known size seed the groups: a size-unknown seed would
    // pull 960 g and 250 g packs into one group.
    for (const x of [...fam].sort((a, b) => Number(Boolean(b.profile.size)) - Number(Boolean(a.profile.size)))) {
      if (placed.has(x.id)) continue;
      const g = fam.filter((y) => !placed.has(y.id) && sameSize(x.profile, y.profile));
      g.forEach((y) => placed.add(y.id));
      if (g.length > 1) groups.push({ products: g, family: fam });
    }
  }
  return groups;
}

/**
 * 0-7: how much real data a product carries -- which copy to keep.
 * @param {{ hasImage, barcode, profile, hasNutrition, ingredientCount, brand, reviewStatus }} p
 */
export function completeness(p) {
  return [
    p.hasImage,
    Boolean(p.barcode),
    Boolean(p.profile?.size),
    p.hasNutrition,
    (p.ingredientCount || 0) >= 3,
    Boolean(p.brand) && !p.profile?.brandLooksWrong,
    p.reviewStatus === 'approved',
  ].filter(Boolean).length;
}

/** The copy to keep: most complete, then approved, then most scanned, then newest. */
export function suggestKeep(products) {
  return [...products].sort((a, b) =>
    completeness(b) - completeness(a)
    || Number(b.reviewStatus === 'approved') - Number(a.reviewStatus === 'approved')
    || (b.scanCount || 0) - (a.scanCount || 0)
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
}
