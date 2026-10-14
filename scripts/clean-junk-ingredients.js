// scripts/clean-junk-ingredients.js
//
// Type A cleanup: take typo / OCR-leftover ingredients ("ii", "burm", "quot",
// "hide") off saved product reports and re-score them -- but ONLY for products
// where every junk ingredient carries penalty 0. A junk entry that carries a
// penalty ("Sod 30", "E-mail Milk 40") is a garbled REAL ingredient; dropping
// it would just inflate the score, so those are left for a re-read of the label.
//
// Per product: re-score the list untouched first ("baseline"); if that doesn't
// reproduce the stored score (hand-set score, older formula) the product is
// skipped. Same steps as the admin form's "Recalculate score" (buildReport +
// finalizeScore); the AI-written summary and recommendation are kept.
// Products come from ../typo-ingredients-products.csv (rejected ones skipped).
//
//   node --env-file=.env scripts/clean-junk-ingredients.js            (preview, writes a CSV)
//   node --env-file=.env scripts/clean-junk-ingredients.js --apply     (saves; JSONL backup first)
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { buildReport, isRuleBasedRecommendation } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';
import { isJunkIngredient } from '../src/services/typoIngredient.js';

const apply = process.argv.includes('--apply');
if (apply && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }

function csvRows(path) {
  const s = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const rows = []; let cur = [], f = '', q = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === '"') { if (s[k + 1] === '"') { f += '"'; k++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cur.push(f); f = ''; }
    else if (c === '\n') { cur.push(f.trim()); rows.push(cur); cur = []; f = ''; }
    else f += c;
  }
  if (f || cur.length) { cur.push(f.trim()); rows.push(cur); }
  rows.shift();
  return rows;
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function rescore(report, ingredients) {
  const pack = report.packSize || null;
  const next = { ...report, ...buildReport(ingredients, { productName: report.productName, brand: report.brand || null, imageUrl: report.imageUrl || null, packSize: pack }) };
  const nutrientsInfo = report.nutrientsPer100
    ? { nutrients: report.nutrients || report.nutrientsPer100, nutrientsPer100: report.nutrientsPer100, servingGrams: report.realNutrientsServingGrams ?? null, servingUnit: report.realNutrientsServingUnit || 'g' }
    : undefined;
  finalizeScore(next, { nutrientsInfo, packSize: pack || undefined });
  // Keep the prose that already names this product's ingredients.
  next.summary = report.summary;
  if (!isRuleBasedRecommendation(report.recommendation)) next.recommendation = report.recommendation;
  return next;
}

const names = [...new Set(csvRows('../typo-ingredients-products.csv').filter((r) => r[1] !== 'rejected').map((r) => r[0]))];
const rows = [];
for (let i = 0; i < names.length; i += 40) {
  const { data, error } = await supabase.from('product_reports').select('id, product_name, review_status, report').in('product_name', names.slice(i, i + 40));
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...data.filter((d) => d.review_status !== 'rejected'));
}
console.log(`loaded ${rows.length} reports`);

const plan = []; const skipped = { noJunk: 0, penalty: 0, allJunk: 0, baseline: 0, same: 0 };
for (const row of rows) {
  const stored = row.report?.ingredients || [];
  const junk = stored.filter(isJunkIngredient);
  if (!junk.length) { skipped.noJunk++; continue; }
  if (junk.some((j) => (j.penalty || 0) > 0)) { skipped.penalty++; continue; }
  const kept = stored.filter((i) => !isJunkIngredient(i));
  if (!kept.length) { skipped.allJunk++; continue; }
  if (rescore(row.report, stored).overallScore !== row.report.overallScore) { skipped.baseline++; continue; }
  const next = rescore(row.report, kept);
  plan.push({ row, junk, kept: kept.length, next });
}
console.log(`to clean: ${plan.length} | skipped:`, skipped);

const moved = plan.filter((p) => p.next.overallScore !== p.row.report.overallScore);
const lines = ['Product,Review status,Old score,New score,Old verdict,New verdict,Junk removed,Ingredients left'];
for (const p of [...plan].sort((a, b) => Math.abs(b.next.overallScore - b.row.report.overallScore) - Math.abs(a.next.overallScore - a.row.report.overallScore))) {
  lines.push([p.row.product_name, p.row.review_status, p.row.report.overallScore, p.next.overallScore, p.row.report.verdict, p.next.verdict, p.junk.map((j) => j.name).join('; '), p.kept].map(csvCell).join(','));
}
fs.writeFileSync('../junk-cleanup-A-preview.csv', '\uFEFF' + lines.join('\r\n'));
console.log(`score changes: ${moved.length} (up ${moved.filter((p) => p.next.overallScore > p.row.report.overallScore).length}, down ${moved.filter((p) => p.next.overallScore < p.row.report.overallScore).length}) -> ../junk-cleanup-A-preview.csv`);

if (!apply) { console.log('preview only -- nothing saved. Add --apply to save.'); process.exit(0); }
const backup = `../junk-cleanup-A-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
fs.writeFileSync(backup, plan.map((p) => JSON.stringify({ id: p.row.id, report: p.row.report })).join('\n') + '\n');
console.log('backup written:', backup);
let saved = 0;
for (const p of plan) {
  const { error } = await supabase.from('product_reports').update({ report: p.next, updated_at: new Date().toISOString() }).eq('id', p.row.id);
  if (error) console.warn(`could not save ${p.row.product_name}: ${error.message}`); else saved++;
}
console.log(`saved ${saved} of ${plan.length}`);
