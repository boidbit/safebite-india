// scripts/backfill-blinkit-barcodes.js
//
// Reads barcodes for Blinkit products we scraped before the scraper started
// reading them (see scripts/scrape-blinkit.js). Our table doesn't keep each
// product's page URL, so this walks Blinkit's food sitemaps again, opens
// only the pages whose URL slug matches one of OUR product names, confirms
// it's the same product (brand + name), and reads the gallery photos with
// ZXing (src/services/barcodeReader.js -- no AI; a code only counts once
// read the same twice). A confirmed code is saved as a PENDING barcode
// link; an admin approves it (Admin > Barcode matches).
//
// Resumable: where each category got to is kept in barcode_backfill_progress
// (supabase/barcode_backfill_migration.sql), which the admin panel's
// "Barcode backfill" page shows live. Run it again and it carries on.
//
// Don't run it alongside the Blinkit scrape loop -- together they send
// Blinkit twice the traffic.
//
// Usage:
//   node --env-file=.env scripts/backfill-blinkit-barcodes.js
//   node --env-file=.env scripts/backfill-blinkit-barcodes.js --category biscuits --limit 20 --dry-run
import { createClient } from '@supabase/supabase-js';
import {
  FOOD_GROUPS,
  getProductSitemaps,
  productUrlsFrom,
  fetchText,
  jsonField,
  readGalleryBarcode,
  sleep,
} from '../src/services/blinkit.js';
import { blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';

const PAGE_GAP_MS = 1500; // same politeness gap as the scraper
const SAVE_EVERY_PAGES = 10;
const RUN_ROW = '__run__';
const NETWORK_RETRIES = 5;

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const CATEGORY = flag('category');
const PAGE_LIMIT = parseInt(flag('limit', '0'), 10) || Infinity;
const DRY_RUN = args.includes('--dry-run');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

// Blinkit's URL slug is the product name with apostrophes dropped and every
// other run of non-letters turned into a dash ("Hershey's Syrup" ->
// hersheys-syrup) -- matched 47 of 47 sampled product pages.
const slugOf = (name) => (name || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const urlSlug = (url) => url.split('/prn/')[1]?.split('/prid/')[0] || '';

async function allRows(table, columns, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(supabase.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// One row per call: a bulk upsert of rows with different columns (a
// category row and the '__run__' row) sends null for every column a row
// lacks, which the not-null counters reject.
async function saveProgress(rows) {
  if (DRY_RUN) return;
  for (const r of rows) {
    const { error } = await supabase
      .from('barcode_backfill_progress')
      .upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: 'category' });
    if (error) console.warn(`Could not save progress: ${error.message}`);
  }
}

const run = { category: RUN_ROW, status: 'running', last_product: null, started_at: new Date().toISOString() };

async function main() {
  // Our products, by the slug their Blinkit page URL would carry.
  const products = await allRows('blinkit_products', 'source, brand, product_name', (q) => q.eq('source', 'blinkit'));
  const bySlug = new Map();
  for (const p of products) {
    const s = slugOf(p.product_name);
    if (!bySlug.has(s)) bySlug.set(s, []);
    bySlug.get(s).push(p);
  }
  // Products that already have a barcode read off their photos.
  const done = new Set((await allRows('barcode_links', 'lookup_key', (q) => q.eq('source', 'blinkit_photo'))).map((r) => r.lookup_key));
  let progress = {};
  try {
    progress = Object.fromEntries((await allRows('barcode_backfill_progress', '*')).map((r) => [r.category, r]));
  } catch (err) {
    if (!DRY_RUN) throw new Error(`${err.message} -- run supabase/barcode_backfill_migration.sql first.`);
  }
  console.log(`${products.length} Blinkit products, ${done.size} already have a barcode.${DRY_RUN ? ' (dry run -- nothing saved)' : ''}`);

  const sitemaps = ((await getProductSitemaps()) || [])
    .filter((s) => FOOD_GROUPS.includes(s.group) && (!CATEGORY || s.category.includes(CATEGORY)))
    .sort((a, b) => FOOD_GROUPS.indexOf(a.group) - FOOD_GROUPS.indexOf(b.group));

  await saveProgress([run]);
  let pagesThisRun = 0;

  for (const sitemap of sitemaps) {
    if (pagesThisRun >= PAGE_LIMIT) break;
    const cursor = progress[sitemap.category] || {};
    if (cursor.exhausted) continue;

    // A dropped connection used to skip every remaining category in a few
    // seconds and end the run -- wait it out instead.
    let urls = null;
    for (let attempt = 1; attempt <= NETWORK_RETRIES && urls === null; attempt++) {
      urls = await productUrlsFrom(sitemap.url);
      if (urls === null && attempt < NETWORK_RETRIES) {
        console.warn(`   couldn't load ${sitemap.category} (network?) -- retrying in 1 min (${attempt}/${NETWORK_RETRIES})`);
        await sleep(60_000);
      }
    }
    if (urls === null) continue; // a failed fetch isn't "finished"
    const row = {
      category: sitemap.category,
      sitemap_url: sitemap.url,
      total_urls: urls.filter((u) => bySlug.has(urlSlug(u))).length,
      next_index: cursor.next_index || 0,
      pages_checked: cursor.pages_checked || 0,
      matched: cursor.matched || 0,
      barcodes_found: cursor.barcodes_found || 0,
      exhausted: false,
    };
    console.log(`\n${sitemap.group}/${sitemap.category}  (${row.total_urls} of ours in ${urls.length})`);

    let sinceSave = 0;
    for (let i = row.next_index; i < urls.length && pagesThisRun < PAGE_LIMIT; i++) {
      row.next_index = i + 1;
      const candidates = (bySlug.get(urlSlug(urls[i])) || [])
        .filter((p) => !done.has(blinkitLookupKey(p.source, p.brand, p.product_name)));
      if (candidates.length === 0) continue; // not ours, or already has one -- no need to open it

      const html = await fetchText(urls[i]);
      await sleep(PAGE_GAP_MS);
      pagesThisRun++;
      row.pages_checked++;
      sinceSave++;
      if (!html) continue;

      // Same brand + name as the row we have, not just a similar slug.
      const key = blinkitLookupKey('blinkit', jsonField(html, 'brand') || '', jsonField(html, 'product_name') || '');
      const product = candidates.find((p) => blinkitLookupKey(p.source, p.brand, p.product_name) === key);
      if (!product) continue;
      row.matched++;
      run.last_product = product.product_name;

      const barcode = await readGalleryBarcode(html);
      if (barcode) {
        done.add(key);
        row.barcodes_found++;
        console.log(`   ${barcode}  ${product.brand} — ${product.product_name}`);
        if (!DRY_RUN) {
          const { error } = await supabase.from('barcode_links').upsert({
            barcode,
            lookup_key: key,
            product_name: product.product_name,
            brand: product.brand || null,
            device_id: 'blinkit-scraper',
            source: 'blinkit_photo',
            status: 'pending',
          }, { onConflict: 'barcode,lookup_key,device_id', ignoreDuplicates: true });
          if (error) console.warn(`   could not save: ${error.message}`);
        }
      }

      if (sinceSave >= SAVE_EVERY_PAGES) {
        await saveProgress([row, run]);
        sinceSave = 0;
      }
    }

    if (row.next_index >= urls.length) row.exhausted = true;
    await saveProgress([row, run]);
    console.log(`   checked ${row.pages_checked}, matched ${row.matched}, barcodes ${row.barcodes_found}`);
  }

  run.status = pagesThisRun >= PAGE_LIMIT ? 'stopped' : 'finished';
  await saveProgress([run]);
  console.log(`\nDone: ${pagesThisRun} pages opened this run.`);
}

// Ctrl+C / the process being stopped: record it, so the admin page doesn't
// keep showing "running".
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    run.status = 'stopped';
    await saveProgress([run]);
    process.exit(130);
  });
}

main().catch(async (err) => {
  console.error(err.message);
  run.status = 'stopped';
  await saveProgress([run]);
  process.exitCode = 1;
});
