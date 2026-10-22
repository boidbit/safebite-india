// site/pages/rankings.js -- /rankings/: every category's best-scoring packs.
// Built from the approved catalog (scripts/build-site.js), grouped by the
// app's own browse categories (findCategoryForProduct), so a product sits
// on the same shelf here as in the app's "better options".
import { APP_URL, esc } from '../layout.js';
import { CATEGORY_KEYWORDS } from '../../src/data/categoryKeywords.js';
import { findCategoryForProduct } from '../../src/services/productCache.js';

const TIER_COLOR = { Excellent: 'var(--t-excellent)', Good: 'var(--t-good)', Moderate: 'var(--t-moderate)', Poor: 'var(--t-poor)', 'Very Poor': 'var(--t-verypoor)' };
const TOP = 20;

function byCategory(catalog) {
  const byCat = new Map(CATEGORY_KEYWORDS.map((c) => [c.id, []]));
  for (const p of catalog) {
    const cat = findCategoryForProduct(p.name);
    if (cat && byCat.has(cat.id)) byCat.get(cat.id).push(p);
  }
  return byCat;
}

/** [{ id, label, total, items: [{ id, name, brand, imageUrl, href, score, verdict }] }], best first; categories with fewer than 3 products left out. */
export function buildRankings(catalog, pathFor) {
  const byCat = byCategory(catalog);
  return CATEGORY_KEYWORDS
    .map((c) => {
      const all = byCat.get(c.id).sort((a, b) => b.score - a.score || (b.scan_count || 0) - (a.scan_count || 0));
      return {
        id: c.id,
        label: c.label,
        total: all.length,
        items: all.slice(0, TOP).map((p) => ({ id: p.id, name: p.name, brand: p.brand, imageUrl: p.imageUrl || null, href: pathFor(p), score: p.score, verdict: p.verdict })),
      };
    })
    .filter((c) => c.total >= 3)
    .sort((a, b) => b.total - a.total);
}

/**
 * One swap per category, for the app's Discover tab: the most-scanned
 * Poor or Moderate pack (never a Very Poor one singled out, as on the
 * home page) and the best pack on the same shelf, at least 20 points up.
 */
export function buildSwaps(catalog, { limit = 8 } = {}) {
  const slim = (p) => ({ id: p.id, name: p.name, brand: p.brand, imageUrl: p.imageUrl || null, score: p.score, verdict: p.verdict });
  const swaps = [];
  for (const [category, all] of byCategory(catalog)) {
    const best = [...all].sort((a, b) => b.score - a.score || (b.scan_count || 0) - (a.scan_count || 0))[0];
    if (!best || best.score < 65) continue;
    const from = all
      .filter((p) => p.score >= 25 && p.score < 65 && best.score - p.score >= 20)
      .sort((a, b) => (b.scan_count || 0) - (a.scan_count || 0))[0];
    if (from) swaps.push({ category, from: slim(from), to: slim(best) });
  }
  return swaps.slice(0, limit);
}

/** One category's table; `limit` shows the first few with a link to the rest. */
export function leagueTable(c, { limit = TOP } = {}) {
  const rows = c.items.slice(0, limit);
  return `<div class="lt" id="${esc(c.id)}">
    <h3>${esc(c.label)}<span>${c.total.toLocaleString('en-IN')} checked</span></h3>
    <ol>${rows.map((p, i) => {
      const color = TIER_COLOR[p.verdict] || 'var(--ink-3)';
      return `<li><span class="n">${i + 1}</span><a href="${esc(p.href)}" title="${esc(p.name)}">${esc(p.name)}${p.brand && limit > 5 ? ` <span>${esc(p.brand)}</span>` : ''}</a><span class="bar" aria-hidden="true"><i style="width:${p.score}%;background:${color}"></i></span><b style="color:${color}">${p.score}</b></li>`;
    }).join('')}</ol>
    ${limit < c.items.length ? `<a class="lt-more" href="/rankings/#${esc(c.id)}">See the full ranking →</a>` : ''}
  </div>`;
}

export default function rankings({ stats }) {
  const cats = stats?.rankings || [];
  return {
    path: '/rankings/',
    title: 'Rankings by category',
    description: 'The best-scoring packaged foods in India, category by category — biscuits, instant noodles, drinks, namkeen and more, ranked by ingredient score.',
    body: `
<div class="page-head"><div class="wrap">
  <div class="eyebrow">League tables</div>
  <h1>Every shelf, ranked.</h1>
  <p>The top ${TOP} packs in each category by ingredient score, from every product a person has checked and approved. Tap one for every ingredient and the reasons.</p>
  ${cats.length ? `<nav class="rk-nav" aria-label="Categories">${cats.map((c) => `<a href="#${esc(c.id)}">${esc(c.label)}</a>`).join('')}</nav>` : ''}
</div></div>
<div class="wrap rk">
${cats.length ? cats.map((c) => leagueTable(c)).join('\n') : `<p>Rankings are being prepared. Meanwhile, <a href="${APP_URL}">check any product in the app</a>.</p>`}
<p class="p-note">Scores rate the ingredient list, not your health — <a href="/how-we-score/">how we score</a>. Spotted a mistake? Report it on the product’s page.</p>
</div>`,
  };
}
