// src/services/finalizeScore.js
//
// Everything that happens to a score AFTER the ingredient math
// (scoringEngine.js's buildReport): decide the real serving, build the
// Quick Health Check, apply its nutrient cap, then the fried/energy-dense
// ceiling. One function, used by both analyzeText.js (a fresh scan) and
// the admin form's "Recalculate score" -- which used to re-run only
// buildReport, so a recalculated fried snack silently lost its density
// ceiling (and any nutrient cap) and jumped back up to its ingredient-
// only score.
//
// Pure and synchronous: no AI, no network. Mutates and returns `report`.
import { toServing } from './nutrientBasis.js';
import { resolveServing } from './servingResolver.js';
import { applyRealNutrientCap } from './scoringEngine.js';
import { applyNutritionDensityCeiling } from './nutritionDensity.js';
import { buildDailyHabitCheck, isSmallPortionFood } from './dailyHabitCheck.js';

/**
 * @param {object} report - already scored by buildReport, with foodType /
 *   isCondimentOrSeasoning / isInfantFormula / isDeepFried set if known.
 * @param {object} [opts]
 * @param {object} [opts.nutrientsInfo] - { nutrients, nutrientsPer100,
 *   servingGrams, servingUnit } as the producers pass it; omitted = no
 *   nutrition data, so only the density ceiling can apply.
 * @param {string} [opts.packSize]
 */
export function finalizeScore(report, { nutrientsInfo, packSize } = {}) {
  // A previous run's results must not leak into this one -- a report
  // being RE-scored still carries them.
  delete report.dailyHabitCheck;
  delete report.overallScoreBeforeDensity;
  delete report.nutritionDensity;
  delete report.scoreNote;

  // Re-decide the serving now that foodType is known -- the producer's
  // servingGrams can be the per-100g basis mislabelled as a serving
  // (exactly 100), junk ("1 g"), or the whole PACK weight. REAL servings
  // only (label or single-serve pack), never the category estimate --
  // see servingResolver.js. No real serving = per 100g.
  let servingGrams = null;
  let servingUnit = 'g';
  if (nutrientsInfo?.nutrients && report.nutrientsPer100) {
    const real = resolveServing({
      productName: report.productName,
      foodType: report.foodType,
      packSize,
      realNutrientsServingGrams: nutrientsInfo.servingGrams,
      realNutrientsServingUnit: nutrientsInfo.servingUnit,
    }, { allowStandard: false });
    servingGrams = real?.grams ?? null;
    servingUnit = real?.unit || 'g';
    report.realNutrientsServingGrams = servingGrams;
    report.realNutrientsServingUnit = servingUnit;
    report.realNutrients = toServing(report.nutrientsPer100, servingGrams);
  }

  // No Quick Health Check (and so no nutrient cap) for things eaten a
  // pinch at a time or dosed (condiments, supplements), or infant formula
  // (WHO's limits are an ADULT reference diet) -- see analyzeText.js.
  const isSmallDoseType = report.foodType === 'condiment' || report.foodType === 'supplement';
  if (nutrientsInfo && !report.isCondimentOrSeasoning && !report.isInfantFormula && !isSmallDoseType && !isSmallPortionFood(report.productName, servingGrams)) {
    const habitCheck = buildDailyHabitCheck(report.realNutrients, servingGrams, servingUnit);
    if (habitCheck) {
      report.dailyHabitCheck = habitCheck;
      applyRealNutrientCap(report, habitCheck);
    }
  }

  // Runs last so it only ever lowers the score.
  applyNutritionDensityCeiling(report);
  return report;
}
