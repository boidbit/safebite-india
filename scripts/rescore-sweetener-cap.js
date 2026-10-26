// scripts/rescore-sweetener-cap.js
//
// Rescores products that were held at the "Moderate" cap (64) by a flagged
// artificial sweetener (sucralose, aspartame, ...) -- scoringEngine.js no
// longer lets a sweetener force that cap on its own. Same safety rule as the
// other rescore scripts: the new score is saved only when the stored score
// can be rebuilt exactly under the OLD rule (sweeteners hidden from the
// exemption), so nothing else that went into the score is lost. Backup first,
// progress after each product. The ingredient's own status stays "concerning".
//
//   node --env-file=.env scripts/rescore-sweetener-cap.js            (preview)
//   node --env-file=.env scripts/rescore-sweetener-cap.js --apply
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { buildReport, isArtificialSweetener, isRuleBasedRecommendation } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';

const APPLY = process.argv.includes('--apply');
if (APPLY && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }
const PROGRESS = '../rescore-sweetener-cap-progress.json';
const BACKUP = '../rescore-sweetener-cap-backup.jsonl';
const progress = (() => { try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return {}; } })();

async function all(build, page = 200) {
  const out = [];
  for (let f = 0; ; f += page) {
    const { data, error } = await build().range(f, f + page - 1);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < page) return out;
  }
}

function run(report) {
  const base = buildReport(report.ingredients || [], { productName: report.productName, brand: report.brand, imageUrl: report.imageUrl, packSize: report.packSize || undefined });
  const next = { ...report, overallScore: base.overallScore, verdict: base.verdict };
  const p = report.nutrientsPer100;
  finalizeScore(next, { nutrientsInfo: p ? { nutrients: report.realNutrients || p, nutrientsPer100: p, servingGrams: report.realNutrientsServingGrams ?? null, servingUnit: report.realNutrientsServingUnit || 'g' } : undefined, packSize: report.packSize || undefined });
  return { next, base };
}

const flaggedSweetener = (i) => i.status === 'concerning' && isArtificialSweetener(i);

// Old rule = sweeteners get no exemption: hide their name/INS from the matcher.
const asOldRule = (ingredients) => ingredients.map((i) => (flaggedSweetener(i) ? { ...i, name: '-', insCode: null } : i));

// Slim read first (score + ingredient names/status), full report only for candidates.
const rows = await all(() => supabase.from('product_reports')
  .select('id, product_name, review_status, score:report->overallScore, ings:report->ingredients')
  .neq('review_status', 'rejected').order('id'));
const candidates = rows.filter((r) => !progress[r.id] && Array.isArray(r.ings) && r.ings.some(flaggedSweetener));
console.log(`products with a flagged artificial sweetener: ${candidates.length}${APPLY ? '' : '  -- preview, nothing is saved'}`);

let changed = 0; let kept = 0; let unchanged = 0;
for (const r of candidates) {
  const { data, error } = await supabase.from('product_reports').select('report').eq('id', r.id).single();
  if (error) { console.error(`${r.product_name}: ${error.message}`); continue; }
  const report = data.report;
  const old = run({ ...report, ingredients: asOldRule(report.ingredients) }).next;
  const rebuilt = old.overallScore === report.overallScore;
  const { next, base } = run(report);
  const names = report.ingredients.filter(flaggedSweetener).map((i) => i.name).join(', ');
  if (rebuilt && next.overallScore === report.overallScore) { unchanged++; continue; }
  console.log(`  ${String(report.overallScore).padStart(3)} -> ${rebuilt ? String(next.overallScore).padStart(3) : '  (kept: not rebuildable)'}  ${report.verdict} -> ${rebuilt ? next.verdict : '-'}  ${r.product_name.slice(0, 50)}  [${names}]`);
  if (!rebuilt) { kept++; continue; }
  changed++;
  if (!APPLY) continue;
  // Only refresh the recommendation when it's still the generic score-band line.
  if (isRuleBasedRecommendation(report.recommendation)) next.recommendation = base.recommendation;
  fs.appendFileSync(BACKUP, `${JSON.stringify({ id: r.id, product: r.product_name, at: new Date().toISOString(), overallScore: report.overallScore, verdict: report.verdict, recommendation: report.recommendation })}\n`);
  const { error: saveErr } = await supabase.from('product_reports').update({ report: next, updated_at: new Date().toISOString() }).eq('id', r.id);
  if (saveErr) { console.error(`${r.product_name}: ${saveErr.message}`); continue; }
  progress[r.id] = { product: r.product_name, before: report.overallScore, after: next.overallScore };
  fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
}
console.log(`\n${changed} to change, ${unchanged} unaffected (score same either way), ${kept} left alone (stored score can't be rebuilt exactly)${APPLY ? '' : ' -- preview only, nothing written'}.`);
