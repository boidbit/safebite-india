// scripts/audit-data-health.js
//
// READ-ONLY. Runs src/services/dataHealth.js over every product that's visible
// in the app (live / approved) and reports how many fail each check -- by
// severity and by source -- plus identical ingredient lists on different
// products. Writes ../data-health.csv (one row per product per failed check).
// Changes nothing.
//
// It reads each product's ingredient TEXT and nutrition only (not the whole
// report), roughly 10 MB once -- Supabase's free egress is limited, so don't
// run it in a loop.
//
//   node --env-file=.env scripts/audit-data-health.js
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { checkProduct, sameIngredientsDifferentProducts, CHECKS } from '../src/services/dataHealth.js';

const COLUMNS = 'id, lookup_key, product_name, review_status, source, ingredients_text, '
  + 'n:report->nutrientsPer100, packSize:report->>packSize, brand:report->>brand, imageUrl:report->>imageUrl, '
  + 'verdict:report->>verdict, score:report->overallScore, foodType:report->>foodType';

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('product_reports').select(COLUMNS).in('review_status', ['live', 'approved']).order('id').range(from, from + 999);
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...data);
  if (data.length < 1000) break;
}
const products = rows.map((r) => ({
  id: r.id, lookupKey: r.lookup_key, name: r.product_name, brand: r.brand, status: r.review_status, source: r.source,
  ingredientsText: r.ingredients_text, n: r.n, packSize: r.packSize, imageUrl: r.imageUrl, verdict: r.verdict, score: r.score, foodType: r.foodType,
}));

const csv = ['check,severity,product,status,source,evidence'];
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const byCheck = new Map(CHECKS.map((c) => [c.id, { ...c, count: 0, bySource: {}, samples: [] }]));
const flagged = new Set();
for (const p of products) {
  for (const f of checkProduct(p)) {
    const c = byCheck.get(f.id);
    c.count++;
    c.bySource[p.source] = (c.bySource[p.source] || 0) + 1;
    if (c.samples.length < 3) c.samples.push(`${p.name} (${f.evidence})`);
    flagged.add(p.id);
    csv.push([f.id, f.severity, p.name, p.status, p.source, f.evidence].map(cell).join(','));
  }
}
const groups = sameIngredientsDifferentProducts(products);
for (const g of groups) for (const r of g.rows) csv.push(['sameIngredientsDifferentProducts', 'medium', r.name, r.status, r.source, `identical ingredient list shared by ${g.rows.length} products`].map(cell).join(','));

console.log(`checked ${products.length} visible products\n`);
for (const sev of ['high', 'medium', 'low']) {
  console.log(`-- ${sev.toUpperCase()}`);
  for (const c of byCheck.values()) {
    if (c.severity !== sev) continue;
    console.log(`  ${String(c.count).padStart(5)}  ${c.title}   ${Object.entries(c.bySource).map(([s, n]) => `${s}:${n}`).join(' ')}`);
    for (const s of c.samples) console.log(`           e.g. ${s.slice(0, 150)}`);
  }
}
console.log(`\n  ${String(groups.length).padStart(5)}  identical ingredient list on different products (${groups.reduce((n, g) => n + g.rows.length, 0)} products in ${groups.length} groups)`);
for (const g of groups.slice(0, 3)) console.log(`           e.g. ${g.rows.slice(0, 3).map((r) => r.name).join('  |  ').slice(0, 150)}`);
console.log(`\nproducts with at least one high/medium/low flag: ${flagged.size}`);
fs.writeFileSync('../data-health.csv', `﻿${csv.join('\n')}\n`);
console.log('CSV: ../data-health.csv');
