// scripts/plan-brand-coverage.js
//
// READ-ONLY. For each priority brand (src/data/priorityBrands.js): how many of
// its products are listed on Blinkit, how many we already have, how many are
// missing -- and how many of those are multi-packs we'd skip anyway.
//
// Reads only Blinkit's SITEMAP files (no product pages) and our own
// blinkit_products names. A product's URL slug is its name ("amul-butter-…"),
// which is how the brand is picked out and how "do we have it" is decided --
// the same slug match scripts/backfill-blinkit-barcodes.js uses.
// Writes ../brand-coverage.csv and ../brand-missing-urls.json. Saves nothing.
//
//   node --env-file=.env scripts/plan-brand-coverage.js
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { FOOD_GROUPS, getProductSitemaps, productUrlsFrom, sleep } from '../src/services/blinkit.js';
import { PRIORITY_BRANDS, brandOfSlug } from '../src/data/priorityBrands.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const slugOf = (name) => (name || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const urlSlug = (url) => url.split('/prn/')[1]?.split('/prid/')[0] || '';
const urlId = (url) => url.split('/prid/')[1] || '';
// Listings the scraper skips anyway (see packNormalize.js / bundleListing.js).
const SKIPPED = /(^|-)(pack-of-\d+|buy-\d+-get-\d+|combo|gift|hamper|hampers|potli|sampler|variety-pack|assorted)(-|$)|\d+-x-\d/;

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
  const ours = new Set((await allRows('blinkit_products', 'product_name', (q) => q.eq('source', 'blinkit'))).map((p) => slugOf(p.product_name)));
  console.log(`our Blinkit products: ${ours.size} distinct names`);

  // The sitemap listing is kept for a day (blinkit-sitemap-cache.json) so
  // re-running after editing the brand list doesn't open ~106 files again.
  const CACHE = '../blinkit-sitemap-cache.json';
  const byId = new Map(); // prid -> { url, slug, category }
  let cached = null;
  try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (Date.now() - c.at < 24 * 3600 * 1000) cached = c; } catch { /* none yet */ }
  if (cached) {
    for (const p of cached.products) byId.set(urlId(p.url), p);
    console.log(`using the sitemap listing saved ${Math.round((Date.now() - cached.at) / 60000)} min ago (${byId.size} products)`);
  }
  const sitemaps = cached ? [] : ((await getProductSitemaps()) || []).filter((s) => FOOD_GROUPS.includes(s.group));
  if (!cached) console.log(`${sitemaps.length} food category sitemaps`);
  let done = 0;
  for (const sm of sitemaps) {
    let urls = null;
    for (let attempt = 1; attempt <= 3 && urls === null; attempt++) {
      urls = await productUrlsFrom(sm.url);
      if (urls === null) await sleep(5000);
    }
    for (const url of urls || []) {
      const id = urlId(url);
      if (id && !byId.has(id)) byId.set(id, { url, slug: urlSlug(url), category: sm.category });
    }
    if (++done % 20 === 0) console.log(`  ${done}/${sitemaps.length} sitemaps, ${byId.size} products listed`);
    await sleep(800);
  }
  if (!cached) fs.writeFileSync(CACHE, JSON.stringify({ at: Date.now(), products: [...byId.values()] }));
  console.log(`Blinkit food products listed: ${byId.size}`);

  const stats = new Map(PRIORITY_BRANDS.map((b) => [b.name, { brand: b, listed: 0, have: 0, skipped: 0, missing: [], categories: new Map() }]));
  const unmatched = new Map(); // first slug word -> count, for brands not on the list
  for (const p of byId.values()) {
    const b = brandOfSlug(p.slug);
    if (!b) { const w = p.slug.split('-')[0]; unmatched.set(w, (unmatched.get(w) || 0) + 1); continue; }
    const s = stats.get(b.name);
    s.listed++;
    s.categories.set(p.category, (s.categories.get(p.category) || 0) + 1);
    if (SKIPPED.test(p.slug)) { s.skipped++; continue; }
    if (ours.has(p.slug)) s.have++; else s.missing.push(p);
  }

  const rows = [...stats.values()].sort((a, b) => a.brand.tier - b.brand.tier || b.listed - a.listed);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  // A file left open in Excel can't be overwritten -- write a numbered copy instead.
  const save = (path, text) => { try { fs.writeFileSync(path, text); } catch (err) { if (err.code !== 'EBUSY') throw err; const alt = path.replace(/(.[a-z]+)$/, `-${Date.now() % 100000}$1`); fs.writeFileSync(alt, text); console.log(`(${path} is open -- saved as ${alt})`); } };
  save('../brand-coverage.csv', '﻿' + ['Tier,Brand,Group,Listed on Blinkit,We have,Missing,Multi-packs skipped,Coverage %,Main categories'].concat(
    rows.map((s) => [s.brand.tier, esc(s.brand.name), esc(s.brand.group), s.listed, s.have, s.missing.length, s.skipped, s.listed - s.skipped ? Math.round(100 * s.have / (s.listed - s.skipped)) : '', esc([...s.categories].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} ${n}`).join('; '))].join(','))).join('\n'));
  save('../brand-missing-urls.json', JSON.stringify(Object.fromEntries(rows.filter((s) => s.missing.length).map((s) => [s.brand.name, s.missing.map((m) => m.url)])), null, 1));

  const sum = (f) => rows.reduce((n, s) => n + f(s), 0);
  const listed = sum((s) => s.listed); const have = sum((s) => s.have); const missing = sum((s) => s.missing.length); const skipped = sum((s) => s.skipped);
  console.log(`\nPRIORITY BRANDS (${PRIORITY_BRANDS.length}): ${listed} listed on Blinkit = ${Math.round(100 * listed / byId.size)}% of all food listings`);
  console.log(`  we have ${have}, missing ${missing}, multi-packs skipped ${skipped}  -> ${Math.round(100 * have / Math.max(1, listed - skipped))}% done`);
  for (const tier of [1, 2, 3]) {
    const t = rows.filter((s) => s.brand.tier === tier);
    console.log(`  tier ${tier}: listed ${t.reduce((n, s) => n + s.listed, 0)}, have ${t.reduce((n, s) => n + s.have, 0)}, missing ${t.reduce((n, s) => n + s.missing.length, 0)}`);
  }
  console.log('\nbrand'.padEnd(40), 'listed  have  missing');
  const showGroups = new Set(['Spreads & protein', 'Spreads & oil', 'Healthy snacks', 'Protein', 'Spreads', 'Dry fruits & nuts', 'Healthy foods', 'Spreads & coffee']);
  console.log('(tier 1 and the health / protein / spreads brands)');
  for (const s of rows.filter((r) => r.brand.tier === 1 || showGroups.has(r.brand.group))) console.log(`${`T${s.brand.tier} ${s.brand.name}`.padEnd(38)} ${String(s.listed).padStart(6)} ${String(s.have).padStart(5)} ${String(s.missing.length).padStart(7)}`);
  const zero = rows.filter((r) => r.listed === 0).map((r) => r.brand.name);
  if (zero.length) console.log(`\nbrands with NOTHING matched (check their prefixes): ${zero.join(' | ')}`);
  console.log('\nbiggest brands on Blinkit that are NOT on the list (first word of the product name):');
  console.log([...unmatched].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w, n]) => `${w} ${n}`).join(' | '));
  console.log('\nwritten: ../brand-coverage.csv, ../brand-missing-urls.json -- nothing was saved to the database.');
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
