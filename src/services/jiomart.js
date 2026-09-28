// src/services/jiomart.js
//
// Shared JioMart scraping logic, used by scripts/scrape-jiomart.js.
//
// Not imported by any app code — it never reaches the browser bundle.
//
// Why JioMart and not another retry at Blinkit: Blinkit started
// returning 403 Forbidden on every request as of 2026-09-10 (see
// .github/workflows/scrape-blinkit.yml) -- an active anti-scraping
// block from sustained request volume, not a code bug. Rather than
// hammering the same blocked site again, this is a second, independent
// source: manufacturer-supplied ingredient text and a clean e-commerce
// product photo, same reasoning as blinkit.js, different site.
//
// IMPORTANT — unlike blinkit.js, the extraction logic below has NOT been
// verified against real JioMart HTML. The sandbox this was written in
// cannot reach jiomart.com at all (org network policy), so there was no
// way to hand-inspect a real product page the way Blinkit's regexes
// were clearly built by someone who did. Instead of guessing at bespoke
// inline JSON field names (the way that would silently produce nothing
// if a single guess is wrong), extraction here is layered and defensive:
//
//   1. schema.org Product JSON-LD (<script type="application/ld+json">)
//      -- a W3C-ish standard most e-commerce sites embed for Google
//      Shopping/SEO, so far more likely to actually be present and
//      correctly named than a guessed bespoke field.
//   2. A generic "Ingredients" label search in the page's visible text,
//      for the ingredients list specifically (JSON-LD's Product schema
//      has no standard ingredients field).
//   3. Gemini extraction from the page's visible text as a last resort,
//      same "extract, never invent" contract as blinkit.js.
//
// Sitemap discovery is deliberately generic too (no assumed
// /group/category/ path convention) -- run with --list first to see
// JioMart's REAL sitemap/category structure before trusting anything
// else this file does. Treat the first real run as reconnaissance, not
// production seeding.

import { isGeminiAvailable, callGemini } from './geminiService.js';

const SITEMAP_CANDIDATES = [
  'https://www.jiomart.com/sitemap.xml',
  'https://www.jiomart.com/sitemap_index.xml',
];

// A real browser UA, not a self-identifying bot string -- same reasoning
// as blinkit.js: a cloud CI runner's IP range is what anti-scraping
// systems flag hardest, and this is the one lever available against that.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Filled in from a real --list run plus manually checking what's actually
// inside each candidate sitemap (fetched live, not guessed) -- unlike
// Blinkit, JioMart's sitemap.xml doesn't split cleanly into a dedicated
// "groceries" file. What --list actually found:
//   electronics-1 / electronics-2  -- confirmed pure electronics, no food
//   sitemap-collections / sitemap-sections -- /collection/ and /sections/
//     browse pages, not individual product pages at all -- nothing here
//     is scrapable for ingredients regardless of category
//   custom       -- 904 product URLs, sampled across the file: heavily
//     grocery (atta, dal, dates, Amul milk/ghee/dahi/cheese, produce),
//     with a minority of non-food items mixed in (mosquito repellents,
//     small appliances) that the existing "extract, never invent"
//     ingredient logic already skips harmlessly (no Ingredients section
//     to find, so nothing gets saved for those)
//   home-and-kitchen -- 3,660 URLs, lower food density (umbrellas,
//     cookware, alongside some food/pooja items) -- much bigger, noisier
//     haul for the same reason; left out of the default list below on
//     purpose so a first real run stays small and high-signal. Worth
//     adding once `custom` alone has been checked against a handful of
//     real saved rows.
export const FOOD_GROUPS = ['custom.sitemap'];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, retries = 3) {
  let lastFailure = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.ok) return await res.text();
      lastFailure = `HTTP ${res.status} ${res.statusText}`;
    } catch (err) {
      lastFailure = `${err.name}: ${err.message}`;
    }
    if (attempt < retries) await sleep(attempt * 1200);
  }

  // Surfaced so a genuine block (403/429) is visible instead of looking
  // identical to a transient network blip -- the exact failure mode that
  // took a while to notice with Blinkit.
  if (lastFailure) console.error(`[jiomart] fetch failed for ${url}: ${lastFailure}`);
  return null;
}

/** All <loc> entries directly inside a sitemap XML document (index or leaf). */
function extractLocs(xml) {
  return (xml.match(/<loc>([^<]+)<\/loc>/g) || []).map((loc) => loc.replace(/<\/?loc>/g, '').trim());
}

/**
 * Every product-page sitemap reachable from the site's sitemap index(es).
 * Deliberately makes no assumption about URL path conventions (Blinkit's
 * /sitemaps/products/<group>/<category>/ shape may not exist here) --
 * returns every leaf sitemap found, tagged only with its own URL. Group
 * these into meaningful categories AFTER a --list run shows what's real.
 */
export async function getProductSitemaps() {
  const leaves = [];

  for (const indexUrl of SITEMAP_CANDIDATES) {
    const xml = await fetchText(indexUrl);
    if (!xml) continue;

    const locs = extractLocs(xml);
    if (locs.length === 0) continue;

    // A sitemap index nests further sitemaps; a leaf sitemap lists actual
    // pages directly. Tell them apart by whether Google's sitemap index
    // tag wraps the <loc> entries, not by guessing from the URL text.
    const isIndex = /<sitemapindex/i.test(xml);

    if (!isIndex) {
      leaves.push({ url: indexUrl, group: 'root', category: 'root' });
      continue;
    }

    for (const loc of locs) {
      // Best-effort label from the URL's own path/filename -- purely for
      // human-readable --list output, not used to decide what to scrape.
      const slug = loc.replace(/^https?:\/\/[^/]+\//, '').replace(/\.xml.*$/i, '');
      const parts = slug.split('/').filter(Boolean);
      leaves.push({ url: loc, group: parts[0] || slug, category: parts[parts.length - 1] || slug });
    }
  }

  return leaves.length > 0 ? leaves : null;
}

/**
 * Page URLs listed in one leaf sitemap. Returns null (not []) when the
 * fetch itself failed, so callers can tell a transient network problem
 * apart from a genuinely empty sitemap.
 */
export async function productUrlsFrom(sitemapUrl) {
  const xml = await fetchText(sitemapUrl);
  if (!xml) return null;
  return extractLocs(xml);
}

/**
 * Pull every schema.org Product JSON-LD block out of a page. A page can
 * legitimately embed more than one <script type="application/ld+json">
 * tag (breadcrumbs, organization, product) -- only the Product one is
 * useful here.
 */
function productJsonLd(html) {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const inner = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>\s*$/i, '');
    let parsed;
    try {
      parsed = JSON.parse(inner);
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
    const product = candidates.find((c) => {
      const type = c?.['@type'];
      return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
    });
    if (product) return product;
  }
  return null;
}

/**
 * JioMart's real ingredient data lives in a structured attribute object
 * embedded in the page's script-tag JSON state -- e.g.
 * {"code":"C5936E","display_string":"Ingredients","value":"Whole Spices",...}
 * -- confirmed against real product pages (a spice product and a
 * packaged snack), NOT in naturally-flowing visible text. This is the
 * same shape blinkit.js's structured-attribute lookup already uses; the
 * generic text-label search below was the only method tried at first,
 * which is why an early real run found 0 usable products out of 20 real
 * ones, including well-known packaged snacks that clearly do have a
 * declared ingredients list on the actual page.
 *
 * Runs against the RAW html, not visibleText()'s output -- that strips
 * every <script> tag out first, which is exactly where this lives.
 * The attribute is itself JSON-escaped one level deep (it's a stringified
 * array inside the page's larger embedded JSON), so the matched chunk is
 * unescaped before being parsed as a normal object.
 *
 * Some products genuinely have no transcribed text -- their "value" is a
 * placeholder like "Available on the image" pointing at a pack photo
 * instead. That's real information (nothing usable to extract as text),
 * not a parse failure, so it's filtered out here rather than returned.
 */
function ingredientsFromAttributes(html) {
  const match = html.match(/\{\\"code\\"[^{}]*?\\"display_string\\"\s*:\s*\\"Ingredients\\"[^{}]*?\}/i);
  if (!match) return null;

  try {
    const obj = JSON.parse(match[0].replace(/\\"/g, '"'));
    const value = (obj.value || '').trim();
    if (!value || /^available on/i.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Best-effort "Ingredients" section out of a page's visible text. There
 * is no standard schema.org field for a grocery ingredients list, so
 * this looks for the word itself acting as a label (":" or line break
 * after it) and captures up to the next all-caps/label-like line or a
 * sane length cap, same shape as blinkit.js's structured-attribute
 * lookup but working off raw text instead of a known JSON field. Only
 * ever a fallback for a page that doesn't have the structured attribute
 * above -- untested against a real case where this one actually fires,
 * since every real product checked so far had (or lacked) the
 * structured field instead.
 */
function ingredientsFromText(text) {
  const match = text.match(/ingredients?\s*[:-]\s*([^\n]{12,1000})/i);
  if (!match) return null;
  // Trim at the next likely section label so a run-on page (nutrition
  // facts, allergen note) immediately after doesn't get swallowed too.
  const value = match[1].split(/\b(?:nutritional|nutrition facts|allergen|storage|net quantity|fssai)\b/i)[0].trim();
  return value.length >= 12 ? value : null;
}

/** Strip tags/scripts down to plain visible-ish text, for the regex/AI fallbacks. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const AI_PROMPT = `You are reading the product information from an Indian grocery listing and pulling out the ingredients list, if one is present.

Rules:
- Return ONLY the ingredients list, exactly as written in the text you are given.
- Do NOT invent, infer, complete or guess ingredients. If the text does not contain an actual ingredients list, return exactly: NONE
- A description of the product ("refreshing cola drink", "made with real fruit") is NOT an ingredients list. Return NONE for those.
- Do not add commentary, labels or markdown. Just the ingredients text, or NONE.`;

/**
 * Last resort for products with no "Ingredients" label found in the raw
 * text: show Gemini the page's visible text and let it find an
 * ingredients list inside it. Extraction only, same contract as
 * blinkit.js's extractIngredientsWithAI -- it's told to return NONE
 * rather than infer anything.
 */
export async function extractIngredientsWithAI(productName, text) {
  if (!isGeminiAvailable) return null;

  const shown = text.slice(0, 4000);
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
    const { text: reply, finishReason } = await callGemini(body);
    if (finishReason !== 'STOP') return null;

    const trimmed = reply?.trim();
    if (!trimmed || /^NONE\b/i.test(trimmed) || trimmed.length < 12) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Scrape one product page into a blinkit_products row (source: 'jiomart') --
 * this and blinkit.js's scrapeProduct share that one table; see
 * supabase/blinkit_products_add_source_migration.sql for why.
 * Returns { error } when there's nothing usable to save.
 */
export async function scrapeProduct(url, category, { useAI = false } = {}) {
  const html = await fetchText(url);
  if (!html) return { error: 'fetch failed' };

  const product = productJsonLd(html);
  const text = visibleText(html);

  const productName = product?.name || null;
  if (!productName) return { error: 'no product name (no Product JSON-LD found on this page)' };

  let ingredients = ingredientsFromAttributes(html) || ingredientsFromText(text);
  let viaAI = false;

  if (!ingredients && useAI) {
    ingredients = await extractIngredientsWithAI(productName, text);
    viaAI = Boolean(ingredients);
  }

  // The whole point is complete ingredient text — a row without it would
  // just be noise in the table.
  if (!ingredients || ingredients.length < 12) {
    return { error: 'no ingredients found', productName };
  }

  const brand = typeof product?.brand === 'string' ? product.brand : product?.brand?.name || '';
  const image = Array.isArray(product?.image) ? product.image[0] : product?.image;

  return {
    viaAI,
    product: {
      product_name: productName,
      brand,
      ingredients_text: ingredients,
      category,
      image_url: image || null,
      source: 'jiomart',
      scraped_at: new Date().toISOString(),
    },
  };
}
