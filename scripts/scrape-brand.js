// scripts/scrape-brand.js
//
// Brand-first scraping: for one priority brand (src/data/priorityBrands.js)
// scrape ONLY the Blinkit products we don't have yet -- found from Blinkit's
// sitemap listing (kept by scripts/plan-brand-coverage.js in
// ../blinkit-sitemap-cache.json) by matching the product's URL slug, so no
// product page outside the brand is opened. Each product goes through the
// normal scrapeProduct() rules (combos / multi-packs skipped, ingredients
// from the page or a photo, barcode read from the photos and kept only if
// read the same twice) and is saved like scripts/scrape-blinkit.js saves it:
// blinkit_products, plus any barcode as a PENDING link for admin approval.
//
//   node --env-file=.env scripts/scrape-brand.js --brand pintola --dry-run
//   node --env-file=.env scripts/scrape-brand.js --brand pintola --limit 25
//   node --env-file=.env scripts/scrape-brand.js --tier 1            (every tier-1 brand, biggest first)
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { scrapeProduct, sleep } from '../src/services/blinkit.js';
import { blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';
import { PRIORITY_BRANDS, brandOfSlug } from '../src/data/priorityBrands.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const DRY_RUN = args.includes('--dry-run');
const BRAND = flag('brand');
const TIER = flag('tier') ? Number(flag('tier')) : null;
const LIMIT = parseInt(flag('limit', '0'), 10) || Infinity;
const PAGE_GAP_MS = 1500; // be polite; this is someone else's server
const SAVE_EVERY = 25;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const slugOf = (name) => (name || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SKIPPED = /(^|-)(pack-of-\d+|buy-\d+-get-\d+|combo|gift|hamper|hampers|potli|sampler|variety-pack|assorted|samples?|trial-pack|tester)(-|$)|\d+-x-\d/;

async function allRows(table, columns, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabase.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function pickBrands() {
  if (BRAND) {
    const q = BRAND.toLowerCase();
    return PRIORITY_BRANDS.filter((b) => b.name.toLowerCase().includes(q) || b.prefixes.includes(q));
  }
  if (TIER) return PRIORITY_BRANDS.filter((b) => b.tier === TIER);
  return [];
}

async function main() {
  const brands = pickBrands();
  if (!brands.length) { console.error('Give --brand <name or prefix> or --tier <1|2|3>.'); process.exitCode = 1; return; }

  let cache;
  try { cache = JSON.parse(fs.readFileSync('../blinkit-sitemap-cache.json', 'utf8')); } catch { /* none */ }
  if (!cache) { console.error('Run scripts/plan-brand-coverage.js first (it saves the sitemap listing).'); process.exitCode = 1; return; }
  const ours = new Set((await allRows('blinkit_products', 'product_name', (q) => q.eq('source', 'blinkit'))).map((p) => slugOf(p.product_name)));

  const wanted = new Map(brands.map((b) => [b.name, []]));
  for (const p of cache.products) {
    const b = brandOfSlug(p.slug);
    if (b && wanted.has(b.name) && !SKIPPED.test(p.slug) && !ours.has(p.slug)) wanted.get(b.name).push(p);
  }

  const totals = { opened: 0, saved: 0, skipped: 0, barcodes: 0, byReason: {} };
  let left = LIMIT;
  for (const [name, list] of [...wanted].sort((a, b) => b[1].length - a[1].length)) {
    if (left <= 0) break;
    const todo = list.slice(0, left);
    console.log(`\n== ${name}: ${list.length} missing, doing ${todo.length}${DRY_RUN ? ' (dry run)' : ''}`);
    let products = []; let found = [];
    // Saved every SAVE_EVERY products, not once per brand: Amul alone is
    // ~500 pages, and a stop part-way must not lose them.
    const flush = async () => {
      if (DRY_RUN || products.length === 0) { totals.saved += products.length; products = []; found = []; return; }
      const unique = [...new Map(products.map((x) => [`${x.brand}|${x.product_name}`, x])).values()];
      const { error } = await supabase.from('blinkit_products').upsert(unique, { onConflict: 'brand,product_name' });
      if (error) { console.error(`   SAVE FAILED: ${error.message}`); return; } // kept in memory, retried at the next flush
      totals.saved += unique.length;
      if (found.length) {
        const rows = found.map(({ barcode, product }) => ({
          barcode, lookup_key: blinkitLookupKey(product.source, product.brand, product.product_name), product_name: product.product_name,
          brand: product.brand || null, device_id: 'blinkit-scraper', source: 'blinkit_photo', status: 'pending',
        }));
        const r = await supabase.from('barcode_links').upsert(rows, { onConflict: 'barcode,lookup_key,device_id', ignoreDuplicates: true });
        if (r.error) console.warn(`   could not save barcode links: ${r.error.message}`);
      }
      console.log(`   -- saved ${unique.length} products, ${found.length} barcodes (pending for approval)`);
      products = []; found = [];
    };
    for (const p of todo) {
      const result = await scrapeProduct(p.url, p.category, { useAI: false, useImageFallback: true, readBarcode: true, readNutritionPhoto: true });
      await sleep(PAGE_GAP_MS);
      totals.opened++; left--;
      if (result.error) { totals.skipped++; totals.byReason[result.error] = (totals.byReason[result.error] || 0) + 1; console.log(`   skip  ${p.slug.slice(0, 50)} -- ${result.error}`); continue; }
      const prod = result.product;
      products.push(prod);
      if (result.barcode) { found.push({ barcode: result.barcode, product: prod }); totals.barcodes++; }
      console.log(`   ${result.viaImage ? 'img' : 'ok '}  ${prod.product_name.slice(0, 54).padEnd(54)} ${prod.pack_size || ''}${result.barcode ? `  [barcode ${result.barcode}]` : ''}${result.nutritionSource ? `  [nutrition: ${result.nutritionSource}]` : ''}`);
      if (products.length >= SAVE_EVERY) await flush();
    }
    await flush();
  }
  console.log(`\nDone: opened ${totals.opened} pages, saved ${totals.saved}, skipped ${totals.skipped}, barcodes read ${totals.barcodes}${DRY_RUN ? ' -- dry run, nothing saved' : ''}`);
  if (Object.keys(totals.byReason).length) console.log('skipped because:', totals.byReason);
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; });
