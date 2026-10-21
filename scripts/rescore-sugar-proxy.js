// scripts/rescore-sugar-proxy.js
//
// Rescores the products the sugar proxy now applies to (sugarProxy.js: a
// sugar-led product -- jaggery, honey, khandsari -- whose label gives
// carbohydrate but no sugar). Same safety rule as the other fix scripts: the
// new score is saved only when the stored score can be rebuilt exactly
// WITHOUT the proxy, so nothing else that went into the score is lost.
// Backup and progress after each product.
//
//   node --env-file=.env scripts/rescore-sugar-proxy.js            (preview)
//   node --env-file=.env scripts/rescore-sugar-proxy.js --apply
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { buildReport } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';
import { sugarFromCarbs } from '../src/services/sugarProxy.js';

const APPLY = process.argv.includes('--apply');
if (APPLY && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }
const PROGRESS = '../rescore-sugar-proxy-progress.json';
const BACKUP = '../rescore-sugar-proxy-backup.jsonl';
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

function run(report) {
  const base = buildReport(report.ingredients || [], { productName: report.productName, brand: report.brand, imageUrl: report.imageUrl, packSize: report.packSize || undefined });
  const next = { ...report, overallScore: base.overallScore, verdict: base.verdict };
  const p = report.nutrientsPer100;
  finalizeScore(next, { nutrientsInfo: p ? { nutrients: report.realNutrients || p, nutrientsPer100: p, servingGrams: report.realNutrientsServingGrams ?? null, servingUnit: report.realNutrientsServingUnit || 'g' } : undefined, packSize: report.packSize || undefined });
  return next;
}

// Candidates from slim fields; the full report only for them.
const rows = await all(() => supabase.from('product_reports')
  .select('id, product_name, review_status, n:report->nutrientsPer100, first:report->ingredients->0->>name')
  .neq('review_status', 'rejected').order('id'));
const candidates = rows.filter((r) => !progress[r.id] && sugarFromCarbs({ nutrientsPer100: r.n, ingredients: [{ name: r.first }] }) !== null);
console.log(`products the sugar proxy applies to: ${candidates.length}${APPLY ? '' : '  -- preview, nothing is saved'}`);

for (const r of candidates) {
  const { data, error } = await supabase.from('product_reports').select('report').eq('id', r.id).single();
  if (error) { console.error(`${r.product_name}: ${error.message}`); continue; }
  const report = data.report;
  // Rebuild without the proxy (main ingredient hidden from it) -- must give the stored score.
  const without = run({ ...report, ingredients: [{ ...report.ingredients[0], name: '-' }, ...report.ingredients.slice(1)] });
  const rebuilt = without.overallScore === report.overallScore;
  const next = run(report);
  console.log(`  ${String(report.overallScore).padStart(3)} -> ${rebuilt ? String(next.overallScore).padStart(3) : '  (kept: not rebuildable)'}  ${r.product_name.slice(0, 50)}  [carbs ${next.sugarCountedFromCarbs} g, main "${report.ingredients[0]?.name}"]`);
  if (!APPLY || !rebuilt) continue;
  fs.appendFileSync(BACKUP, `${JSON.stringify({ id: r.id, product: r.product_name, at: new Date().toISOString(), overallScore: report.overallScore, verdict: report.verdict })}\n`);
  const { error: saveErr } = await supabase.from('product_reports').update({ report: next, updated_at: new Date().toISOString() }).eq('id', r.id);
  if (saveErr) { console.error(`${r.product_name}: ${saveErr.message}`); continue; }
  progress[r.id] = { product: r.product_name, before: report.overallScore, after: next.overallScore };
  fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
}
