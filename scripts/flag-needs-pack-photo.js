// scripts/flag-needs-pack-photo.js
//
// Opens a "Needs pack photo" data issue (product_data_issues) for each Blinkit
// product whose nutrition table is still wrong and whose pack photo showed that
// Blinkit's text is the problem (scripts/recheck-blinkit-nutrition.js verdicts:
// text wrong / columns mixed / a figure the pack doesn't print). Admin >
// Products > "Needs pack photo" lists them; approving one closes its issue
// (adminSetReviewStatus). A product that already has an open one is skipped.
//
//   node --env-file=.env scripts/flag-needs-pack-photo.js           (preview)
//   node --env-file=.env scripts/flag-needs-pack-photo.js --apply
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { nutritionIssues } from '../src/services/dataHealth.js';
import { NEEDS_PHOTO_PREFIX } from '../src/services/adminReviewRepo.js';

const APPLY = process.argv.includes('--apply');
const WHY = {
  'blinkit-text-wrong': "Blinkit's nutrition text differs from the table on the pack",
  'blinkit-mixed-columns': "Blinkit's text mixes the pack's per-100 and per-serving columns",
  'blinkit-extra-figure': "Blinkit's text has a figure the pack's table doesn't print",
};

const recheck = JSON.parse(fs.readFileSync('../blinkit-nutrition-recheck.json', 'utf8')).filter((x) => x.photo && WHY[x.verdict]);
// Every Blinkit report (slim), matched by name here: names with quotes, commas
// or brackets ('Act II Crispy "n" Crunchy Nachos') can't go into an IN() filter.
const wanted = new Set(recheck.map((x) => x.product));
const rows = [];
for (let f = 0; ; f += 1000) {
  const { data, error } = await supabase.from('product_reports')
    .select('lookup_key, product_name, source, review_status, ingredients_text, n:report->nutrientsPer100, score:report->overallScore, verdict:report->>verdict')
    .eq('source', 'blinkit').neq('review_status', 'rejected').order('id').range(f, f + 999);
  if (error) throw new Error(error.message);
  rows.push(...data.filter((r) => wanted.has(r.product_name)));
  if (data.length < 1000) break;
}
const verdictOf = new Map(recheck.map((x) => [x.product, x]));
const still = rows.filter((r) => nutritionIssues({ n: r.n, ingredientsText: r.ingredients_text }).length > 0);
const { data: open } = await supabase.from('product_data_issues').select('lookup_key').eq('status', 'open').like('reason', `${NEEDS_PHOTO_PREFIX}%`);
const already = new Set((open || []).map((r) => r.lookup_key));
const toAdd = still.filter((r) => !already.has(r.lookup_key));
console.log(`photo-checked: ${recheck.length} | still wrong: ${still.length} | already flagged: ${still.length - toAdd.length} | to flag: ${toAdd.length}${APPLY ? '' : '  -- preview'}`);
for (const r of toAdd) console.log(`  ${r.review_status.padEnd(8)} ${r.product_name}`);
if (!APPLY || !toAdd.length) process.exit(0);

const { error } = await supabase.from('product_data_issues').insert(toAdd.map((r) => {
  const x = verdictOf.get(r.product_name);
  const fields = (x.fields || []).join(', ');
  return {
    lookup_key: r.lookup_key,
    product_name: r.product_name,
    source: r.source,
    reason: `${NEEDS_PHOTO_PREFIX}: ${WHY[x.verdict]}${fields ? ` (${fields})` : ''}. Fix the figures from the pack photo (photo ${x.photo.photoNo} on the Blinkit page), then approve.`,
    score_at_detection: typeof r.score === 'number' ? Math.round(r.score) : null,
    verdict_at_detection: r.verdict || null,
  };
}));
if (error) { console.error(error.message); process.exit(1); }
console.log(`flagged ${toAdd.length}`);
