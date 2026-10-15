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

const OUT = 'dist';
const PAGES = [home, howWeScore, about, disclaimer];

async function loadStats() {
  try {
    const { supabase, isSupabaseConfigured } = await import('../src/services/supabaseClient.js');
    if (!isSupabaseConfigured) return null;
    const visible = ['live', 'approved'];
    const { count } = await supabase.from('product_reports').select('id', { count: 'exact', head: true }).in('review_status', visible);
    const { data } = await supabase
      .from('product_reports')
      .select('id, product_name, brand:report->>brand, imageUrl:report->>imageUrl, score:report->overallScore, verdict:report->>verdict')
      .in('review_status', visible)
      .not('report->>imageUrl', 'is', null)
      .order('scan_count', { ascending: false })
      .limit(250);
    const rows = (data || []).filter((r) => r.product_name && typeof r.score === 'number' && r.imageUrl);
    // Popular products across the bands -- but not a brand singled out as
    // "Very Poor" on the home page; low scores live on each product's page.
    const pick = (test) => rows.find((r) => test(r.score));
    const examples = [pick((s) => s >= 85), pick((s) => s >= 65 && s < 85), pick((s) => s >= 45 && s < 65)]
      .filter(Boolean)
      .map((r) => ({ id: r.id, name: r.product_name, brand: r.brand, imageUrl: r.imageUrl, score: r.score, verdict: r.verdict }));
    return { total: count || null, examples };
  } catch (err) {
    console.warn(`website: no live numbers this build (${err.message})`);
    return null;
  }
}

function write(pagePath, html) {
  const file = pagePath.endsWith('.html') ? path.join(OUT, pagePath) : path.join(OUT, pagePath, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

const stats = await loadStats();
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync('site/assets', path.join(OUT, 'assets'), { recursive: true });

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
</urlset>
`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /app/
Sitemap: ${SITE_URL}/sitemap.xml
`);
console.log(`website: ${built.join(', ')} + sitemap.xml, robots.txt${stats ? ` (${stats.total} products, ${stats.examples.length} examples)` : ' (no live numbers)'}`);
