// scripts/fix-food-type.js
//
// Gives a food type to the products that have none (report.foodType missing or
// 'other'), using the keyword rules in src/services/foodType.js, and applies the
// fried / dense-snack score ceiling that depends on it (nutritionDensity.js) --
// the same per-product change scripts/backfill-food-type.js makes, but:
//   - only for products WITHOUT a type: a type Gemini or an admin gave is never
//     replaced by a keyword guess;
//   - one product at a time, saved as it goes: the old report is appended to
//     ../fix-food-type-backup.jsonl before it changes and the outcome to
//     ../fix-food-type-progress.json after, so a stopped run (laptop off)
//     resumes where it left off;
//   - reads only the slim fields to decide, and the full report only for the
//     products that change.
// Where the type comes from, first that answers: the product's name (+ its
// ingredients for frying), Blinkit's own shelf for it (blinkit_products.category),
// then the kind the AI summary names ("This chocolate bar is…"). Products none of
// these can place stay 'other' (left for a person).
//
//   node --env-file=.env scripts/fix-food-type.js            (preview: CSV of what would change)
//   node --env-file=.env scripts/fix-food-type.js --apply    (saves)
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { classifyFoodType, kindFromSummary } from '../src/services/foodType.js';
import { foodTypeForBlinkitCategory } from '../src/data/blinkitCategoryFoodType.js';
import { blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';
import { applyNutritionDensityCeiling } from '../src/services/nutritionDensity.js';

const APPLY = process.argv.includes('--apply');
if (APPLY && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }
const PROGRESS = '../fix-food-type-progress.json';
const BACKUP = '../fix-food-type-backup.jsonl';
const progress = (() => { try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return {}; } })();

async function all(build) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build().range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// Same steps as backfill-food-type.js reclassify(), with the type already decided.
function withType(report, { foodType, isDeepFried }) {
  const next = { ...report };
  if (typeof next.overallScoreBeforeDensity === 'number') next.overallScore = next.overallScoreBeforeDensity;
  delete next.overallScoreBeforeDensity;
  delete next.nutritionDensity;
  delete next.scoreNote;
  next.foodType = foodType;
  next.isDeepFried = isDeepFried;
  const beforeVerdict = next.verdict;
  applyNutritionDensityCeiling(next);
  if (typeof next.overallScoreBeforeDensity !== 'number') next.verdict = beforeVerdict === report.verdict ? report.verdict : beforeVerdict;
  return next;
}

const rows = await all(() => supabase.from('product_reports')
  .select('id, lookup_key, product_name, review_status, ingredients_text, ft:report->>foodType, fts:report->>foodTypeSource, infant:report->>isInfantFormula, summary:report->>summary')
  .neq('review_status', 'rejected').order('id'));
const untyped = rows.filter((r) => (!r.ft || r.ft === 'other') && r.fts !== 'admin' && r.infant !== 'true');
const shelves = await all(() => supabase.from('blinkit_products').select('source, brand, product_name, category').order('product_name'));
const shelfByKey = new Map(shelves.map((b) => [blinkitLookupKey(b.source, b.brand, b.product_name), b.category]));

/** { foodType, isDeepFried, from } -- or null when nothing places it. */
function decide(r) {
  const c = classifyFoodType({ productName: r.product_name, ingredientNames: String(r.ingredients_text || '').split(',').map((x) => x.trim()) });
  if (c.foodType !== 'other') return { ...c, from: 'name' };
  const shelf = foodTypeForBlinkitCategory(shelfByKey.get(r.lookup_key));
  if (shelf) return { foodType: shelf, isDeepFried: shelf === 'fried-snack', from: `blinkit shelf ${shelfByKey.get(r.lookup_key)}` };
  const kind = kindFromSummary(r.summary);
  const k = kind ? classifyFoodType({ productName: kind }) : null;
  if (k && k.foodType !== 'other') return { ...k, from: `summary "${kind}"` };
  return null;
}

const plan = [];
for (const r of untyped) {
  if (progress[r.id]) continue;
  const c = decide(r);
  if (c) plan.push({ r, c });
}
console.log(`products without a food type: ${untyped.length} | already done earlier: ${Object.keys(progress).length} | the rules can place now: ${plan.length}${APPLY ? '' : '  -- preview, nothing is saved'}`);

const csv = ['product,status,food_type,from,deep_fried,score_before,score_after'];
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const types = {};
let scoreChanged = 0, failed = 0;
for (const [i, { r, c }] of plan.entries()) {
  const { data, error } = await supabase.from('product_reports').select('report').eq('id', r.id).single();
  if (error) { failed++; console.error(`${r.product_name}: ${error.message}`); continue; }
  const next = withType(data.report, c);
  types[c.foodType] = (types[c.foodType] || 0) + 1;
  if (next.overallScore !== data.report.overallScore) scoreChanged++;
  csv.push([r.product_name, r.review_status, c.foodType, c.from, c.isDeepFried, data.report.overallScore, next.overallScore].map(cell).join(','));
  if (APPLY) {
    fs.appendFileSync(BACKUP, `${JSON.stringify({ id: r.id, product: r.product_name, at: new Date().toISOString(), report: data.report })}\n`);
    const { error: saveErr } = await supabase.from('product_reports').update({ report: next, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (saveErr) { failed++; console.error(`${r.product_name}: ${saveErr.message}`); continue; }
    progress[r.id] = { product: r.product_name, foodType: c.foodType, from: c.from, before: data.report.overallScore, after: next.overallScore };
    fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
  }
  if ((i + 1) % 200 === 0) console.log(`  ${i + 1} / ${plan.length}`);
}

const out = `../fix-food-type-${APPLY ? 'applied' : 'preview'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
fs.writeFileSync(out, `﻿${csv.join('\n')}\n`);
console.log(`\n${APPLY ? 'saved' : 'would set'}: ${JSON.stringify(types)}`);
console.log(`score changes: ${scoreChanged} | failed: ${failed}`);
console.log(`CSV: ${out}${APPLY ? `\nBackup: ${BACKUP} | progress: ${PROGRESS}` : ''}`);
