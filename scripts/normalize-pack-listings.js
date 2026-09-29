// scripts/normalize-pack-listings.js
//
// Multi-pack Blinkit listings ("3 x 250 ml", "... - Pack of 2", "... - Buy 1
// Get 1 Free") are the same product as its single pack. For every such
// listing this works out what it becomes (src/services/packNormalize.js):
//   size only    -- "3 x 250 ml" -> "250 ml", name already fine
//   rename       -- "- Pack of 2" comes off the name; no single listing exists
//   merge        -- the single listing already exists: this one is deleted
//                   and its barcode links move to the single one
//   needs a look -- a size we won't guess ("1 ltr + 200 ml"), or the single
//                   listing is a different size (a different product) -- left alone
// Gift packs / combos of different products are left alone too
// (remove-bundle-listings.js deals with those).
//
// Without --apply: reads the database, writes a preview CSV (with each
// product's score before and after), changes nothing.
// With --apply: needs SUPABASE_SERVICE_ROLE_KEY in .env (live products are
// locked against the public key -- supabase/lock_public_writes_migration.sql).
// Writes a JSON backup of every row it touches first.
//
//   node --env-file=.env scripts/normalize-pack-listings.js
//   node --env-file=.env scripts/normalize-pack-listings.js --apply
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { normalizeListing } from '../src/services/packNormalize.js';
import { blinkitLookupKey, extractNutrientsForHabitCheck } from '../src/services/blinkitProductsRepo.js';
import { buildReport } from '../src/services/scoringEngine.js';
import { finalizeScore } from '../src/services/finalizeScore.js';

const APPLY = process.argv.includes('--apply');
const OUT = APPLY ? '../pack-normalize-applied.csv' : '../pack-normalize-preview.csv';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(process.env.VITE_SUPABASE_URL, APPLY ? SERVICE_KEY : process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

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
const keyOf = (p) => blinkitLookupKey(p.source, p.brand, p.product_name);

// The stored score, redone with a new pack size. Only when redoing it with
// the OLD pack size reproduces the stored score exactly -- otherwise the
// score carries something this can't rebuild (an admin's own edit), so
// only the pack size text changes.
function rescore(report, row, newPack) {
  const nutrientsInfo = extractNutrientsForHabitCheck(row.nutrition, row.serving_size) || undefined;
  const run = (packSize) => {
    const base = buildReport(report.ingredients || [], { productName: report.productName, brand: report.brand, imageUrl: report.imageUrl, packSize });
    const next = { ...report, overallScore: base.overallScore, verdict: base.verdict, packSize: packSize || null };
    if (nutrientsInfo) next.nutrientsPer100 = nutrientsInfo.nutrientsPer100;
    finalizeScore(next, { nutrientsInfo, packSize: packSize || undefined });
    return next;
  };
  if (!Array.isArray(report.ingredients) || report.ingredients.length === 0) return { report: { ...report, packSize: newPack }, rescored: false };
  if (run(report.packSize ?? row.pack_size).overallScore !== report.overallScore) return { report: { ...report, packSize: newPack }, rescored: false };
  return { report: run(newPack), rescored: true };
}

async function plan() {
  const products = await allRows('blinkit_products', 'id, source, brand, product_name, pack_size, nutrition, serving_size', (q) => q.eq('source', 'blinkit'));
  const byName = new Map(products.map((p) => [sameProduct(p.brand, p.product_name), p]));
  const reports = new Map((await allRows('product_reports', 'id, lookup_key, product_name, review_status, report', (q) => q.like('lookup_key', 'blinkit:%')))
    .map((r) => [r.lookup_key, r]));
  const links = new Map();
  for (const l of await allRows('barcode_links', 'id, lookup_key, barcode, device_id, status', (q) => q.neq('status', 'rejected'))) {
    if (!links.has(l.lookup_key)) links.set(l.lookup_key, []);
    links.get(l.lookup_key).push(l);
  }

  const plans = [];
  const claimed = new Map();
  let bundles = 0;
  for (const p of products) {
    const n = normalizeListing(p);
    if (n.bundle && /pack\s+of|\d\s*[x×]/i.test(`${p.product_name} ${p.pack_size || ''}`)) bundles++;
    if (!n.changed && !n.needsLook) continue;
    let action = n.name !== p.product_name ? 'rename' : 'size only';
    let into = null;
    if (action === 'rename') {
      const target = byName.get(sameProduct(p.brand, n.name));
      if (target && target.id !== p.id) into = target;
      else if (claimed.has(sameProduct(p.brand, n.name))) into = claimed.get(sameProduct(p.brand, n.name));
      else claimed.set(sameProduct(p.brand, n.name), { ...p, product_name: n.name, pack_size: n.packSize });
      if (into) action = 'merge';
    }
    let why = n.needsLook || '';
    let intoSize = null;
    if (into) {
      intoSize = normalizeListing(into).packSize;
      if (n.packSize && intoSize && n.packSize !== intoSize) {
        action = 'needs a look';
        why = `The single listing is ${intoSize}, this one's unit is ${n.packSize} -- different sizes are different products`;
      }
    }
    if (n.needsLook) action = 'needs a look';

    const report = reports.get(keyOf(p));
    const newScore = report && (action === 'size only' || action === 'rename') ? rescore(report.report, p, n.packSize) : null;
    plans.push({ action, p, n, into, intoSize, report, newScore, why, links: links.get(keyOf(p)) || [], intoLinks: into ? links.get(keyOf(into)) || [] : [] });
  }
  return { products, plans, bundles };
}

// product_nutrition.lookup_key points at product_reports.lookup_key with no
// ON UPDATE -- move the row out of the way while the key changes.
async function moveReportKey(oldKey, newKey, fields) {
  const { data: nutrition } = await supabase.from('product_nutrition').select('*').eq('lookup_key', oldKey);
  if (nutrition?.length) await supabase.from('product_nutrition').delete().eq('lookup_key', oldKey);
  const { error } = await supabase.from('product_reports').update({ ...fields, lookup_key: newKey, updated_at: new Date().toISOString() }).eq('lookup_key', oldKey);
  if (nutrition?.length) {
    const { id, ...row } = nutrition[0]; // eslint-disable-line no-unused-vars
    await supabase.from('product_nutrition').insert({ ...row, lookup_key: error ? oldKey : newKey, product_name: fields.product_name ?? row.product_name });
  }
  if (error) throw new Error(error.message);
}

async function apply(pl) {
  const { p, n, into, report, newScore } = pl;
  if (pl.action === 'needs a look') return 'left alone';

  if (pl.action === 'size only') {
    let r = await supabase.from('blinkit_products').update({ pack_size: n.packSize }).eq('id', p.id);
    if (r.error) throw new Error(r.error.message);
    if (report) {
      r = await supabase.from('product_reports').update({ report: newScore.report, updated_at: new Date().toISOString() }).eq('id', report.id);
      if (r.error) throw new Error(r.error.message);
    }
    return 'done';
  }

  if (pl.action === 'rename') {
    const renamed = { ...p, product_name: n.name };
    const oldKey = keyOf(p);
    const newKey = keyOf(renamed);
    let r = await supabase.from('blinkit_products').update({ product_name: n.name, pack_size: n.packSize }).eq('id', p.id);
    if (r.error) throw new Error(r.error.message);
    if (report) await moveReportKey(oldKey, newKey, { product_name: n.name, report: { ...newScore.report, productName: n.name } });
    for (const l of pl.links) {
      r = await supabase.from('barcode_links').update({ lookup_key: newKey, product_name: n.name }).eq('id', l.id);
      if (r.error) await supabase.from('barcode_links').delete().eq('id', l.id); // same link already on the new key
    }
    return 'done';
  }

  // merge: the single listing stays exactly as it is; this one goes.
  const intoKey = keyOf(into);
  for (const l of pl.links) {
    const already = pl.intoLinks.some((x) => x.barcode === l.barcode);
    if (already) { await supabase.from('barcode_links').delete().eq('id', l.id); continue; }
    const r = await supabase.from('barcode_links').update({ lookup_key: intoKey, product_name: into.product_name }).eq('id', l.id);
    if (r.error) await supabase.from('barcode_links').delete().eq('id', l.id);
  }
  if (report) {
    const r = await supabase.from('product_reports').delete().eq('id', report.id); // nutrition row goes with it (on delete cascade)
    if (r.error) throw new Error(r.error.message);
  }
  const r = await supabase.from('blinkit_products').delete().eq('id', p.id);
  if (r.error) throw new Error(r.error.message);
  return 'done';
}

async function main() {
  if (APPLY && !SERVICE_KEY) {
    console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env (Supabase -> Project Settings -> API -> service_role).');
    process.exitCode = 1;
    return;
  }
  const { products, plans, bundles } = await plan();

  const count = (a) => plans.filter((x) => x.action === a).length;
  console.log(`${products.length} Blinkit products; ${plans.length} multi-pack listings:`);
  for (const a of ['size only', 'rename', 'merge', 'needs a look']) console.log(`  ${a.padEnd(13)} ${count(a)}`);
  console.log(`  (left alone: ${bundles} gift packs / combos of different products)`);
  const scored = plans.filter((x) => x.newScore);
  const moved = scored.filter((x) => x.newScore.rescored && x.newScore.report.overallScore !== x.report.report.overallScore);
  console.log(`  score changes: ${moved.length} of ${scored.length} with a report (${scored.filter((x) => !x.newScore.rescored).length} kept as they are -- their score can't be rebuilt)`);

  const results = new Map();
  if (APPLY) {
    const backup = `../pack-normalize-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(backup, JSON.stringify(plans.filter((x) => x.action !== 'needs a look').map((x) => ({ action: x.action, blinkit_product: x.p, product_report: x.report || null, barcode_links: x.links })), null, 1));
    console.log(`\nBackup of every row touched: ${backup}`);
    let done = 0;
    for (const pl of plans) {
      try { results.set(pl, await apply(pl)); } catch (err) { results.set(pl, `ERROR: ${err.message}`); }
      if (++done % 50 === 0) console.log(`  ${done}/${plans.length}`);
    }
    const errors = [...results.values()].filter((v) => v.startsWith('ERROR')).length;
    console.log(`Applied: ${[...results.values()].filter((v) => v === 'done').length} done, ${count('needs a look')} left alone, ${errors} errors.`);
  }

  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const order = { merge: 0, 'needs a look': 1, rename: 2, 'size only': 3 };
  const lines = [...plans].sort((a, b) => order[a.action] - order[b.action] || (a.p.brand || '').localeCompare(b.p.brand || ''));
  fs.writeFileSync(OUT, '﻿' + [
    `Action,Brand,Old name,Old size,New name,New size,Review status,Score now,Score after,Barcodes on this listing,Why it needs a look${APPLY ? ',Result' : ''}`,
    ...lines.map((x) => [
      x.action, esc(x.p.brand), esc(x.p.product_name), esc(x.p.pack_size),
      esc(x.into ? x.into.product_name : x.n.name), esc(x.into ? x.intoSize : x.n.packSize),
      x.report?.review_status || 'no report yet', x.report?.report?.overallScore ?? '',
      x.newScore ? x.newScore.report.overallScore : '',
      esc(x.links.map((l) => `${l.barcode} (${l.status})`).join(' ')), esc(x.why),
      ...(APPLY ? [esc(results.get(x))] : []),
    ].join(',')),
  ].join('\n'));
  console.log(`\n${APPLY ? 'Result' : 'Preview'} written to ${OUT}${APPLY ? '' : ' -- nothing in the database was changed'}.`);
  if (!APPLY) {
    console.log('\nBiggest score changes:');
    for (const x of moved.sort((a, b) => Math.abs(b.newScore.report.overallScore - b.report.report.overallScore) - Math.abs(a.newScore.report.overallScore - a.report.report.overallScore)).slice(0, 8)) {
      console.log(`   ${x.report.report.overallScore} -> ${x.newScore.report.overallScore}  ${x.p.product_name} [${x.p.pack_size} -> ${x.n.packSize}]`);
    }
  }
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
