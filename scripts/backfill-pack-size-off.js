// scripts/backfill-pack-size-off.js
//
// Barcode products (source 'barcode', key "barcode:<code>") were saved
// without a pack size -- the Duplicates page then can't tell a 70 g pack
// from a 280 g one. This asks Open Food Facts for each one's "quantity"
// ("70 g", "4 x 70 g") and saves it as report.packSize.
//
// The score is redone with the new size only when redoing it with the OLD
// (missing) size reproduces the stored score exactly -- otherwise the score
// carries something this can't rebuild (an admin's own edit), so only the
// pack size text changes. Multipacks become "280 g (4 x 70 g)" (the total
// first, which is what the Duplicates page reads); one with no total is
// skipped. Nothing is guessed: no usable quantity on OFF = left for a person.
//
// Without --apply: reads only, prints what would change.
// With --apply: needs SUPABASE_SERVICE_ROLE_KEY in .env. Writes a JSON
// backup of every report it changes first.
//
//   node --env-file=.env scripts/backfill-pack-size-off.js [--limit 30]
//   node --env-file=.env scripts/backfill-pack-size-off.js --apply
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { buildReport } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';
import { extractNutrientsForHabitCheck } from '../src/services/openFoodFacts.js';
import { parseSize } from '../src/utils/productFamilies.js';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(process.env.VITE_SUPABASE_URL, APPLY ? SERVICE_KEY : process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

// Open Food Facts allows 100 product reads a minute on paper, but answers
// 429 well before that once a run has been going a while -- 20 a minute holds.
const DELAY_MS = 3000;
// Barcodes already asked about that OFF had no usable size for -- skipped
// on the next run instead of asked again.
const CHECKED_FILE = '../pack-size-off-checked.txt';
const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product';
const USER_AGENT = 'FoodGuardIndia/1.0 (pack-size backfill)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function allRows(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function fetchOff(code) {
  const url = `${OFF_URL}/${encodeURIComponent(code)}.json?fields=quantity,product_quantity,product_quantity_unit,nutriments,serving_size`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(5000 * attempt);
    const started = Date.now();
    try {
      // OFF sometimes never answers; without a limit one request stalls the run.
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;
      if (!res.ok) {
        console.log(`  OFF ${res.status} for ${code} after ${Date.now() - started} ms`);
        if (res.status === 429) await sleep(60000); // rate limited: wait the minute out
        continue;
      }
      const data = await res.json();
      return data.status === 1 ? data.product : null;
    } catch (err) {
      console.log(`  OFF ${err.name} for ${code} after ${Date.now() - started} ms`);
    }
  }
  throw new Error('Open Food Facts not answering');
}

// OFF's quantity, as a size the Duplicates page can read -- or null.
function packSizeFrom(p) {
  const text = String(p?.quantity || '').replace(/\s+/g, ' ').trim();
  const total = Number(p?.product_quantity);
  const unit = String(p?.product_quantity_unit || '').trim().toLowerCase();
  const totalText = total > 0 && /^(g|kg|ml|l|cl)$/.test(unit) ? `${+total.toFixed(2)} ${unit}` : null;
  const ok = (s) => {
    const size = parseSize(s);
    return Boolean(size && size.value > 0 && size.value <= 50000);
  };
  if (text && /\d\s*[x×*]\s*\d/i.test(text)) {
    // "4 x 70 g": the first size in the text is one unit, not the pack.
    return totalText && ok(totalText) ? `${totalText} (${text})`.slice(0, 60) : null;
  }
  if (text && text.length <= 40 && ok(text)) return text;
  return totalText && ok(totalText) ? totalText : null;
}

function nutrientsFromReport(report) {
  if (!report.nutrientsPer100 || !Object.keys(report.nutrientsPer100).length) return undefined;
  return { nutrients: report.nutrientsPer100, nutrientsPer100: report.nutrientsPer100, servingGrams: report.realNutrientsServingGrams ?? null, servingUnit: report.realNutrientsServingUnit };
}

// Same rule as normalize-pack-listings.js: rescore only when the stored
// score can be rebuilt exactly.
function rescore(report, offProduct, newPack) {
  const run = (packSize, nutrientsInfo) => {
    const base = buildReport(report.ingredients || [], { productName: report.productName, brand: report.brand, imageUrl: report.imageUrl, packSize });
    const next = { ...report, overallScore: base.overallScore, verdict: base.verdict, packSize: packSize || null };
    if (nutrientsInfo) next.nutrientsPer100 = nutrientsInfo.nutrientsPer100;
    finalizeScore(next, { nutrientsInfo, packSize: packSize || undefined });
    return next;
  };
  const textOnly = { report: { ...report, packSize: newPack }, rescored: false };
  if (!Array.isArray(report.ingredients) || report.ingredients.length === 0) return textOnly;
  for (const nutrientsInfo of [extractNutrientsForHabitCheck(offProduct) || undefined, nutrientsFromReport(report)]) {
    const before = run(report.packSize || undefined, nutrientsInfo);
    if (before.overallScore === report.overallScore && JSON.stringify(before.nutrientsPer100 ?? null) === JSON.stringify(report.nutrientsPer100 ?? null)) {
      return { report: run(newPack, nutrientsInfo), rescored: true };
    }
  }
  return textOnly;
}

async function main() {
  if (APPLY && !SERVICE_KEY) {
    console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.');
    process.exitCode = 1;
    return;
  }
  const missing = (await allRows(() => supabase.from('product_reports')
    .select('id, lookup_key, product_name, review_status, report')
    .eq('source', 'barcode')
    .neq('review_status', 'rejected')
    .like('lookup_key', 'barcode:%')
    .order('id')))
    .filter((r) => !String(r.report?.packSize || '').trim());
  const checked = new Set(fs.existsSync(CHECKED_FILE) ? fs.readFileSync(CHECKED_FILE, 'utf8').split('\n').filter(Boolean) : []);
  const rows = missing.filter((r) => !checked.has(r.lookup_key)).slice(0, LIMIT);
  const markChecked = (key) => { if (APPLY) fs.appendFileSync(CHECKED_FILE, `${key}\n`); };
  console.log(`${missing.length} barcode products without a pack size (${missing.length - rows.length} skipped: already asked, OFF had none). ${APPLY ? 'Saving' : 'Preview only -- nothing is saved'}.`);

  // One line per report, written before it changes -- survives the run being stopped.
  const backupFile = `../pack-size-off-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  if (APPLY) console.log(`Backup of each report before it changes: ${backupFile}`);
  const changed = [];
  const counts = { saved: 0, noOff: 0, noSize: 0, errors: 0 };
  for (const [i, row] of rows.entries()) {
    if (i) await sleep(DELAY_MS);
    if (i && i % 100 === 0) console.log(`  ${i}/${rows.length}  (${counts.saved} with a size so far)`);
    try {
      const off = await fetchOff(row.lookup_key.slice('barcode:'.length));
      if (!off) { counts.noOff++; markChecked(row.lookup_key); continue; }
      const pack = packSizeFrom(off);
      if (!pack) { counts.noSize++; markChecked(row.lookup_key); continue; }
      const result = rescore(row.report, off, pack);
      if (APPLY) {
        fs.appendFileSync(backupFile, `${JSON.stringify({ id: row.id, lookup_key: row.lookup_key, report: row.report })}\n`);
        const { error } = await supabase.from('product_reports').update({ report: result.report, updated_at: new Date().toISOString() }).eq('id', row.id);
        if (error) throw new Error(error.message);
      }
      counts.saved++;
      changed.push({ name: row.product_name, brand: row.report?.brand, pack, before: row.report?.overallScore, after: result.report.overallScore, rescored: result.rescored });
      if (result.report.overallScore !== row.report?.overallScore) console.log(`  score ${row.report?.overallScore} -> ${result.report.overallScore}  ${pack}  ${row.product_name}`);
    } catch (err) {
      counts.errors++;
      console.warn(`  ${row.product_name}: ${err.message}`);
    }
  }

  const moved = changed.filter((c) => c.after !== c.before);
  console.log(`\nPack size ${APPLY ? 'saved' : 'found'}: ${counts.saved}`);
  console.log(`  score changed: ${moved.length}   score rebuilt, same: ${changed.filter((c) => c.rescored).length - moved.length}   size only (score not rebuildable): ${changed.filter((c) => !c.rescored).length}`);
  console.log(`Not on Open Food Facts: ${counts.noOff}   On it, but no usable size: ${counts.noSize}   Errors: ${counts.errors}`);

  const sample = [...moved.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)), ...changed.filter((c) => c.after === c.before)].slice(0, 20);
  console.log('\n20 examples (biggest score changes first):');
  for (const c of sample) console.log(`  ${String(c.before).padStart(3)} -> ${String(c.after).padEnd(3)}  ${c.pack.padEnd(22)}  ${c.brand ? `${c.brand} -- ` : ''}${c.name}`);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
