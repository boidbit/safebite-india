// scripts/fix-junk-reports.js
//
// Type B cleanup: saved reports where a typo / OCR-leftover ingredient carries a
// penalty ("Red 15", "E-mail Milk 40", "Fr 10") -- usually a fragment the old
// parser split off a real ingredient ("Beetroot Red", "White & Black Sesame").
// Re-runs the CURRENT pipeline on the product's own saved label text (parse ->
// resolve against the ingredient library -> score), exactly as a fresh scan does,
// so the report is rebuilt from the label instead of having ingredients deleted.
// No Gemini call except for ingredients the library has never seen.
//
// Kept from the old report: summary, recommendation (when AI-written), nutrition,
// photo, pack size, brand and every other field. Replaced: ingredients, score,
// verdict, flags, positives.
//
// A product is only changed when the rebuilt list has NO junk left at all; the
// rest are listed for hand-checking.
//
//   node --env-file=.env scripts/fix-junk-reports.js            (preview, writes a CSV)
//   node --env-file=.env scripts/fix-junk-reports.js --apply    (saves; JSONL backup first)
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { parseLabel } from '../src/services/ingredientParser.js';
import { estimateQuantities } from '../src/services/quantityEstimator.js';
import { resolveIngredients } from '../src/services/ingredientLibrary.js';
import { buildReport, isRuleBasedRecommendation } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';
import { isJunkIngredient } from '../src/services/typoIngredient.js';

const apply = process.argv.includes('--apply');
if (apply && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

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
const penaltyJunk = (list) => list.filter((i) => isJunkIngredient(i) && (i.penalty || 0) > 0);

const names = [...new Set(csvRows('../typo-ingredients-products.csv').filter((r) => r[1] !== 'rejected').map((r) => r[0]))];
const rows = [];
for (let i = 0; i < names.length; i += 40) {
  const { data, error } = await supabase.from('product_reports').select('id, product_name, review_status, ingredients_text, report').in('product_name', names.slice(i, i + 40));
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...data.filter((d) => d.review_status !== 'rejected'));
}
const todo = rows.filter((r) => penaltyJunk(r.report?.ingredients || []).length && (r.report.ingredients.length > (r.report.ingredients || []).filter(isJunkIngredient).length) && r.ingredients_text).slice(0, limit);
console.log(`${todo.length} reports with a junk ingredient that carries a penalty`);

const results = [];
for (const row of todo) {
  const old = row.report;
  const out = { row, status: '', next: null, junkLeft: [] };
  try {
    const { ingredients: parsed } = parseLabel(row.ingredients_text);
    if (!parsed.length) { out.status = 'label text gives no ingredients'; results.push(out); continue; }
    const { ingredients } = await resolveIngredients(estimateQuantities(parsed));
    if (!ingredients.length) { out.status = 'could not resolve'; results.push(out); continue; }
    const pack = old.packSize || null;
    const next = { ...old, ...buildReport(ingredients, { productName: old.productName, brand: old.brand || null, imageUrl: old.imageUrl || null, packSize: pack }) };
    const nutrientsInfo = old.nutrientsPer100
      ? { nutrients: old.nutrients || old.nutrientsPer100, nutrientsPer100: old.nutrientsPer100, servingGrams: old.realNutrientsServingGrams ?? null, servingUnit: old.realNutrientsServingUnit || 'g' }
      : undefined;
    finalizeScore(next, { nutrientsInfo, packSize: pack || undefined });
    next.summary = old.summary;
    if (!isRuleBasedRecommendation(old.recommendation)) next.recommendation = old.recommendation;
    out.next = next;
    out.junkLeft = next.ingredients.filter(isJunkIngredient); // neutralized junk still counts: it is still junk
    out.status = out.junkLeft.length ? 'still has junk -- check by hand' : 'fixed';
  } catch (e) { out.status = `error: ${e.message}`; }
  results.push(out);
}

const fixed = results.filter((r) => r.status === 'fixed');
const lines = ['Product,Review status,Result,Old score,New score,Old ingredients,New ingredients,Junk before (penalty),Junk still there'];
for (const r of results) {
  const o = r.row.report;
  lines.push([r.row.product_name, r.row.review_status, r.status, o.overallScore, r.next?.overallScore ?? '', o.ingredients.length, r.next?.ingredients.length ?? '',
    penaltyJunk(o.ingredients).map((j) => `${j.name} (${j.penalty})`).join('; '), r.junkLeft.map((j) => j.name).join('; ')].map(csvCell).join(','));
}
fs.writeFileSync('../junk-fix-B-preview.csv', '\uFEFF' + lines.join('\r\n'));
const by = results.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
console.log(by);
const d = fixed.map((r) => r.next.overallScore - r.row.report.overallScore);
console.log(`fixed: ${fixed.length} | score up ${d.filter((x) => x > 0).length}, down ${d.filter((x) => x < 0).length}, same ${d.filter((x) => x === 0).length} | -> ../junk-fix-B-preview.csv`);
if (!apply) { console.log('preview only -- nothing saved. Add --apply to save.'); process.exit(0); }

const backup = `../junk-fix-B-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
fs.writeFileSync(backup, fixed.map((r) => JSON.stringify({ id: r.row.id, report: r.row.report })).join('\n') + '\n');
console.log('backup written:', backup);
let saved = 0;
for (const r of fixed) {
  const { error } = await supabase.from('product_reports').update({ report: r.next, updated_at: new Date().toISOString() }).eq('id', r.row.id);
  if (error) console.warn(`could not save ${r.row.product_name}: ${error.message}`); else saved++;
}
console.log(`saved ${saved} of ${fixed.length}`);
