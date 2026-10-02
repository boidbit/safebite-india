// scripts/reparse-reports.js
//
// Re-analyzes saved reports the old parser (or a Gemini bracket repair that
// dropped words) left short: the fixed parser now finds, in the stored label
// text, an additive code, a declared flavour, or 2+ other ingredients the
// stored report doesn't have. Brackets that never close, a "]" read as "1",
// a long or comma-listed flavour and bare codes like "492" all lost
// ingredients before -- see ingredientParser.js.
//
// Keeps everything an admin or scraper set (photo, brand, pack size,
// nutrition panel, food-type override) and only replaces what analysis
// produces. Uses Gemini for the summary/insights, so it paces itself and
// stops early if Gemini keeps failing. A JSONL backup line is written before
// each report changes.
//
// Usage (needs SUPABASE_SERVICE_ROLE_KEY in .env to write):
//   node --env-file=.env scripts/reparse-reports.js --limit=20          (dry run)
//   node --env-file=.env scripts/reparse-reports.js --write
import fs from 'fs';
import { supabase, isSupabaseConfigured } from '../src/services/supabaseClient.js';
import { parseLabel, normalizeName } from '../src/services/ingredientParser.js';
import { analyzeText } from '../src/services/analyzeText.js';
import { buildReport } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';

const PACING_MS = 1500;
const MAX_CONSECUTIVE_FAILURES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

// What the fixed parser finds that the stored report is missing -- an
// additive code, a declared flavour, or (when the stored list is barely
// half the label) the rest of the label. A re-analysis also redoes the
// quantity estimates (a barcode report's came from Open Food Facts), so a
// report that only differs by a name's spelling is left alone: its score
// would move for no reason.
function missingFrom(row) {
  const stored = row.report?.ingredients || [];
  const names = new Set(stored.map((i) => normalizeName(i.name || '')));
  const codes = new Set(stored.map((i) => String(i.insCode || '').toLowerCase()).filter(Boolean));
  const fresh = parseLabel(row.ingredients_text).ingredients;
  const missing = fresh.filter((i) => (i.insCode ? !codes.has(i.insCode) : !i.lookupKeys.some((k) => names.has(k))));
  // Real INS numbers only -- "INS 8412" is OCR noise, not a lost additive.
  const codesMissing = missing.filter((i) => i.insCode && parseInt(i.insCode, 10) >= 100 && parseInt(i.insCode, 10) <= 1599);
  const flavourMissing = missing.some((i) => i.categoryHint === 'flavour') && !stored.some((i) => /flavou?r/i.test(i.name || ''));
  const mostlyLost = fresh.length >= 6 && stored.length < fresh.length * 0.6;
  return codesMissing.length || flavourMissing || mostlyLost ? missing.map((i) => i.displayName) : null;
}

// Results of the last analysis that the new one replaces or drops -- left
// on the merged report they'd describe the old ingredient list.
const STALE_KEYS = ['dailyHabitCheck', 'overallScoreBeforeDensity', 'nutritionDensity', 'scoreNote', 'hi', 'story', 'usefulContext', 'isCondimentOrSeasoning', 'isInfantFormula', 'isDeepFried'];

// A barcode report's percentages came from Open Food Facts' estimates, which
// a re-analysis from the label text alone doesn't have. Give each ingredient
// that's still on the list its old percentage back and rescore, so the score
// moves for what was added or dropped, not for a different guess at amounts.
function keepOldPercentages(fresh, old, nutrientsInfo) {
  const byKey = new Map();
  for (const i of old.ingredients || []) {
    if (typeof i.percentage !== 'number') continue;
    if (i.insCode) byKey.set(`ins:${String(i.insCode).toLowerCase()}`, i.percentage);
    byKey.set(`name:${normalizeName(i.name || '')}`, i.percentage);
  }
  let changed = false;
  for (const i of fresh.ingredients) {
    if (typeof i.percentage === 'number') continue;
    const pct = (i.insCode && byKey.get(`ins:${String(i.insCode).toLowerCase()}`)) ?? byKey.get(`name:${normalizeName(i.name || '')}`);
    if (typeof pct === 'number') { i.percentage = pct; delete i.estimatedPercentage; changed = true; }
  }
  if (!changed) return;
  const base = buildReport(fresh.ingredients, { productName: fresh.productName, brand: fresh.brand, imageUrl: fresh.imageUrl, packSize: fresh.packSize });
  fresh.overallScore = base.overallScore;
  fresh.verdict = base.verdict;
  if (fresh.foodType) finalizeScore(fresh, { nutrientsInfo, packSize: fresh.packSize || undefined });
}

async function loadAffected() {
  const out = [];
  for (let from = 0; ; from += 100) {
    const { data, error } = await supabase
      .from('product_reports')
      .select('id, product_name, ingredients_text, report')
      .neq('review_status', 'rejected')
      .order('id', { ascending: true })
      .range(from, from + 99);
    if (error) throw new Error(error.message);
    for (const r of data) {
      if (!r.ingredients_text || !r.report?.ingredients?.length) continue;
      const missing = missingFrom(r);
      if (missing) out.push({ ...r, missing });
    }
    if (data.length < 100) break;
  }
  return out;
}

async function main() {
  if (!isSupabaseConfigured) { console.error('Missing Supabase env.'); process.exitCode = 1; return; }
  const write = process.argv.includes('--write');
  if (write && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--write needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exitCode = 1; return; }
  const limit = Number(arg('limit')) || Infinity;

  const affected = (await loadAffected()).slice(0, limit);
  console.log(`${affected.length} report(s) to re-analyze. Mode: ${write ? 'WRITE' : 'dry run'}`);
  const backupFile = `../reparse-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  if (write) console.log(`Backup of each report before it changes: ${backupFile}`);
  console.log('');

  let done = 0;
  let failed = 0;
  let consecutive = 0;
  const changes = [];

  for (const row of affected) {
    const old = row.report;
    const nutrientsInfo = old.realNutrients
      ? {
          nutrients: old.realNutrients,
          nutrientsPer100: old.nutrientsPer100,
          servingGrams: old.realNutrientsServingGrams ?? null,
          servingUnit: old.realNutrientsServingUnit || 'g',
        }
      : undefined;
    try {
      const { report: fresh } = await analyzeText(
        row.ingredients_text,
        old.productName || row.product_name,
        old.brand || undefined,
        null,
        old.imageUrl || undefined,
        nutrientsInfo,
        old.packSize || undefined,
      );
      keepOldPercentages(fresh, old, nutrientsInfo);
      const kept = { ...old };
      for (const key of STALE_KEYS) delete kept[key];
      const next = { ...kept, ...fresh };
      // Never let a refresh undo what an admin/scraper put on the report.
      next.imageUrl = old.imageUrl ?? fresh.imageUrl;
      next.packSize = old.packSize ?? fresh.packSize;
      if (old.nutritionPanel) next.nutritionPanel = old.nutritionPanel;
      if (old.foodTypeSource === 'admin') {
        next.foodType = old.foodType;
        next.isDeepFried = old.isDeepFried;
        next.foodTypeSource = 'admin';
      }

      changes.push({ name: row.product_name, before: old.overallScore, after: next.overallScore, countBefore: old.ingredients.length, countAfter: next.ingredients.length });
      console.log(`${row.product_name}: ingredients ${old.ingredients.length} -> ${next.ingredients.length} | score ${old.overallScore} -> ${next.overallScore} | +${row.missing.slice(0, 4).join(', ')}${row.missing.length > 4 ? ', ...' : ''}`);
      if (write) {
        fs.appendFileSync(backupFile, `${JSON.stringify({ id: row.id, report: old })}\n`);
        const { error } = await supabase
          .from('product_reports')
          .update({ report: next, updated_at: new Date().toISOString() })
          .eq('id', row.id);
        if (error) throw new Error(error.message);
      }
      done++;
      consecutive = 0;
    } catch (err) {
      failed++;
      consecutive++;
      console.warn(`FAILED ${row.product_name}: ${err.message}`);
      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        console.warn(`\n${MAX_CONSECUTIVE_FAILURES} failures in a row -- stopping (Gemini quota?). Re-run to continue; re-analyzed rows are skipped.`);
        break;
      }
    }
    await sleep(PACING_MS);
  }

  const moved = changes.filter((c) => c.after !== c.before);
  console.log(`\nDone. ${done} re-analyzed, ${failed} failed. Score changed on ${moved.length}: ${moved.filter((c) => c.after < c.before).length} down, ${moved.filter((c) => c.after > c.before).length} up.`);
  console.log('\n20 biggest score changes:');
  for (const c of moved.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 20)) {
    console.log(`  ${String(c.before).padStart(3)} -> ${String(c.after).padEnd(3)}  (${c.countBefore} -> ${c.countAfter} ingredients)  ${c.name}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
