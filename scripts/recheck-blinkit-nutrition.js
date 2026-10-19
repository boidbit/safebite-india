// scripts/recheck-blinkit-nutrition.js
//
// READ-ONLY. For Blinkit products whose saved nutrition table "can't be right"
// (dataHealth.js tableImpossible), opens the product page again and reads the
// nutrition table off the pack photos (Gemini vision), then compares three
// things:
//   saved    -- report.nutrientsPer100 (what the app shows)
//   text     -- Blinkit's own nutrition text, as we scraped it
//   photo    -- the table printed on the pack
// and says where the wrong figure came from:
//   blinkit-text-wrong   the photo disagrees with Blinkit's text (we copied a wrong text)
//   our-conversion       the photo agrees with the text but not with what we saved
//   label-itself         the photo agrees with what we saved (the pack is inconsistent, or the check misfired)
//   no-photo-text-*      no nutrition photo: whether Blinkit's text changed since we scraped
// Blinkit's nutrition always comes from the page TEXT in the scraper
// (blinkit.js scrapeProduct); photos are only read for ingredients/barcodes.
// Writes ../blinkit-nutrition-recheck.csv and .json. Changes nothing.
//
//   node --env-file=.env scripts/recheck-blinkit-nutrition.js --limit 10
//   node --env-file=.env scripts/recheck-blinkit-nutrition.js            (all of them)
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';
import { CHECKS } from '../src/services/dataHealth.js';
import { parsePack } from '../src/services/productFamilies.js';
import { blinkitLookupKey } from '../src/services/blinkitProductsRepo.js';
import { fetchText, extractImageGallery, fetchImageBuffer, sleep, getProductSitemaps, productUrlsFrom, FOOD_GROUPS } from '../src/services/blinkit.js';
import { callGemini } from '../src/services/geminiService.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? Number(process.argv[i + 1]) : fallback; };
const LIMIT = arg('limit', Infinity);
const MAX_PHOTOS = 8;
const GAP_MS = 4200; // free-tier vision limit is ~15 a minute
const impossible = CHECKS.find((c) => c.id === 'tableImpossible');

async function all(build) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await build().range(f, f + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// Blinkit's attribute text -> numbers, same key names as nutrientsPer100.
const TEXT_KEYS = {
  Energy: 'caloriesKcal', Protein: 'proteinG', 'Total Carbohydrates': 'carbohydrateG', 'Total Sugar': 'totalSugarG', 'Added Sugar': 'addedSugarG',
  'Total Fat': 'totalFatG', 'Saturated Fat': 'saturatedFatG', 'Trans Fat': 'transFatG', Sodium: 'sodiumMg',
};
function textNumbers(nutrition) {
  const out = {};
  for (const [label, key] of Object.entries(TEXT_KEYS)) {
    const m = String(nutrition?.[label] ?? '').match(/([\d.]+)\s*(mg|g|kcal)?/i);
    if (!m) continue;
    let v = parseFloat(m[1]);
    if (key === 'sodiumMg' && (m[2] || '').toLowerCase() === 'g' && v <= 40) v *= 1000;
    if (Number.isFinite(v)) out[key] = v;
  }
  return out;
}
function pageNutrition(html) {
  const out = {};
  const re = /"attribute_name":"([^"]+)"[^}]*?"value":("(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (TEXT_KEYS[m[1]] && out[m[1]] === undefined) { try { out[m[1]] = JSON.parse(m[2]).trim(); } catch { /* skip */ } }
  }
  return out;
}

const PROMPT = `You are reading ONE photo from an Indian packaged food product's online listing.

Return ONLY JSON:
{"hasNutritionTable": boolean,
 "per100Basis": "g" | "ml" | null,
 "servingSize": string | null,
 "per100": {"caloriesKcal": n, "proteinG": n, "carbohydrateG": n, "totalSugarG": n, "addedSugarG": n, "totalFatG": n, "saturatedFatG": n, "transFatG": n, "sodiumMg": n} | null,
 "perServing": { same keys } | null}

Rules:
- Only numbers printed in the nutrition information table on the pack. hasNutritionTable false if there is no such table in this photo.
- "per100": the "per 100 g" or "per 100 ml" column. "perServing": the per-serving column. Fill whichever the table has; null for a column it doesn't have.
- Sodium in mg (convert g to mg). Energy in kcal (if only kJ is printed, divide by 4.184).
- If a row is not printed, use null for it. Never guess or calculate a value that isn't printed.`;

async function readPhoto(buf, productName) {
  const body = {
    contents: [{ parts: [{ text: `${PROMPT}\n\nProduct: ${productName}` }, { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }] }],
    generationConfig: { temperature: 0, topK: 1, maxOutputTokens: 900, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
  };
  const { text, finishReason } = await callGemini(body);
  if (finishReason !== 'STOP' || !text) return null;
  return JSON.parse(text);
}

const close = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= Math.max(0.3, Math.abs(b) * 0.1);
/** share of the keys both tables give that match; null when fewer than 2 overlap */
function agreement(a, b) {
  if (!a || !b) return null;
  const keys = Object.keys(a).filter((k) => typeof a[k] === 'number' && typeof b[k] === 'number');
  if (keys.length < 2) return null;
  return keys.filter((k) => close(a[k], b[k])).length / keys.length;
}
const agrees = (a, b) => (agreement(a, b) ?? 0) >= 0.7;
const clean = (o) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number')) : null);

// Which column of the pack's table each of Blinkit's text figures came from.
function columnOf(text, p100, pServ) {
  const out = {};
  for (const [k, t] of Object.entries(text || {})) {
    if (typeof t !== 'number') continue;
    const a = p100?.[k], b = pServ?.[k];
    out[k] = close(t, a) ? 'per100' : close(t, b) ? 'perServing' : (typeof a === 'number' || typeof b === 'number') ? 'neither' : 'notOnPack';
  }
  return out;
}

// The figures that make the saved table impossible (same rules as dataHealth.js).
function offending(n) {
  const v = (k) => (typeof n?.[k] === 'number' ? n[k] : null);
  const out = new Set();
  const over = (a, b, slack = 0.1) => v(a) !== null && v(b) !== null && v(a) > v(b) * 1.05 + slack;
  if (over('saturatedFatG', 'totalFatG')) ['saturatedFatG', 'totalFatG'].forEach((k) => out.add(k));
  if (over('transFatG', 'totalFatG')) ['transFatG', 'totalFatG'].forEach((k) => out.add(k));
  if (over('addedSugarG', 'totalSugarG')) ['addedSugarG', 'totalSugarG'].forEach((k) => out.add(k));
  if (over('totalSugarG', 'carbohydrateG', 0.5)) ['totalSugarG', 'carbohydrateG'].forEach((k) => out.add(k));
  for (const k of ['proteinG', 'totalFatG', 'carbohydrateG', 'totalSugarG', 'addedSugarG', 'saturatedFatG']) if (v(k) !== null && (v(k) > 100.5 || v(k) < 0)) out.add(k);
  if ((v('proteinG') ?? 0) + (v('totalFatG') ?? 0) + (v('carbohydrateG') ?? 0) > 105) ['proteinG', 'totalFatG', 'carbohydrateG'].forEach((k) => out.add(k));
  return [...out];
}

// "100 ml (53 g)" -> 53, "1 cup (240mL)" -> 240, "238 ml" -> 238, "1 Can" -> null. Grams first:
// the per-100 column of a food is per 100 g.
function servingAmount(text) {
  const s = String(text || '');
  const g = s.match(/([\d.]+)\s*g\b/i);
  const ml = s.match(/([\d.]+)\s*ml\b/i);
  const v = parseFloat((g || ml || [])[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The pack's per-100 column; worked out from the per-serving one when the pack prints only that. */
function per100Of(photo, fallbackAmount) {
  if (photo.per100) return { table: photo.per100, derived: false };
  const amount = servingAmount(photo.serving) || fallbackAmount;
  if (!photo.perServing || !amount) return { table: null, derived: false };
  const k = 100 / amount;
  return { table: Object.fromEntries(Object.entries(photo.perServing).map(([key, v]) => [key, Math.round(v * k * 100) / 100])), derived: true };
}

/** Where the wrong figure came from, judged field by field. */
function diagnose(res, fallbackAmount) {
  const { table: p100, derived } = per100Of(res.photo, fallbackAmount);
  const cols = columnOf(res.text, p100, res.photo.perServing);
  const bad = offending(res.saved);
  const where = (c) => Object.keys(cols).filter((k) => cols[k] === c);
  res.columns = cols;
  res.offending = bad;
  res.per100Derived = derived;
  // A figure that makes the table impossible and isn't printed on the pack at all.
  const extra = bad.filter((k) => cols[k] === 'notOnPack');
  if (extra.length) return { verdict: 'blinkit-extra-figure', fields: extra };
  if (where('per100').length && where('perServing').length) return { verdict: 'blinkit-mixed-columns', fields: where('perServing') };
  if (where('neither').length) return { verdict: 'blinkit-text-wrong', fields: where('neither') };
  // Blinkit's text is one column of the pack, consistently. Then what we saved should be that column per 100.
  if (p100 && !agrees(p100, res.saved)) return { verdict: 'our-conversion', fields: Object.keys(res.saved).filter((k) => typeof p100[k] === 'number' && !close(res.saved[k], p100[k])) };
  return { verdict: 'label-itself', fields: bad };
}

// --- which products
const reports = await all(() => supabase.from('product_reports')
  .select('lookup_key, product_name, source, n:report->nutrientsPer100, servG:report->realNutrientsServingGrams, packSize:report->>packSize')
  .in('review_status', ['live', 'approved']).eq('source', 'blinkit').order('id'));
const flagged = reports.filter((r) => r.n && impossible.test({ n: r.n }));
const scraped = await all(() => supabase.from('blinkit_products').select('source, brand, product_name, nutrition, serving_size').order('product_name'));
const byKey = new Map(scraped.map((b) => [blinkitLookupKey(b.source, b.brand, b.product_name), b]));
const byName = new Map(scraped.map((b) => [b.product_name.toLowerCase(), b]));
console.log(`Blinkit products with an impossible table: ${flagged.length}${Number.isFinite(LIMIT) ? ` (checking ${LIMIT})` : ''}`);

// The page URL isn't stored, so it comes from Blinkit's food sitemaps: a page's
// URL slug is its product name (same match as backfill-blinkit-barcodes.js).
// The slug -> URL list is kept in ../blinkit-url-cache.json for a day, so a
// second run doesn't read every sitemap from Blinkit again.
const slugOf = (name) => (name || '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const URL_CACHE = '../blinkit-url-cache.json';
let urlBySlug = {};
try {
  const c = JSON.parse(fs.readFileSync(URL_CACHE, 'utf8'));
  if (Date.now() - c.at < 24 * 3600 * 1000) urlBySlug = c.urls;
} catch { /* first run */ }
if (!Object.keys(urlBySlug).length) {
  const sitemaps = ((await getProductSitemaps()) || []).filter((s) => FOOD_GROUPS.includes(s.group));
  for (const s of sitemaps) {
    for (const u of (await productUrlsFrom(s.url)) || []) {
      const slug = u.split('/prn/')[1]?.split('/prid/')[0];
      if (slug && !urlBySlug[slug]) urlBySlug[slug] = u;
    }
    await sleep(800);
  }
  fs.writeFileSync(URL_CACHE, JSON.stringify({ at: Date.now(), urls: urlBySlug }));
  console.log(`read ${sitemaps.length} sitemaps, ${Object.keys(urlBySlug).length} product URLs`);
}

// When the pack prints only a per-serving column with no amount ("1 Can"), the serving is the pack.
const fallbackAmount = (r) => r.servG || parsePack(r.packSize)?.size || parsePack(r.product_name)?.size || null;

// Every product checked is written to the JSON straight away, so a run that is
// stopped (laptop off) loses nothing: the next run reuses what's there -- no
// second Gemini call, no second page visit -- and carries on with the rest.
// Only a page that couldn't be opened is tried again.
const JSON_FILE = '../blinkit-nutrition-recheck.json';
const store = new Map();
try {
  for (const x of JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'))) store.set(x.product, x);
} catch { /* first run */ }
const keep = (res) => { store.set(res.product, res); fs.writeFileSync(JSON_FILE, JSON.stringify([...store.values()], null, 1)); };

const results = [];
for (const r of flagged.slice(0, LIMIT)) {
  const prev = store.get(r.product_name);
  if (prev && !['fetch-failed', 'no-page-url'].includes(prev.verdict)) {
    const res = { ...prev, product: r.product_name, saved: clean(r.n), servingG: r.servG ?? null };
    if (res.photo) Object.assign(res, diagnose(res, fallbackAmount(r)));
    results.push(res);
    keep(res);
    console.log(`  ${res.verdict.padEnd(24)} ${r.product_name.slice(0, 60)} (already checked)`);
    continue;
  }
  const row = byKey.get(r.lookup_key) || byName.get(r.product_name.toLowerCase());
  const res = { product: r.product_name, saved: clean(r.n), servingG: r.servG ?? null };
  const url = urlBySlug[slugOf(row?.product_name || r.product_name)];
  if (!url) { results.push({ ...res, verdict: 'no-page-url' }); keep({ ...res, verdict: 'no-page-url' }); console.log(`  no page URL: ${r.product_name}`); continue; }
  res.url = url;
  res.text = textNumbers(row?.nutrition);
  const html = await fetchText(url);
  if (!html) { results.push({ ...res, verdict: 'fetch-failed' }); keep({ ...res, verdict: 'fetch-failed' }); console.log(`  fetch failed: ${r.product_name}`); continue; }
  res.textNow = textNumbers(pageNutrition(html));

  let photo = null;
  const images = extractImageGallery(html).slice(0, MAX_PHOTOS);
  for (const [i, url] of images.entries()) {
    const buf = await fetchImageBuffer(url);
    if (!buf) continue;
    try {
      const read = await readPhoto(buf, r.product_name);
      if (read?.hasNutritionTable && (read.per100 || read.perServing)) { photo = { ...read, photoNo: i + 1, photoUrl: url }; break; }
    } catch { /* quota or bad JSON on this photo -- try the next */ }
    await sleep(GAP_MS);
  }

  if (photo) {
    res.photo = { per100: clean(photo.per100), perServing: clean(photo.perServing), basis: photo.per100Basis, serving: photo.servingSize, photoNo: photo.photoNo };
    Object.assign(res, diagnose(res, fallbackAmount(r)));
  } else {
    res.verdict = agreement(res.text, res.textNow) === 1 ? 'no-photo-text-unchanged' : 'no-photo-text-changed';
  }
  results.push(res);
  keep(res);
  console.log(`  ${res.verdict.padEnd(24)} ${r.product_name.slice(0, 60)}${res.photo ? ` (photo ${res.photo.photoNo})` : ''}`);
  await sleep(1500);
}

const tally = {};
for (const x of results) tally[x.verdict] = (tally[x.verdict] || 0) + 1;
console.log('\nsummary:', JSON.stringify(tally));
const show = (o) => (o ? Object.entries(o).map(([k, v]) => `${k}=${v}`).join(' ') : '');
const csv = ['product,verdict,fields,saved_per100,blinkit_text,photo_per100,photo_per_serving,serving_g,url'];
for (const x of results) csv.push([x.product, x.verdict, (x.fields || []).join(' '), show(x.saved), show(x.text), show(x.photo?.per100), show(x.photo?.perServing), x.servingG ?? '', x.url ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
fs.writeFileSync('../blinkit-nutrition-recheck.csv', `﻿${csv.join('\n')}\n`);
// (the JSON was written after every product -- see keep())
console.log('CSV: ../blinkit-nutrition-recheck.csv');
