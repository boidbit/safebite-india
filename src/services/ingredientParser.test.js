// src/services/ingredientParser.test.js
//
// Run with: node --test src/services/ingredientParser.test.js
// (or `npm test`, which runs every *.test.js file under src/).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredients, parseLabel, looksLikeNutritionPanel, findBracketIssues, findMissingCommaIssues, findIngredientTextIssues } from './ingredientParser.js';

function byName(ingredients, name) {
  return ingredients.find((i) => i.displayName === name);
}

test('does not drop a real named group just because it carries a leading disclosure mark', () => {
  // Regression test for a real scanned product (Lays India's Magic
  // Masala): "*Seasoning (Spices and condiments, Maltodextrin, ...)" --
  // the leading "*" is a disclosure mark on a real ingredient group,
  // not a footnote reference to something mentioned earlier (like the
  // genuine "#(D-GLUCOSE, LEVULOSE)" case below). The old check treated
  // ANY leading marker as a footnote and skipped the whole entry --
  // silently dropping 8 real ingredients (including two flavour
  // enhancers) and scoring the product as if it were just potato and
  // oil (a false 93/100 "Very Healthy").
  const label =
    'Potato (83%), Edible Vegetable Oil, *Seasoning (Spices and condiments, Maltodextrin, ' +
    'lodised Salt, Sugar, Flavour (Natural and Nature Identical Flavouring Substances), ' +
    'Edible Vegetable Oil (Sunflower Oil, Palm Oil), Flavour Enhancers (627, 631)).';

  const result = parseIngredients(label);
  const names = result.map((i) => i.displayName);

  assert.ok(names.includes('Potato'));
  assert.ok(names.includes('Maltodextrin'));
  assert.ok(names.includes('Sugar'));
  assert.ok(names.includes('Sunflower Oil'));
  assert.ok(names.includes('Palm Oil'));
  assert.ok(result.some((i) => i.insCode === '627'));
  assert.ok(result.some((i) => i.insCode === '631'));
});

test('still skips a genuine standalone footnote that is nothing but a marker and a bracket', () => {
  // The case this whole check exists for -- "#(D-GLUCOSE, LEVULOSE)"
  // defines "INVERT SUGAR SYRUP#" mentioned earlier, it isn't itself
  // an ingredient. Must keep working after the fix above.
  const result = parseIngredients('INVERT SUGAR SYRUP#, Citric Acid. #(D-GLUCOSE, LEVULOSE)');
  assert.deepEqual(result.map((i) => i.displayName), ['Invert Sugar Syrup', 'Citric Acid']);
});

test('extracts ingredients nested inside a group that is followed by its own percentage bracket', () => {
  // Regression test for a real scanned label (Slurp Farm Millet Noodles):
  // "Supergrain blend (whole wheat (atta), jowar) (63%)" — the comma-
  // separated ingredient list sits in the MIDDLE bracket, with a
  // trailing percentage-only bracket after it. The parser used to only
  // look at the LAST top-level bracket to decide whether to recurse into
  // a sub-ingredient list; since the last bracket here is "(63%)" (no
  // comma), it never recursed, mangled the whole clause into one
  // unnamed blob, and silently dropped it entirely -- atta and jowar,
  // the two largest ingredients in the product, never reached scoring.
  const label =
    'Noodles (88.5%): Supergarn blend (whole wheat (atta), jowar) (63%), ' +
    'guar gum, iodised salt, rosemary (antioxidant) [INS 392]. ' +
    'Seasoning (11.5%): Mixed spices (onion, coriander, chilli), ' +
    'tapioca starch, citric acid (acidity regulator) [INS 330].';

  const result = parseIngredients(label);

  const atta = byName(result, 'Whole Wheat Atta');
  const jowar = byName(result, 'Jowar');
  assert.ok(atta, 'whole wheat (atta) must be extracted as its own ingredient');
  assert.ok(jowar, 'jowar must be extracted as its own ingredient');

  // The trailing "(63%)" belongs to this two-member group, split evenly.
  assert.equal(atta.percentage, 31.5);
  assert.equal(jowar.percentage, 31.5);
  // Both share one slot -- they came out of the same bracket.
  assert.equal(atta.groupId, jowar.groupId);
  assert.ok(atta.groupId);

  // Siblings outside that bracket ("guar gum", "iodised salt", ...) are
  // unaffected and still parse as their own, ungrouped ingredients.
  assert.ok(byName(result, 'Guar Gum'));
  assert.ok(byName(result, 'Iodised Salt'));
});

test('picks the percentage bracket nearest to the group it belongs to, not the first one in the string', () => {
  // "Noodles (88.5%)" is an unrelated OUTER percentage that happens to
  // appear earlier in the string than the "(63%)" that actually
  // describes the supergrain blend. Grabbing whichever percentage
  // bracket appears first would silently attribute the wrong number.
  const label = 'Noodles (88.5%): Supergarn blend (whole wheat (atta), jowar) (63%).';
  const result = parseIngredients(label);

  const atta = byName(result, 'Whole Wheat Atta');
  const jowar = byName(result, 'Jowar');
  assert.equal(atta.percentage, 31.5);
  assert.equal(jowar.percentage, 31.5);
});

test('still distributes a wrapper percentage across a simple sub-ingredient list', () => {
  // "Seasoning (11.5%): Mixed spices (a, b, c, d, e)" — this case already
  // recursed correctly before the fix (its own comma-bearing bracket was
  // the last one), but the wrapper's "11.5%" was previously discarded
  // instead of being shared across the five spices.
  const label = 'Seasoning (11.5%): Mixed spices (onion, coriander, chilli, turmeric, garlic).';
  const result = parseIngredients(label);

  for (const name of ['Onion', 'Coriander', 'Chilli', 'Turmeric', 'Garlic']) {
    const ing = byName(result, name);
    assert.ok(ing, `${name} should be extracted`);
    assert.equal(ing.percentage, 11.5 / 5);
  }
});

test('a child that states its own percentage keeps it instead of the group average', () => {
  const label = 'Blend (Sugar 20%, Salt) (30%).';
  const result = parseIngredients(label);

  const sugar = byName(result, 'Sugar');
  const salt = byName(result, 'Salt');
  assert.equal(sugar.percentage, 20); // its own stated value, not 15 (30/2)
  assert.equal(salt.percentage, 15); // falls back to the even split
});

test('does not regress a bracketed ingredient list with no trailing percentage', () => {
  const label = 'Edible Vegetable Oil (Ricebran, Cottonseed, Palmolein)';
  const result = parseIngredients(label);

  for (const name of ['Ricebran', 'Cottonseed', 'Palmolein']) {
    const ing = byName(result, name);
    assert.ok(ing, `${name} should be extracted`);
    assert.equal(ing.percentage, null);
  }
});

test('does not regress a bracketed additive code list', () => {
  const label = 'RAISING AGENTS [INS 503(ii), 500(ii)]';
  const result = parseIngredients(label);
  assert.equal(result.length, 2);
  assert.ok(result.every((i) => i.insCode));
});

test('does not regress a single aliased ingredient', () => {
  const label = 'Refined Wheat Flour (Maida)';
  const result = parseIngredients(label);
  assert.equal(result.length, 1);
  assert.equal(result[0].displayName, 'Refined Wheat Flour Maida');
});

test('does not lose a bracketed group whose closing sentence period sits before the closing brace', () => {
  // Regression test for a real seeded product (Maggi 2-minute noodles,
  // scored a false 98/100): "Noodles {..., Humectant (451(i)).} Masala
  // {...}." puts the full stop INSIDE the group, right before its own
  // closing brace. splitTopLevel used to force a flush on every period
  // regardless of bracket depth (a rescue for genuinely unbalanced OCR'd
  // text) -- here it split the group in half at that period, leaving
  // every real ingredient trapped in one over-long blob that later fails
  // the "looks like one ingredient name" check and gets silently
  // dropped, so only the allergen sentence after it got parsed as
  // "ingredients" at all.
  const label =
    'Noodles {Refined wheat flour (Maida), Palm oil, Wheat gluten, ' +
    'Humectant (451(i)).} Masala {Sugar, Flavour enhancer (635), ' +
    'Colour (150d) and Wheat gluten.} Contains Wheat and nut.';

  const result = parseIngredients(label);

  for (const name of ['Palm Oil', 'Flavour Enhancer (INS 635)', 'Colour (INS 150d)']) {
    assert.ok(byName(result, name), `${name} should be extracted, not swallowed by the period-before-brace`);
  }
});

test('recovers every ingredient after a single missing closing bracket, instead of dropping them all', () => {
  // Regression test for a real scanned product (Maaza Refresh Mango
  // Drink, barcode 8901764175022): the label text is missing the ")"
  // that should close "(330, 331(iii))" -- "SUGAR ACIDITY REGULATORS
  // (330, 331(iii), STABILIZER (466), ...". Because splitTopLevel's
  // bracket depth never returns to zero after that point, every comma
  // for the REST of the string stopped splitting too, so the whole tail
  // (stabilizer, antioxidant, sweetener, colour, flavour) got swallowed
  // into one blob and silently dropped -- the product scored a false
  // "Very Healthy 99/100" because the artificial sweetener (960) and a
  // restricted synthetic colour (110, Sunset Yellow) vanished along with
  // it, not just the acidity regulators that were actually missing their
  // bracket.
  const label =
    'WATER, MANGO PULP (11.3%), SUGAR ACIDITY REGULATORS (330, 331(iii), STABILIZER (466),\n' +
    'ANTIOXIDANT (300) SWEETENER (960), COLOUR(110),\n' +
    'MANGO FLAVOUR (NATURE-IDENTICAL & ARTIFICIAL FLAVOURING SUBSTANCES).';

  const result = parseIngredients(label);

  assert.ok(byName(result, 'Water'));
  assert.ok(byName(result, 'Mango Pulp'));
  const sweetener = result.find((i) => i.insCode === '960');
  const colour = result.find((i) => i.insCode === '110');
  assert.ok(sweetener, 'the artificial sweetener (INS 960) must survive the missing bracket');
  assert.ok(colour, 'the restricted synthetic colour (INS 110) must survive the missing bracket');
});

test('splits two additive categories glued together with no comma between them', () => {
  // "ANTIOXIDANT (300) SWEETENER (960)" is missing the comma between the
  // two categories -- without recognising this, only the LAST bracket
  // ("960") was kept and "(300)" was silently absorbed as unparsed text
  // in front of it, losing the antioxidant as its own scoreable entry.
  const result = parseIngredients('ANTIOXIDANT (300) SWEETENER (960)');
  const antioxidant = result.find((i) => i.insCode === '300');
  const sweetener = result.find((i) => i.insCode === '960');
  assert.ok(antioxidant, 'Antioxidant (300) must be its own entry');
  assert.ok(sweetener, 'Sweetener (960) must be its own entry');
});

test('does not split a descriptive name that happens to end in "Flavour" or "Colour"', () => {
  // The category-word repair above must never fire on "Mango Flavour" or
  // "Caramel Colour" -- these are real compound ingredient names, not a
  // category label glued to an unrelated preceding word, and splitting
  // them would fabricate a fake standalone "Flavour"/"Colour" ingredient.
  const result = parseIngredients('MANGO FLAVOUR (NATURE-IDENTICAL), CARAMEL COLOUR (150D)');
  assert.ok(!byName(result, 'Flavour'), 'must not split "Mango Flavour" into "Mango" + "Flavour"');
  assert.ok(!byName(result, 'Colour'), 'must not split "Caramel Colour" into "Caramel" + "Colour"');
  assert.ok(result.some((i) => i.displayName.toLowerCase().includes('mango flavour')));
  assert.ok(result.some((i) => i.displayName.toLowerCase().includes('caramel colour')));
});

test('strips manufacturer/address boilerplate that names itself with a trigger word', () => {
  const label =
    'Ingredients: Wheat Flour, Sugar, Palm Oil, Salt, Raising Agent (503(ii)). Contains Wheat. ' +
    'Mfd by: ABC Foods Pvt Ltd, Plot 45, Sector 10, Gurgaon, Haryana - 122001. ' +
    'FSSAI Lic No. 12345678901234. ' +
    'Customer Care: 1800-123-4567, care@abcfoods.com, www.abcfoods.com. ' +
    'Best Before 6 months from Pkd on. Batch No. B123.';

  const { ingredients, allergens } = parseLabel(label);
  const names = ingredients.map((i) => i.displayName);

  assert.deepEqual(names, ['Wheat Flour', 'Sugar', 'Palm Oil', 'Salt', 'Raising Agent (INS 503(ii))']);
  assert.deepEqual(allergens, [{ word: 'wheat', severity: 'contains' }]);
});

test('drops a manufacturer/address block that has no attribution verb in front of it', () => {
  // Plenty of real labels just print the company name and address as a
  // trailing run of comma-separated entries with nothing announcing
  // what they are -- no "Mfd by" for the trigger-word check above to
  // catch. "Private Limited" and the trailing 6-digit PIN code are each
  // a strong enough signal on their own that everything from there to
  // the end of the label is address, not more ingredients.
  const label = 'Wheat Flour, Sugar, Palm Oil, Salt, XYZ Foods Private Limited, Plot 12, MIDC, Pune - 411019.';
  const result = parseIngredients(label);
  assert.deepEqual(result.map((i) => i.displayName), ['Wheat Flour', 'Sugar', 'Palm Oil', 'Salt']);
});

test('does not fabricate a fake "Quot" ingredient from a leaked &quot; entity', () => {
  // Regression test for a real scanned product (Storia Coffee Shake
  // 180ml): the extracted text wasn't an ingredients list at all -- it
  // was the NUTRITION FACTS panel, with an unescaped "&quot;" leaked in
  // right before a marketing line. splitTopLevel treats a bare "&" as a
  // top-level "X, Y & Z" separator, so it tore "&quot;" into "&" (flush),
  // then "quot" landed as its own clean-looking token that passed every
  // "is this a real ingredient name" check -- Gemini then dutifully
  // researched "Quot" and even correctly wrote "this is a typographical
  // error, not a food substance" in its own explanation, but the product
  // still scored a false 100/100 "Very Healthy" off that one fabricated
  // "ingredient". None of this text is a real ingredients list, so the
  // correct outcome is zero ingredients (which the caller in
  // analyzeText.js turns into an honest "couldn't read this" error,
  // instead of a confident wrong score).
  const label =
    'SERVE SIZE: 100 ml PER 100 ml %RDA (Approx) (Per Serve) 93 4.6 Energy(kcal) ' +
    'Total Fat (g) 3.2 4.7 Saturated Fat(g) 2 9 Trans Fat(g) 0 0 Total Carbohydrates(g) ' +
    '14.3 Total Sugars(g) 8.5 Added Sugar(g) 6 12 Protein(g) 3.3 1.8 Calcium(mg) 6 60 4.5 ' +
    'Sodium(mg) &quot;COFFEE IS A RICH SOURCE OF DISEASE-FIGHT RDA calculated as per';

  const result = parseIngredients(label);
  assert.equal(result.length, 0, 'a nutrition-facts panel must not be read as an ingredients list');
});

test('still splits a legitimate top-level "X, Y & Z" list ending', () => {
  // Guards the actual, legitimate use of "&" as a separator -- decoding
  // HTML entities must not disable it.
  const result = parseIngredients('Sugar, Salt & Citric Acid');
  for (const name of ['Sugar', 'Salt', 'Citric Acid']) {
    assert.ok(byName(result, name), `${name} should still be extracted`);
  }
});

test('extracts a "Contains" allergen declaration separately even with markdown emphasis underscores', () => {
  // Same real product: its allergen line came through as "Contains
  // _Wheat_ and _nut_. May contains _Milk_, _Mustard_, _Oats_ and
  // _Soy_." -- the underscores (leaked from some earlier AI step) meant
  // "_wheat_" never matched the plain word "wheat" in ALLERGEN_WORDS, so
  // the whole clause fell through to be parsed as six fake ingredients
  // ("Contains _wheat_", "_nut_", ...) instead of being recognized and
  // removed as allergen text.
  const label =
    'Noodles {Wheat flour, Palm oil.} Contains _Wheat_ and _nut_. ' +
    'May contains _Milk_, _Mustard_, _Oats_ and _Soy_.';

  const { ingredients, allergens } = parseLabel(label);

  assert.deepEqual(
    [...allergens].sort((a, b) => a.word.localeCompare(b.word)),
    [
      { word: 'milk', severity: 'may_contain' },
      { word: 'mustard', severity: 'may_contain' },
      { word: 'nut', severity: 'contains' },
      { word: 'oats', severity: 'may_contain' },
      { word: 'soy', severity: 'may_contain' },
      { word: 'wheat', severity: 'contains' },
    ]
  );
  for (const fake of ['Contains _wheat_', '_nut_', 'May Contains _milk_', '_mustard_', '_oats_', '_soy_']) {
    assert.ok(!byName(ingredients, fake), `"${fake}" must not appear as a fake ingredient`);
  }
});

test('does not split the fixed category name "Spices and Condiments" at its own "and"', () => {
  // Regression test for a real scanned product (Lay's Potato Chips,
  // barcode 8901491101844): "spices and condiments (onion powder,
  // chilli powder, ..., natural flavors (e160b)" -- the label's own
  // final bracket is missing its closer. The generic " and " splitter
  // (meant for trailing "X, Y AND Z" lists) was treating "Spices and
  // Condiments" as two separate top-level entries, leaving "condiments
  // (...)" holding the real, now-orphaned ingredient list with a
  // dangling bracket that then silently dropped everything inside it --
  // 16 real ingredients gone, including sugar, salt and citric acid.
  const label =
    'potato, edible vegetable oil (sunflower oil, corn oil, and/or canola oil), spices and ' +
    'condiments (onion powder, chilli powder, dry mango powder, coriander powder, ginger ' +
    'powder, garlic powder, black pepper powder, turmeric powder, cumin powder, salt, ' +
    'black salt, sugar, tomato powder, citric acid, tartaric acid, natural flavors (e160b)';

  const result = parseIngredients(label);
  const names = result.map((i) => i.displayName);

  assert.ok(!names.includes('Spices'), 'must not split off a bare "Spices" fragment');
  for (const name of ['Onion Powder', 'Salt', 'Sugar', 'Citric Acid', 'Tartaric Acid']) {
    assert.ok(names.includes(name), `${name} should still be extracted`);
  }
  assert.ok(result.some((i) => i.insCode === '160b'), 'Natural Flavors (e160b) should resolve to INS 160b');
});

test('a trailing bracket with no closer at all recovers everything inside it instead of dropping the whole entry', () => {
  // A shorter, more direct case than the "Spices and Condiments" one
  // above -- a single named group whose closing ")" is simply never
  // there (the physical label got cut off / OCR missed it), with
  // nothing else in the string after it.
  const label = 'Rice, Seasoning (Sugar, Salt, Citric Acid';
  const result = parseIngredients(label);
  const names = result.map((i) => i.displayName);
  assert.ok(names.includes('Rice'));
  assert.ok(names.includes('Sugar'));
  assert.ok(names.includes('Salt'));
  assert.ok(names.includes('Citric Acid'));
  assert.ok(!names.includes('Seasoning'), 'the generic wrapper name should not itself become an ingredient');
});

test('recognizes a photographed nutrition panel instead of scoring it as a clean ingredient list', () => {
  // Regression test for a real scanned product (Parle-G, barcode
  // 8901719134852) whose entire stored "ingredients" text was
  // "Energy.protrin.carbohydrate." -- the nutrition panel's row labels,
  // photographed instead of the ingredients list. Each word resolves as
  // a harmless real food term with nothing to penalize, so a biscuit
  // that's roughly a quarter sugar scored a flat 100/100 "Very Healthy".
  assert.equal(looksLikeNutritionPanel(parseIngredients('Energy.protrin.carbohydrate.')), true);
  assert.equal(
    looksLikeNutritionPanel(parseIngredients('Energy, Protein, Carbohydrate, Total Fat, Saturated Fat, Sodium')),
    true
  );
});

test('does not mistake a real ingredient list for a nutrition panel just because it contains sugar or salt', () => {
  // Sugar, salt, water and oil are genuine ingredients that also appear
  // as panel rows -- treating those as panel terms would reject a large
  // share of real Indian labels.
  const real = parseIngredients('Refined Wheat Flour (Maida) 68%, Sugar, Refined Palm Oil, Iodised Salt, Milk Solids');
  assert.equal(looksLikeNutritionPanel(real), false);

  // A single coincidental panel word in a real list must not trip it --
  // two or more are required.
  assert.equal(looksLikeNutritionPanel(parseIngredients('Whey Protein Concentrate, Cocoa Solids, Sugar')), false);
});

test('strips a leftover "and/or" conjunction fragment instead of leaving it stuck to the ingredient name', () => {
  // "sunflower oil, corn oil, and/or canola oil" -- splitting on the
  // comma before "and/or" left "and/or canola oil" as the ingredient's
  // own name, which then failed to match the database's plain "canola
  // oil" entry at all.
  const result = parseIngredients('Edible Vegetable Oil (Sunflower Oil, Corn Oil, and/or Canola Oil)');
  const names = result.map((i) => i.displayName);
  assert.ok(names.includes('Canola Oil'));
  assert.ok(!names.includes('And/or Canola Oil'));
});

// findBracketIssues -- admin form's live textbox highlighting.

test('findBracketIssues finds nothing on real, well-formed label text', () => {
  const text = 'Sugar, Refined Wheat Flour (Maida), Palm Oil, Salt, Raising Agents (INS 500(ii), INS 503(ii)), Emulsifiers (INS 322, INS 471)';
  assert.deepEqual(findBracketIssues(text), []);
});

test('findBracketIssues catches an unclosed opener and points at it', () => {
  const text = 'Sugar, Palm Oil (Ricebran, Cottonseed';
  const issues = findBracketIssues(text);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].from, text.indexOf('('));
  assert.match(issues[0].message, /never closed/);
});

test('findBracketIssues catches a closer with nothing open to match', () => {
  const text = 'Sugar, Palm Oil), Salt';
  const issues = findBracketIssues(text);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].from, text.indexOf(')'));
  assert.match(issues[0].message, /no opening bracket/);
});

test('findBracketIssues catches a type mismatch ("(Maida]") that depth-only balance checking misses', () => {
  // Depth-only balance is fine here (one opener, one closer) -- the bug
  // is the closer is the wrong TYPE, which isBracketBalanced can't see.
  const text = 'Refined Wheat Flour (Maida], Sugar';
  const issues = findBracketIssues(text);
  assert.equal(issues.length, 2); // flags both the opener and the mismatched closer
  assert.equal(issues[0].from, text.indexOf('('));
  assert.equal(issues[1].from, text.indexOf(']'));
});

// findMissingCommaIssues -- verified against 400 real scraped
// ingredient texts before shipping (see the function's own comment);
// these are the real positive and negative cases found there.

test('findMissingCommaIssues catches a real scraping glitch (real KitKat listing) with zero space between closer and next word', () => {
  const text = 'Raising Agent (500(ii))Artificial Flavouring Substance';
  const issues = findMissingCommaIssues(text);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].from, text.indexOf('))') + 1);
});

test('findMissingCommaIssues catches a closer + one space + capitalized word with no comma (real Knorr listing)', () => {
  const text = 'Vegetables (Onion (1%) and Leeks (0.4%)) Hydrolyzed Vegetable Protein';
  const issues = findMissingCommaIssues(text);
  assert.ok(issues.length >= 1);
});

test('findMissingCommaIssues does NOT flag a closer followed by a comma, another closer, or a lowercase word', () => {
  assert.deepEqual(findMissingCommaIssues('Palm Oil (Ricebran), Sunflower Oil'), []);
  assert.deepEqual(findMissingCommaIssues('Raising Agents (INS 500(ii), INS 503(ii))'), []);
  assert.deepEqual(findMissingCommaIssues('Oil (Sunflower) and Preservative (INS 211)'), []);
});

test('findIngredientTextIssues merges both checks, sorted by position', () => {
  const text = 'Sugar, Palm Oil (Ricebran]Sunflower Oil';
  const issues = findIngredientTextIssues(text);
  assert.ok(issues.some((i) => i.severity === 'error'));
  assert.ok(issues.some((i) => i.severity === 'warning'));
  for (let i = 1; i < issues.length; i++) assert.ok(issues[i].from >= issues[i - 1].from);
});

// "Milk Solids, Vitamin A & Vitamin D" silently lost its Vitamin A (the "A"
// counted as an English filler word), and "Vitamin A & D" / "Vitamins (A, D
// & B12)" lost every vitamin (bare letters are rejected as OCR noise).
test('"Vitamin A & Vitamin D" keeps both vitamins', () => {
  const names = parseIngredients('Toned Milk, Milk Solids, Vitamin A & Vitamin D').map((i) => i.displayName);
  assert.deepEqual(names, ['Toned Milk', 'Milk Solids', 'Vitamin A', 'Vitamin D']);
});

test('vitamin shorthand is spelled out: "Vitamin A & D", "Vitamins A, D and E", "Vitamins (A, D & B12)"', () => {
  const names = (t) => parseIngredients(t).map((i) => i.displayName);
  assert.deepEqual(names('Water, Vitamin A & D, Salt'), ['Water', 'Vitamin A', 'Vitamin D', 'Salt']);
  assert.deepEqual(names('Sugar, Vitamins A, D and E'), ['Sugar', 'Vitamin A', 'Vitamin D', 'Vitamin E']);
  assert.deepEqual(names('Flour, Vitamins (A, D & B12), Iron'), ['Flour', 'Vitamin A', 'Vitamin D', 'Vitamin B12', 'Iron']);
});

test('vitamin expansion does not swallow ordinary words that follow a vitamin', () => {
  const names = parseIngredients('Sugar, Vitamin C and Dextrose, Salt').map((i) => i.displayName);
  assert.deepEqual(names, ['Sugar', 'Vitamin C', 'Dextrose', 'Salt']);
});

// A scanned Krack Jack label: "RAISING AGENTS [" never closes and OCR read
// two closing brackets as "1" -- only Maida, oil and sugar were scored.
test('recovers code lists whose closing bracket is missing or read as "1"', () => {
  const label = 'REFINED WHEAT FLOUR (MAIDA), REFINED OILS (PALMOLEIN AND PALM), SUGAR (19.1%), RAISING AGENTS [503( ii ), 500(ii) ,341(1), INVERT SUGAR SYRUP, IODISED SALT(0.9%), YEAST, ACIDITY REGULATORS [ 270, 296 1, FLOUR TREATMENT AGENTS [223, 1101(ii), 1100(1)1, EMULSIFIER OF VEGETABLE ORIGIN [472e]';
  const result = parseIngredients(label);
  const names = result.map((i) => i.displayName);
  for (const name of ['Invert Sugar Syrup', 'Iodised Salt', 'Yeast']) assert.ok(names.includes(name), `${name} should be extracted`);
  const codes = result.map((i) => i.insCode).filter(Boolean);
  for (const code of ['503(ii)', '500(ii)', '341(i)', '270', '296', '223', '1101(ii)', '1100(i)', '472e']) assert.ok(codes.includes(code), `INS ${code} should be extracted`);
  assert.equal(byName(result, 'Acidity Regulators (INS 296)')?.insCode, '296');
});

test('a well-formed mixed list in brackets is not closed early', () => {
  const names = parseIngredients('Sugar, Acidity Regulator (330, Sodium Citrate), Salt').map((i) => i.displayName);
  assert.ok(names.includes('Sodium Citrate'));
  assert.ok(names.includes('Salt'));
});

test('a declared flavour is one ingredient, whatever the bracket lists', () => {
  const names = (t) => parseIngredients(t).map((i) => i.displayName);
  assert.deepEqual(names('Sugar, artificial flavouring substances (cocoa, vanilla), Salt'), ['Sugar', 'Artificial Flavouring Substances', 'Salt']);
  assert.deepEqual(
    names('Sugar, FLAVOURS (NATURE IDENTICAL AND ARTIFICIAL FLAVOURING SUBSTANCES - CHOCOLATE AND VANILLA), Water'),
    ['Sugar', 'Nature Identical and Artificial Flavouring Substances', 'Water'],
  );
  assert.deepEqual(
    names('Milk Solids, Flavours (Natural, Nature Identical and Artificial Flavouring Substances)'),
    ['Milk Solids', 'Natural, Nature Identical and Artificial Flavouring Substances'],
  );
  assert.deepEqual(names('Sugar, Added Flavours (Artificial (Vanilla & Butter) Flavouring Substances)'), ['Sugar', 'Artificial Flavouring Substances']);
});

test('a flavour falls back to the library\'s plain entry for its most concerning kind', () => {
  const [flavour] = parseIngredients('Nature identical and artificial flavouring substances (honey, saffron)');
  assert.deepEqual(flavour.lookupKeys, ['nature identical and artificial flavouring substances', 'artificial flavouring substances', 'nature identical flavouring substances']);
});

test('flavour handling leaves groups, enhancers and code-named flavours alone', () => {
  const seasoning = parseIngredients('Seasoning (Salt, Sugar, Nature Identical Flavouring Substances, Spices)').map((i) => i.displayName);
  assert.deepEqual(seasoning, ['Salt', 'Sugar', 'Nature Identical Flavouring Substances', 'Spices']);
  const enhancers = parseIngredients('Flavour Enhancers (627, 631)').map((i) => i.insCode);
  assert.deepEqual(enhancers, ['627', '631']);
  // A missing comma: the cream filling after the flavour is still read.
  const filling = parseIngredients('Flavours (Milk, Vanillin) Cream Filling (Sugar, Palm Oil)').map((i) => i.displayName);
  assert.ok(filling.includes('Palm Oil'));
});

test('a flavour bracket that never closes still lets the rest of the label through', () => {
  const names = parseIngredients('Malt extract, sugar, artificial flavouring substances (milk caramel, emulsifiers (322, 471), raising agent [500(ii)], iodized salt.').map((i) => i.displayName);
  assert.ok(names.includes('Artificial Flavouring Substances'));
  assert.ok(names.includes('Iodized Salt'));
});

test('bare and described codes inside a group are kept, named after the group', () => {
  const result = parseIngredients('Dark Compound [Sugar, Edible Vegetable Fat (Hydrogenated), Cocoa Solids & Emulsifiers (492, 322 (i) - Lecithin of Soya Origin)]');
  assert.equal(byName(result, 'Emulsifiers (INS 492)')?.insCode, '492');
  assert.equal(byName(result, 'Lecithin Of Soya Origin (INS 322(i))')?.insCode, '322(i)');
});

test('numbers outside the INS range are not read as additive codes', () => {
  const result = parseIngredients('Sugar, Notes (2000 - calories a day is used for general nutrition advice, 4500)');
  assert.ok(!result.some((i) => i.insCode === '2000' || i.insCode === '4500'));
});
