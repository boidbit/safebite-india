// scripts/fix-zero-conflicts.js
//
// A nutrition table that says 0 g sugar / 0 mg sodium / 0 g fat while sugar,
// salt or oil is one of the MAIN ingredients (first half of the list,
// dataHealth.js) can't be right -- "Date Palm Jaggery: 0 g sugar". Almost
// always the source (Blinkit text, Open Food Facts) printed 0 for "not given".
//
// For each such product:
//   1. the false 0 is removed -- the figure becomes "not known" instead of a
//      claim of zero (sugar: total and added; fat: total, saturated, trans,
//      only the ones that are 0);
//   2. the score is redone the same safe way as fix-blinkit-nutrition.js
//      (only when the stored score can be rebuilt exactly);
//   3. a "Needs pack photo" data issue is opened, so the real figure can be
//      filled from the pack (Admin > Products > Needs pack photo).
// Saved one product at a time: backup ../fix-zero-conflicts-backup.jsonl,
// progress ../fix-zero-conflicts-progress.json -- a stopped run resumes.
//
//   node --env-file=.env scripts/fix-zero-conflicts.js            (preview, CSV)
//   node --env-file=.env scripts/fix-zero-conflicts.js --apply
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { nutritionIssues } from '../src/services/dataHealth.js';
import { buildReport } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';
import { NEEDS_PHOTO_PREFIX } from '../src/services/adminReviewRepo.js';

const APPLY = process.argv.includes('--apply');
if (APPLY && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }
const PROGRESS = '../fix-zero-conflicts-progress.json';
const BACKUP = '../fix-zero-conflicts-backup.jsonl';
const progress = (() => { try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return {}; } })();

const KEYS = {
  sugarZeroListed: { keys: ['totalSugarG', 'addedSugarG'], word: 'sugar', unit: 'g' },
  sodiumZeroSalt: { keys: ['sodiumMg'], word: 'sodium', unit: 'mg' },
  fatZeroListed: { keys: ['totalFatG', 'saturatedFatG', 'transFatG'], word: 'fat', unit: 'g' },
};
const isZero = (v) => typeof v === 'number' && v <= 0.5;

async function all(build) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build().range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

/** A copy of a nutrient table without the given keys (when they're zero), or null if nothing is left. */
function without(table, keys) {
  if (!table) return table;
  const out = { ...table };
  for (const k of keys) if (isZero(out[k])) delete out[k];
  return Object.keys(out).length ? out : null;
}

// Same rule as backfill-pack-size-off.js / fix-blinkit-nutrition.js: rescore only
// when the stored score can be rebuilt exactly from the old figures.
function rescored(report, nextPer100, nextReal) {
  const run = (per100, real) => {
    const base = buildReport(report.ingredients || [], { productName: report.productName, brand: report.brand, imageUrl: report.imageUrl, packSize: report.packSize || undefined });
    const next = { ...report, overallScore: base.overallScore, verdict: base.verdict };
    const info = per100 ? { nutrients: real || per100, nutrientsPer100: per100, servingGrams: report.realNutrientsServingGrams ?? null, servingUnit: report.realNutrientsServingUnit || 'g' } : undefined;
    if (info) next.nutrientsPer100 = per100; else delete next.nutrientsPer100;
    finalizeScore(next, { nutrientsInfo: info, packSize: report.packSize || undefined });
    return next;
  };
  const figures = (r) => {
    const out = { ...r };
    if (nextPer100) out.nutrientsPer100 = nextPer100; else delete out.nutrientsPer100;
    if (nextReal) out.realNutrients = nextReal; else delete out.realNutrients;
    return out;
  };
  const canRescore = Array.isArray(report.ingredients) && report.ingredients.length > 0
    && run(report.nutrientsPer100, report.realNutrients).overallScore === report.overallScore;
  return canRescore ? { report: figures(run(nextPer100, nextReal)), rescored: true } : { report: figures(report), rescored: false };
}

const rows = await all(() => supabase.from('product_reports')
  .select('id, lookup_key, product_name, source, review_status, ingredients_text, n:report->nutrientsPer100')
  .neq('review_status', 'rejected').order('id'));
const plan = [];
for (const r of rows) {
  if (progress[r.id] || !r.n) continue;
  const issues = nutritionIssues({ n: r.n, ingredientsText: r.ingredients_text }).filter((i) => KEYS[i.kind]);
  if (issues.length) plan.push({ r, issues });
}
const { data: open } = await supabase.from('product_data_issues').select('lookup_key').eq('status', 'open').like('reason', `${NEEDS_PHOTO_PREFIX}%`);
const flagged = new Set((open || []).map((x) => x.lookup_key));
console.log(`products with a false 0: ${plan.length} | already done earlier: ${Object.keys(progress).length}${APPLY ? '' : '  -- preview, nothing is saved'}`);

const csv = ['product,status,source,removed,score_before,score_after'];
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const tally = { sugar: 0, sodium: 0, fat: 0 };
let changed = 0, failed = 0;
for (const { r, issues } of plan) {
  const { data, error } = await supabase.from('product_reports').select('report').eq('id', r.id).single();
  if (error) { failed++; console.error(`${r.product_name}: ${error.message}`); continue; }
  const keys = issues.flatMap((i) => KEYS[i.kind].keys);
  const { report: next, rescored: re } = rescored(data.report, without(data.report.nutrientsPer100, keys), without(data.report.realNutrients, keys));
  for (const i of issues) tally[KEYS[i.kind].word]++;
  const removed = issues.map((i) => `${KEYS[i.kind].word} (list #${i.at}/${i.of}: ${i.word})`).join('; ');
  csv.push([r.product_name, r.review_status, r.source, removed, data.report.overallScore, re ? next.overallScore : `${data.report.overallScore} (kept)`].map(cell).join(','));
  if (next.overallScore !== data.report.overallScore) changed++;
  if (!APPLY) continue;

  fs.appendFileSync(BACKUP, `${JSON.stringify({ id: r.id, product: r.product_name, at: new Date().toISOString(), nutrientsPer100: data.report.nutrientsPer100 ?? null, realNutrients: data.report.realNutrients ?? null, overallScore: data.report.overallScore, verdict: data.report.verdict })}\n`);
  const { error: saveErr } = await supabase.from('product_reports').update({ report: next, updated_at: new Date().toISOString() }).eq('id', r.id);
  if (saveErr) { failed++; console.error(`${r.product_name}: ${saveErr.message}`); continue; }
  if (!flagged.has(r.lookup_key)) {
    const what = issues.map((i) => `0 ${KEYS[i.kind].unit} ${KEYS[i.kind].word} although "${i.word}" is ingredient #${i.at} of ${i.of}`).join('; ');
    await supabase.from('product_data_issues').insert({
      lookup_key: r.lookup_key, product_name: r.product_name, source: r.source,
      reason: `${NEEDS_PHOTO_PREFIX}: the table said ${what}. The 0 was removed (shown as not known); fill the real figure from the pack, then approve.`,
      score_at_detection: typeof next.overallScore === 'number' ? Math.round(next.overallScore) : null,
      verdict_at_detection: next.verdict || null,
    });
    flagged.add(r.lookup_key);
  }
  progress[r.id] = { product: r.product_name, removed, before: data.report.overallScore, after: next.overallScore };
  fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
}

const out = `../fix-zero-conflicts-${APPLY ? 'applied' : 'preview'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
fs.writeFileSync(out, `﻿${csv.join('\n')}\n`);
console.log(`false zeros: sugar ${tally.sugar}, sodium ${tally.sodium}, fat ${tally.fat} | score changes: ${changed} | failed: ${failed}`);
console.log(`CSV: ${out}`);
