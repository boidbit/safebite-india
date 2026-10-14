// src/data/priorityBrands.js
//
// The brands to complete first -- India's everyday packaged-food brands, in
// rough order of how much people buy and scan. A brand is picked out of a
// Blinkit product URL by its slug ("amul-butter-…" -> Amul), so `prefixes`
// are how that brand's products start in a URL: lower case, apostrophes gone,
// words joined by "-" ("Lay's" -> "lays", "Parle-G" -> "parle-g").
// Edit freely: add a brand, add a prefix, or move a brand's `tier` (1 = first).
// scripts/plan-brand-coverage.js reports, per brand, how many of its Blinkit
// products we have and how many are still missing.

export const PRIORITY_BRANDS = [
  // Tier 1 -- the biggest, in nearly every home
  { name: 'Amul', prefixes: ['amul'], group: 'Dairy', tier: 1 },
  { name: 'Britannia', prefixes: ['britannia'], group: 'Biscuits & bakery', tier: 1 },
  { name: 'Parle', prefixes: ['parle', 'hide-seek', 'krackjack', 'monaco', 'kismi', 'melody'], group: 'Biscuits & bakery', tier: 1 },
  { name: 'Nestle', prefixes: ['nestle', 'maggi', 'kitkat', 'munch', 'milkybar', 'nescafe', 'milkmaid', 'cerelac', 'everyday'], group: 'Mixed', tier: 1 },
  { name: 'Haldiram\'s', prefixes: ['haldirams', 'haldiram'], group: 'Snacks', tier: 1 },
  { name: 'Cadbury', prefixes: ['cadbury', 'oreo', 'bournvita', 'dairy-milk', '5-star', 'gems', 'perk', 'fuse', 'celebrations'], group: 'Chocolates', tier: 1 },
  { name: 'Sunfeast (ITC)', prefixes: ['sunfeast', 'yippee', 'bingo', 'dark-fantasy', 'farmlite', 'mom-s-magic'], group: 'Biscuits & snacks', tier: 1 },
  { name: 'Lay\'s / PepsiCo', prefixes: ['lays', 'kurkure', 'doritos', 'uncle-chipps', 'cheetos', 'quaker', 'tropicana', 'pepsi', 'mountain-dew', 'sting', '7up', 'mirinda', 'gatorade'], group: 'Snacks & drinks', tier: 1 },
  { name: 'Coca-Cola', prefixes: ['coca-cola', 'coke', 'sprite', 'thums-up', 'fanta', 'limca', 'maaza', 'minute-maid', 'kinley', 'schweppes', 'monster'], group: 'Drinks', tier: 1 },
  { name: 'Tata', prefixes: ['tata'], group: 'Staples & tea', tier: 1 },
  { name: 'Aashirvaad (ITC)', prefixes: ['aashirvaad', 'ashirvaad'], group: 'Staples', tier: 1 },
  { name: 'Mother Dairy', prefixes: ['mother-dairy'], group: 'Dairy', tier: 1 },
  { name: 'Kissan / HUL', prefixes: ['kissan', 'knorr', 'bru', 'horlicks', 'boost', 'brooke-bond', 'lipton', 'kwality-walls', 'lakme', 'pureit'], group: 'Mixed', tier: 1 },
  { name: 'Dabur / Real', prefixes: ['dabur', 'real', 'hajmola', 'chyawanprash'], group: 'Mixed', tier: 1 },
  { name: 'Fortune / Adani', prefixes: ['fortune', 'kohinoor'], group: 'Oil & staples', tier: 1 },

  // Tier 2 -- very common
  { name: 'Bikaji', prefixes: ['bikaji'], group: 'Snacks', tier: 2 },
  { name: 'Bikano', prefixes: ['bikano'], group: 'Snacks', tier: 2 },
  { name: 'Balaji', prefixes: ['balaji'], group: 'Snacks', tier: 2 },
  { name: 'Kellogg\'s', prefixes: ['kelloggs', 'chocos'], group: 'Cereal', tier: 2 },
  { name: 'MTR', prefixes: ['mtr'], group: 'Ready food & spices', tier: 2 },
  { name: 'Everest', prefixes: ['everest'], group: 'Spices', tier: 2 },
  { name: 'MDH', prefixes: ['mdh'], group: 'Spices', tier: 2 },
  { name: 'Catch', prefixes: ['catch'], group: 'Spices', tier: 2 },
  { name: 'Saffola / Marico', prefixes: ['saffola', 'parachute'], group: 'Oil & oats', tier: 2 },
  { name: 'Patanjali', prefixes: ['patanjali'], group: 'Mixed', tier: 2 },
  { name: 'Epigamia', prefixes: ['epigamia'], group: 'Dairy', tier: 2 },
  { name: 'Milky Mist', prefixes: ['milky-mist'], group: 'Dairy', tier: 2 },
  { name: 'Nandini', prefixes: ['nandini'], group: 'Dairy', tier: 2 },
  { name: 'Yakult', prefixes: ['yakult'], group: 'Dairy', tier: 2 },
  { name: 'Veeba', prefixes: ['veeba'], group: 'Sauces', tier: 2 },
  { name: 'Ching\'s', prefixes: ['chings', 'ching-s'], group: 'Sauces & noodles', tier: 2 },
  { name: 'Paper Boat', prefixes: ['paper-boat'], group: 'Drinks', tier: 2 },
  { name: 'Frooti / Appy (Parle Agro)', prefixes: ['frooti', 'appy', 'bailley'], group: 'Drinks', tier: 2 },
  { name: 'B Natural', prefixes: ['b-natural'], group: 'Drinks', tier: 2 },
  { name: 'Bisleri', prefixes: ['bisleri'], group: 'Drinks', tier: 2 },
  { name: 'Red Bull', prefixes: ['red-bull'], group: 'Drinks', tier: 2 },
  { name: 'Daawat / India Gate', prefixes: ['daawat', 'india-gate'], group: 'Rice', tier: 2 },
  { name: 'Quaker', prefixes: ['quaker'], group: 'Cereal', tier: 2 },
  { name: 'Wai Wai / Top Ramen', prefixes: ['wai-wai', 'top-ramen', 'nissin'], group: 'Noodles', tier: 2 },
  { name: 'Unibic', prefixes: ['unibic'], group: 'Biscuits & bakery', tier: 2 },
  { name: 'Cremica', prefixes: ['cremica'], group: 'Biscuits & bakery', tier: 2 },
  { name: 'Priyagold', prefixes: ['priyagold'], group: 'Biscuits & bakery', tier: 2 },
  { name: 'Modern / English Oven / Harvest Gold', prefixes: ['modern', 'english-oven', 'harvest-gold', 'bonn'], group: 'Bread', tier: 2 },
  { name: 'Ferrero / Mars / Hershey\'s', prefixes: ['ferrero', 'snickers', 'mars', 'hersheys', 'toblerone', 'lindt'], group: 'Chocolates', tier: 2 },
  { name: 'McCain', prefixes: ['mccain'], group: 'Frozen', tier: 2 },
  { name: 'Wagh Bakri / Taj Mahal / Tetley', prefixes: ['wagh-bakri', 'taj-mahal', 'tetley', 'society-tea', 'red-label'], group: 'Tea', tier: 2 },
  { name: 'Complan / Pediasure / Ensure / Protinex', prefixes: ['complan', 'pediasure', 'ensure', 'protinex'], group: 'Health drinks', tier: 2 },

  // Health, protein and spreads -- popular with the people who read labels
  { name: 'MyFitness', prefixes: ['myfitness', 'my-fitness'], group: 'Spreads & protein', tier: 2 },
  { name: 'Pintola', prefixes: ['pintola'], group: 'Spreads & protein', tier: 2 },
  { name: 'Alpino', prefixes: ['alpino'], group: 'Spreads & protein', tier: 2 },
  { name: 'Sundrop', prefixes: ['sundrop'], group: 'Spreads & oil', tier: 2 },
  { name: 'The Whole Truth', prefixes: ['the-whole-truth', 'whole-truth'], group: 'Healthy snacks', tier: 2 },
  { name: 'Yoga Bar', prefixes: ['yoga-bar', 'yogabar'], group: 'Healthy snacks', tier: 2 },
  { name: 'RiteBite', prefixes: ['ritebite', 'rite-bite'], group: 'Healthy snacks', tier: 2 },
  { name: 'MuscleBlaze / HealthKart', prefixes: ['muscleblaze', 'healthkart', 'hk-vitals'], group: 'Protein', tier: 2 },
  { name: 'Open Secret', prefixes: ['open-secret'], group: 'Healthy snacks', tier: 2 },
  { name: 'True Elements', prefixes: ['true-elements'], group: 'Healthy snacks', tier: 2 },
  { name: 'Happilo / Farmley / Nutraj', prefixes: ['happilo', 'farmley', 'nutraj'], group: 'Dry fruits & nuts', tier: 2 },
  { name: 'Phab / Kapiva / Slurrp Farm', prefixes: ['phab', 'kapiva', 'slurrp-farm'], group: 'Healthy foods', tier: 3 },
  { name: 'Wingreens / Sleepy Owl / Blue Tokai', prefixes: ['wingreens', 'sleepy-owl', 'blue-tokai'], group: 'Spreads & coffee', tier: 3 },
  { name: 'Peanut butter brands', prefixes: ['dr-peanut', 'the-butternut', 'butternut', 'peanut', 'naked-nature', 'nutty-gritties', 'nuttyyum', 'organic-tattva'], group: 'Spreads', tier: 3 },

  // Tier 3 -- common, smaller
  { name: 'Too Yumm / Act II / Cornitos / Pringles', prefixes: ['too-yumm', 'act-ii', 'cornitos', 'pringles', 'yellow-diamond'], group: 'Snacks', tier: 3 },
  { name: 'Funfoods / Dr. Oetker / Heinz / Tops', prefixes: ['funfoods', 'fun-foods', 'dr-oetker', 'heinz', 'tops'], group: 'Sauces', tier: 3 },
  { name: 'Mother\'s Recipe / Priya / Gits / Rasna', prefixes: ['mothers-recipe', 'priya', 'gits', 'rasna'], group: 'Ready food & pickles', tier: 3 },
  { name: 'Eastern / Badshah / Sakthi', prefixes: ['eastern', 'badshah', 'sakthi'], group: 'Spices', tier: 3 },
  { name: 'Organic India / 24 Mantra / Pillsbury', prefixes: ['organic-india', '24-mantra', 'pillsbury'], group: 'Staples', tier: 3 },
  { name: 'Dhara / Gemini / Sundrop', prefixes: ['dhara', 'gemini', 'sundrop'], group: 'Oil', tier: 3 },
  { name: 'Yoga Bar / Soulfull / Bagrry\'s', prefixes: ['yoga-bar', 'soulfull', 'bagrrys'], group: 'Healthy snacks', tier: 3 },
  { name: 'Kwality Wall\'s / Havmor / Baskin', prefixes: ['kwality-walls', 'havmor', 'baskin-robbins', 'vadilal'], group: 'Ice cream', tier: 3 },
  { name: 'Venky\'s / ITC Master Chef / Godrej', prefixes: ['venkys', 'itc-master-chef', 'godrej', 'yummiez'], group: 'Frozen & meat', tier: 3 },
  { name: 'Verka / Aavin / Heritage', prefixes: ['verka', 'aavin', 'heritage'], group: 'Dairy', tier: 3 },
];

/** The brand a Blinkit product slug belongs to, or null. */
export function brandOfSlug(slug) {
  const s = String(slug || '').toLowerCase();
  for (const b of PRIORITY_BRANDS) {
    if (b.prefixes.some((p) => s === p || s.startsWith(`${p}-`))) return b;
  }
  return null;
}
