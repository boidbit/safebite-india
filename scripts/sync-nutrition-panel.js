// scripts/sync-nutrition-panel.js
//
// A report keeps its nutrition twice: report.nutritionPanel (what the admin form
// shows and saves, admin key names) and report.nutrientsPer100 (what the app
// shows and scores). Two things let them drift apart:
//   - the admin form saved the panel but only wrote nutrientsPer100 after
//     "Recalculate" (fixed in AdminProductForm.jsx) -- the panel is newer;
//   - the fix scripts (fix-blinkit-nutrition.js, fix-zero-conflicts.js) corrected
//     nutrientsPer100 and left the panel as it was -- nutrientsPer100 is newer.
// For each report where they differ, the newer side wins: the admin's last edit
// (activity log) against the fix scripts' backups. When nutrientsPer100 changes
// the score is redone the safe way (only when the old score can be rebuilt).
// Backup and progress after each product.
//
//   node --env-file=.env scripts/sync-nutrition-panel.js            (preview)
//   node --env-file=.env scripts/sync-nutrition-panel.js --apply
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { panelToReportKeys, toServing } from '../src/services/nutrientBasis.js';
import { buildReport } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';

const APPLY = process.argv.includes('--apply');
if (APPLY && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }
const PROGRESS = '../sync-nutrition-panel-progress.json';
const BACKUP = '../sync-nutrition-panel-backup.jsonl';
const progress = (() => { try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return {}; } })();

// report key -> admin panel key (the reverse of nutrientBasis.js ADMIN_TO_REPORT_KEY)
const TO_PANEL = { sodiumMg: 'sodiumMg', addedSugarG: 'addedSugarG', totalSugarG: 'totalSugarG', saturatedFatG: 'saturatedFatG', transFatG: 'transFatG', caloriesKcal: 'energyKcal', proteinG: 'proteinG', carbohydrateG: 'totalCarbG', totalFatG: 'totalFatG', fibreG: 'fiberG' };
const near = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.02);

async function all(build) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build().range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

/** Panel keys whose figure the app doesn't show the same way. */
function differences(panel, per100) {
  const p = panelToReportKeys(panel) || {};
  return Object.keys(p).filter((k) => !(typeof per100?.[k] === 'number' && near(per100[k], p[k])));
}

// The admin form's own rule (buildNutrientsInfo): a total sugar with no added figure stands in as added.
function per100FromPanel(panel, current) {
  const p = panelToReportKeys(panel) || {};
  const out = { ...(current || {}) };
  for (const k of Object.keys(TO_PANEL)) delete out[k];
  Object.assign(out, p);
  if (out.addedSugarG === undefined && out.totalSugarG !== undefined) { out.addedSugarG = out.totalSugarG; delete out.totalSugarG; }
  return out;
}

function panelFromPer100(per100, panel) {
  const out = { ...(panel || {}) };
  for (const adminKey of Object.values(TO_PANEL)) delete out[adminKey];
  for (const [k, adminKey] of Object.entries(TO_PANEL)) if (typeof per100?.[k] === 'number') out[adminKey] = per100[k];
  return Object.keys(out).length ? out : null;
}

function rescored(report, per100) {
  const run = (p) => {
    const base = buildReport(report.ingredients || [], { productName: report.productName, brand: report.brand, imageUrl: report.imageUrl, packSize: report.packSize || undefined });
    const next = { ...report, overallScore: base.overallScore, verdict: base.verdict, nutrientsPer100: p };
    const serving = report.realNutrientsServingGrams ?? null;
    finalizeScore(next, { nutrientsInfo: { nutrients: serving ? toServing(p, serving) : p, nutrientsPer100: p, servingGrams: serving, servingUnit: report.realNutrientsServingUnit || 'g' }, packSize: report.packSize || undefined });
    return next;
  };
  const serving = report.realNutrientsServingGrams ?? null;
  const figures = { nutrientsPer100: per100, realNutrients: serving ? toServing(per100, serving) : per100 };
  const ok = Array.isArray(report.ingredients) && report.ingredients.length && report.nutrientsPer100 && run(report.nutrientsPer100).overallScore === report.overallScore;
  return ok ? { report: { ...run(per100), ...figures }, rescored: true } : { report: { ...report, ...figures }, rescored: false };
}

// When each side last changed.
const scriptAt = new Map();
for (const f of ['../fix-blinkit-nutrition-backup.jsonl', '../fix-zero-conflicts-backup.jsonl']) {
  for (const b of readJsonl(f)) if (b.at && (!scriptAt.has(b.id) || b.at > scriptAt.get(b.id))) scriptAt.set(b.id, b.at);
}
const rows = (await all(() => supabase.from('product_reports').select('id, product_name, review_status, n:report->nutrientsPer100, panel:report->nutritionPanel').neq('review_status', 'rejected').order('id')))
  .filter((r) => r.panel && !progress[r.id] && differences(r.panel, r.n).length);
const logs = await all(() => supabase.from('admin_activity_log').select('target_id, action, created_at').eq('target_type', 'product').in('action', ['update', 'create']).order('created_at'));
const adminAt = new Map();
for (const l of logs) adminAt.set(l.target_id, l.created_at);
console.log(`panel and app figures differ: ${rows.length}${APPLY ? '' : '  -- preview, nothing is saved'}`);

const csv = ['product,status,newer,figures,score_before,score_after'];
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
for (const r of rows) {
  const s = scriptAt.get(r.id);
  const a = adminAt.get(r.id);
  const scriptNewer = s && (!a || new Date(s) > new Date(a));
  const { data, error } = await supabase.from('product_reports').select('report').eq('id', r.id).single();
  if (error) { console.error(`${r.product_name}: ${error.message}`); continue; }
  const report = data.report;
  let next;
  let rescore = '';
  if (scriptNewer) {
    next = { ...report, nutritionPanel: panelFromPer100(report.nutrientsPer100, report.nutritionPanel) };
  } else {
    const res = rescored(report, per100FromPanel(report.nutritionPanel, report.nutrientsPer100));
    next = res.report;
    rescore = res.rescored ? '' : ' (score kept)';
  }
  const diff = differences(r.panel, r.n).join(' ');
  csv.push([r.product_name, r.review_status, scriptNewer ? 'fix script -> panel updated' : 'admin panel -> app figures updated', diff, report.overallScore, `${next.overallScore}${rescore}`].map(cell).join(','));
  console.log(`  ${(scriptNewer ? 'panel <- app' : 'app <- panel').padEnd(13)} ${String(report.overallScore).padStart(3)} -> ${String(next.overallScore).padStart(3)}${rescore.padEnd(13)} ${r.product_name.slice(0, 50)}  [${diff}]`);
  if (!APPLY) continue;
  fs.appendFileSync(BACKUP, `${JSON.stringify({ id: r.id, product: r.product_name, at: new Date().toISOString(), report })}\n`);
  const { error: saveErr } = await supabase.from('product_reports').update({ report: next, updated_at: new Date().toISOString() }).eq('id', r.id);
  if (saveErr) { console.error(`${r.product_name}: ${saveErr.message}`); continue; }
  progress[r.id] = { product: r.product_name, newer: scriptNewer ? 'script' : 'admin' };
  fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));
}
fs.writeFileSync(`../sync-nutrition-panel-${APPLY ? 'applied' : 'preview'}.csv`, `﻿${csv.join('\n')}\n`);
