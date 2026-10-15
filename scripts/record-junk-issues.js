// scripts/record-junk-issues.js
//
// Puts every saved report that still has typo / OCR-junk ingredients into the
// admin's manual review (Data Issues page) -- after clean-junk-ingredients.js
// and fix-junk-reports.js have fixed what they can. One open issue per product;
// re-running only adds new ones. New reports get theirs when they are saved
// (productCache.js saveReport -> junkIssues.js).
//
// Products come from ../typo-ingredients-products.csv (the typo search), so the
// whole catalog isn't downloaded.
//
//   node --env-file=.env scripts/record-junk-issues.js            (dry run: counts)
//   node --env-file=.env scripts/record-junk-issues.js --write
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { junkIssueReason, recordJunkIssue } from '../src/services/junkIssues.js';

const write = process.argv.includes('--write');

function csvRows(path) {
  const s = fs.readFileSync(path, 'utf8').replace(/^﻿/, '');
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

const names = [...new Set(csvRows('../typo-ingredients-products.csv').filter((r) => r[1] !== 'rejected').map((r) => r[0]))];
const withJunk = [];
for (let i = 0; i < names.length; i += 40) {
  const { data, error } = await supabase.from('product_reports').select('lookup_key, product_name, source, review_status, report').in('product_name', names.slice(i, i + 40));
  if (error) { console.error(error.message); process.exit(1); }
  withJunk.push(...data.filter((d) => d.review_status !== 'rejected' && junkIssueReason(d.report)));
}
console.log(`${withJunk.length} products still have junk ingredients`);
if (!write) { console.log('dry run -- nothing written. Add --write.'); process.exit(0); }

let opened = 0;
for (const r of withJunk) {
  if (await recordJunkIssue({ lookupKey: r.lookup_key, productName: r.product_name, source: r.source, report: r.report })) opened++;
}
console.log(`opened ${opened} new issue(s) (the rest already had one open)`);
