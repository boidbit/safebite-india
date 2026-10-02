// src/services/analyzeText.js
//
// The real analysis pipeline: parse the label -> resolve every ingredient
// against the shared database (researching only what's genuinely new) ->
// score it with plain rules. No whole-product AI call needed once
// ingredients are known.

import { toPer100 } from './nutrientBasis.js';
import { classifyFoodType, normalizeFoodType } from './foodType.js';
import { parseLabel, isBracketBalanced, looksLikeNutritionPanel } from './ingredientParser.js';
import { resolveIngredients } from './ingredientLibrary.js';
import { buildReport } from './scoringEngine.js';
import { generateProductInsights, repairLabelPunctuation } from './geminiService.js';
import { translateReportToHindi } from './translateService.js';
import { finalizeScore } from './finalizeScore.js';
import { applyOffPercentEstimates } from './openFoodFacts.js';
import { estimateQuantities } from './quantityEstimator.js';

/**
 * Analyze raw ingredients text end to end.
 *
 * Returns { report, isIngredientOnly, knownCount, researchedCount }.
 *
 * isIngredientOnly is true when the text parsed down to a single
 * ingredient (e.g. someone searching "INS 102" or "Tartrazine" directly)
 * rather than a real multi-ingredient product — callers should treat this
 * as an ingredient lookup, not a product scan, and skip saving it to the
 * shared product cache (the ingredient itself is already cached in the
 * ingredients table, so caching it again as a "product" is redundant).
 *
 * nutrientsInfo (optional) -- real, already-known nutrition-panel
 * numbers for this exact product ({ nutrients, servingLabel }, see
 * openFoodFacts.js / blinkitProductsRepo.js), used only to power the
 * "if this became a daily habit" projection. Never estimated -- when a
 * caller has no real numbers for a product (e.g. pasted/photographed
 * text with no nutrition panel), it's simply omitted and that section
 * doesn't appear.
 *
 * packSize (optional) -- the human-readable pack size as printed on
 * the pack ("500 g", "2 x 2 kg"), when the caller happens to know it
 * (currently only Blinkit's scraper, see blinkit.js). Purely
 * descriptive -- stored on the report so it's visible when someone's
 * trying to find/verify this exact product's real barcode later,
 * since different pack sizes of the same product have different
 * barcodes.
 */
export async function analyzeText(rawText, productName, brand, offIngredients, imageUrl, nutrientsInfo, packSize) {
  // Only for parsing -- the caller keeps showing the user their real,
  // original scanned/typed text regardless of what happens here.
  let { ingredients: parsed, allergens } = parseLabel(rawText);
  if (!isBracketBalanced(rawText)) {
    // Gemini's repair is only taken when it reads at least as much as the
    // parser's own recovery did -- nothing checks that a repair kept every
    // word, and one that drops some would lose those ingredients for good
    // (saved reports with 3 of a label's 15 ingredients exist).
    const repaired = await repairLabelPunctuation(rawText);
    const fromRepair = repaired ? parseLabel(repaired) : null;
    if (fromRepair && fromRepair.ingredients.length >= parsed.length) ({ ingredients: parsed, allergens } = fromRepair);
  }

  if (parsed.length === 0) {
    throw new Error("Couldn't find any recognizable ingredients in that text. Please check and try again.");
  }

  // Checked here, before resolveIngredients -- a photographed nutrition
  // panel is cheap to spot from the parsed names alone, and catching it
  // now avoids paying Gemini to research "Energy" and "Carbohydrate" as
  // if they were ingredients. See looksLikeNutritionPanel for the real
  // scan this came from and why the "mostly unrecognized" guard below
  // can't catch it.
  if (looksLikeNutritionPanel(parsed)) {
    throw new Error('That looks like the nutrition panel rather than the ingredients list. Please capture the list that starts with "Ingredients".');
  }

  // When we have Open Food Facts' structured per-ingredient breakdown
  // (barcode-sourced only), fill in real percentages it estimated for
  // ingredients the label itself doesn't state one for -- more accurate
  // than the category-based default quantityWeight() falls back to.
  const enrichedParsed = offIngredients?.length
    ? applyOffPercentEstimates(parsed, offIngredients)
    : parsed;

  // Whatever still has no percentage gets one estimated from its position
  // in the list (labels are ordered by descending weight), so scoring
  // stops treating a trailing spice as a full-strength component.
  const withQuantities = estimateQuantities(enrichedParsed);

  const { ingredients, knownCount, researchedCount } = await resolveIngredients(withQuantities);

  if (ingredients.length === 0) {
    throw new Error("Couldn't research these ingredients right now. Please try again.");
  }

  // A single-ingredient search (e.g. someone typing a random word or a
  // typo) isn't a real product -- if Gemini itself couldn't recognize it
  // as a food ingredient at all, don't fabricate a score/verdict for it.
  // A genuinely unfamiliar ingredient *within* a real multi-ingredient
  // product still gets scored -- this only applies when it's the only
  // thing being looked up.
  if (parsed.length === 1 && ingredients[0].recognized === false) {
    throw new Error(`"${ingredients[0].name}" doesn't look like a real food ingredient. Please check the spelling and try again.`);
  }

  // A real product's ingredient list is virtually never MOSTLY things
  // Gemini can't recognize as food at all -- a real but obscure regional
  // ingredient still comes back recognized (see the prompt in
  // geminiService.js), so at least half unrecognized means the source
  // text almost certainly wasn't a real ingredients list to begin with.
  // Found via a real seeded product (Taj Mahal tea) whose "ingredients"
  // were things like "Rusbea Verified Environment" and "Org 00 8
  // 901030 658778" -- a certification blurb and a barcode, scraped from
  // the wrong field -- which each individually resolved as harmless
  // (nothing to penalize), so the product scored a false 100/100.
  // Scoring text like that as if it were a clean product would be
  // actively misleading.
  //
  // Uses >= rather than a strict majority (> 0.5) -- a real scanned
  // product (Fortune brand Refined Sunflower Oil, barcode
  // 8906035030239) had a photographed label with no real ingredients
  // panel at all, just front-of-pack marketing copy ("Freedom to eat,
  // Freedom to enjoy..."). That parsed down to exactly two fragments:
  // one Gemini correctly flagged as a marketing phrase (recognized:
  // false), the other a garbled "E Freedom Refined Sunflower Oil
  // Freedom To Eat" that Gemini charitably matched to real sunflower
  // oil (recognized: true) by pattern-matching the one legitimate
  // phrase buried inside the noise. A strict "> 0.5" let that exact
  // 50/50 split through, scoring the product 95/100 on a fabricated
  // ingredient. With so few total fragments, a tied split is already
  // too unreliable a sample to trust either way.
  const unrecognized = ingredients.filter((i) => i.recognized === false);
  if (parsed.length > 1 && unrecognized.length / ingredients.length >= 0.5) {
    const examples = unrecognized.slice(0, 3).map((i) => `"${i.name}"`).join(', ');
    throw new Error(`This doesn't look like a real ingredients list — a large share of what was found (${examples}) isn't a recognized food ingredient. Please check the text and try again.`);
  }

  const report = buildReport(ingredients, { productName, brand, imageUrl, packSize });
  report.allergens = allergens;

  // Real, already-published nutrition-panel numbers (Open Food Facts or
  // Blinkit -- see their extractNutrientsForHabitCheck), persisted
  // as-is so Personal FoodGuard's priority matching (personalAssessment.js)
  // can reuse them later, not just at the moment of this one analysis.
  // Kept regardless of isCondimentOrSeasoning below -- that only changes
  // whether the "daily habit" FRAMING makes sense for a masala eaten a
  // pinch at a time, not whether the underlying real numbers are valid.
  if (nutrientsInfo?.nutrients) {
    report.realNutrients = nutrientsInfo.nutrients;
    report.realNutrientsServingGrams = nutrientsInfo.servingGrams ?? null;
    // 'g' for every product before this existed (the only unit ever
    // recorded) -- see the "Per Xg serving" -> "Per X{unit} serving"
    // fix in Result.jsx/strings.js.
    report.realNutrientsServingUnit = nutrientsInfo.servingUnit || 'g';
    // The canonical basis (per 100 g/ml) -- everything that compares
    // products or scores density reads THIS, never realNutrients, whose
    // basis depends on the serving size. Producers that know it pass it
    // straight through; the rest are derived by dividing the serving out.
    report.nutrientsPer100 = nutrientsInfo.nutrientsPer100
      ?? toPer100(nutrientsInfo.nutrients, nutrientsInfo.servingGrams);
  }

  // Single-ingredient lookups don't need "product" text at all -- only
  // worth the extra call for a real multi-ingredient product.
  if (parsed.length > 1) {
    const insights = await generateProductInsights({
      productName: report.productName,
      brand,
      score: report.overallScore,
      verdict: report.verdict,
      harmfulNames: ingredients.filter((i) => i.status === 'harmful').map((i) => i.name),
      concerningNames: ingredients.filter((i) => i.status === 'concerning').map((i) => i.name),
      ingredientCount: ingredients.length,
      ingredientNames: ingredients.map((i) => i.name),
    });
    // Each field falls back independently to the rule-based version
    // already on `report` -- a failed call (or a partial response) must
    // never break the report or blank out a section.
    if (insights?.summary) report.summary = insights.summary;
    if (insights?.recommendation) report.recommendation = insights.recommendation;
    if (insights?.isCondimentOrSeasoning) report.isCondimentOrSeasoning = true;
    // Infant formula is a specially regulated category (FSSAI Infant Milk
    // Substitutes Act, Codex Standard for Infant Formula) -- Result.jsx
    // stops showing the normal 0-100 "78/Good" score presentation
    // entirely for these, so it never reads as "this is healthy for a
    // baby" (a real reported case: Furilac Advance Stage 1 showing
    // 78/Good). See Result.jsx's own isInfantFormula branch.
    if (insights?.isInfantFormula) report.isInfantFormula = true;
    if (insights?.usefulContext) report.usefulContext = insights.usefulContext;
    // What kind of food this is -- Gemini's read first (it sees the whole
    // name + ingredient list), the deterministic keyword pass when that's
    // absent or not one of the known types.
    const keywordType = classifyFoodType({ productName: report.productName, ingredientNames: ingredients.map((i) => i.name) });
    report.foodType = normalizeFoodType(insights?.foodType) ?? keywordType.foodType;
    // "Other" from Gemini defers to a confident keyword hit (e.g. "Bhujia").
    if (report.foodType === 'other' && keywordType.foodType !== 'other') report.foodType = keywordType.foodType;
    report.isDeepFried = insights?.isDeepFried === true || (keywordType.isDeepFried && report.foodType === 'fried-snack');
    if (insights?.story) report.story = insights.story;

    // A masala scoring 95 isn't eaten by the spoonful -- the same reason
    // isCondimentOrSeasoning already changes how the score itself reads
    // means a "here's what a daily habit of this looks like" framing
    // would be actively misleading for one. Infant formula skips this for
    // a related but distinct reason: the WHO daily limits it's built on
    // are an ADULT 2000-kcal reference diet -- applying an adult daily
    // habit projection to a baby's feed would be wrong on two counts at
    // once (wrong population, wrong framing), not just one.
    //
    // foodType 'condiment'/'supplement' is the same isCondimentOrSeasoning
    // reasoning as a safety net -- caught a real live bug: an electrolyte
    // hydration mix (a powder reconstituted in water, not eaten by the
    // 100g) showed "891% of your daily sodium limit" because Gemini's
    // insights call never ran/returned for it and isCondimentOrSeasoning
    // was simply never set. The keyword classifier (classifyFoodType,
    // which DOES recognise "electrolyte"/"supplement") gives a second,
    // deterministic chance to catch exactly this case.
    // Serving, Quick Health Check, its nutrient cap, then the fried/
    // energy-dense ceiling -- shared with the admin form's "Recalculate
    // score" so the two can never score the same product differently.
    finalizeScore(report, { nutrientsInfo, packSize });

    // Hindi translation of everything above -- a completely separate
    // service/quota from Gemini, so it's safe to always attempt (falls
    // back to English on any failure, never blocks the report).
    const hi = await translateReportToHindi(report);
    if (hi) report.hi = hi;
  }

  return {
    report,
    isIngredientOnly: parsed.length === 1,
    knownCount,
    researchedCount,
  };
}
