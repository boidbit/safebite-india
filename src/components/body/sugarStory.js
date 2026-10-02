// src/components/body/sugarStory.js
//
// "What sugar does in the body" -- the scene list BodyStory.jsx plays. Every
// caption after the first is a word-for-word quote (translated for Hindi,
// and marked so) from a public health authority, linked; the first is this
// product's own label numbers. Nothing here is our wording about health, and
// each scene's picture (SugarScenes.jsx) shows only what its quote says.
import { ServingScene, DigestScene, RiseScene, CellsScene, TeethScene, LimitScene } from './SugarScenes';

export const SUGAR_SOURCES = {
  carbs: { name: 'MedlinePlus (U.S. National Library of Medicine): Carbohydrates', url: 'https://medlineplus.gov/ency/article/002469.htm' },
  insulin: { name: 'MedlinePlus (U.S. National Library of Medicine): Insulin in Blood', url: 'https://medlineplus.gov/lab-tests/insulin-in-blood/' },
  caries: { name: 'WHO: Sugars and dental caries', url: 'https://www.who.int/news-room/fact-sheets/detail/sugars-and-dental-caries' },
  guideline: { name: 'WHO: Guideline on sugars intake (2015)', url: 'https://www.who.int/news/item/04-03-2015-who-calls-on-countries-to-reduce-sugars-intake-among-adults-and-children' },
};

/**
 * @param {{ teaspoons: number, grams: number, servingGrams: number, unit: string }} serving
 *   this product's sugar per serving (NutrientAddsUp's sugar item)
 */
export function sugarStory({ teaspoons, grams, servingGrams, unit }) {
  const round1 = (n) => Math.round(n * 10) / 10;
  return [
    { key: 'serving', Scene: ServingScene, props: { teaspoons }, headKey: 'bsSugarH1', captionKey: 'bsSugar1', vars: { serving: servingGrams, unit, tsp: round1(teaspoons), grams: round1(grams) }, source: null },
    { key: 'digest', Scene: DigestScene, headKey: 'bsSugarH2', captionKey: 'bsSugar2', source: SUGAR_SOURCES.carbs },
    { key: 'rise', Scene: RiseScene, headKey: 'bsSugarH3', captionKey: 'bsSugar3', source: SUGAR_SOURCES.insulin },
    { key: 'cells', Scene: CellsScene, headKey: 'bsSugarH4', captionKey: 'bsSugar4', source: SUGAR_SOURCES.insulin },
    { key: 'teeth', Scene: TeethScene, headKey: 'bsSugarH5', captionKey: 'bsSugar5', source: SUGAR_SOURCES.caries },
    { key: 'limit', Scene: LimitScene, props: { grams }, headKey: 'bsSugarH6', captionKey: 'bsSugar6', source: SUGAR_SOURCES.guideline },
  ];
}
