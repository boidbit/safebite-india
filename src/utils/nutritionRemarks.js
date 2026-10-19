// src/utils/nutritionRemarks.js
//
// One plain sentence per nutrition issue (services/dataHealth.js nutritionIssues):
// "Saturated fat (8.3 g) is shown as more than total fat (6.6 g)." Shared by the
// product page (in the reader's language) and the admin list (English).
const KEY = {
  negative: 'reviewNegative',
  over100: 'reviewOver100',
  satOverFat: 'reviewSatOverFat',
  transOverFat: 'reviewTransOverFat',
  addedOverTotal: 'reviewAddedOverTotal',
  sugarOverCarb: 'reviewSugarOverCarb',
  macrosOver100: 'reviewMacrosOver100',
  calories: 'reviewCalories',
  sugarZeroListed: 'reviewSugarZeroListed',
  sodiumZeroSalt: 'reviewSodiumZeroSalt',
  fatZeroListed: 'reviewFatZeroListed',
};
const NUTRIENT = {
  proteinG: 'reviewNutProtein', totalFatG: 'reviewNutFat', carbohydrateG: 'reviewNutCarb', totalSugarG: 'reviewNutSugar',
  addedSugarG: 'reviewNutAddedSugar', saturatedFatG: 'reviewNutSatFat', transFatG: 'reviewNutTransFat', fibreG: 'reviewNutFibre',
  sodiumMg: 'reviewNutSodium', caloriesKcal: 'reviewNutCalories',
};
const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);

/**
 * @param {{ kind: string }} issue
 * @param {(key: string, params?: object) => string} t
 * @param {'g'|'ml'} [basis]
 */
export function nutritionRemark(issue, t, basis = 'g') {
  const params = { basis };
  for (const [k, v] of Object.entries(issue)) params[k] = round(v);
  if (issue.nutrient) params.nutrient = t(NUTRIENT[issue.nutrient] || 'reviewNutOther');
  return t(KEY[issue.kind] || 'reviewOther', params);
}
