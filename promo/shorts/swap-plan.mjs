// promo/shorts/swap-plan.mjs -- the "Swap it" short's plan (used by make.mjs
// --swap): product A, a higher-scoring product B from the same shelf, and a
// side-by-side of facts from both packs. Neutral wording: "higher ingredient
// score", never "worse" or "avoid".
import { isJunkIngredient } from '../../src/services/typoIngredient.js';
import { verdictFor } from '../../src/services/scoringEngine.js';
import { findCategoryForProduct } from '../../src/services/productCache.js';

const COLOR = { Excellent: '#2fbf5f', Good: '#8cc63f', Moderate: '#e0a100', Poor: '#f0821e', 'Very Poor': '#ef5a3c' };
const STOP = new Set(['with', 'and', 'the', 'pack', 'flavour', 'flavor', 'flavoured', 'flavored', 'premium', 'classic', 'original', 'india', 'indian']);
const isFlagged = (i) => i.status === 'concerning' || i.status === 'harmful';
const HEADING = /^(noodles?|masala|tastemaker|masala tastemaker|seasoning|filling|coating|dough|base|cream|wafers?|biscuits?)$/i;
const round1 = (v) => Math.round(v * 10) / 10;
const shorten = (s, n) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')}…`);
const words = (s, brand) => new Set(String(s).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w) && !String(brand || '').toLowerCase().split(/\s+/).includes(w)).map((w) => w.replace(/(ies|es|s)$/, '')));

/** Product facts the side-by-side needs, or a reason it can't be used. */
function describe(row) {
  const r = row.report || {};
  const all = r.ingredients || [];
  const ings = all.filter((i) => i?.name && !isJunkIngredient(i));
  if (!r.imageUrl) return { why: 'no product photo' };
  if (r.isInfantFormula) return { why: 'infant formula' };
  if (ings.length < 4) return { why: `only ${ings.length} readable ingredients` };
  const scored = all.filter((i) => i?.name && isJunkIngredient(i) && ((i.penalty || 0) > 0 || isFlagged(i)));
  if (scored.length) return { why: `typo ingredient(s) that affect the score: ${scored.map((i) => `"${i.name}"`).join(', ')}` };
  const flagged = ings.filter(isFlagged);
  const brand = r.brand || '';
  const name = row.product_name;
  const shortName = brand && name.toLowerCase().startsWith(brand.toLowerCase()) ? name.slice(brand.length).trim() : name;
  const verdict = verdictFor(r.overallScore);
  return {
    id: row.id, name, brand, shortName, pack: r.packSize || '', imageUrl: r.imageUrl,
    score: r.overallScore, verdict, color: COLOR[verdict],
    ingCount: ings.length, flaggedCount: flagged.length, additives: ings.filter((i) => i.insCode).length,
    sugar100: typeof r.nutrientsPer100?.addedSugarG === 'number' ? r.nutrientsPer100.addedSugarG : null,
    protein100: typeof r.nutrientsPer100?.proteinG === 'number' ? r.nutrientsPer100.proteinG : null,
    flaggedNames: flagged.filter((i) => !HEADING.test(i.name.trim())).map((i) => (i.insCode ? `INS ${i.insCode}` : shorten(i.name.replace(/\s*\(.*\)$/, ''), 22))),
    line: flagged.length ? `${flagged.length} of ${ings.length} ingredients worth a closer look` : `All ${ings.length} ingredients check out`,
  };
}

/**
 * @returns {Promise<{ a, b, TL } | { why }>}
 */
export async function planSwap(supabase, rowA, pickBy) {
  const a = describe(rowA);
  if (a.why) return { why: `"${rowA.product_name}": ${a.why}` };
  const shelf = findCategoryForProduct(a.name);
  if (!shelf) return { why: `can't tell which shelf "${a.name}" is on, so there is nothing to compare it with` };

  // Every approved product, slim, to find same-shelf ones with a clearly higher score.
  const cat = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('product_reports')
      .select('id, product_name, scan_count, brand:report->>brand, imageUrl:report->>imageUrl, score:report->overallScore')
      .eq('review_status', 'approved').order('id').range(from, from + 499);
    if (error) return { why: `catalog: ${error.message}` };
    cat.push(...data);
    if (data.length < 500) break;
  }
  const aWords = words(a.name, a.brand);
  const candidates = cat
    .filter((p) => p.id !== a.id && p.imageUrl && typeof p.score === 'number' && p.score >= Math.max(65, a.score + 15) && findCategoryForProduct(p.product_name)?.id === shelf.id)
    .map((p) => ({ ...p, overlap: [...words(p.product_name, p.brand)].filter((w) => aWords.has(w)).length, otherBrand: (p.brand || '').toLowerCase() !== a.brand.toLowerCase() }))
    // Same kind of product, not just the same browse shelf: cup noodles vs
    // other noodles, not vs pasta -- at least one product word in common.
    .filter((p) => p.overlap >= 1)
    .sort((x, y) => y.overlap - x.overlap || Number(y.otherBrand) - Number(x.otherBrand) || y.score - x.score || (y.scan_count || 0) - (x.scan_count || 0))
    .slice(0, 8);
  if (!candidates.length) return { why: `no similar approved product (${[...aWords].join(', ')}) on the "${shelf.id}" shelf scores at least ${Math.max(65, a.score + 15)} with a photo` };

  let b = null;
  for (const c of candidates) {
    const { data } = await supabase.from('product_reports').select('id, product_name, report').eq('id', c.id).single();
    const d = data && describe(data);
    if (d && !d.why) { b = d; break; }
  }
  if (!b) return { why: 'the higher-scoring products on this shelf have no clean ingredient list yet' };

  // The side-by-side: only facts both packs give.
  const rows = [
    { label: 'Ingredient score', a: String(a.score), b: String(b.score), better: b.score > a.score ? 'b' : b.score < a.score ? 'a' : null },
    { label: 'Worth a closer look', a: String(a.flaggedCount), b: String(b.flaggedCount), better: b.flaggedCount < a.flaggedCount ? 'b' : b.flaggedCount > a.flaggedCount ? 'a' : null },
  ];
  if (a.additives || b.additives) rows.push({ label: 'Additives (INS)', a: String(a.additives), b: String(b.additives), better: b.additives < a.additives ? 'b' : b.additives > a.additives ? 'a' : null });
  if (a.sugar100 != null && b.sugar100 != null) rows.push({ label: 'Added sugar / 100 g', a: `${round1(a.sugar100)} g`, b: `${round1(b.sugar100)} g`, better: b.sugar100 < a.sugar100 ? 'b' : b.sugar100 > a.sugar100 ? 'a' : null });
  if (a.protein100 != null && b.protein100 != null) rows.push({ label: 'Protein / 100 g', a: `${round1(a.protein100)} g`, b: `${round1(b.protein100)} g`, better: b.protein100 > a.protein100 ? 'b' : b.protein100 < a.protein100 ? 'a' : null });

  const hook = [0, 3.2], A = [3.2, 9.4], B = [9.4, 15.6];
  const c0 = 15.6, rowTimes = rows.map((_, i) => round1(c0 + 1.0 + i * 0.8));
  const c1 = round1(rowTimes[rowTimes.length - 1] + 2.6);
  const duration = Math.ceil(c1 + 4.6);
  const chipsFor = (p) => (p.flaggedNames.length ? p.flaggedNames.slice(0, 3).map((n) => [n, 'c']) : [['Nothing flagged', 's']]);
  const aChips = chipsFor(a);
  const bChips = chipsFor(b);
  if (b.flaggedCount < a.flaggedCount && b.flaggedNames.length) bChips.push([`${a.flaggedCount - b.flaggedCount} fewer flagged`, 's']);
  const chipTimes = (s0, n) => Array.from({ length: n }, (_, i) => round1(s0 + 2.2 + i * 0.45));
  const TL = {
    _: `Made by shorts/make.mjs --swap: ${a.name} (${a.id}) vs ${b.name} (${b.id}). Facts from each pack's ingredient list and nutrition panel as saved in FoodGuard.`,
    kind: 'swap', duration, music: pickBy(['warm', 'bright', 'chill', 'pulse', 'lofi'], 'swap-music'),
    scenes: { hook, label: A, facts: B, verdict: [c0, c1], cta: [c1, duration] },
    transitions: [{ t: hook[1], kind: 'push' }, { t: A[1], kind: 'push' }, { t: c0, kind: 'burst' }, { t: c1, kind: 'wipe' }],
    firstToken: A[0] + 1, tokenStep: 1, tokens: [], spoons: [],
    sfx: [
      ...aChips.map(([, k], i) => ({ t: chipTimes(A[0], aChips.length)[i], kind: k })),
      ...bChips.map(([, k], i) => ({ t: chipTimes(B[0], bChips.length)[i], kind: k })),
      ...rowTimes.map((t) => ({ t, kind: 's' })),
    ],
    a: { ...a, chips: aChips, chipTimes: chipTimes(A[0], aChips.length) },
    b: { ...b, chips: bChips, chipTimes: chipTimes(B[0], bChips.length) },
    rows, rowTimes,
    pickLine: `Higher ingredient score: ${shorten(b.shortName, 34)}`,
    hook: ['Same shelf.', 'Two labels.'],
    cta: pickBy(['Find your<br /><em>swap.</em>', 'Same shelf,<br /><em>better pick.</em>', 'Your shelf,<br /><em>decoded.</em>'], 'swap-cta'),
  };
  return { a, b, TL };
}
