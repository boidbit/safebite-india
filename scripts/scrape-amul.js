// scripts/scrape-amul.js
//
// Amul's own shop (shop.amul.com) as a source: the brand's own data, cleaner
// than Blinkit's. Each listing gives the barcode as a field, the ingredients
// as text, and its gallery photos are named by what they show -- "07-ni-table"
// is the nutrition table (Amul's own typeset artwork, not a photo of a pack).
//
// The shop shows products only once a delivery pincode is chosen, so a
// headless browser picks one (as a shopper would), then opens each category
// and each product page, and reads the product data the page itself loads.
// The shop's API takes a signed token per call; we don't make our own calls
// to it.
//
// Per product:
//  - "| Pack of 30" listings are reduced to the single unit, and listings of
//    the same unit (same barcode) become one product;
//  - the barcode field is checked against the barcode photo (ZXing);
//  - the nutrition table photo is read twice (nutritionPhotoRead.js) and
//    counts only when both reads agree;
//  - it is matched to what we already have, by barcode and then by name and
//    pack size, and the figures compared.
//
// Reading saves nothing to the database. Every product's result goes to
// ../amul-scrape-progress.json as it's done (a stop part-way loses nothing,
// and photo reads are never repeated); the summary goes to ../amul-preview.json.
//
// Saving, in two steps:
//  --apply  every product with a barcode (and an ingredients list) goes into
//           blinkit_products as source 'amul_shop', for generate-reports.js to
//           score like any scraped product. A name Blinkit already has
//           exactly is not added again; its barcode is linked to that product.
//  --link   once the reports exist: each barcode is linked (approved) to its
//           Amul product and any other link for that barcode is retired, so a
//           scan opens the Amul product. A barcode whose photo shows a
//           different number than Amul's data stays pending, both numbers.
//           An older product saved under the barcode itself is hidden by the
//           SQL file this writes (review status needs a signed-in admin).
//
//   node --env-file=.env scripts/scrape-amul.js              (read the shop)
//   node --env-file=.env scripts/scrape-amul.js --limit 5
//   node --env-file=.env scripts/scrape-amul.js --summary    (preview again, shop not opened)
//   node --env-file=.env scripts/scrape-amul.js --apply
//   node --env-file=.env scripts/generate-reports.js         (until the Amul rows are done)
//   node --env-file=.env scripts/scrape-amul.js --link
import fs from 'fs';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { supabase } from '../src/services/supabaseClient.js';
import { fetchImageBuffer, sleep } from '../src/services/blinkit.js';
import { isValidGtin, readBarcodesFromPhoto, confirmBarcode } from '../src/services/barcodeReader.js';
import { nutritionFromPhotos, asBlinkitAttributes } from '../src/services/nutritionPhotoRead.js';
import { tableProblems } from '../src/services/dataHealth.js';
import { parsePack } from '../src/services/productFamilies.js';
import { blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';
import { optimizeAndUploadBlinkitImage } from '../src/services/blinkitImageOptimizer.js';
import { isBundleListing } from '../src/services/bundleListing.js';
import { chunk } from '../src/utils/chunk.js';

const args = process.argv.slice(2);
const LIMIT = parseInt(args[args.indexOf('--limit') + 1], 10) || Infinity;
const SHOP = 'https://shop.amul.com';
const PINCODE = '110001';
const PROGRESS = '../amul-scrape-progress.json';
const PREVIEW = '../amul-preview.json';
const SAVED = '../amul-saved.json';
const SQL_OUT = '../amul-hide-old-barcode-products.sql';
const SOURCE = 'amul_shop';
const BRAND = 'Amul';
const progress = (() => { try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return {}; } })();
const save = () => fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));

// Gift boxes and hampers hold several different products.
const NOT_ONE_PRODUCT = /\b(hamper|combo|assorted|celebration|festive|gift box|variety)\b/i;
// A sample / trial bundle isn't the product people buy.
const TRIAL = /\btrial pack\b/i;
// Gallery photos that are never the nutrition table.
const NOT_TABLE = /hero|fop|bar-?code|storage|manufacturer|marketer|claims|extra-view/i;

const stripHtml = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s || '').toLowerCase().replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && w !== 'amul'));

/** "Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 8" -> name + pack size of ONE unit. */
export function unitOf(listingName) {
  const noMulti = listingName.replace(/\s*\|\s*pack of\b.*$/i, '').trim();
  const m = noMulti.match(/^(.*),\s*([\d.]+\s*(?:g|kg|ml|l|ltr|litre)\b.*)$/i);
  const name = (m ? m[1] : noMulti).replace(/\s*\|\s*/g, ' - ').trim();
  return { name, packSize: m ? m[2].trim() : null };
}

/** Ingredients text without the allergen note (kept apart). */
function ingredientsOf(html) {
  const text = stripHtml(html).replace(/^ingredients\s*:?\s*/i, '');
  const [ingredients, allergen] = text.split(/allergen information\s*:?/i);
  return { ingredients: ingredients.trim().replace(/[.\s]+$/, ''), allergen: allergen?.trim() || null };
}

async function photoAsJpeg(url) {
  const buf = await fetchImageBuffer(url);
  if (!buf) return null;
  try { return await sharp(buf).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer(); } catch { return null; }
}

/** A browser with a delivery pincode chosen, and every product-data response it receives. */
async function openShop() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
  const seen = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/api/1/entity/ms.products')) return;
    try { seen.push({ url: decodeURIComponent(res.url()), body: await res.json() }); } catch { /* not JSON */ }
  });
  await page.goto(`${SHOP}/en/browse/protein`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('#search').fill(PINCODE);
  await page.waitForTimeout(2500);
  await page.locator('.searchitem-name').first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  return { browser, page, seen };
}

/** Every listing in every category, scrolled through like a shopper would. */
async function shopListings({ page, seen }) {
  const groups = await (await fetch(`${SHOP}/en/sitemap-groups-1.xml`)).text();
  const categories = [...groups.matchAll(/\/en\/browse\/([a-z0-9-]+)/g)].map((m) => m[1]);
  const listings = new Map();
  for (const cat of categories) {
    seen.length = 0;
    await page.goto(`${SHOP}/en/browse/${cat}`, { waitUntil: 'networkidle', timeout: 60000 });
    for (let still = 0, last = -1; still < 2; ) {
      await page.mouse.wheel(0, 5000);
      await page.waitForTimeout(1500);
      const n = seen.length;
      still = n === last ? still + 1 : 0;
      last = n;
    }
    for (const { url, body } of seen) {
      if (!url.includes(`[value][0]=${cat}`)) continue;
      for (const p of body.data || []) if (!listings.has(p.alias)) listings.set(p.alias, { alias: p.alias, name: p.name, category: cat });
    }
    console.log(`   ${cat.padEnd(20)} ${listings.size} listings so far`);
  }
  return [...listings.values()];
}

/** The full product record the product page loads (barcode, images, ingredients). */
async function productDetail({ page, seen }, alias) {
  seen.length = 0;
  await page.goto(`${SHOP}/en/product/${alias}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
  const hit = seen.find(({ url, body }) => url.includes(`"alias":"${alias}"`) && body.data?.length);
  return hit ? { ...hit.body.data[0], fileBase: hit.body.fileBaseUrl } : null;
}

async function readListing(p) {
  const { name, packSize } = unitOf(p.name);
  // Image paths come both ways: "6adc.../2.jpg" (under fileBase) and "s/62fa.../6adc.../2.jpg" (from the site root).
  const images = (p.images || []).map(({ image }) => (/^https?:/.test(image) ? image : image.startsWith('s/') ? `${SHOP}/${image}` : `${p.fileBase}${image}`));
  const { ingredients, allergen } = ingredientsOf(p.metafields?.ingredients);
  const fieldCode = [...(p.unique_barcodes || []), p.barcode].find((c) => isValidGtin(String(c || '')));
  const out = { alias: p.alias, listing: p.name, category: p.category, name, packSize, ingredients, allergen, images, barcode: fieldCode || null };

  // The barcode field, checked against the barcode photo.
  const codePhoto = images.find((u) => /bar-?code/i.test(u));
  if (fieldCode && codePhoto) {
    const buf = await photoAsJpeg(codePhoto);
    const onPhoto = buf ? confirmBarcode(await readBarcodesFromPhoto(buf, 0)) : null;
    out.barcodeCheck = onPhoto === fieldCode ? 'matches photo' : onPhoto ? `photo shows ${onPhoto}` : 'photo not readable';
  } else {
    out.barcodeCheck = fieldCode ? 'no barcode photo' : 'no barcode';
  }

  // The nutrition table photo first, then any photo that might be one.
  const tableFirst = [...images.filter((u) => /ni-table|nutri/i.test(u)), ...images.filter((u) => !/ni-table|nutri/i.test(u) && !NOT_TABLE.test(u))];
  const res = tableFirst.length
    ? await nutritionFromPhotos(name, tableFirst, { photo: photoAsJpeg, maxPhotos: 3, isImpossible: (t) => tableProblems(t).length > 0 })
    : { failed: 'no table photo' };
  if (res.per100) { out.per100 = res.per100; out.nutritionFrom = tableFirst[res.photoNo - 1].split('/').pop(); } else out.nutritionFailed = res.failed;
  return out;
}

async function ourProducts() {
  const rows = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('product_reports')
      .select('lookup_key, product_name, source, review_status, pack:report->>packSize, n:report->nutrientsPer100')
      .ilike('product_name', '%amul%').neq('review_status', 'rejected').range(f, f + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const { data: links } = await supabase.from('barcode_links').select('barcode, lookup_key').eq('status', 'approved').like('barcode', '890126%');
  return { rows, links: links || [] };
}

function match(product, { rows, links }) {
  if (product.barcode) {
    const keys = new Set([`barcode:${product.barcode}`, ...links.filter((l) => l.barcode === product.barcode).map((l) => l.lookup_key)]);
    const hit = rows.find((r) => keys.has(r.lookup_key));
    if (hit) return { by: 'barcode', row: hit };
  }
  const want = words(product.name);
  const pack = parsePack(product.packSize)?.key;
  // Words that make it a different product: "Kool Protein Kesar" is not "Kool Kesar".
  const kind = (s) => [...new Set([...norm(s).matchAll(/\b(protein|organic|lactose free|sugar free|no added sugar|diet|lite|light)\b/g)].map((m) => m[1]))].sort().join('|');
  let best = null;
  for (const r of rows) {
    if (kind(product.name) !== kind(r.product_name)) continue;
    const have = words(r.product_name);
    const shared = [...want].filter((w) => have.has(w)).length;
    const score = shared / Math.max(want.size, have.size);
    const samePack = pack && parsePack(r.pack)?.key === pack;
    if (score >= 0.75 && (samePack || !pack) && (!best || score > best.score)) best = { by: 'name', row: r, score };
  }
  return best;
}

const FIELDS = { caloriesKcal: 'kcal', proteinG: 'protein', carbohydrateG: 'carbs', totalSugarG: 'sugar', addedSugarG: 'added sugar', totalFatG: 'fat', saturatedFatG: 'sat fat', sodiumMg: 'sodium' };
function differences(amul, ours) {
  if (!amul || !ours) return [];
  return Object.entries(FIELDS).flatMap(([k, label]) => {
    const a = amul[k], o = ours[k];
    if (typeof a !== 'number' || typeof o !== 'number') return [];
    return Math.abs(a - o) > Math.max(0.5, Math.abs(a) * 0.1) ? [`${label} ${o} -> ${a}`] : [];
  });
}

async function main() {
  if (args.includes('--apply')) return apply();
  if (args.includes('--link')) return link();
  if (args.includes('--summary')) return summarize(); // from what's already read, without opening the shop
  console.log('Amul shop: reading the product list ...');
  const shop = await openShop();
  const listings = (await shopListings(shop)).filter((p) => !NOT_ONE_PRODUCT.test(p.name));
  const left = listings.filter((p) => !progress[p.alias]);
  const todo = left.slice(0, LIMIT);
  console.log(`${listings.length} listings, ${listings.length - left.length} already read, reading ${todo.length}\n`);

  for (const p of todo) {
    try {
      const detail = await productDetail(shop, p.alias);
      if (!detail) { console.error(`   ${p.name}: product page gave no data`); continue; }
      progress[p.alias] = await readListing({ ...detail, category: p.category });
    } catch (e) {
      console.error(`   ${p.name}: ${e.message}`);
      continue;
    }
    const r = progress[p.alias];
    save();
    console.log(`   ${r.name.slice(0, 50).padEnd(50)} ${String(r.packSize || '').padEnd(8)} ${r.barcode || '-'} (${r.barcodeCheck})  ${r.per100 ? `table: ${r.nutritionFrom}` : `no table: ${r.nutritionFailed}`}`);
    await sleep(1500); // be polite; this is someone else's server
  }
  await shop.browser.close();
  await summarize();
}

/**
 * One product per unit: listings of the same unit share its barcode (or its
 * name and pack). The listing kept is the one with a nutrition table, then
 * the one not sold as a gift pack (its name is the product's plain name).
 */
function unitsFrom() {
  const rank = (r) => (r.per100 ? 2 : 0) + (/gift/i.test(r.listing) ? 0 : 1);
  const units = new Map();
  for (const r of Object.values(progress)) {
    const key = r.barcode || `${norm(r.name)}|${parsePack(r.packSize)?.key || ''}`;
    const prev = units.get(key);
    if (!prev || rank(r) > rank(prev)) units.set(key, r);
  }
  return [...units.values()];
}

async function summarize() {
  const ours = await ourProducts();
  const products = unitsFrom().map((r) => {
    const m = match(r, ours);
    return { ...r, ourMatch: m ? { by: m.by, name: m.row.product_name, pack: m.row.pack, lookup_key: m.row.lookup_key } : null, differs: m ? differences(r.per100, m.row.n) : [] };
  });
  fs.writeFileSync(PREVIEW, JSON.stringify(products, null, 1));

  const count = (f) => products.filter(f).length;
  console.log(`\n== Preview (nothing saved) ==`);
  console.log(`unique products: ${products.length}  (from ${Object.keys(progress).length} listings)`);
  console.log(`barcode: ${count((p) => p.barcode)}  | checked on the barcode photo: ${count((p) => p.barcodeCheck === 'matches photo')}  | photo shows a different code: ${count((p) => /photo shows/.test(p.barcodeCheck))}`);
  console.log(`ingredients text: ${count((p) => p.ingredients.length > 10)}`);
  console.log(`nutrition table read (two reads agree): ${count((p) => p.per100)}  | not read: ${count((p) => !p.per100)}`);
  console.log(`already in our app: ${count((p) => p.ourMatch)} (by barcode ${count((p) => p.ourMatch?.by === 'barcode')}, by name ${count((p) => p.ourMatch?.by === 'name')})  | new: ${count((p) => !p.ourMatch)}`);
  console.log(`of those already in the app, figures differ from Amul's: ${count((p) => p.differs.length)}`);
  for (const p of products.filter((x) => x.differs.length).slice(0, 15)) console.log(`   ${p.name.slice(0, 45).padEnd(45)} ${p.differs.join(', ')}`);
  console.log(`\nfull list: ${PREVIEW}`);
}

const slug = (s) => norm(s).replace(/ /g, '-').slice(0, 120);
const photoCodeOf = (check) => (String(check).match(/photo shows (\d+)/) || [])[1] || null;

async function allRows(build) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build().range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function apply() {
  const take = unitsFrom().filter((u) => u.barcode && !TRIAL.test(u.listing));
  const noIngredients = take.filter((u) => u.ingredients.length < 12);
  const ready = take.filter((u) => u.ingredients.length >= 12);

  // Same name in more than one pack size: the size goes into the name, or one
  // would overwrite the other (a product is kept by brand + name).
  const sameName = new Map();
  for (const u of ready) sameName.set(norm(u.name), (sameName.get(norm(u.name)) || 0) + 1);
  for (const u of ready) u.saveName = sameName.get(norm(u.name)) > 1 ? `${u.name} ${parsePack(u.packSize)?.label || u.packSize}` : u.name;

  // Blinkit files Amul under several brand names ("Amul Kool", "Amul Tru", ...).
  const existing = await allRows(() => supabase.from('blinkit_products').select('source, brand, product_name, pack_size').or('brand.ilike.%amul%,brand.ilike.%janmay%'));
  const saved = [];
  let added = 0;
  for (const u of ready) {
    // Blinkit has the same name in another pack size (Mango Lassi 140 ml, Amul's is 1 L): a product of its own.
    const packKey = parsePack(u.packSize)?.key;
    const otherSize = existing.some((e) => e.source !== SOURCE && norm(e.product_name) === norm(u.saveName) && packKey && parsePack(e.pack_size)?.key && parsePack(e.pack_size).key !== packKey);
    if (otherSize) u.saveName = `${u.saveName} ${parsePack(u.packSize).label}`;
    const base = { alias: u.alias, name: u.saveName, barcode: u.barcode, photoCode: photoCodeOf(u.barcodeCheck), barcodeCheck: u.barcodeCheck };
    if (existing.some((e) => e.source === SOURCE && e.product_name === u.saveName)) { // saved by an earlier --apply
      saved.push({ ...base, lookupKey: blinkitLookupKey(SOURCE, BRAND, u.saveName) });
      continue;
    }
    const clash = existing.find((e) => norm(e.product_name) === norm(u.saveName) && e.source !== SOURCE);
    if (clash) {
      saved.push({ ...base, lookupKey: blinkitLookupKey(clash.source, clash.brand, clash.product_name), alreadyHad: clash.source });
      console.log(`   had   ${u.saveName} (from ${clash.source}) -- barcode goes to that one`);
      continue;
    }
    if (isBundleListing(u.saveName)) console.warn(`   note: "${u.saveName}" reads as a bundle; generate-reports.js will skip it`);
    const photo = u.images.find((x) => /02-fop/i.test(x)) || u.images.find((x) => /hero/i.test(x)) || u.images[0];
    const optimized = photo ? await optimizeAndUploadBlinkitImage(photo, `amul-shop-${slug(u.saveName)}`) : null;
    const row = {
      source: SOURCE,
      brand: BRAND,
      product_name: u.saveName,
      ingredients_text: u.ingredients,
      category: u.category,
      image_url: photo || null,
      optimized_image_url: optimized?.url || null,
      optimized_image_bytes: optimized?.bytes || null,
      nutrition: u.per100 ? { ...asBlinkitAttributes(u.per100), 'Nutrition source': `Amul shop: ${u.nutritionFrom} (read twice)` } : {},
      pack_size: u.packSize,
      serving_size: null,
      fssai_license: null,
      scraped_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('blinkit_products').upsert(row, { onConflict: 'brand,product_name' });
    if (error) { console.error(`   SAVE FAILED ${u.saveName}: ${error.message}`); continue; }
    saved.push({ ...base, lookupKey: blinkitLookupKey(SOURCE, BRAND, u.saveName) });
    added++;
    console.log(`   added ${u.saveName.slice(0, 55).padEnd(55)} ${u.packSize || ''}${u.per100 ? '' : '  (no nutrition table)'}${optimized ? '' : '  (photo not copied)'}`);
  }
  fs.writeFileSync(SAVED, JSON.stringify(saved, null, 1));
  console.log(`\nwith a barcode: ${take.length} | added: ${added} | already had (barcode goes to that product): ${saved.length - added} | left out, no ingredients list: ${noIngredients.length}`);
  for (const u of noIngredients) console.log(`   no ingredients: ${u.name} ${u.packSize || ''}`);
  console.log(`\nnext: node --env-file=.env scripts/generate-reports.js (until the Amul rows are done), then --link`);
}

async function link() {
  const saved = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
  const have = new Set();
  for (const keys of chunk(saved.map((s) => s.lookupKey), 100)) {
    const { data, error } = await supabase.from('product_reports').select('lookup_key').in('lookup_key', keys);
    if (error) throw new Error(error.message);
    for (const r of data) have.add(r.lookup_key);
  }
  const now = new Date().toISOString();
  const toHide = [];
  const counts = { approved: 0, pending: 0, retired: 0, notReady: 0 };
  for (const s of saved) {
    if (!have.has(s.lookupKey)) { counts.notReady++; continue; }
    const doubtful = Boolean(s.photoCode);
    const codes = doubtful ? [s.barcode, s.photoCode] : [s.barcode];
    const rows = codes.map((code) => ({
      barcode: code, lookup_key: s.lookupKey, product_name: s.name, brand: BRAND, device_id: 'amul-shop', source: SOURCE,
      status: doubtful ? 'pending' : 'approved', reviewed_at: doubtful ? null : now,
    }));
    const { error } = await supabase.from('barcode_links').upsert(rows, { onConflict: 'barcode,lookup_key,device_id' });
    if (error) { console.error(`   ${s.name}: ${error.message}`); continue; }
    if (doubtful) { counts.pending += codes.length; console.log(`   pending  ${s.name}: Amul's data says ${s.barcode}, the barcode photo shows ${s.photoCode}`); continue; }
    counts.approved++;

    // The barcode is the Amul product's now: any other link for it is retired ...
    const { data: retired } = await supabase.from('barcode_links').update({ status: 'rejected', reviewed_at: now })
      .eq('barcode', s.barcode).neq('lookup_key', s.lookupKey).in('status', ['pending', 'approved']).select('product_name');
    for (const r of retired || []) console.log(`   retired  ${s.barcode} -> ${r.product_name} (now ${s.name})`);
    counts.retired += retired?.length || 0;
    // ... an Open Food Facts row still waiting for a report won't become one ...
    await supabase.from('products').update({ report_generated_at: now }).eq('lookup_key', `barcode:${s.barcode}`).is('report_generated_at', null);
    // ... and an older product saved under the barcode itself is hidden (SQL below).
    const { data: old } = await supabase.from('product_reports').select('id, product_name, review_status')
      .eq('lookup_key', `barcode:${s.barcode}`).neq('review_status', 'rejected');
    for (const o of old || []) toHide.push({ ...o, barcode: s.barcode, newName: s.name });
  }

  if (toHide.length) {
    const reason = 'Replaced by the Amul shop product with the same barcode (brand data).';
    const ids = toHide.map((o) => `  '${o.id}'`).join(',\n');
    fs.writeFileSync(SQL_OUT, `-- FoodGuard India -- hide ${toHide.length} older product(s) saved under a barcode that now opens
-- the Amul shop product (Amul's own data). Run once in the Supabase SQL Editor, all of it.
--
-- Review status can only be changed by a signed-in admin (the
-- product_reports_guard_review_status trigger). The two set_config lines make
-- this one transaction count as that, nothing else. A hidden product can be
-- approved again from Admin > Products > Rejected.
${toHide.map((o) => `--   ${o.barcode}  ${o.review_status}: ${o.product_name}  ->  ${o.newName}`).join('\n')}

begin;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

with hidden as (
  update public.product_reports
     set review_status = 'rejected', reviewed_at = now()
   where id in (
${ids}
  )
  returning id, product_name
)
insert into public.admin_activity_log (actor_email, action, target_type, target_id, product_name, details)
select null, 'reject_product', 'product', id::text, product_name, '{"reason": "${reason}"}'::jsonb
  from hidden;

-- Should list all ${toHide.length} as rejected:
select product_name, review_status from public.product_reports where id in (
${ids}
) order by product_name;

commit;
`);
  }
  console.log(`\nbarcodes approved: ${counts.approved} | pending (photo shows another number): ${counts.pending} | other links retired: ${counts.retired} | report not made yet: ${counts.notReady}`);
  console.log(toHide.length ? `older products under these barcodes: ${toHide.length} -- run ${SQL_OUT} in the Supabase SQL Editor to hide them` : 'no older product saved under these barcodes');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
