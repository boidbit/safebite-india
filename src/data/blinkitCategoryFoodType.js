// src/data/blinkitCategoryFoodType.js
//
// Blinkit's own shelf for a product (blinkit_products.category, the sitemap
// path it was found under) -> our food type. Used when the product's name
// doesn't say what it is ("Fuse", "Mom's Magic"): Blinkit has already put it
// on the chocolate or the biscuit shelf. Shelves that mix kinds (gourmet
// bakery: breads and cakes) are left out on purpose -- no guess is better than
// a wrong one.
const MAP = {
  'ready-to-cook-eat': 'ready-meal', 'frozen-veg-snacks': 'ready-meal', 'frozen-non-veg-snacks': 'ready-meal', 'pasta-more': 'ready-meal', noodles: 'ready-meal', soup: 'ready-meal',
  'whole-spices': 'condiment', 'powdered-spice': 'condiment', 'herbs-seasoning': 'condiment', 'baking-ingredients': 'condiment', 'dips-salad-dressings': 'condiment',
  'cooking-sauces-vinegar': 'condiment', 'table-sauces': 'condiment', 'imported-spreads': 'condiment', 'jam-spreads': 'condiment', 'peanut-butter': 'condiment',
  'mouth-fresheners': 'condiment', 'indian-chutney-pickle': 'condiment', 'gravy-mixes-pastes': 'condiment',
  'water-ice-cubes': 'beverage', 'soft-drinks': 'beverage', 'lassi-shakes-more': 'beverage', 'cold-coffee-ice-tea': 'beverage', 'imported-tea-coffee': 'beverage',
  'mango-drinks': 'beverage', 'green-flavoured-tea': 'beverage', 'beverages-gift-packs': 'beverage', 'herbal-infusion': 'beverage', 'lactose-free-drink': 'beverage',
  tea: 'beverage', coffee: 'beverage', 'pure-juices': 'beverage',
  'dessert-cake-mixes': 'sweet-snack', 'rusks-wafers': 'sweet-snack', 'cakes-rolls': 'sweet-snack', 'candies-gum': 'sweet-snack', 'chocolate-packs': 'sweet-snack',
  cookies: 'sweet-snack', 'biscuit-gift-pack': 'sweet-snack', chocolates: 'sweet-snack', 'indian-sweets': 'sweet-snack',
  'namkeen-snacks': 'fried-snack', 'bhujia-mixtures': 'fried-snack',
  'salt-sugar-jaggery': 'staple', eggs: 'staple', 'poha-daliya-other-grains': 'staple', 'frozen-veg': 'staple', 'rajma-chhole-others': 'staple',
  'flakes-kids-cereals': 'staple', 'bread-pav': 'staple', 'millet-other-flours': 'staple', 'instant-mixes': 'staple',
  'curd-yogurt': 'dairy', 'paneer-tofu': 'dairy', 'gourmet-cheese': 'dairy', 'cream-whitener': 'dairy',
  'butter-more': 'oil-fat', 'ghee-vanaspati': 'oil-fat', oil: 'oil-fat',
  'makhana-more': 'nuts-seeds', 'dates-seeds': 'nuts-seeds', 'dry-fruits': 'nuts-seeds',
};

/** Our food type for a Blinkit shelf, or null when the shelf doesn't say. */
export function foodTypeForBlinkitCategory(category) {
  return MAP[String(category || '').trim().toLowerCase()] || null;
}
