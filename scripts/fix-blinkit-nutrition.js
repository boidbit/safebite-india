// scripts/fix-blinkit-nutrition.js
//
// Fixes Blinkit products whose saved nutrition is wrong, from the best source
// there is, one product at a time:
//
//  1. TEXT -- Blinkit's text as it is now (re-scraped since the report was made,
//     or fixed by the "added sugar > total sugar" rule in blinkitProductsRepo.js).
//     Used when it differs clearly from what's saved AND passes every
//     nutrition check. A report an admin edited keeps its figures unless they
//     are themselves impossible (Act II: 175 g fat per 100 g).
//  2. PHOTO -- for a table that's still wrong and whose pack photo was read by
//     recheck-blinkit-nutrition.js: the same photo is read a SECOND time, and
//     only when both reads agree and the result passes every check is it used.
//
// The score is redone only when redoing it with the OLD figures gives back the
// stored score exactly (same rule as backfill-pack-size-off.js); otherwise only
// the figures change and the score is left for a person.
//
// Saved as it goes: before a product changes, its old figures are appended to
// ../fix-blinkit-nutrition-backup.jsonl; after, the outcome goes into
// ../fix-blinkit-nutrition-progress.json. A stopped run (laptop off) loses
// nothing -- the next run skips what's done. Second photo reads are kept in
// ../fix-blinkit-photo-reads.json so they're never paid for twice.
//
//   node --env-file=.env scripts/fix-blinkit-nutrition.js            (preview: what would change, CSV)
//   node --env-file=.env scripts/fix-blinkit-nutrition.js --apply    (saves)
//   add --limit N to stop after N changes, --only text|photo for one source
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { extractNutrientsForHabitCheck, blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';
import { nutritionIssues } from '../src/services/dataHealth.js';
import { buildReport } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';
import { toServing } from '../src/services/nutrientBasis.js';
import { parsePack } from '../src/services/productFamilies.js';
import { readNutritionPhoto, per100FromPhoto } from '../src/services/nutritionPhotoRead.js';
import { fetchText, extractImageGallery, fetchImageBuffer, sleep } from '../src/services/blinkit.js';

const APPLY = process.argv.includes('--apply');
const limitAt = process.argv.indexOf('--limit');
const LIMIT = limitAt > -1 ? Number(process.argv[limitAt + 1]) : Infinity;
const onlyAt = process.argv.indexOf('--only');
const ONLY = onlyAt > -1 ? process.argv[onlyAt + 1] : null; // 'text' or 'photo'
if (APPLY && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }

const PROGRESS = '../fix-blinkit-nutrition-progress.json';
const BACKUP = '../fix-blinkit-nutrition-backup.jsonl';
const READS = '../fix-blinkit-photo-reads.json';
const RECHECK = '../blinkit-nutrition-recheck.json';
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const progress = readJson(PROGRESS, {});
const reads = readJson(READS, {});
const saveProgress = () => fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
const saveReads = () => fs.writeFileSync(READS, JSON.stringify(reads, null, 1));

async function all(build) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build().range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const near = (a, b, rel, abs) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);
/** Figures that clearly differ (10% and 0.3 apart): rounding isn't a reason to rewrite a report. */
function clearlyDifferent(saved, next) {
  const keys = new Set([...Object.keys(saved || {}), ...Object.keys(next || {})]);
  return [...keys].filter((k) => {
    const a = saved?.[k], b = next?.[k];
    if (typeof a !== 'number' && typeof b !== 'number') return false;
    if (typeof a !== 'number' || typeof b !== 'number') return true;
    return !near(a, b, 0.1, 0.3);
  });
}
/** Two photo reads of the same table agree on every figure both give (and give at least 3). */
function readsAgree(a, b) {
  const keys = Object.keys(a || {}).filter((k) => typeof b?.[k] === 'number');
  return keys.length >= 3 && keys.every((k) => near(a[k], b[k], 0.05, 0.15));
}
const passes = (n, text) => nutritionIssues({ n, ingredientsText: text }).length === 0;

// Same rule as backfill-pack-size-off.js: rescore only when the stored score can be rebuilt exactly.
function withFigures(report, info) {
  const run = (nutrientsInfo) => {
    const base = buildReport(report.ingredients || [], { productName: report.productName, brand: report.brand, imageUrl: report.imageUrl, packSize: report.packSize || undefined });
    const next = { ...report, overallScore: base.overallScore, verdict: base.verdict };
    if (nutrientsInfo) next.nutrientsPer100 = nutrientsInfo.nutrientsPer100;
    finalizeScore(next, { nutrientsInfo, packSize: report.packSize || undefined });
    return next;
  };
  const oldInfo = report.nutrientsPer100
    ? { nutrients: report.realNutrients || report.nutrientsPer100, nutrientsPer100: report.nutrientsPer100, servingGrams: report.realNutrientsServingGrams ?? null, servingUnit: report.realNutrientsServingUnit || 'g' }
    : undefined;
  const figures = { nutrientsPer100: info.nutrientsPer100, realNutrients: info.nutrients, realNutrientsServingGrams: info.servingGrams ?? null, realNutrientsServingUnit: info.servingUnit || 'g' };
  const canRescore = Array.isArray(report.ingredients) && report.ingredients.length > 0 && run(oldInfo).overallScore === report.overallScore;
  if (!canRescore) return { report: { ...report, ...figures }, rescored: false };
  return { report: { ...run(info), ...figures }, rescored: true };
}

// ---- what there is
const reports = await all(() => supabase.from('product_reports')
  .select('id, lookup_key, product_name, review_status, updated_at, ingredients_text, n:report->nutrientsPer100, servG:report->realNutrientsServingGrams, servU:report->realNutrientsServingUnit, packSize:report->>packSize')
  .eq('source', 'blinkit').neq('review_status', 'rejected').order('id'));
const scraped = await all(() => supabase.from('blinkit_products').select('source, brand, product_name, nutrition, serving_size, scraped_at').order('product_name'));
const textByKey = new Map(scraped.map((b) => [blinkitLookupKey(b.source, b.brand, b.product_name), b]));
const edited = new Set((await all(() => supabase.from('admin_activity_log').select('target_id').eq('action', 'update').eq('target_type', 'product').order('created_at'))).map((r) => r.target_id));
const recheck = new Map(readJson(RECHECK, []).map((x) => [x.product, x]));
const PHOTO_VERDICTS = new Set(['blinkit-text-wrong', 'blinkit-mixed-columns', 'blinkit-extra-figure']);

// ---- decide, one product at a time
const plan = [];
for (const r of reports) {
  if (progress[r.id]?.done) continue;
  const text = r.ingredients_text;
  const savedOk = r.n ? passes(r.n, text) : true;
  const row = textByKey.get(r.lookup_key);
  const info = row ? extractNutrientsForHabitCheck(row.nutrition, row.serving_size) : null;
  if (info?.nutrientsPer100 && r.n) {
    const diff = clearlyDifferent(r.n, info.nutrientsPer100);
    // Newer than the report, or the saved figures are impossible anyway: an older
    // text must never overwrite a newer report (Mother Dairy Cheese Slices).
    const textNewer = row.scraped_at && r.updated_at && new Date(row.scraped_at) > new Date(r.updated_at);
    if (diff.length && passes(info.nutrientsPer100, text) && (textNewer || !savedOk) && (!edited.has(r.id) || !savedOk)) {
      plan.push({ r, source: 'text', info, diff });
      continue;
    }
  }
  const prev = recheck.get(r.product_name);
  if (!savedOk && prev?.photo && PHOTO_VERDICTS.has(prev.verdict)) plan.push({ r, source: 'photo', prev });
}
console.log(`Blinkit reports: ${reports.length} | already done earlier: ${Object.values(progress).filter((p) => p.done).length}`);
console.log(`to look at: ${plan.length} (from Blinkit's current text: ${plan.filter((p) => p.source === 'text').length}, from the pack photo: ${plan.filter((p) => p.source === 'photo').length})${APPLY ? '' : '  -- preview, nothing is saved'}`);

const csv = ['product,status,source,outcome,score_before,score_after,figures_changed'];
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
let changed = 0;
const tally = {};
const fallbackAmount = (r) => r.servG || parsePack(r.packSize)?.size || parsePack(r.product_name)?.size || null;

for (const p of plan) {
  if (changed >= LIMIT) break;
  if (ONLY && p.source !== ONLY) continue;
  const { r } = p;
  let info = p.info;
  let outcome;

  if (p.source === 'photo') {
    // Second read of the same photo.
    let second = reads[r.product_name];
    if (!second) {
      const html = p.prev.url ? await fetchText(p.prev.url) : null;
      const url = html ? extractImageGallery(html)[p.prev.photo.photoNo - 1] : null;
      const buf = url ? await fetchImageBuffer(url) : null;
      try { second = buf ? await readNutritionPhoto(buf, r.product_name) : null; } catch { second = null; }
      // Only a real answer is kept: a read that failed (Gemini out of quota, page
      // not opening) is tried again on the next run, not remembered as a "no".
      if (second) { reads[r.product_name] = second; saveReads(); }
      await sleep(4200);
    }
    const one = per100FromPhoto(p.prev.photo, fallbackAmount(r)).table;
    const two = second ? per100FromPhoto(second, fallbackAmount(r)).table : null;
    if (!second) outcome = 'second-read-failed (try again later)';
    else if (!one || !two || !readsAgree(one, two)) outcome = 'photo-reads-disagree';
    else if (!passes(two, r.ingredients_text)) outcome = 'photo-table-still-fails';
    else {
      const per100 = Object.fromEntries(Object.entries(two).map(([k, v]) => [k, Math.round(v * 100) / 100]));
      info = { nutrientsPer100: per100, nutrients: r.servG ? toServing(per100, r.servG) : per100, servingGrams: r.servG ?? null, servingUnit: r.servU || 'g' };
      p.diff = clearlyDifferent(r.n, per100);
    }
  }

  if (!outcome) {
    // The whole report, read at the last moment, so nothing else is overwritten.
    const { data, error } = await supabase.from('product_reports').select('report').eq('id', r.id).single();
    if (error) { outcome = `read failed: ${error.message}`; }
    else {
      const { report: next, rescored } = withFigures(data.report, info);
      outcome = `fixed-${p.source}${rescored ? '' : ' (score kept: not rebuildable)'}`;
      if (APPLY) {
        fs.appendFileSync(BACKUP, `${JSON.stringify({ id: r.id, product: r.product_name, at: new Date().toISOString(), nutrientsPer100: data.report.nutrientsPer100 ?? null, realNutrients: data.report.realNutrients ?? null, realNutrientsServingGrams: data.report.realNutrientsServingGrams ?? null, overallScore: data.report.overallScore, verdict: data.report.verdict })}\n`);
        const { error: saveErr } = await supabase.from('product_reports').update({ report: next, updated_at: new Date().toISOString() }).eq('id', r.id);
        if (saveErr) outcome = `save failed: ${saveErr.message}`;
      }
      csv.push([r.product_name, r.review_status, p.source, outcome, data.report.overallScore, next.overallScore, (p.diff || []).join(' ')].map(cell).join(','));
      if (!outcome.startsWith('save failed')) changed++;
    }
  }
  if (!outcome.startsWith('fixed')) csv.push([r.product_name, r.review_status, p.source, outcome, '', '', ''].map(cell).join(','));
  tally[outcome.replace(/ \(.*/, '')] = (tally[outcome.replace(/ \(.*/, '')] || 0) + 1;
  // Only a saved fix, or a photo that can't help, is final; anything else is tried again next run.
  if (APPLY && (outcome.startsWith('fixed') || outcome.startsWith('photo-'))) {
    progress[r.id] = { done: true, product: r.product_name, outcome, at: new Date().toISOString() };
    saveProgress();
  }
  console.log(`  ${outcome.padEnd(46)} ${r.product_name.slice(0, 60)}`);
}

const out = `../fix-blinkit-nutrition-${APPLY ? 'applied' : 'preview'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
fs.writeFileSync(out, `﻿${csv.join('\n')}\n`);
console.log('\nsummary:', JSON.stringify(tally));
console.log(`CSV: ${out}${APPLY ? `\nBackup: ${BACKUP}  |  progress: ${PROGRESS}` : ''}`);
