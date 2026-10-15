// src/utils/categoryIcon.js
// Shared between IngredientCard.jsx (the Ingredients tab) and the score
// breakdown modal (Result.jsx) so the same ingredient always gets the
// same icon everywhere in the app, not two slightly different mappings.
//
// The icon comes from the ingredient's NAME first (wheat flour 🌾, salt 🧂,
// onion 🧅), and only falls back to its category. Category alone gave wrong
// pictures: "protein" put a steak next to Roasted Peanuts, "emulsifier" a
// lotion bottle, and "natural"/"other" a leaf or a blank diamond for water,
// salt and rice alike.
//
// Order matters -- first match wins:
//   1. what an additive DOES ("Preservative (Sodium Benzoate)" is a preservative)
//   2. animal foods, so meat never shows unless the name says meat
//   3. compound foods before their parts ("Peanut Oil" is oil, "Gram Flour" dal)
//   4. single foods
// Anything unmatched gets its category's icon, or a neutral 🔹 -- guessing a
// specific food for an ambiguous name would mislead more than a placeholder.
const NAME_ICONS = [
  // 1. Additive functions
  [/flavou?r enhancer|monosodium glutamate|\bmsg\b|glutamate|inosinate|guanylate/, '👅'],
  [/preservative|benzoate|sorbate|propionate|sulphite|sulfite|metabisulphite|nitrite|nitrate/, '🧪'],
  [/antioxidant|tocopherol|\bbha\b|\bbht\b|\btbhq\b|ascorbyl/, '🛡️'],
  [/emulsifi|lecithin|glycerides/, '🥣'],
  [/stabili[sz]er|thickener|thickening|gelling|humectant|\bgums?\b|xanthan|guar|carrageenan|pectin|agar|cellulose|carboxymethyl/, '🫙'],
  [/anti-?caking|free[- ]flow/, '🫙'],
  [/glazing|shellac|carnauba|beeswax/, '✨'],
  [/raising agent|leavening|baking (soda|powder)|bicarbonate|carbonates?\b/, '🫧'],
  [/acidity regulator|acidulant/, '⚗️'],
  [/colou?r|caramel|tartrazine|sunset yellow|carmoisine|annatto|beetroot red|erythrosine|brilliant blue|\bins 1[0-9]{2}/, '🎨'],
  [/sucralose|aspartame|acesulfame|stevia|saccharin|sorbitol|maltitol|xylitol|erythritol|sweetener|\bins 420/, '🍬'],
  [/glycerine|glycerol|propylene glycol|antifoam|\bins 900/, '🫙'],
  [/caffeine/, '☕'],
  [/vitamin|mineral|\biron\b|calcium|\bzinc\b|magnesium|selenium|folic|niacin|riboflavin|thiamine|pyridoxine|cobalamin|biotin|iodine|taurine|carnitine|inositol|choline/, '💊'],
  [/potassium chloride|iodate|\bsalts\b|iodi[sz]ed|\bsodium\b$|\bsel\b/, '🧂'],
  [/carbon dioxide/, '🫧'],
  [/cultures?\b|lactobacill|bifido|bacillus|probiotic|acidophilus|bulgaricus|streptococcus|rennet|enzymes?\b|lactase|protease|xylanase|cellulase|amylase|lipase/, '🧫'],
  [/flavou?r|essence|aroma/, '👃'],
  // 2. Animal foods
  [/\b(eggs?|egg (white|yolk|powder)|albumen)\b/, '🥚'],
  [/\b(fish|prawns?|shrimps?|tuna|salmon|sardines?|anchov\w*|seafood|crab)\b/, '🐟'],
  [/\b(chicken|mutton|meat|beef|pork|lamb|bacon|ham|sausages?|gelatine?|lard)\b/, '🍗'],
  // Chocolate before dairy: "Milk Chocolate" is chocolate.
  [/\bcocoa\b|chocolate|cacao|\bchoco\b/, '🍫'],
  [/\bcheese\b/, '🧀'],
  [/\b(ghee|butter)\b/, '🧈'],
  [/\b(milk|buttermilk|whey|casein\w*|cream|paneer|curd|dahi|yogh?urt|lactose|khoa|khoya|dairy)\b/, '🥛'],
  // 3. Compound foods
  [/\boils?\b|olein|shortening|vanaspati|\bfat\b|\bfats\b/, '🫗'],
  [/\b(gram|besan|chana|chickpeas?|dal|daal|lentils?|moong|mung|urad|masoor|toor|arhar|rajma|kidney beans?|beans?|peas|soy\w*|tofu)\b/, '🫘'],
  [/\b(peanuts?|groundnuts?|almonds?|cashews?|walnuts?|pistachios?|pista|hazelnuts?|nuts?|makhana)\b/, '🥜'],
  [/coconut|copra|\bcoco\b/, '🥥'],
  [/tree ?nuts/, '🥜'],
  [/\bprotein\b/, '🫘'], // "Hydrolysed Vegetable Protein"; whey/egg/chicken protein matched above
  // 4. Single foods
  [/\bwater\b/, '💧'],
  [/\bsalt\b|sodium chloride|\bnamak\b/, '🧂'],
  [/\bhoney\b/, '🍯'],
  [/sugar|jaggery|\bgur\b|syrup|dextrose|glucose|fructose|sucrose|maltose|molasses|candied/, '🍬'],
  [/\b(corn|maize)\b|cornflour|cornstarch|cornflakes/, '🌽'], // before grains: "Corn Flakes" is corn
  [/\b(wheat|flour|maida|atta|semolina|sooji|suji|rava|oats?|barley|malt|millets?|ragi|jowar|bajra|sorghum|foxtail|barnyard|kodo|amaranth|quinoa|bran|gluten|cereal|grains?|flakes)\b|oligosacchar|\bfos\b|inulin/, '🌾'],
  [/noodles?|pasta|vermicelli|macaroni/, '🍜'],
  [/custard/, '🍮'],
  [/tutti ?frutti/, '🍒'],
  [/\b(rice|poha)\b/, '🍚'],
  [/\bstarch\b|maltodextrin|tapioca|sago|arrowroot/, '🌾'],
  [/potato/, '🥔'],
  [/onion/, '🧅'],
  [/garlic/, '🧄'],
  [/tomato/, '🍅'],
  [/ginger|\bsaunth\b|sonth/, '🫚'],
  [/chill?i|chilly|paprika|cayenne|jalapeno|mirch/, '🌶️'],
  [/capsicum|bell pepper/, '🫑'],
  [/carrot/, '🥕'],
  [/cucumber|gherkin/, '🥒'],
  [/mushroom/, '🍄'],
  [/broccoli|cabbage|cauliflower/, '🥦'],
  [/\bolives?\b/, '🫒'],
  [/lemon|\blime\b|citric|citrus/, '🍋'],
  [/orange/, '🍊'],
  [/mango|aam/, '🥭'],
  [/banana/, '🍌'],
  [/\bapples?\b/, '🍎'],
  [/strawberr/, '🍓'],
  [/grape|raisin|kishmish/, '🍇'],
  [/pineapple/, '🍍'],
  [/cherr/, '🍒'],
  [/peach|apricot|\bplums?\b|\bpears?\b/, '🍑'],
  [/melon/, '🍉'],
  [/berr/, '🫐'],
  [/\bfruits?\b|\bjam\b|marmalade|papaya|guava|pomegranate|anar|kiwi|litchi|lychee|jamun|amla/, '🍓'],
  [/\bdates?\b|khajur|\bfigs?\b|anjeer/, '🌴'],
  [/\bseeds?\b|sesame|\btil\b|flax|chia|sunflower|pumpkin seed/, '🌻'],
  [/coffee|chicory/, '☕'],
  [/\btea\b|matcha/, '🍵'],
  [/yeast|bread|biscuit|dough|crumbs?/, '🍞'],
  [/vinegar/, '🍶'],
  [/spinach|methi|fenugreek|coriander|dhania|mint|pudina|basil|tulsi|curry leaves|herbs?|leaves|leaf|parsley|oregano|thyme|rosemary/, '🌿'],
  [/pepper|turmeric|haldi|cumin|jeera|cardamom|elaichi|clove|cinnamon|nutmeg|mace|ajwain|carom|fennel|saunf|mustard|asafoetida|hing|spices?|masala|garam/, '🌶️'],
];

const CATEGORY_ICONS = {
  natural: '🌿',
  protein: '🫘', // most protein on Indian labels is veg -- meat only by name, above
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
  emulsifier: '🥣',
  color: '🎨',
  colorant: '🎨',
  'raising agent': '🫧',
  stabilizer: '🫙',
  thickener: '🫙',
  'anticaking agent': '🫙',
  'glazing agent': '✨',
  vitamin: '💊',
};

export function categoryIcon(category, name = '') {
  const n = String(name || '').toLowerCase();
  if (n) {
    const hit = NAME_ICONS.find(([re]) => re.test(n));
    if (hit) return hit[1];
  }
  return CATEGORY_ICONS[(category || '').toLowerCase()] || '🔹';
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
