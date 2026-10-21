// src/services/sugarProxy.js
//
// Jaggery, honey, khandsari and the like are almost all sugar, but some packs
// print only "Carbohydrates" (Utpanna Date Palm Jaggery: 86.27 g, no sugar
// row). With no sugar figure the score's sugar check never runs, and a pack of
// jaggery scores 95 "Excellent".
//
// For the SCORE only, such a product's carbohydrate is counted as its sugar --
// when its main (first) ingredient is a sugar, the label gives no sugar figure
// at all, and the carbohydrate is high enough to be mostly that sugar. What the
// app SHOWS stays the label's own figures (sugar: not known); the report records
// that the score did this (sugarCountedFromCarbs), so it can be explained.

const SUGAR_MAIN = /\b(jaggery|gur|gud|sugar|khand|khandsari|shakkar|honey|misri|mishri|molasses|treacle|syrup|date palm)\b/i;
const NOT_SUGAR = /\b(sugar[\s-]*free|sugar[\s-]*substitute|sugar alcohol)\b/i;
const MIN_CARB_G = 50;

/** The carbohydrate per 100 g to count as sugar for the score, or null when the rule doesn't apply. */
export function sugarFromCarbs(report) {
  const n = report?.nutrientsPer100;
  if (!n) return null;
  if (typeof n.totalSugarG === 'number' || typeof n.addedSugarG === 'number') return null; // the label gives sugar
  if (!(typeof n.carbohydrateG === 'number' && n.carbohydrateG >= MIN_CARB_G)) return null;
  const main = String(report.ingredients?.[0]?.name || '');
  return SUGAR_MAIN.test(main) && !NOT_SUGAR.test(main) ? n.carbohydrateG : null;
}
