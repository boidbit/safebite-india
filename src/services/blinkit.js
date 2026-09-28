// src/services/blinkit.js
//
// Shared Blinkit scraping logic, used by scripts/scrape-blinkit.js (both
// its manual --category mode and its cursor-aware --all mode, which the
// GitHub Actions workflow runs on a schedule).
//
// Not imported by any app code — it never reaches the browser bundle.
//
// Discovery goes through Blinkit's published sitemaps rather than
// category pages: category listings vary by delivery location (an
// anonymous request for the cold-drinks category returns dairy), while
// the sitemaps are static and organised by category. robots.txt
// disallows /s/* (search); nothing here touches it.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { isGeminiAvailable, callGemini } from './geminiService.js';
import { isBundleListing } from './bundleListing.js';
import { optimizeAndUploadBlinkitImage } from './blinkitImageOptimizer.js';

const SITEMAP_INDEX = 'https://blinkit.com/sitemap.xml';
// A real browser UA, not a self-identifying bot string. Manual testing
// from a residential IP worked fine either way, but a cloud CI runner's
// IP range is the kind of traffic anti-scraping systems flag hardest —
// this is the one lever available to try to get past that.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// The groups worth scanning for a food-label app. The sitemap also
// carries fashion, electronics and pet care, which have nothing to score.
//
// Order matters here (see scrape-blinkit.js's `--all` target sort, which
// walks this array's own order, not the sitemap's). Ranked on two
// combined factors, not just "how often is this bought":
//   1. How often an Indian household actually buys from the group.
//   2. How often someone would actually open FoodGuard and scan
//      something from it -- this is a health-label scanner, not a
//      grocery-list app, so a category people doubt (packaged snacks,
//      sugary drinks, instant noodles) earns priority even over a
//      more-bought but rarely-scanned staple like atta or rice.
// Top: strong on both. Middle: strong on only one (atta-rice-dal is
// bought constantly but rarely scanned; sauces-spreads is middling on
// both). Bottom: weak on both, or a genuinely occasional buy
// (sweet-tooth, dry-fruits-masala-oil).
export const FOOD_GROUPS = [
  'dairy-breakfast',
  'munchies',
  'bakery-biscuits',
  'tea-coffee-milk-drinks',
  'cold-drinks-juices',
  'instant-frozen-food',
  'sauces-spreads',
  'atta-rice-dal',
  'sweet-tooth',
  'dry-fruits-masala-oil',
];

// How many NEW products `--all` mode takes from a category per round --
// tiered the same way FOOD_GROUPS' own order is, so top-priority groups
// don't just get walked first, they finish scraping much sooner too.
// Middle groups get enough to make steady progress without crowding out
// the top tier; bottom groups get just enough to eventually finish.
export const FOOD_GROUP_QUOTA = {
  'dairy-breakfast': 8,
  munchies: 8,
  'bakery-biscuits': 8,
  'tea-coffee-milk-drinks': 8,
  'cold-drinks-juices': 8,
  'instant-frozen-food': 8,
  'sauces-spreads': 4,
  'atta-rice-dal': 4,
  'sweet-tooth': 1,
  'dry-fruits-masala-oil': 1,
};

const NUTRITION_FIELDS = [
  'Energy', 'Protein', 'Total Carbohydrates', 'Added Sugar', 'Total Sugar',
  'Total Fat', 'Saturated Fat', 'Trans Fat', 'Unsaturated Fat', 'Sodium', 'Calcium',
];

// Logistics and tax attributes — noise a shopper would never read, and
// not worth showing the AI fallback.
const NOISE_ATTRIBUTES = /gst|hsn|tax|case|polybag|guidelines|warehouse|_weight|engagement|ptr|uom|unitvalue|unittype|return type|gift wrap|packaged product|packed product|physical packaging/i;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node's own fetch() gets an immediate 403 from Blinkit -- confirmed on a
// single isolated request, same IP, same User-Agent, no other requests
// around it at all, so this was never actually about request volume the
// way it first looked. curl succeeded on that exact same request for a
// long time. That pointed to their anti-bot check fingerprinting the
// HTTP client itself (most likely at the TLS/connection level, e.g.
// JA3/JA4 -- curl and Node's fetch have different TLS stacks even with
// an identical User-Agent header) rather than tracking who's asking or
// how often. Shelling out to curl changed nothing about what's
// requested, how often, or from where -- same single IP, same honest
// User-Agent, same pacing the caller already applies between requests.
//
// 2026-09-25: curl itself started getting 403 too, now with a
// `Cf-Mitigated: challenge` response header -- Cloudflare escalated from
// fingerprinting the TLS client to actually serving a JS challenge, which
// no plain HTTP client (curl or Node's fetch) can execute. A real browser
// engine (Playwright's headless Chromium) runs that JS and passes it
// immediately -- confirmed: a single page load gets 200 with no visible
// CAPTCHA or manual step. Running a full browser for every one of a
// scrape's thousands of requests would be slow, so instead one browser
// page load extracts the two cookies the challenge sets (`__cf_bm`,
// `_cfuvid`) and every curl call after that carries them -- confirmed
// this alone is enough (curl with no other change than the Cookie header
// gets 200). `__cf_bm` lasts ~30 minutes, so it's refreshed on a timer
// and again on the spot if a request still comes back 403 despite having
// a "fresh" cookie.
const CF_COOKIE_DOMAIN = 'blinkit.com';
const CF_COOKIE_MAX_AGE_MS = 20 * 60 * 1000; // refresh before the ~30 min __cf_bm actually expires
let cfCookies = null; // { header: string, obtainedAt: number }
let cfCookiesPromise = null; // in-flight refresh, so concurrent callers share one browser launch

async function refreshCloudflareCookies() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.goto(SITEMAP_INDEX, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const cookies = await context.cookies();
    const header = cookies
      .filter((c) => c.domain.includes(CF_COOKIE_DOMAIN))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    if (!header) throw new Error('no cookies came back from the challenge page');
    cfCookies = { header, obtainedAt: Date.now() };
  } finally {
    await browser.close();
  }
}

/** @param {boolean} [force] - bypass the age check, e.g. after a 403 despite a "fresh" cookie. */
async function ensureCloudflareCookies(force = false) {
  if (!force && cfCookies && Date.now() - cfCookies.obtainedAt < CF_COOKIE_MAX_AGE_MS) return;
  // A concurrent caller reuses the SAME refresh rather than each
  // launching its own browser -- fetchText calls can overlap (Promise.all
  // callers elsewhere in the scraper).
  if (!cfCookiesPromise) {
    cfCookiesPromise = refreshCloudflareCookies().finally(() => { cfCookiesPromise = null; });
  }
  await cfCookiesPromise;
}

const execFileAsync = promisify(execFile);
const STATUS_MARKER = '\n__HTTP_STATUS__';

async function curlGet(url) {
  const args = ['-sS', '--max-time', '20', '-A', USER_AGENT];
  if (cfCookies) args.push('-H', `Cookie: ${cfCookies.header}`);
  args.push('-w', `${STATUS_MARKER}%{http_code}`, url);

  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 25 * 1024 * 1024 });

  const idx = stdout.lastIndexOf(STATUS_MARKER);
  if (idx === -1) throw new Error('curl output missing status marker');
  return { status: Number(stdout.slice(idx + STATUS_MARKER.length).trim()), body: stdout.slice(0, idx) };
}

/**
 * Same as fetchText, but returns raw bytes -- for downloading a gallery
 * photo rather than parsing HTML. No retry/status-marker plumbing here:
 * a missing photo just means this one candidate is skipped, not a page
 * worth re-fetching. The Cloudflare cookie is domain-scoped to
 * blinkit.com and gallery photos are usually served from a separate CDN
 * host, so it's attached defensively (harmless where it isn't needed)
 * rather than assumed to be the whole fix for this path.
 */
async function fetchImageBuffer(url) {
  try {
    const args = ['-sS', '--max-time', '20', '-A', USER_AGENT];
    if (cfCookies) args.push('-H', `Cookie: ${cfCookies.header}`);
    args.push(url);
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 25 * 1024 * 1024, encoding: 'buffer' });
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

export async function fetchText(url, retries = 3) {
  let lastFailure = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await ensureCloudflareCookies();
      const { status, body } = await curlGet(url);
      if (status >= 200 && status < 300) return body;
      lastFailure = `HTTP ${status}`;
      // A 403 despite a cookie we believe is still fresh means Cloudflare
      // invalidated it early (or this is the very first call and the
      // cookie was never actually fetched yet) -- force a real refresh
      // rather than retrying with the same cookie and failing the same way.
      if (status === 403) await ensureCloudflareCookies(true);
    } catch (err) {
      lastFailure = `${err.name}: ${err.message}`;
    }
    if (attempt < retries) await sleep(attempt * 1200);
  }

  // Surfaced so a genuine block (403/429) is visible instead of looking
  // identical to a transient network blip -- both currently just return
  // null to the caller, but only one of them is worth investigating.
  if (lastFailure) console.error(`[blinkit] fetch failed for ${url}: ${lastFailure}`);
  return null;
}

/** Read a top-level JSON string field out of the embedded page data. */
function jsonField(html, key) {
  const match = html.match(new RegExp(`"${key}":("(?:[^"\\\\]|\\\\.)*")`));
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Every labelled attribute on the page. This is the same content the
 * "View more details" button expands — it's already in the HTML, so no
 * browser or click is needed to reach it.
 */
function allAttributes(html) {
  const out = {};
  const re = /"attribute_name":"([^"]+)"[^}]*?"value":("(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (out[m[1]] !== undefined) continue;
    try {
      const value = JSON.parse(m[2]).trim();
      if (value) out[m[1]] = value;
    } catch {
      // skip anything that won't parse
    }
  }
  return out;
}

const AI_PROMPT = `You are reading the product information from an Indian grocery listing and pulling out the ingredients list, if one is present.

Rules:
- Return ONLY the ingredients list, exactly as written in the text you are given.
- Do NOT invent, infer, complete or guess ingredients. If the text does not contain an actual ingredients list, return exactly: NONE
- A description of the product ("refreshing cola drink", "made with real fruit") is NOT an ingredients list. Return NONE for those.
- Do not add commentary, labels or markdown. Just the ingredients text, or NONE.`;

/** The product's full photo gallery, in the order Blinkit lists them. */
export function extractImageGallery(html) {
  const m = html.match(/"images":\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) =>
    x[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/')
  );
}

const IMAGE_AI_PROMPT = `You are reading one photo from an Indian packaged food product's listing.

Rules:
- If THIS image shows a printed ingredients list, transcribe it exactly as written.
- Do NOT invent, infer, complete or guess ingredients.
- If no ingredients list is visible in this image (e.g. it's a front-of-pack marketing shot, a nutrition table only, or a lifestyle photo), reply with exactly: NONE
- Do not add commentary, labels or markdown. Just the ingredients text, or NONE.`;

// Checked in order, stopping at the first photo that actually shows an
// ingredients panel -- most galleries put the back-of-pack shot within
// the first 8-10 images, and every image beyond that just spends quota
// for a shrinking chance of a hit (confirmed against real product
// galleries during this feature's research).
const MAX_GALLERY_IMAGES_TRIED = 10;
const IMAGE_REQUEST_GAP_MS = 4200; // free-tier vision limit is 15 req/min

/**
 * Last resort for products with no structured Ingredients attribute AND
 * no ingredients findable in the page's own text: try reading the
 * ingredients straight off the product's gallery photos instead. Some
 * products (seen on real Blinkit besan listings) only ever put the
 * ingredients list on the pack photo, never in any text attribute — this
 * is the only way to recover those.
 */
export async function extractIngredientsFromImages(productName, imageUrls) {
  if (!isGeminiAvailable || imageUrls.length === 0) return null;

  for (const url of imageUrls.slice(0, MAX_GALLERY_IMAGES_TRIED)) {
    const buf = await fetchImageBuffer(url);
    await sleep(IMAGE_REQUEST_GAP_MS);
    if (!buf) continue;

    const body = {
      contents: [{
        parts: [
          { text: `${IMAGE_AI_PROMPT}\n\nProduct: ${productName}` },
          { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        topK: 1,
        maxOutputTokens: 500,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    };

    try {
      const { text, finishReason } = await callGemini(body);
      if (finishReason !== 'STOP') continue;
      const trimmed = text?.trim();
      if (!trimmed || /^NONE\b/i.test(trimmed) || trimmed.length < 12) continue;
      return trimmed;
    } catch {
      // This one photo's call failed (quota/transient) — try the next
      // photo rather than giving up on the whole product.
      continue;
    }
  }
  return null;
}

/**
 * Last resort for products with no structured Ingredients attribute:
 * show Gemini only the text already on that page and let it find an
 * ingredients list inside it. Extraction only — it's told to return
 * NONE rather than infer anything, because a plausible-sounding
 * invented ingredient list is far worse here than no data.
 */
export async function extractIngredientsWithAI(productName, attributes) {
  if (!isGeminiAvailable) return null;

  const shown = Object.entries(attributes)
    .filter(([name]) => !NOISE_ATTRIBUTES.test(name))
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
    .slice(0, 4000);
  if (!shown.trim()) return null;

  const body = {
    contents: [{ parts: [{ text: `${AI_PROMPT}\n\nProduct: ${productName}\n\n${shown}` }] }],
    generationConfig: {
      temperature: 0,
      topK: 1,
      maxOutputTokens: 1200,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };

  try {
    const { text, finishReason } = await callGemini(body);
    if (finishReason !== 'STOP') return null;

    const trimmed = text?.trim();
    if (!trimmed || /^NONE\b/i.test(trimmed) || trimmed.length < 12) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Scrape one product page into a blinkit_products row.
 * Returns { error } when there's nothing usable to save.
 */
// A real found case (Habanero Jalapeno Cheese Dip + Habanero Zingy
// Jalapeno Nachos Combo): Blinkit's own "Ingredients" attribute for a
// combo listing only ever covers ONE of the bundled items -- the
// resulting score/report would then silently represent just that one
// item while its name and photo imply the whole bundle. " + " is
// Blinkit's own consistent naming convention for joining two distinct
// product names in a bundle listing (confirmed against the real
// catalog: matches essentially every genuine multi-item combo, and
// doesn't false-positive on single products that merely use the word
// "combo" as marketing, e.g. "Orange Fruit Juice Combo With Pulp" --
// a completely ordinary single juice, no "+" in its name). See
// blinkit.combo.test.js for the real names this was checked against.
// Widened from just " + " to every bundle shape (gift packs, hampers,
// potlis, assorted/variety packs, samplers, "combo") -- see bundleListing.js.
export function isComboListing(productName) {
  return isBundleListing(productName);
}

export async function scrapeProduct(url, category, { useAI = false, useImageFallback = false } = {}) {
  const html = await fetchText(url);
  if (!html) return { error: 'fetch failed' };

  const productName = jsonField(html, 'product_name');
  if (!productName) return { error: 'no product name' };

  if (isComboListing(productName)) {
    return { error: 'combo listing (bundles multiple products)', productName };
  }

  const attributes = allAttributes(html);
  let ingredients = attributes['Ingredients'] || null;
  let viaAI = false;
  let viaImage = false;

  if (!ingredients && useAI) {
    ingredients = await extractIngredientsWithAI(productName, attributes);
    viaAI = Boolean(ingredients);
  }

  // Some products (seen on real besan listings) never publish an
  // ingredients list as text anywhere on the page -- only on a gallery
  // photo. Tried last since it costs a vision call per photo checked,
  // the most expensive of the three routes.
  if (!ingredients && useImageFallback) {
    const images = extractImageGallery(html);
    ingredients = await extractIngredientsFromImages(productName, images);
    viaImage = Boolean(ingredients);
  }

  // The whole point is complete ingredient text — a row without it
  // would just be noise in the table.
  if (!ingredients || ingredients.length < 12) {
    return { error: 'no ingredients listed', productName };
  }

  const nutrition = {};
  for (const field of NUTRITION_FIELDS) {
    if (attributes[field]) nutrition[field] = attributes[field];
  }

  // "Unit (with options)" is the human-readable pack size shown to a
  // shopper on the page itself (e.g. "500 g", "2 x 2 kg") -- falls back
  // to the plain net weight when that specific attribute isn't there.
  // Matters because different pack sizes of the same product have
  // different real barcodes (see AdminProductForm.jsx's barcode-search
  // helper) -- without this, nobody editing a Blinkit-scraped product
  // (which never has a barcode of its own) can tell which size they're
  // even looking at.
  const packSize = attributes['Unit (with options)'] || attributes['Net Weight (Without Packaging)'] || null;

  // A REAL, separate "Standard Serve Size" attribute Blinkit prints
  // right in the nutrition table (e.g. "200 ml" on a 2.25 LITRE Mountain
  // Dew bottle) -- confirmed live on the actual page, and NOT the same
  // thing as packSize above, which is the whole pack/bottle. Using
  // packSize as a stand-in for this was a real bug this replaces: a
  // "2.25 litre serving" of a soft drink is nonsense, nobody drinks the
  // whole bottle in one sitting, while packSize is exactly correct for
  // its own actual purpose (barcode lookups, telling pack sizes apart).
  const servingSize = attributes['Standard Serve Size'] || null;
  const brand = jsonField(html, 'brand') || '';

  // The standing rule (clarified after an earlier over-correction this
  // session): downloading and keeping our OWN copy of the product photo
  // is wanted -- useful for identifying the product and as a reference
  // for sourcing a real/raw photo of it later -- what's NOT wanted is
  // the app ever pointing a user's browser AT Blinkit's own server for
  // it. So image_url stays the raw Blinkit link purely as that
  // reference (never shown to an end user -- see generate-reports.js,
  // which only ever uses optimized_image_url for what a report
  // actually displays), and optimized_image_url is our own Storage
  // copy, cropped+compressed here at scrape time so it's ready
  // immediately rather than waiting on report-generation to catch up.
  // objectId has to be stable WITHOUT a database id (this product
  // hasn't been saved yet) -- a slug of its own brand+name (the same
  // value blinkitLookupKey() is built from elsewhere) serves that role
  // just as well as a real id would. Failure-safe: a download/upload
  // problem just leaves optimized_image_url empty for now (picked up
  // later by a backfill pass), never blocks the scrape.
  const rawImageUrl = jsonField(html, 'image_url');
  const objectId = `${brand} ${productName}`.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || null;
  const optimized = rawImageUrl && objectId ? await optimizeAndUploadBlinkitImage(rawImageUrl, objectId) : null;

  return {
    viaAI,
    viaImage,
    product: {
      product_name: productName,
      brand,
      ingredients_text: ingredients,
      category,
      image_url: rawImageUrl,
      optimized_image_url: optimized?.url || null,
      optimized_image_bytes: optimized?.bytes || null,
      nutrition,
      pack_size: packSize,
      serving_size: servingSize,
      fssai_license: attributes['FSSAI License'] || null,
      source: 'blinkit',
      scraped_at: new Date().toISOString(),
    },
  };
}

/** All product sitemaps, tagged with their group and category. */
export async function getProductSitemaps() {
  const xml = await fetchText(SITEMAP_INDEX);
  if (!xml) return null;

  return (xml.match(/<loc>([^<]+)<\/loc>/g) || [])
    .map((loc) => loc.replace(/<\/?loc>/g, ''))
    .filter((url) => url.includes('/sitemaps/products/'))
    .map((url) => {
      const parts = url.split('/sitemaps/products/')[1]?.split('/') || [];
      return { url, group: parts[0] || 'unknown', category: parts[1] || parts[0] || 'unknown' };
    });
}

/**
 * Product URLs from one category sitemap. Returns null (not []) when the
 * fetch itself failed, so callers can tell a transient network problem
 * apart from a genuinely empty category.
 */
export async function productUrlsFrom(sitemapUrl) {
  const xml = await fetchText(sitemapUrl);
  if (!xml) return null;

  return (xml.match(/<loc>([^<]+)<\/loc>/g) || [])
    .map((loc) => loc.replace(/<\/?loc>/g, ''))
    .filter((url) => url.includes('/prid/'));
}
