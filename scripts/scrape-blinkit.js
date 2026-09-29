// scripts/scrape-blinkit.js
//
// Walks Blinkit's food categories and saves brand / product name /
// ingredients (plus nutrition and FSSAI licence) into blinkit_products.
//
// Why this exists: Open Food Facts ingredient text is transcribed from
// photos of packs, which is the root cause of nearly every parsing bug
// in this project -- garbled brackets, missing commas, dropped
// ingredients. Blinkit's text is manufacturer-supplied, so it's clean.
//
// Discovery uses Blinkit's published sitemaps, not category pages:
// category listings vary by delivery location (an anonymous request for
// the cold-drinks category returns dairy), while the sitemaps are
// static and organised by category. robots.txt disallows /s/* (search),
// which this never touches.
//
// Most products expose ingredients as a structured attribute. For the
// ones that don't, Gemini is asked to find the ingredients inside the
// other text already on that page (--no-ai to skip; real runs showed a
// near-zero recovery rate, so it's off by default via the loop script).
// --image-fallback goes further: when there's no ingredients text
// anywhere on the page either, it downloads the product's gallery
// photos and asks Gemini to read an ingredients panel directly off one
// of them -- some products (seen on real besan listings) only ever
// publish it that way. Costs one vision call per photo checked, so
// it's opt-in.
//
// Barcodes: Blinkit pages carry none, so each saved product's gallery
// photos are also read with ZXing (src/services/barcodeReader.js -- no AI;
// a code only counts once read the same twice). A confirmed code is saved
// as a PENDING barcode link for an admin to approve (Admin > Barcode
// matches), never straight onto the product. --no-barcodes skips this.
//
// Usage:
//   node scripts/scrape-blinkit.js --list
//   node scripts/scrape-blinkit.js --all                          (per-category quota comes from FOOD_GROUP_QUOTA, not a flag)
//   node scripts/scrape-blinkit.js --category soft-drinks --limit 15
//   node scripts/scrape-blinkit.js --all --dry-run --no-ai
//   node scripts/scrape-blinkit.js --all --no-ai --image-fallback
//   node scripts/scrape-blinkit.js --category soft-drinks --limit 15 --no-barcodes
//
// --all mode gets its per-category count from src/services/blinkit.js's
// FOOD_GROUP_QUOTA instead of --per-category now, so higher-priority
// categories get more products per round, not just an earlier turn.
// --per-category only still matters as a fallback for a food group not
// yet listed there; a manual --category run uses --limit instead.

import { createClient } from '@supabase/supabase-js';

import {
  FOOD_GROUPS,
  FOOD_GROUP_QUOTA,
  getProductSitemaps,
  productUrlsFrom,
  scrapeProduct,
  sleep,
} from '../src/services/blinkit.js';
import { blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';

const REQUEST_GAP_MS = 1500; // be polite; this is someone else's server

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const CATEGORY = flag('category');
const SCRAPE_ALL = has('all');
const LIMIT = parseInt(flag('limit', '15'), 10);
const PER_CATEGORY = parseInt(flag('per-category', '8'), 10);
const DRY_RUN = has('dry-run');
const USE_AI = !has('no-ai');
const USE_IMAGE_FALLBACK = has('image-fallback');
const READ_BARCODES = !has('no-barcodes');

function client() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Where each category got to last time, so repeated runs walk forward
 * through a category instead of re-fetching its first few products for
 * ever. Shares the blinkit_seed_progress table with the scheduled job.
 */
async function loadProgress(supabase) {
  const { data, error } = await supabase.from('blinkit_seed_progress').select('*');
  if (error) {
    console.warn('Could not read progress (has blinkit_seed_progress_schema.sql been run?):', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((row) => [row.category, row]));
}

async function saveProgress(supabase, rows) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('blinkit_seed_progress')
    .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'category' });
  if (error) console.warn('Could not save progress:', error.message);
}

async function save(products) {
  const supabase = client();
  if (!supabase) {
    console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — nothing saved.');
    return false;
  }
  const { error } = await supabase
    .from('blinkit_products')
    .upsert(products, { onConflict: 'brand,product_name' });

  if (error) {
    console.error(`Save failed: ${error.message}`);
    console.error('(Have blinkit_products_schema.sql and blinkit_products_migration.sql both been run?)');
    return false;
  }
  return true;
}

// barcode_links rows the public key may insert (pending only -- see
// supabase/barcode_links_schema.sql). One scraper "device", so a re-scrape
// of the same product doesn't add a second confirmation of its own link.
async function saveBarcodeLinks(found) {
  const supabase = client();
  if (!supabase || found.length === 0) return;
  const rows = found.map(({ barcode, product }) => ({
    barcode,
    lookup_key: blinkitLookupKey(product.source, product.brand, product.product_name),
    product_name: product.product_name,
    device_id: 'blinkit-scraper',
    source: 'blinkit_photo',
    status: 'pending',
  }));
  const { error } = await supabase
    .from('barcode_links')
    .upsert(rows, { onConflict: 'barcode,lookup_key,device_id', ignoreDuplicates: true });
  if (error) console.warn(`Could not save barcode links: ${error.message}`);
}

async function main() {
  // Check credentials before scraping anything. Discovering this at the
  // save step instead means throwing away a full run's work — which is
  // exactly what happened to the first four scheduled runs.
  if (!DRY_RUN && !client()) {
    console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
    console.error('Set them as repository secrets (Settings -> Secrets and variables -> Actions), or use --dry-run.');
    process.exitCode = 1;
    return;
  }

  const sitemaps = await getProductSitemaps();
  if (!sitemaps) {
    console.error('Could not fetch the Blinkit sitemap index. Check your connection and try again.');
    process.exitCode = 1;
    return;
  }

  if (has('list') || (!CATEGORY && !SCRAPE_ALL)) {
    const byGroup = {};
    for (const s of sitemaps) (byGroup[s.group] ||= new Set()).add(s.category);
    console.log(`${sitemaps.length} categories. Food groups marked with *:\n`);
    for (const [group, cats] of Object.entries(byGroup)) {
      console.log(`  ${FOOD_GROUPS.includes(group) ? '*' : ' '} ${group}`);
      console.log(`      ${[...cats].join(', ')}`);
    }
    console.log('\n  node scripts/scrape-blinkit.js --all --per-category 8');
    console.log('  node scripts/scrape-blinkit.js --category soft-drinks --limit 15');
    return;
  }

  let targets;
  if (SCRAPE_ALL) {
    // .filter() alone keeps the sitemap's own (arbitrary) order -- sorting
    // by FOOD_GROUPS' index is what actually makes that array's order
    // mean anything, so everyday-purchase groups get walked first.
    targets = sitemaps
      .filter((s) => FOOD_GROUPS.includes(s.group))
      .sort((a, b) => FOOD_GROUPS.indexOf(a.group) - FOOD_GROUPS.indexOf(b.group));
    // --per-category is ignored in --all mode -- FOOD_GROUP_QUOTA decides
    // per-group instead, so top-priority groups don't just get walked
    // first, they finish scraping sooner too. (--limit / --per-category
    // still apply to a manual single-category run, below.)
    const quotaTiers = [...new Set(FOOD_GROUPS.map((g) => FOOD_GROUP_QUOTA[g] ?? PER_CATEGORY))].sort((a, b) => b - a);
    console.log(`Walking ${targets.length} food categories -- ${quotaTiers.join('/')} products each per round (higher for higher-priority groups).`);
  } else {
    targets = sitemaps.filter((s) => s.category.includes(CATEGORY) || s.group.includes(CATEGORY));
    if (targets.length === 0) {
      console.error(`No category matching "${CATEGORY}". Run with --list to see the options.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Matched ${targets.length} category/categories for "${CATEGORY}".`);
  }
  console.log(USE_AI ? 'AI text fallback: on' : 'AI text fallback: off');
  console.log(USE_IMAGE_FALLBACK ? 'AI image fallback: on' : 'AI image fallback: off');
  console.log(READ_BARCODES ? 'Barcodes from photos: on\n' : 'Barcodes from photos: off\n');

  let totalSaved = 0;
  let skipped = 0;
  let aiRescued = 0;
  let imageRescued = 0;
  let barcodesFound = 0;
  let categoriesDone = 0;
  let categoriesExhausted = 0;
  let anySaveFailed = false;

  // In --all mode, resume each category where the last run stopped.
  // Without this, repeated runs would re-scrape the same opening
  // products of every category and never reach the rest.
  const supabase = DRY_RUN ? null : client();
  const progress = supabase && SCRAPE_ALL ? await loadProgress(supabase) : {};

  for (const sitemap of targets) {
    const cursor = progress[sitemap.category];
    if (SCRAPE_ALL && cursor?.exhausted) continue;

    const startIndex = SCRAPE_ALL ? cursor?.next_index || 0 : 0;
    const max = SCRAPE_ALL ? (FOOD_GROUP_QUOTA[sitemap.group] ?? PER_CATEGORY) : LIMIT;

    const all = await productUrlsFrom(sitemap.url);
    // null means the fetch failed — don't let a transient network error
    // look like "this category is finished".
    if (all === null) continue;

    const urls = all.slice(startIndex, startIndex + max);
    if (urls.length === 0) {
      if (SCRAPE_ALL && startIndex >= all.length && !DRY_RUN) {
        await saveProgress(supabase, [{
          category: sitemap.category, sitemap_url: sitemap.url,
          next_index: startIndex, exhausted: true,
          products_saved: cursor?.products_saved || 0,
        }]);
        categoriesExhausted++;
      }
      continue;
    }

    console.log(`${sitemap.group}/${sitemap.category}  [${startIndex}-${startIndex + urls.length} of ${all.length}]`);
    const collectedHere = [];
    const barcodesHere = [];

    for (const url of urls) {
      const result = await scrapeProduct(url, sitemap.category, { useAI: USE_AI, useImageFallback: USE_IMAGE_FALLBACK, readBarcode: READ_BARCODES });
      await sleep(REQUEST_GAP_MS);

      if (result.error) {
        skipped++;
        continue;
      }

      collectedHere.push(result.product);
      if (result.viaAI) aiRescued++;
      if (result.viaImage) imageRescued++;
      const p = result.product;
      if (result.barcode && !barcodesHere.some((b) => b.barcode === result.barcode && b.product.product_name === p.product_name)) {
        barcodesHere.push({ barcode: result.barcode, product: p });
      }
      const tag = result.viaImage ? 'img' : result.viaAI ? 'ai ' : 'ok ';
      console.log(`   ${tag} ${p.brand || '?'} — ${p.product_name}${result.barcode ? `  [barcode ${result.barcode}]` : ''}`);
      console.log(`        ${p.ingredients_text.replace(/\s+/g, ' ').slice(0, 100)}…`);
    }

    // The same product can turn up in more than one category's sitemap
    // -- one row per brand+name so this category's own upsert doesn't
    // fight itself. A duplicate across two DIFFERENT categories (each
    // saved in its own call, not one shared batch any more) is harmless:
    // upsert just writes the same row twice.
    const dedupedHere = [...new Map(collectedHere.map((p) => [`${p.brand}|${p.product_name}`, p])).values()];

    if (DRY_RUN) {
      totalSaved += dedupedHere.length;
      barcodesFound += barcodesHere.length;
      continue;
    }

    // Saved right after THIS category finishes, not batched until the
    // whole round (all ~100+ categories) ends. A round can take several
    // minutes; batching every category's products and progress into one
    // save at the very end meant a crash or dropped connection partway
    // through -- a real, observed failure mode (Gemini quota, Blinkit
    // rate-limiting, a network blip) -- discarded every category's work
    // for that entire round, including ones that had finished minutes
    // earlier. Saving as each category finishes makes that work durable
    // immediately, and means category order now actually matters: a
    // round that dies partway still keeps everything up to that point.
    if (dedupedHere.length > 0) {
      if (!(await save(dedupedHere))) {
        // Leave this category's cursor untouched so the next run retries
        // it rather than skipping past products that were never stored
        // -- but keep going to the rest of this round instead of
        // aborting it entirely; every earlier category is already saved.
        anySaveFailed = true;
        continue;
      }
      totalSaved += dedupedHere.length;
      // Only once the products themselves are stored.
      await saveBarcodeLinks(barcodesHere);
      barcodesFound += barcodesHere.length;
    }

    if (SCRAPE_ALL) {
      await saveProgress(supabase, [{
        category: sitemap.category, sitemap_url: sitemap.url,
        next_index: startIndex + urls.length,
        exhausted: false,
        products_saved: (cursor?.products_saved || 0) + dedupedHere.length,
      }]);
    }
    categoriesDone++;
  }

  console.log(`\n${totalSaved} products with ingredients (${aiRescued} recovered by AI text, ${imageRescued} by AI image), ${skipped} skipped.`);
  if (READ_BARCODES) console.log(`${barcodesFound} barcodes confirmed from photos${DRY_RUN ? '' : ' (saved for admin review)'}.`);

  if (DRY_RUN) {
    console.log('--dry-run: nothing written to the database.');
    return;
  }

  console.log(`Saved ${totalSaved} products to blinkit_products.`);
  if (SCRAPE_ALL) {
    console.log(`Progress updated for ${categoriesDone + categoriesExhausted} categories${categoriesExhausted ? ` (${categoriesExhausted} now complete)` : ''}.`);
  }
  if (anySaveFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
