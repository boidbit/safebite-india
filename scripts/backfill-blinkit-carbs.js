// scripts/backfill-blinkit-carbs.js
//
// Blinkit labels carbohydrates "Total Carbohydrates"; the parser only knew
// "Total Carbohydrate", so no Blinkit report ever got a carbohydrate figure even
// though ~6,000 scraped rows have one. extractNutrientsForHabitCheck now reads it;
// this fills it into the reports that already exist.
//
// Same maths as a fresh report (blinkitProductsRepo.js): Blinkit's table is per
// 100 g/ml, so nutrientsPer100.carbohydrateG is the figure as printed and
// realNutrients.carbohydrateG is it scaled to the report's serving.
// Carbohydrates are shown in the Nutrition section only -- not used by the
// score -- so no score changes.
//
// Only a report whose other per-100 figures still equal Blinkit's text is
// filled. One that differs (edited by an admin since, or converted wrongly) is
// listed for a person instead: adding a carb figure from the text to a table that
// no longer is the text could mix two sources.
//
//   node --env-file=.env scripts/backfill-blinkit-carbs.js            (preview, writes a CSV)
//   node --env-file=.env scripts/backfill-blinkit-carbs.js --apply    (saves; JSONL backup first)
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { extractNutrientsForHabitCheck, blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';

const APPLY = process.argv.includes('--apply');
if (APPLY && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function all(build) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build().range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const close = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.02);

/** Every per-100 figure the report and the text both have is the same (carbs aside). */
function sameAsText(saved, fromText) {
  const keys = Object.keys(fromText).filter((k) => k !== 'carbohydrateG' && typeof saved?.[k] === 'number');
  if (keys.length < 2) return { ok: false, why: 'too few figures to compare' };
  const off = keys.filter((k) => !close(saved[k], fromText[k]));
  return off.length ? { ok: false, why: off.map((k) => `${k} saved ${saved[k]} vs text ${fromText[k]}`).join('; ') } : { ok: true };
}

const scraped = (await all(() => supabase.from('blinkit_products').select('source, brand, product_name, nutrition').order('product_name')))
  .filter((b) => b.nutrition?.['Total Carbohydrates']);
const textByKey = new Map(scraped.map((b) => [blinkitLookupKey(b.source, b.brand, b.product_name), b]));
const reports = await all(() => supabase.from('product_reports')
  .select('id, lookup_key, product_name, n:report->nutrientsPer100')
  .eq('source', 'blinkit').order('id'));

const plan = [];
const skipped = [];
let alreadyHas = 0;
let noText = 0;
for (const r of reports) {
  const row = textByKey.get(r.lookup_key);
  if (!row) { noText++; continue; }
  if (typeof r.n?.carbohydrateG === 'number') { alreadyHas++; continue; }
  const fromText = extractNutrientsForHabitCheck(row.nutrition, null)?.nutrientsPer100;
  const carb = fromText?.carbohydrateG;
  if (typeof carb !== 'number') { skipped.push({ r, why: 'carbohydrate text not readable' }); continue; }
  const check = sameAsText(r.n, fromText);
  if (!check.ok) { skipped.push({ r, why: check.why, carb }); continue; }
  plan.push({ id: r.id, name: r.product_name, carb });
}

console.log(`Blinkit reports: ${reports.length} | scraped text has carbs: ${scraped.length}`);
console.log(`  will fill: ${plan.length} | skipped for a person: ${skipped.length} | already have carbs: ${alreadyHas} | no matching scraped row: ${noText}`);
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync(`../blinkit-carbs-skipped-${stamp}.csv`, `﻿${['product,carb_in_text,why_skipped', ...skipped.map((s) => [s.r.product_name, s.carb ?? '', s.why].map(csvCell).join(','))].join('\n')}\n`);
console.log(`  skipped list: ../blinkit-carbs-skipped-${stamp}.csv`);
console.log('  e.g.', plan.slice(0, 3).map((p) => `${p.name} -> ${p.carb} g`).join(' ; '));
if (!APPLY) { console.log('\nPreview only. Run with --apply to save.'); process.exit(0); }

const backup = `../blinkit-carbs-backup-${stamp}.jsonl`;
let done = 0;
let failed = 0;
for (const p of plan) {
  // The whole report, read at the last moment, so nothing else is overwritten.
  const { data, error } = await supabase.from('product_reports').select('report').eq('id', p.id).single();
  if (error) { failed++; console.error(`${p.name}: ${error.message}`); continue; }
  const report = data.report;
  fs.appendFileSync(backup, `${JSON.stringify({ id: p.id, nutrientsPer100: report.nutrientsPer100, realNutrients: report.realNutrients ?? null })}\n`);
  const next = { ...report, nutrientsPer100: { ...report.nutrientsPer100, carbohydrateG: p.carb } };
  if (report.realNutrients && typeof report.realNutrientsServingGrams === 'number' && report.realNutrientsServingGrams > 0) {
    next.realNutrients = { ...report.realNutrients, carbohydrateG: round2(p.carb * report.realNutrientsServingGrams / 100) };
  } else if (report.realNutrients) {
    next.realNutrients = { ...report.realNutrients, carbohydrateG: p.carb };
  }
  const { error: saveErr } = await supabase.from('product_reports').update({ report: next }).eq('id', p.id);
  if (saveErr) { failed++; console.error(`${p.name}: ${saveErr.message}`); continue; }
  done++;
  if (done % 500 === 0) console.log(`  ${done} / ${plan.length}`);
}
console.log(`\nFilled ${done}, failed ${failed}. Backup of the old figures: ${backup}`);
