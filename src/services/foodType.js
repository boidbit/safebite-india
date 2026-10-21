// src/services/foodType.js
//
// What KIND of food a product is -- the missing piece behind reports like
// "Bingo Ribbon Pakoda 89/100": a deep-fried namkeen with a short,
// "clean" ingredient list scored as if it were a plain staple. Gemini
// names the type in the same insights call that already runs per product
// (see INSIGHTS_PROMPT); this deterministic keyword pass is the fallback
// for when that call is missing/failed AND the way the bulk backfill
// classifies thousands of existing rows for free.

export const FOOD_TYPES = [
  'fried-snack', 'sweet-snack', 'baked-snack', 'beverage', 'dairy', 'staple',
  'oil-fat', 'nuts-seeds', 'condiment', 'supplement', 'infant', 'ready-meal', 'other',
];

// Order matters: the first rule that matches wins, and the exclusions
// (baked/roasted) run before the fried keywords so "Roasted Chana Chivda"
// or "Baked Chips" never get the fried label.
const RULES = [
  { type: 'infant', re: /\b(infant|baby food|cerelac|lactogen|nan pro|nestle nan|nan (excella\w*|optipro)|similac|follow[- ]?up formula)\b/i },
  { type: 'supplement', re: /\b(protein (powder|isolate|blend)|whey|mass gainer|multivitamin|supplement|electrolyte|ors\b|creatine|bcaa|health drink mix|pediasure|ensure|protinex)\b/i },
  { type: 'oil-fat', re: /\b(oil|ghee|butter|vanaspati|margarine)\b(?!\s*(cookies?|biscuits?|chips|popcorn))/i, notRe: /\b(butter (cookies?|biscuits?|chips|scotch|milk|naan|popcorn)|peanut butter|nut butter|almond butter|cashew butter|seed butter|cocoa butter|butter ?milk|body butter)\b/i },
  { type: 'nuts-seeds', re: /\b(almonds?|cashews?|pistachios?|walnuts?|raisins|dates|figs|makhana|chia|flax|pumpkin seeds?|sunflower seeds?|mixed nuts|dry fruits?|peanuts?)\b/i, notRe: /\b(chikki|bar|butter|namkeen|masala peanuts?|coated|chocolate|cookies?|biscuits?|laddu)\b/i },
  // Things whose names contain a snack-ish word but that aren't snacks:
  // a "Bingo Buttermilk" is a drink, a "Chocos Cereal" is a cereal, a
  // "Choco Chips" bag is baking chips, a KitKat "wafer" is a chocolate bar.
  { type: 'beverage', re: /\b(buttermilk|sharbat|lassi|drink|juice|beverage|(mineral|sparkling|drinking|soda|tonic) water|ginger ale|herbal infusion|infusion|tea bags?|green tea|herbal tea|chamomile|cocktail mix|mocktail|horlicks|bourn ?vita|boost|complan|malt drink|smoothies?|glucon-?d|crush|falooda)\b/i },
  // Bottled water -- but not rose/kewra water (cooking) or water chestnut.
  { type: 'beverage', re: /\bwater\b/i, notRe: /\b(rose|kewra|chestnut)\b/i },
  { type: 'staple', re: /\bcereals?\b/i },
  { type: 'condiment', re: /\b(peanut butter|nut butter|almond butter|spread)\b/i },
  { type: 'sweet-snack', re: /\b(choco(late)?s?[- ]?(chips|coated|flavou?red)|choco chips|kitkat|loacker|waffy|wafer (roll|bar|cube|pops)|coated wafer|(vanilla|orange|strawberry|chocolate|choco\w*) wafers?|protein bar|cookies?|biscuits?|aam-?papad|candies|chocolates?)\b/i, notRe: /\b(namkeen|potato|banana|nachos)\b/i },
  // Chocolate bars and Indian sweets whose names don't say "chocolate" or
  // "sweet" ("Cadbury Dairy Milk", "Dharwad Peda") -- but Mother Dairy milk isn't one.
  { type: 'sweet-snack', re: /\b(dairy milk|5 star|perk|munch|gems|eclairs|bournville|snickers|mars bar|bounty|twix|ferrero|rocher|toblerone|kinder|milky ?bar|bar one|galaxy|cadbury|good ?day|choc|praline|snack bar|energy bar|nutrition bar|granola bar|lollipops?|peda|gulkand|murabba|petha|soan papdi|mysore pak|kaju katli|gajak|rewari|marshmallows?|gumm(y|ies)|jelly|ice cream|kulfi|frozen dessert)\b/i, notRe: /\b(mother dairy|milk powder|biscuits?)\b/i },
  // Papad/appalam are usually roasted, not fried in the pack sense.
  { type: 'baked-snack', re: /\b(papad|appalam|khichya)\b/i },
  // Branded plain fried moong dal (a namkeen) vs the raw pulse.
  { type: 'fried-snack', re: /\b(haldiram'?s?|prabhuji|bikaji|bikano)\b.*\bmoong dal\b/i, notRe: /\b(chilka|dhuli|washed|split|organic|unpolished|khichdi)\b/i },
  { type: 'baked-snack', re: /\b(baked|roasted|khakhra|air[- ]popped|popcorn|multigrain crackers|crackers|oats bar|muesli bar)\b/i, notRe: /\b(coffee|tea|sooji|rava|semolina|vermicelli|seviyan|flour|atta|besan|seeds?|chana dal)\b/i },
  { type: 'fried-snack', re: /\b(namkeen|bhujia|sev|chivda|chiwda|mixture|murukku|chakli|papdi|pakoda|pakora|farsan|kachori|samosa|fryums?|papad|wafers?|chips|crisps|nachos|puffs?|kurkure|lays|bingo|banana chips|tapioca chips|potato sticks|rings|shakarpara|namak para|mathri|diet chivda|aloo bhujia|salted peanuts?|masala peanuts?|fries|nuggets)\b/i },
  { type: 'sweet-snack', re: /\b(biscuits?|cookies?|cake|cakes|pastry|brownie|muffin|cupcake|wafer (bar|cream|cube)|chocolates?|candy|candies|toffee|mithai|barfi|laddu|halwa|rasgulla|gulab jamun|jalebi|pheni|chikki|cream roll|rusk|donut|croissant|wafer cube)\b/i },
  { type: 'beverage', re: /\b(juice|drink|soda|cola|lassi|buttermilk|sharbat|squash|syrup|thandai|energy drink|coffee|tea|milkshake|shake|kombucha|coconut water)\b/i },
  { type: 'dairy', re: /\b(milk|curd|dahi|paneer|cheese|yogurt|yoghurt|cream|khoa|mawa|raita|doi|whitener)\b/i },
  // Spices, powders and other things eaten a pinch or a spoonful at a time.
  // Before the generic "masala" rule; meals, snacks, drinks and staples that
  // merely carry a spice word in their name are kept out.
  { type: 'condiment', re: /\b(turmeric|haldi|chilli|chili|coriander|dhania|jeera|cumin|hing|asafoetida|pepper|garam|rasam|sambar|amchur|cardamom|elaichi|cinnamon|clove|nutmeg|ajwain|methi|kasuri|fennel|saunf|mustard|oregano|thyme|basil|parsley|rosemary|paprika|chaat|kitchen king|powder|essence|food colou?r|baking (powder|soda)|yeast|gelatin|cocoa|custard|mouth freshener|mukhwas|dip|dressing|hummus|salsa|stock cubes?|bouillon|seasoning cubes?)\b/i, notRe: /\b(noodles?|pasta|bread|biscuits?|cookies?|chips|crisps|nachos|tea|chai|coffee|drink|juice|protein|soup|paneer|chicken|cake|chocolates?|bar|candy|wafers?|batter|rice|oats?|atta|flour|bhujia|namkeen|sev|peanuts?)\b/i },
  // Seeds to eat and dried fruit (spice seeds are caught just above).
  { type: 'nuts-seeds', re: /\b(seeds?|freeze[- ]dried|kismis|kishmish|dried (fruits?|mango|jackfruit|apple|berr\w+|cranberr\w+|kiwi|pineapple|strawberr\w+|blueberr\w+)|trail mix|berries)\b/i, notRe: /\b(chips|bar|cookies?|biscuits?)\b/i },
  // "Masala" (and "spice") is the trap here: "Maggi Masala Noodles" and
  // "Saffola Masala Oats" are FULL MEALS seasoned with masala, not masala
  // itself -- a real bug this caught live: classifying them as 'condiment'
  // wrongly suppressed their (legitimate, useful) high-sodium daily-habit
  // warning, the opposite of what foodType is for. Same protection
  // dailyHabitCheck.js's own ORDINARY_PORTION_RE already has for exactly
  // this reason -- an ordinary meal/staple word alongside "masala" wins.
  { type: 'condiment', re: /\b(masala|sauce|ketchup|pickle|achar|chutney|mayonnaise|spread|seasoning|jam|preserve|marmalade|vinegar|paste|spice)\b/i, notRe: /\b(noodles?|pasta|vermicelli|oats?|rice|dal|cereals?|muesli|granola|bread|chips|crisps|biscuits?|cookies?|soup|paratha|roti|idli|dosa|upma|poha)\b/i },
  { type: 'ready-meal', re: /\b(noodles?|pasta|soup|ready to eat|instant|frozen|pizza|burger|meal|biryani|biriyani|pulao|khichdi|curry|keema|chicken|mutton|fish|prawns?|sausages?|salami|momos|spring rolls?|dumplings?)\b/i },
  { type: 'staple', re: /\b(atta|maida|flour|rice|dal|lentil|pulses?|oats|cornflakes|muesli|bread|besan|sooji|rava|poha|semolina|wheat|millet|ragi|quinoa|sugar|salt|jaggery|chana|rajma|urad|moong|masoor|toor|arhar|lobia|chole|kabuli|soya|tofu|batter|honey|corn flakes|flakes|granola|vermicelli|seviyan|sevai|pav|buns?|paratha|parota|roti|naan|kulcha|chapati|jowar|bajra|idli|dosa|upma|dhokla|khaman|chocos|special k|sourdough)\b/i },
];

// Frying oils in an ingredient list are strong evidence that a snack was
// fried rather than baked -- checked only for snack-ish types.
const FRYING_OIL_RE = /\b(palmolein|palm oil|refined (palmolein|vegetable|sunflower|soybean|cottonseed|rice bran|groundnut) oil|edible vegetable oil|vegetable oil)\b/i;

/**
 * @param {{productName?: string, ingredientNames?: string[]}} input
 * @returns {{foodType: string, isDeepFried: boolean}}
 */
export function classifyFoodType({ productName, ingredientNames = [] } = {}) {
  // "No Palm Oil" is a claim about a snack, not a product that IS oil.
  const name = String(productName || '').replace(/\b(no|without|free of|zero|low)\s+(palm\s+)?(oil|fat)\b/gi, ' ');
  let foodType = 'other';
  for (const rule of RULES) {
    if (rule.re.test(name) && !(rule.notRe && rule.notRe.test(name))) { foodType = rule.type; break; }
  }
  const hasFryingOil = FRYING_OIL_RE.test((ingredientNames || []).join(', '));
  // A snack whose name says nothing useful ("Crunchy Bites") but whose
  // ingredients are mostly flour/potato + frying oil is still a fried snack.
  const isDeepFried = foodType === 'fried-snack' || (foodType === 'other' && hasFryingOil && /\b(bites?|sticks?|crunch|crispy|munch|snack)\b/i.test(name));
  if (foodType === 'other' && isDeepFried) foodType = 'fried-snack';
  return { foodType, isDeepFried };
}

export function normalizeFoodType(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return FOOD_TYPES.includes(v) ? v : null;
}
