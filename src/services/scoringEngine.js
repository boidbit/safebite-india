// src/services/scoringEngine.js
//
// Turns a resolved ingredient list into a full product report — score,
// verdict, flags, positives, recommendation, summary — using plain rules,
// not AI. This is what lets the ingredient library actually replace the
// per-product AI call once ingredients are known: no ingredients library
// service is any good if you still need an AI call to score the product.

const VERDICT_TIERS = [
  // Kept identical to SCORE_TIERS in utils/storage.js -- see the note
  // there on why the top tier rates the ingredients ("Excellent")
  // rather than making a health claim about the food.
  { min: 85, label: 'Excellent' },
  { min: 65, label: 'Good' },
  { min: 45, label: 'Moderate' },
  { min: 25, label: 'Poor' },
  { min: 0, label: 'Very Poor' },
];

export function verdictFor(score) {
  return VERDICT_TIERS.find((t) => score >= t.min).label;
}

// A single harmful/banned ingredient must dominate the verdict — a pile
// of safe ingredients should never be able to dilute it into looking
// "moderate". Same idea, softer, for "concerning": it should never read
// as "Very Healthy" just because nothing else pulled the average down.
const HARMFUL_SCORE_CAP = 24;   // forces the "Very Poor" tier
const HARMFUL_SCORE_FLOOR = 5;  // worst case within that forced tier
const CONCERNING_SCORE_CAP = 64; // forces at most "Moderate"
const CONCERNING_SCORE_FLOOR = 48; // worst case within that forced tier
const SWEETENER_SCORE_CAP = 84;   // top of "Good": a flagged sweetener keeps a product out of "Excellent"
const SWEETENER_SCORE_FLOOR = 78; // worst case within that squeeze

// A plain `Math.min(score, cap)` flattens every product that crosses the
// cap onto the exact same number, no matter how different their real
// ingredient profiles are -- found in production doing exactly that:
// 167 of 338 seeded products all showing 64/100, because "has a trace of
// a concerning ingredient" is common but the resulting score always
// landed on the same fixed point instead of varying with how clean the
// rest of the product actually is. Squeezes whatever WOULD have scored
// above the cap down into [floor, cap] instead, preserving relative
// order: a product that's clean apart from one trace concerning
// ingredient still lands near the top of its forced tier, while one with
// real penalty piling up elsewhere (that also happens to cross the cap)
// lands lower within it, instead of both looking identical.
function squeezeToCap(score, cap, floor) {
  if (score <= cap) return score;
  const t = (score - cap) / (100 - cap);
  return Math.round(floor + t * (cap - floor));
}

// Categories that are, by regulatory nature, almost always dosed in
// fractions of a percent -- nobody prints "0.01% TBHQ" on a pack, but
// preservatives/antioxidants/flavourings/colors/emulsifiers are reliably
// trace amounts in real products. Bulk-by-nature categories (oil, sugar,
// flour, protein) are left at full weight since they're often genuinely
// significant even when the label doesn't state a number.
const TRACE_CATEGORIES = new Set([
  'preservative', 'antioxidant', 'flavour', 'flavor', 'color', 'colorant',
  'emulsifier', 'acidity regulator', 'raising agent', 'stabilizer',
]);

// When a label states an ingredient's percentage (or Open Food Facts'
// algorithmic percent_estimate filled one in), weight its penalty by how
// dominant it actually is in the product — a 68%-of-product ingredient
// should matter far more than a trace one carrying the same per-unit
// penalty. With no percentage at all, trace-by-nature categories default
// to the low end of that range instead of being treated as if they were
// as significant as an unlabeled bulk ingredient.
function quantityWeight(ingredient) {
  // A real percentage (stated on the label, or from Open Food Facts)
  // always wins. Failing that, use the position-based estimate from
  // quantityEstimator -- which is what stops a trailing spice in a
  // 39-ingredient list being charged like the frying oil.
  const percentage = typeof ingredient.percentage === 'number'
    ? ingredient.percentage
    : ingredient.estimatedPercentage;

  if (typeof percentage === 'number') {
    return 0.5 + (percentage / 100) * 0.5; // ranges 0.5x (trace) to 1.0x (100%)
  }
  return TRACE_CATEGORIES.has((ingredient.category || '').toLowerCase()) ? 0.5 : 1;
}

function totalPenaltyOf(ingredients) {
  return ingredients.reduce((sum, ing) => sum + (ing.penalty || 0) * quantityWeight(ing), 0);
}

// Zero-calorie / artificial sweeteners stay flagged "concerning" (the
// research on them is still debated) but are exempt from the Moderate cap:
// a whey protein whose only flag is a sliver of sucralose was being held at
// 64 no matter how clean the rest was. Their own penalty still counts.
// Matched by name / INS code on purpose, not by category: plain sugar is
// also category "sweetener" and must keep the cap.
const ARTIFICIAL_SWEETENER_NAME = /sucralose|aspartame|acesulfame|saccharin|neotame|advantame|cyclamate|steviol|stevia/i;
const ARTIFICIAL_SWEETENER_INS = new Set(['950', '951', '952', '954', '955', '961', '969', '960']);

export function isArtificialSweetener(ingredient) {
  if (ARTIFICIAL_SWEETENER_NAME.test(ingredient.name || '')) return true;
  const ins = String(ingredient.insCode || '').replace(/\D/g, '');
  return ins !== '' && ARTIFICIAL_SWEETENER_INS.has(ins);
}

function computeScore(ingredients) {
  if (ingredients.length === 0) return 100;

  let score = Math.max(0, Math.min(100, Math.round(100 - totalPenaltyOf(ingredients))));

  if (ingredients.some((i) => i.status === 'harmful')) {
    score = squeezeToCap(score, HARMFUL_SCORE_CAP, HARMFUL_SCORE_FLOOR);
  } else if (ingredients.some((i) => i.status === 'concerning' && !isArtificialSweetener(i))) {
    score = squeezeToCap(score, CONCERNING_SCORE_CAP, CONCERNING_SCORE_FLOOR);
  } else if (ingredients.some((i) => i.status === 'concerning')) {
    // Only flagged sweeteners are left: not held to Moderate, but a sweetened
    // product still shouldn't read as "Excellent" (a zero-sugar soda with no
    // other penalty would otherwise land in the high 80s).
    score = squeezeToCap(score, SWEETENER_SCORE_CAP, SWEETENER_SCORE_FLOOR);
  }

  return score;
}

// A product can have a perfectly "clean" ingredient list -- no banned
// substances, nothing artificial, nothing to flag -- and still be
// something WHO's own daily limits say isn't a good idea to eat
// regularly. Potato, oil and salt are each "safe" ingredients on their
// own, but a real, measured 75%-of-a-day's-saturated-fat serving is a
// genuine reason a bag of chips shouldn't read as "Very Healthy" --
// found in production doing exactly that (a 92/100 potato chips product
// whose own "Quick health check" section already showed 75% of the
// daily saturated fat limit, with nothing in the score reflecting it).
//
// Deliberately reuses the exact same squeeze mechanism as the harmful/
// concerning ingredient caps above, at the same severity (capped at
// "Moderate" at most) -- this is a second, independent way to earn that
// cap, not a new scoring dimension with its own tuning. Triggered by
// dailyHabitCheck.js's own "worth mentioning" bar (>=30% of a WHO daily
// limit) rather than a new threshold invented here: if a number is
// already good enough to show the user in the Quick Health Check
// section, it's also good enough to keep the score honest about it.
// Never called for condiments/seasonings (see analyzeText.js) -- a
// masala eaten a pinch at a time genuinely isn't held to a "100g
// serving" standard, the same reasoning that already excludes those
// from the Quick Health Check section entirely.
export function applyRealNutrientCap(report, dailyHabitCheck) {
  if (!dailyHabitCheck) return report;
  report.overallScore = squeezeToCap(report.overallScore, CONCERNING_SCORE_CAP, CONCERNING_SCORE_FLOOR);
  report.verdict = verdictFor(report.overallScore);
  return report;
}

// The fallback recommendations, used when the AI-written per-product one
// (see generateProductInsights) isn't available. Exported as a set so a
// bulk re-score can tell "this row still has the generic line, safe to
// refresh" apart from "this row has real AI text, leave it alone".
const RULE_BASED_RECOMMENDATIONS = [
  'This is a healthy choice — enjoy without concern.',
  'A reasonably good choice, with only minor concerns to be aware of.',
  'Fine occasionally, but not something to eat every day.',
  'Better treated as an occasional indulgence than a regular choice.',
  'Best avoided or eaten very rarely given its ingredient profile.',
];

export function isRuleBasedRecommendation(text) {
  return RULE_BASED_RECOMMENDATIONS.includes((text || '').trim());
}

function recommendationFor(score) {
  if (score >= 85) return RULE_BASED_RECOMMENDATIONS[0];
  if (score >= 65) return RULE_BASED_RECOMMENDATIONS[1];
  if (score >= 45) return RULE_BASED_RECOMMENDATIONS[2];
  if (score >= 25) return RULE_BASED_RECOMMENDATIONS[3];
  return RULE_BASED_RECOMMENDATIONS[4];
}

/**
 * Build a full product report from resolved ingredients (the output of
 * ingredientLibrary.resolveIngredients). No AI call.
 */
export function buildReport(ingredients, { productName, brand, imageUrl, packSize } = {}) {
  const score = computeScore(ingredients);
  const verdict = verdictFor(score);

  const harmful = ingredients.filter((i) => i.status === 'harmful');
  const concerning = ingredients.filter((i) => i.status === 'concerning');
  const safe = ingredients.filter((i) => i.status === 'safe');

  const flags = [...harmful, ...concerning]
    .sort((a, b) => (b.penalty || 0) - (a.penalty || 0))
    .slice(0, 6)
    .map((i) => i.name);

  // True whenever at least one ingredient that actually affects the
  // score has no real percentage behind it (neither stated on the label
  // nor filled in from Open Food Facts) -- its weight came from the
  // category-based default above, not this specific product's real
  // composition. Shown to the user as a transparency note.
  const hasEstimatedQuantities = ingredients.some(
    (i) => typeof i.percentage !== 'number' && (i.penalty || 0) > 0
  );

  const positives = [];
  if (ingredients.length > 0 && harmful.length === 0) positives.push('No FSSAI-banned ingredients');
  if (ingredients.some((i) => i.category)) {
    if (!ingredients.some((i) => i.category === 'color' && i.status !== 'safe')) {
      positives.push('No concerning artificial colors');
    }
    if (!ingredients.some((i) => i.category === 'sweetener' && i.status !== 'safe')) {
      positives.push('No artificial sweeteners');
    }
  }
  if (ingredients.length > 0 && safe.length === ingredients.length) {
    positives.push('All ingredients are considered safe');
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  return {
    productName: productName || 'Unknown Product',
    brand: brand || null,
    imageUrl: imageUrl || null,
    packSize: packSize || null,
    overallScore: score,
    verdict,
    summary: buildSummary({ verdict, harmful, concerning, ingredients, plural }),
    ingredients,
    flags,
    positives,
    recommendation: recommendationFor(score),
    hasEstimatedQuantities,
  };
}

// Opening line by verdict tier, used only when there's something worth
// naming -- kept separate from `recommendation` below (the UI shows both:
// this is the hook, that's the "what should I do" advice).
const CONCERN_OPENERS = {
  Excellent: 'About as clean as packaged food gets, but not quite —',
  Good: 'A solid pick overall —',
  Moderate: 'Not the healthiest option on the shelf, but not the worst either —',
  Poor: 'This one leans heavily processed —',
  'Very Poor': 'This one leans heavily processed —',
};

function buildSummary({ verdict, harmful, concerning, ingredients, plural }) {
  if (ingredients.length === 0) return 'No ingredients were found to analyze.';

  if (harmful.length > 0) {
    const names = harmful.slice(0, 3).map((i) => i.name);
    const verb = names.length === 1 ? 'is' : 'are';
    return `This one's a real red flag — ${names.join(', ')} ${verb} flagged as harmful, not just "something to watch."`;
  }

  if (concerning.length > 0) {
    const names = concerning.slice(0, 3).map((i) => i.name);
    const verb = names.length === 1 ? 'is' : 'are';
    const opener = CONCERN_OPENERS[verdict] || 'Worth a closer look —';
    return `${opener} ${names.join(', ')} ${verb} doing a lot of the work here instead of real ingredients.`;
  }

  return `Clean ingredient list — all ${plural(ingredients.length, 'ingredient')} check out, nothing artificial or concerning standing out.`;
}
