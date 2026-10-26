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
// Preview only for now: nothing is saved to the database. Every product's
// result goes to ../amul-scrape-progress.json as it's done (a stop part-way
// loses nothing, and photo reads are never repeated); the summary goes to
// ../amul-preview.json.
//
//   node --env-file=.env scripts/scrape-amul.js
//   node --env-file=.env scripts/scrape-amul.js --limit 5
import fs from 'fs';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { supabase } from '../src/services/supabaseClient.js';
import { fetchImageBuffer, sleep } from '../src/services/blinkit.js';
import { isValidGtin, readBarcodesFromPhoto, confirmBarcode } from '../src/services/barcodeReader.js';
import { nutritionFromPhotos } from '../src/services/nutritionPhotoRead.js';
import { tableProblems } from '../src/services/dataHealth.js';
import { parsePack } from '../src/services/productFamilies.js';

const args = process.argv.slice(2);
const LIMIT = parseInt(args[args.indexOf('--limit') + 1], 10) || Infinity;
const SHOP = 'https://shop.amul.com';
const PINCODE = '110001';
const PROGRESS = '../amul-scrape-progress.json';
const PREVIEW = '../amul-preview.json';
const progress = (() => { try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return {}; } })();
const save = () => fs.writeFileSync(PROGRESS, JSON.stringify(progress, null, 1));

// Gift boxes and hampers hold several different products.
const NOT_ONE_PRODUCT = /\b(hamper|combo|assorted|celebration|festive|gift box|variety)\b/i;
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

async function summarize() {
  // One product per unit: listings of the same unit share its barcode (or its name and pack).
  const units = new Map();
  for (const r of Object.values(progress)) {
    const key = r.barcode || `${norm(r.name)}|${parsePack(r.packSize)?.key || ''}`;
    const prev = units.get(key);
    if (!prev || (!prev.per100 && r.per100)) units.set(key, r);
  }
  const ours = await ourProducts();
  const products = [...units.values()].map((r) => {
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

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
