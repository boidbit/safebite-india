// scripts/normalize-pack-listings.js
//
// Multi-pack Blinkit listings ("3 x 250 ml", "... - Pack of 2", "... - Buy 1
// Get 1 Free") are the same product as its single pack. This works out, for
// every such listing, what it becomes (src/services/packNormalize.js):
//   size only   -- "3 x 250 ml" -> "250 ml", name already fine
//   rename      -- "- Pack of 2" comes off the name; no single listing exists
//   merge       -- the single listing already exists: this one folds into it
//   needs a look-- a size we won't guess ("2 x 500 g + 100 g")
//
// PREVIEW ONLY for now: reads the database, writes a CSV, changes nothing.
//   node --env-file=.env scripts/normalize-pack-listings.js
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { normalizeListing } from '../src/services/packNormalize.js';
import { blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';

const OUT = '../pack-normalize-preview.csv';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function allRows(table, columns, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabase.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const sameProduct = (brand, name) => `${(brand || '').trim().toLowerCase()}|${(name || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;

async function main() {
  const products = await allRows('blinkit_products', 'id, source, brand, product_name, pack_size', (q) => q.eq('source', 'blinkit'));
  const byName = new Map(products.map((p) => [sameProduct(p.brand, p.product_name), p]));

  const reports = new Map((await allRows('product_reports', 'lookup_key, review_status, overall:report->overallScore', (q) => q.like('lookup_key', 'blinkit:%')))
    .map((r) => [r.lookup_key, r]));
  const links = new Map();
  for (const l of await allRows('barcode_links', 'lookup_key, barcode, status', (q) => q.neq('status', 'rejected'))) {
    if (!links.has(l.lookup_key)) links.set(l.lookup_key, []);
    links.get(l.lookup_key).push(`${l.barcode} (${l.status})`);
  }

  const plans = [];
  const claimed = new Map(); // new name -> the listing that becomes it (when no single exists)
  let bundles = 0;
  for (const p of products) {
    const n = normalizeListing(p);
    if (n.bundle && /pack\s+of|\d\s*[x×]/i.test(`${p.product_name} ${p.pack_size || ''}`)) bundles++;
    if (!n.changed && !n.needsLook) continue;
    const key = blinkitLookupKey(p.source, p.brand, p.product_name);
    const renamed = n.name !== p.product_name;
    let action = renamed ? 'rename' : 'size only';
    let into = null;
    if (renamed) {
      const target = byName.get(sameProduct(p.brand, n.name));
      if (target && target.id !== p.id) {
        action = 'merge';
        into = target;
      } else if (claimed.has(sameProduct(p.brand, n.name))) {
        action = 'merge';
        into = claimed.get(sameProduct(p.brand, n.name));
      } else {
        claimed.set(sameProduct(p.brand, n.name), { ...p, product_name: n.name, pack_size: n.packSize });
      }
    }
    // The single listing is itself shown one unit at a time ("4 x 70 g" ->
    // "70 g"). A different unit size is a different product (its own
    // barcode) -- never merge those.
    let why = n.needsLook || '';
    if (into) {
      const intoSize = normalizeListing(into).packSize;
      into = { ...into, pack_size: intoSize };
      if (n.packSize && intoSize && n.packSize !== intoSize) {
        action = 'needs a look';
        why = `The single listing is ${intoSize}, this one's unit is ${n.packSize} -- different sizes are different products`;
      }
    }
    if (n.needsLook) action = 'needs a look';
    const report = reports.get(key);
    plans.push({
      action,
      brand: p.brand,
      oldName: p.product_name,
      oldPack: p.pack_size,
      newName: into ? into.product_name : n.name,
      newPack: into ? into.pack_size : n.packSize,
      intoPack: into?.pack_size ?? '',
      review: report?.review_status || 'no report yet',
      score: report?.overall ?? '',
      barcodes: (links.get(key) || []).join(' '),
      intoBarcodes: into ? (links.get(blinkitLookupKey(into.source, into.brand, into.product_name)) || []).join(' ') : '',
      why,
    });
  }

  const count = (a) => plans.filter((p) => p.action === a).length;
  console.log(`${products.length} Blinkit products; ${plans.length} multi-pack listings:`);
  for (const a of ['size only', 'rename', 'merge', 'needs a look']) console.log(`  ${a.padEnd(13)} ${count(a)}`);
  console.log(`  (skipped ${bundles} gift packs / combos of different products -- see remove-bundle-listings.js)`);
  console.log(`  live ones among them: ${plans.filter((p) => p.review === 'live' || p.review === 'approved').length}`);

  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const order = { merge: 0, 'needs a look': 1, rename: 2, 'size only': 3 };
  const lines = [...plans].sort((a, b) => order[a.action] - order[b.action] || a.brand.localeCompare(b.brand));
  fs.writeFileSync(OUT, '﻿' + [
    'Action,Brand,Old name,Old size,New name,New size,Review status,Score,Barcodes on this listing,Barcodes on the product it merges into,Why it needs a look',
    ...lines.map((p) => [p.action, esc(p.brand), esc(p.oldName), esc(p.oldPack), esc(p.newName), esc(p.newPack), p.review, p.score, esc(p.barcodes), esc(p.intoBarcodes), esc(p.why)].join(',')),
  ].join('\n'));
  console.log(`\nPreview written to ${OUT} -- nothing in the database was changed.`);
  for (const a of ['merge', 'rename', 'size only', 'needs a look']) {
    console.log(`\n${a}:`);
    for (const p of plans.filter((x) => x.action === a).slice(0, 5)) console.log(`   ${p.oldName} [${p.oldPack}]  ->  ${p.newName} [${p.newPack}]${p.why ? '  (' + p.why.slice(0, 60) + ')' : ''}`);
  }
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
