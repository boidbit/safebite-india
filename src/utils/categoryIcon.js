// src/utils/categoryIcon.js
// Shared between IngredientCard.jsx (the Ingredients tab) and the score
// breakdown modal (Result.jsx) so the same ingredient always gets the
// same icon everywhere in the app, not two slightly different mappings.
//
// Deliberately generic for anything not clearly one of these -- guessing
// a specific food icon for an ambiguous "other" category would be more
// misleading than a neutral placeholder.
const CATEGORY_ICONS = {
  natural: '🌿',
  protein: '🫘', // see proteinIcon -- most protein on Indian labels is veg
  spice: '🌶️',
  'flavour enhancer': '👅',
  flavour: '👃',
  flavor: '👃',
  'acidity regulator': '⚗️',
  sweetener: '🍬',
  oil: '🫗',
  fat: '🧈',
  preservative: '🧪',
  antioxidant: '🛡️',
  emulsifier: '🥣', // blends oil and water -- was a lotion bottle, which read as a cosmetic
  color: '🎨',
  colorant: '🎨',
  'raising agent': '🫧',
  stabilizer: '🫙',
};

// "Protein" covers peanuts, dal and soy as much as chicken -- a steak next to
// Roasted Peanuts alarms a vegetarian. The ingredient's own name picks the icon;
// a meat icon only for something that names meat.
const PROTEIN_ICONS = [
  [/\b(eggs?|egg (white|yolk|powder))\b/, '🥚'],
  [/\b(fish|prawns?|shrimps?|tuna|salmon|anchov\w*|seafood)\b/, '🐟'],
  [/\b(chicken|mutton|meat|beef|pork|lamb|bacon|ham|sausages?|gelatine?)\b/, '🍗'],
  [/\b(milk|whey|casein\w*|paneer|cheese|curd|yogh?urt)\b/, '🥛'],
  [/(peanut|groundnut|almond|cashew|walnut|pistachio|pista|hazelnut|\bnuts?\b|\bseeds?\b)/, '🥜'],
];

export function categoryIcon(category, name = '') {
  const key = (category || '').toLowerCase();
  if (key === 'protein') {
    const n = String(name || '').toLowerCase();
    const hit = PROTEIN_ICONS.find(([re]) => re.test(n));
    if (hit) return hit[1];
  }
  return CATEGORY_ICONS[key] || '🔹';
}

// A tinted background for the icon's own little square -- purely a
// visual grouping cue (spices read warm, preservatives read clinical,
// etc.), never a severity signal on its own (severity is always the
// pill next to it, see getIngredientSeverity). A small fixed palette
// keyed by category, falling back to a deterministic pick from the
// same palette for any category not listed here -- so an "other"
// ingredient still gets a consistent, real colour instead of always
// landing on the same one.
const CATEGORY_PALETTE = [
  { bg: 'rgba(34, 197, 94, 0.14)', fg: '#16a34a' }, // green
  { bg: 'rgba(239, 68, 68, 0.14)', fg: '#dc2626' }, // red
  { bg: 'rgba(249, 115, 22, 0.14)', fg: '#ea580c' }, // orange
  { bg: 'rgba(217, 119, 6, 0.14)', fg: '#b45309' }, // amber/brown
  { bg: 'rgba(59, 130, 246, 0.14)', fg: '#2563eb' }, // blue
  { bg: 'rgba(168, 85, 247, 0.14)', fg: '#9333ea' }, // purple
  { bg: 'rgba(20, 184, 166, 0.14)', fg: '#0d9488' }, // teal
  { bg: 'rgba(107, 114, 128, 0.14)', fg: '#4b5563' }, // grey
];

const CATEGORY_COLOR_INDEX = {
  natural: 0,
  spice: 2,
  protein: 1,
  sweetener: 3,
  oil: 3,
  fat: 3,
  'flavour enhancer': 5,
  flavour: 5,
  flavor: 5,
  'acidity regulator': 4,
  preservative: 7,
  antioxidant: 6,
  emulsifier: 4,
  color: 5,
  colorant: 5,
  'raising agent': 4,
  stabilizer: 7,
};

export function categoryColor(category) {
  const key = (category || '').toLowerCase();
  if (key in CATEGORY_COLOR_INDEX) return CATEGORY_PALETTE[CATEGORY_COLOR_INDEX[key]];
  // Deterministic, not random -- the same unlisted category always gets
  // the same colour across every ingredient and every render.
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length];
}
