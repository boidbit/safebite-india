// scripts/preview-typo-cleanup.js
//
// READ-ONLY preview: what happens to a product's score if the typo / junk
// ingredients (OCR leftovers like "ing", "der", "ii", "sod") are taken off its
// ingredient list and it is re-scored. Writes nothing to the database.
//
// The typo list is ../typo-ingredients-library.csv, the product list is
// ../typo-ingredients-products.csv (both made by the earlier typo search).
// Scoring runs the same steps as the admin form's "Recalculate score":
// buildReport, then finalizeScore. To tell a real change from drift, every
// product is also re-scored UNTOUCHED ("baseline"); if that already differs
// from the stored score, the row is flagged and its numbers can't be trusted.
//
//   node --env-file=.env scripts/preview-typo-cleanup.js
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { buildReport } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';

function csvRows(path) {
  const s = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const rows = []; let cur = [], f = '', q = false;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === '"') { if (s[k + 1] === '"') { f += '"'; k++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cur.push(f); f = ''; }
    else if (c === '\n') { cur.push(f.replace(/\r$/, '')); rows.push(cur); cur = []; f = ''; }
    else f += c;
  }
  rows.shift();
  return rows;
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// The library CSV's names are normalised keys ("ins 1500") while a stored report keeps the raw
// label text ("47201 Co Fla ... (INS 1500)"), so match on the explanation the ingredient carries.
const typoReasons = new Set(csvRows('../typo-ingredients-library.csv').map((r) => r[3].trim()));
const TYPO_WORDS = /typo|misspell|nonsens|placeholder|label error|not a recognized (food )?(ingredient|additive)|unrecognized|non-?food (term|word)|invalid .*code|no recognized food additive/i;
const isTypo = (i) => i.recognized !== true && (typoReasons.has(String(i.reason || '').trim()) || TYPO_WORDS.test(i.reason || '') || TYPO_WORDS.test(i.whatIsIt || ''));
const wanted = csvRows('../typo-ingredients-products.csv').filter((r) => r[1] !== 'rejected').map((r) => r[0]);
console.log(`${typoReasons.size} typo explanations, ${wanted.length} products (rejected left out)`);

function rescore(row, ingredients) {
  const r = row.report;
  const trimmedPack = r.packSize || null;
  const next = { ...r, ...buildReport(ingredients, { productName: r.productName, brand: r.brand || null, imageUrl: r.imageUrl || null, packSize: trimmedPack }) };
  const nutrientsInfo = r.nutrientsPer100
    ? { nutrients: r.nutrients || r.nutrientsPer100, nutrientsPer100: r.nutrientsPer100, servingGrams: r.realNutrientsServingGrams ?? null, servingUnit: r.realNutrientsServingUnit || 'g' }
    : undefined;
  finalizeScore(next, { nutrientsInfo, packSize: trimmedPack || undefined });
  return next;
}

const rows = [];
for (let i = 0; i < wanted.length; i += 40) {
  const { data, error } = await supabase.from('product_reports').select('id, product_name, review_status, report').in('product_name', wanted.slice(i, i + 40));
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...data.filter((d) => d.review_status !== 'rejected'));
}
console.log(`loaded ${rows.length} reports`);

const out = []; const stats = { changed: 0, same: 0, unreliable: 0, noTypo: 0 };
for (const row of rows) {
  const stored = row.report?.ingredients || [];
  const typos = stored.filter(isTypo);
  if (!typos.length) { stats.noTypo++; continue; }
  const kept = stored.filter((i) => !isTypo(i));
  if (!kept.length) { out.push({ row, old: row.report.overallScore, base: '', next: '', typos, note: 'EVERY ingredient is a typo -- skip, needs a look' }); continue; }
  const base = rescore(row, stored);
  const next = rescore(row, kept);
  const reliable = base.overallScore === row.report.overallScore;
  if (!reliable) stats.unreliable++;
  else if (next.overallScore !== row.report.overallScore) stats.changed++; else stats.same++;
  out.push({ row, old: row.report.overallScore, base: base.overallScore, next: next.overallScore, typos, kept: kept.length, total: stored.length, note: reliable ? '' : 'baseline rescore differs from stored score -- not trusted', verdictOld: row.report.verdict, verdictNew: next.verdict });
}

const lines = ['Product,Review status,Old score,Rescored untouched,New score,Change,Old verdict,New verdict,Typo ingredients removed,Ingredients left,Note'];
out.sort((a, b) => ((b.next === '' ? 0 : b.next - b.old) - (a.next === '' ? 0 : a.next - a.old)));
for (const o of out) {
  lines.push([o.row.product_name, o.row.review_status, o.old, o.base, o.next, o.next === '' ? '' : o.next - o.old, o.verdictOld, o.verdictNew, o.typos.map((t) => `${t.name} (${t.status}, ${t.penalty ?? 0})`).join('; '), o.kept ?? '', o.note].map(csvCell).join(','));
}
const file = '../typo-cleanup-preview.csv';
fs.writeFileSync(file, '\uFEFF' + lines.join('\r\n'));
const good = out.filter((o) => o.next !== '' && !o.note);
const up = good.filter((o) => o.next > o.old);
console.log(JSON.stringify({ ...stats, rowsWritten: out.length, scoreUp: up.length, avgUp: up.length ? +(up.reduce((s, o) => s + o.next - o.old, 0) / up.length).toFixed(1) : 0, scoreDown: good.filter((o) => o.next < o.old).length }));
console.log('wrote', file);
