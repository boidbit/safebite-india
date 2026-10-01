// scripts/audit-product-families.js
//
// READ-ONLY audit of duplicates and product families across the catalog
// (rules: src/utils/productFamilies.js -- the same ones Admin > Inbox >
// Duplicates uses). Measures how many products have a pack size, brands that
// look wrong, families, and duplicate groups (same product saved twice).
// Writes ../product-families-audit.csv. Changes nothing.
//
//   node --env-file=.env scripts/audit-product-families.js
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { brandCounts, profileProduct, groupFamilies, duplicateGroups, sizeLabel } from '../src/utils/productFamilies.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const OUT = '../product-families-audit.csv';

async function allRows(table, columns, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabase.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function main() {
  const rows = (await allRows('product_reports', 'id, lookup_key, source, product_name, review_status, scan_count, brand:report->>brand, pack:report->>packSize, score:report->overallScore, image:report->>imageUrl'))
    .filter((r) => r.product_name && r.review_status !== 'rejected')
    .map((r) => ({ id: r.id, productName: r.product_name, brand: r.brand, packSize: r.pack, scanCount: r.scan_count, source: r.source, reviewStatus: r.review_status, score: r.score, hasImage: Boolean(r.image) }));
  const known = brandCounts(rows);
  const items = rows.map((r) => ({ ...r, profile: profileProduct(r, known) }));
  const families = groupFamilies(items);
  const multi = families.filter((f) => f.length > 1);
  const groups = duplicateGroups(families);
  const spread = groups.filter((g) => { const s = g.products.map((p) => p.score).filter((v) => typeof v === 'number'); return s.length > 1 && Math.max(...s) - Math.min(...s) > 5; });

  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const csv = ['Group #,Brand,Variant words,Product,Source,Status,Size,Size from,Score,Scans,Brand looks wrong,Photo'];
  groups.sort((a, b) => b.products.length - a.products.length).forEach((g, gi) => {
    for (const p of g.products) csv.push([gi + 1, esc(p.profile.brandKey), esc(p.profile.variant), esc(p.productName), p.source, p.reviewStatus, sizeLabel(p.profile.size), p.profile.sizeFrom, p.score ?? '', p.scanCount ?? '', p.profile.brandLooksWrong ? 'yes' : '', p.hasImage ? 'yes' : 'no'].join(','));
  });
  fs.writeFileSync(OUT, '﻿' + csv.join('\n'));

  const sized = items.filter((x) => x.profile.size).length;
  console.log(`products checked: ${items.length} (live, approved, pending)`);
  console.log(`pack size known: ${sized} (${Math.round(sized / items.length * 100)}%)`);
  console.log(`brand looks wrong: ${items.filter((x) => x.profile.brandLooksWrong).length}`);
  console.log(`families with 2+ products: ${multi.length} -- with 2+ known sizes: ${multi.filter((f) => new Set(f.map((x) => sizeLabel(x.profile.size)).filter(Boolean)).size > 1).length}`);
  console.log(`duplicate groups: ${groups.length} (${groups.reduce((n, g) => n + g.products.length, 0)} products) -- scores differ by more than 5 in ${spread.length}`);
  console.log(`written to ${OUT} -- nothing in the database was changed.`);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
