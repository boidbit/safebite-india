// scripts/build-site.js
//
// Builds the website at the domain root (foodguards.space). Runs after
// `vite build` (package.json "build"), which puts the app in dist/app.
//
// Pages are plain HTML rendered here from site/pages/*.js through
// site/layout.js -- no framework, so they're fast and search engines read
// them whole. site/assets/ is copied as-is. The home page shows a few live
// numbers, read once per build with only the fields it shows (never whole
// reports -- Supabase egress); without Supabase env it builds without them.
import fs from 'fs';
import path from 'path';
import { layout, SITE_URL } from '../site/layout.js';
import home from '../site/pages/home.js';
import howWeScore from '../site/pages/how-we-score.js';
import about from '../site/pages/about.js';
import disclaimer from '../site/pages/disclaimer.js';
import notFound from '../site/pages/not-found.js';
import { verdictFor } from '../src/services/scoringEngine.js';
import { assignSlugs, productPage, productPath, productsDirectory, alternativesFor } from '../site/products.js';

const OUT = 'dist';
// Product pages (/product/<slug>/, /products/): off by default until they're
// signed off. --products=10 builds a small sample locally; --products=all
// (or SITE_PRODUCT_PAGES=all) builds every live/approved product.
const productsArg = (process.argv.find((a) => a.startsWith('--products=')) || '').split('=')[1] || process.env.SITE_PRODUCT_PAGES || '';
const PAGES = [home, howWeScore, about, disclaimer];

// Only products an admin has APPROVED appear on the website -- not ones
// that are live but never reviewed, pending, rejected, or have an open
// report (flag) against them. The "foods checked" count still counts every
// product the app has checked.
const SHOWN_STATUS = 'approved';
async function openFlaggedKeys(supabase) {
  const { data, error } = await supabase.from('product_flags').select('lookup_key').eq('status', 'open').not('lookup_key', 'is', null);
  if (error) throw new Error(`flags: ${error.message}`);
  return new Set(data.map((r) => r.lookup_key));
}

async function loadStats() {
  let supabase;
  try {
    const client = await import('../src/services/supabaseClient.js');
    if (!client.isSupabaseConfigured) return null;
    supabase = client.supabase;
  } catch { return null; }
  const visible = ['live', 'approved'];
  const stats = { total: null, examples: [], shelf: [] };

  // Each part on its own: one failing must not cost the other.
  try {
    const { count, error } = await supabase.from('product_reports').select('id', { count: 'exact', head: true }).in('review_status', visible);
    if (error) throw new Error(error.message);
    stats.total = count || null;
  } catch (err) { console.warn(`website: no product count this build (${err.message})`); }

  try {
    // The public key has a short statement timeout: sorting the whole table
    // (or filtering inside the report JSON) runs past it -- fetch, sort here.
    const { data, error } = await supabase
      .from('product_reports')
      .select('id, lookup_key, product_name, scan_count, brand:report->>brand, imageUrl:report->>imageUrl, score:report->overallScore, verdict:report->>verdict')
      .eq('review_status', SHOWN_STATUS)
      .limit(800);
    if (error) throw new Error(error.message);
    const flagged = await openFlaggedKeys(supabase);
    const rows = (data || [])
      .filter((r) => r.product_name && typeof r.score === 'number' && r.imageUrl && !flagged.has(r.lookup_key))
      .sort((a, b) => (b.scan_count || 0) - (a.scan_count || 0));
    // Popular products across the bands -- but not a brand singled out as
    // "Very Poor" on the home page; low scores live on each product's page.
    const pick = (test) => rows.find((r) => test(r.score));
    stats.examples = [pick((v) => v >= 85), pick((v) => v >= 65 && v < 85), pick((v) => v >= 45 && v < 65)]
      .filter(Boolean)
      .map((r) => ({ id: r.id, name: r.product_name, brand: r.brand, imageUrl: r.imageUrl, score: r.score, verdict: r.verdict }));
    // The moving shelf on the home page: popular packs with a photo, every
    // band but Very Poor (same reason as above), one per brand for variety.
    const seenBrand = new Set();
    stats.shelf = rows
      .filter((r) => r.score >= 25 && !seenBrand.has((r.brand || r.product_name).toLowerCase()) && seenBrand.add((r.brand || r.product_name).toLowerCase()))
      .slice(0, 22)
      .map((r) => ({ id: r.id, name: r.product_name, brand: r.brand, imageUrl: r.imageUrl, score: r.score, verdict: verdictFor(r.score) }));
  } catch (err) { console.warn(`website: no example products this build (${err.message})`); }

  return stats;
}

function write(pagePath, html) {
  const file = pagePath.endsWith('.html') ? path.join(OUT, pagePath) : path.join(OUT, pagePath, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

const stats = await loadStats();
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync('site/assets', path.join(OUT, 'assets'), { recursive: true });

// Product details (ingredients, nutrition) are ~6 KB each. Kept between
// builds in .site-cache/ (GitHub Actions cache, see deploy-pages.yml) so a
// deploy only fetches products that are new or changed since the last one --
// every push deploys, and re-reading all of them each time would eat the
// Supabase egress allowance.
const CACHE_FILE = '.site-cache/product-details.json';
const slimIngredient = (i) => ({ name: i.name, status: i.status, reason: i.reason, whatIsIt: i.whatIsIt, insCode: i.insCode, recognized: i.recognized, penalty: i.penalty });

const productUrls = [];
let productCount = 0;
if (productsArg) {
  const { supabase } = await import('../src/services/supabaseClient.js');
  // The whole catalog, slim (for slugs, alternatives and the directory).
  const catalog = [];
  const flagged = await openFlaggedKeys(supabase);
  // The public key has a short statement timeout: small pages, and a page
  // that times out is tried again rather than failing the whole deploy.
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    let data, error;
    for (let attempt = 1; attempt <= 4; attempt++) {
      ({ data, error } = await supabase.from('product_reports')
        .select('id, lookup_key, product_name, scan_count, updated_at, brand:report->>brand, packSize:report->>packSize, imageUrl:report->>imageUrl, score:report->overallScore, verdict:report->>verdict, infant:report->>isInfantFormula')
        .eq('review_status', SHOWN_STATUS).order('id').range(from, from + PAGE - 1));
      if (!error) break;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    if (error) throw new Error(`catalog: ${error.message}`);
    // Infant formula gets no public score page -- the app keeps it out of
    // every spotlight too (a specially regulated product, adult limits don't apply).
    catalog.push(...data.filter((r) => r.product_name && typeof r.score === 'number' && r.infant !== 'true' && !flagged.has(r.lookup_key)).map((r) => ({ ...r, name: r.product_name })));
    if (data.length < PAGE) break;
  }
  assignSlugs(catalog);
  productCount = catalog.length;

  let chosen = catalog;
  if (productsArg !== 'all') {
    // A sample across the bands: popular products first, two per band.
    const n = Number(productsArg) || 10;
    const bands = ['Excellent', 'Good', 'Moderate', 'Poor', 'Very Poor'];
    const popular = [...catalog].sort((a, b) => (b.scan_count || 0) - (a.scan_count || 0));
    chosen = bands.flatMap((v) => popular.filter((p) => p.verdict === v).slice(0, Math.ceil(n / bands.length))).slice(0, n);
  }

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { /* first build */ }
  const stale = chosen.filter((p) => cache[p.id]?.updated_at !== p.updated_at);
  for (let i = 0; i < stale.length; i += 100) {
    let data, error;
    for (let attempt = 1; attempt <= 4; attempt++) {
      ({ data, error } = await supabase.from('product_reports')
        .select('id, summary:report->>summary, ingredients:report->ingredients, per100:report->nutrientsPer100, foodType:report->>foodType')
        .in('id', stale.slice(i, i + 100).map((p) => p.id)));
      if (!error) break;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    if (error) throw new Error(`detail: ${error.message}`);
    const when = new Map(stale.map((p) => [p.id, p.updated_at]));
    for (const d of data) cache[d.id] = { updated_at: when.get(d.id), summary: d.summary, per100: d.per100, foodType: d.foodType, ingredients: (d.ingredients || []).map(slimIngredient) };
  }
  // Keep only products still on the site.
  const keep = new Set(chosen.map((p) => p.id));
  for (const id of Object.keys(cache)) if (!keep.has(id)) delete cache[id];
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));

  const built = new Set();
  for (const p of chosen) {
    const page = productPage({ ...p, ...cache[p.id] }, { alternatives: alternativesFor(p, catalog), api: { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY } });
    write(page.path, layout(page));
    built.add(p.id);
    productUrls.push({ path: page.path, lastmod: String(p.updated_at || '').slice(0, 10) });
  }
  const dir = productsDirectory(productsArg === 'all' ? catalog : chosen);
  write(dir.path, layout(dir));
  productUrls.push({ path: dir.path });
  // /product/ on its own (no product named) opens the directory.
  write('/product/', `<!doctype html><meta charset="utf-8"><title>All products</title><link rel="canonical" href="${SITE_URL}/products/"><meta http-equiv="refresh" content="0; url=/products/"><script>location.replace('/products/')</script><a href="/products/">All products</a>`);

  // Home page cards open the product's own page when it has one.
  const bySlug = new Map(catalog.filter((p) => built.has(p.id)).map((p) => [p.id, productPath(p)]));
  for (const item of [...(stats?.examples || []), ...(stats?.shelf || [])]) item.href = bySlug.get(item.id) || null;
  if (stats) stats.productCount = productsArg === 'all' ? catalog.length : chosen.length;

  console.log(`website: ${chosen.length} product pages + /products/ (${stale.length} fetched from Supabase, ${chosen.length - stale.length} from cache)`);
  for (const p of chosen.slice(0, 12)) console.log(`  ${p.verdict.padEnd(9)} ${productPath(p)}`);
}

const built = [];
for (const make of [...PAGES, notFound]) {
  const page = make({ stats });
  write(page.path, layout(page));
  built.push(page.path);
}

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((m) => `  <url><loc>${SITE_URL}${m({ stats }).path}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
${productUrls.map((u) => `  <url><loc>${SITE_URL}${u.path}</loc><lastmod>${u.lastmod || today}</lastmod></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /app/
Sitemap: ${SITE_URL}/sitemap.xml
`);
console.log(`website: ${built.join(', ')} + sitemap.xml, robots.txt${stats ? ` (${stats.total ?? 'no'} product count, ${stats.examples.length} examples)` : ' (no live numbers)'}`);
