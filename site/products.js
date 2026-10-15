// site/products.js -- one page per product (/product/<slug>/) and the
// A-Z directory (/products/). Rendered by scripts/build-site.js from the
// live/approved catalog.
//
// Wording is deliberately neutral: an ingredient score, "worth eating less
// often", never "harmful product" or "avoid" -- the page names a real brand
// in search results. No star ratings or review markup either.
import { APP_URL, CONTACT_EMAIL, esc } from './layout.js';
import { isJunkIngredient } from '../src/services/typoIngredient.js';
import { findCategoryForProduct } from '../src/services/productCache.js';
import { verdictFor } from '../src/services/scoringEngine.js';
import { FLAG_REASONS } from '../src/services/productFlags.js';

const TIER = {
  Excellent: { color: 'var(--t-excellent)', eat: 'Yes' },
  Good: { color: 'var(--t-good)', eat: 'Mostly, yes' },
  Moderate: { color: 'var(--t-moderate)', eat: 'Occasionally' },
  Poor: { color: 'var(--t-poor)', eat: 'Rarely' },
  'Very Poor': { color: 'var(--t-verypoor)', eat: 'Rarely' },
};
const STATUS = {
  harmful: { label: 'High concern', color: 'var(--t-verypoor)', order: 0 },
  concerning: { label: 'Worth limiting', color: 'var(--t-poor)', order: 1 },
  safe: { label: 'Fine', color: 'var(--t-excellent)', order: 2 },
};
const NUTRIENTS = [
  ['caloriesKcal', 'Energy', 'kcal'], ['proteinG', 'Protein', 'g'], ['carbohydrateG', 'Carbohydrate', 'g'],
  ['totalSugarG', 'Total sugars', 'g'], ['addedSugarG', 'Added sugars', 'g'], ['totalFatG', 'Total fat', 'g'],
  ['saturatedFatG', 'Saturated fat', 'g'], ['transFatG', 'Trans fat', 'g'], ['fiberG', 'Fibre', 'g'], ['sodiumMg', 'Sodium', 'mg'],
];

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

/**
 * A stable, readable address per product: brand + name (+ pack size). Two
 * products that would share one get the pack size, then a short id.
 * Mutates each product with `.slug`.
 */
export function assignSlugs(products) {
  for (const p of products) if (typeof p.score === 'number') p.verdict = verdictFor(p.score);
  const base = (p) => {
    const name = slugify(p.name);
    const brand = slugify(p.brand);
    return brand && !name.startsWith(brand) ? `${brand}-${name}` : name || 'product';
  };
  const counts = new Map();
  for (const p of products) counts.set(base(p), (counts.get(base(p)) || 0) + 1);
  const used = new Set();
  for (const p of products) {
    let slug = base(p);
    if (counts.get(slug) > 1 && p.packSize) slug = `${slug}-${slugify(p.packSize)}`;
    if (used.has(slug)) slug = `${slug}-${String(p.id).slice(0, 6)}`;
    used.add(slug);
    p.slug = slug;
  }
  return products;
}

export const productPath = (p) => `/product/${p.slug}/`;

/** Same-shelf products with a better score (findCategoryForProduct, as the app does). */
export function alternativesFor(p, catalog, limit = 4) {
  const cat = findCategoryForProduct(p.name);
  if (!cat) return [];
  return catalog
    .filter((o) => o.id !== p.id && typeof o.score === 'number' && o.score >= Math.max(65, p.score + 1) && findCategoryForProduct(o.name)?.id === cat.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const ring = (score, color, size = 'lg') => `<div class="ring ring-${size}" style="--c:${color};--v:${score}"><span>${score}</span></div>`;
const firstSentence = (s) => { const t = String(s || '').trim(); const m = t.match(/^.+?[.!?](\s|$)/); return (m ? m[0] : t).trim(); };

// Ingredients worth a look: full rows, with the reason.
function flaggedRows(list) {
  return list.map((i) => `<li class="ing">
      <span class="ing-dot" style="background:${i.s.color}"></span>
      <div><div class="ing-name">${esc(i.name)}${i.insCode ? ` <span class="ing-ins">INS ${esc(i.insCode)}</span>` : ''}</div>
      <div class="ing-why">${esc(firstSentence(i.reason || i.whatIsIt))}</div></div>
      <span class="ing-tag" style="color:${i.s.color}">${i.s.label}</span>
    </li>`).join('');
}

// The fine ones: compact chips -- tap one for its one-line reason.
function fineChips(list) {
  return list.map((i) => `<details class="chip"><summary>${esc(i.name)}</summary><p>${esc(firstSentence(i.reason || i.whatIsIt))}</p></details>`).join('');
}

function nutritionTable(per100, foodType) {
  if (!per100) return '';
  const rows = NUTRIENTS.filter(([k]) => typeof per100[k] === 'number');
  if (rows.length < 3) return '';
  const unit = /drink|beverage|juice|milk/i.test(foodType || '') ? '100 ml' : '100 g';
  return `<div class="label nutri"><div class="label-title">Nutrition facts</div><div class="label-sub"><span>Per ${unit}</span><span>from the pack</span></div>
    ${rows.map(([k, label, u]) => `<div class="nutri-row"><span>${label}</span><b>${per100[k]} ${u}</b></div>`).join('')}
    </div>`;
}

// The app's "Report an issue", on the page: same reasons, same table
// (product_flags) -> Admin > Flagged. Sent by /assets/report.js.
function reportForm(p, nameWithBrand, api) {
  if (!api?.url || !api?.key) return '';
  return `<details class="report"><summary>Is something wrong? Report it</summary>
    <form class="report-form" data-api="${esc(api.url)}" data-key="${esc(api.key)}" data-lookup-key="${esc(p.lookup_key || '')}" data-name="${esc(p.name)}" data-score="${p.score}" data-verdict="${esc(p.verdict)}">
      <p class="report-q">What looks wrong with ${esc(nameWithBrand)}?</p>
      ${FLAG_REASONS.map((r) => `<label class="report-opt"><input type="radio" name="reason" value="${r.key}" /> ${esc(r.label)}</label>`).join('')}
      <textarea maxlength="500" rows="3" placeholder="Anything that helps us fix it (optional)"></textarea>
      <div class="report-actions"><button type="submit" class="btn btn-primary btn-sm">Send report</button><span class="report-status" role="status"></span></div>
    </form></details>`;
}

export function productPage(p, { alternatives = [], api = null } = {}) {
  const tier = TIER[p.verdict] || { color: 'var(--ink-3)', eat: '' };
  const ings = (p.ingredients || [])
    .filter((i) => i?.name && !isJunkIngredient(i))
    .map((i) => ({ ...i, s: STATUS[i.status] || STATUS.safe }));
  const flagged = ings.filter((i) => i.status === 'concerning' || i.status === 'harmful').sort((a, b) => a.s.order - b.s.order);
  const fine = ings.filter((i) => i.status !== 'concerning' && i.status !== 'harmful');
  const flaggedLine = ings.length ? (flagged.length ? `${flagged.length} of ${ings.length} ingredients worth a closer look` : `All ${ings.length} ingredients check out`) : '';
  const nameWithBrand = p.brand && !p.name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name;
  const flaggedNames = [...new Set(flagged.map((i) => i.name.replace(/^[^:]{2,30}:\s*/, '').trim()))].slice(0, 3).join(', ');
  const description = `Is ${nameWithBrand} healthy? Ingredient score ${p.score}/100 (${p.verdict}). ${flagged.length ? `Worth a closer look: ${flaggedNames}${flagged.length > 3 ? ' and more' : ''}.` : 'No ingredient flagged.'} Every ingredient explained.`;
  const nutrition = nutritionTable(p.per100, p.foodType);
  return {
    path: productPath(p),
    title: `${nameWithBrand} — ingredients & score (${p.score}/100)`,
    description,
    ogImage: p.imageUrl || undefined,
    scripts: api?.url ? ['/assets/report.js'] : [],
    body: `
<div class="wrap p-wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/products/">Products</a>${p.brand ? ` / <a href="/products/#${esc(slugify(p.brand))}">${esc(p.brand)}</a>` : ''}</nav>
  <div class="p-layout">
    <aside class="p-side">
      <div class="p-card">
        <div class="p-top">
          <div class="p-img${p.imageUrl ? '' : ' p-img-none'}">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(nameWithBrand)}" width="200" height="200" />` : '<span aria-hidden="true">📦</span>'}</div>
          <div class="p-title">
            ${p.brand ? `<div class="eyebrow">${esc(p.brand)}</div>` : ''}
            <h1>${esc(p.name)}</h1>
            ${p.packSize ? `<div class="p-pack">${esc(p.packSize)}</div>` : ''}
          </div>
        </div>
        <div class="p-score">
          ${ring(p.score, tier.color)}
          <div><div class="p-verdict" style="color:${tier.color}">${esc(p.verdict)}</div><div class="p-flagged">${esc(flaggedLine)}</div>
          ${tier.eat ? `<div class="p-eat">How often? <b style="color:${tier.color}">${tier.eat}</b></div>` : ''}</div>
        </div>
        <div class="p-ctas"><a class="btn btn-primary btn-sm" href="${APP_URL}#/p/${encodeURIComponent(p.id)}">Open in the app</a><a class="btn btn-ghost btn-sm" href="${APP_URL}">Scan your own</a></div>
      </div>
      ${nutrition ? `<div class="p-side-nutri">${nutrition}</div>` : ''}
    </aside>

    <div class="p-main">
      ${p.summary ? `<p class="p-summary">${esc(p.summary)}</p>` : ''}

      ${flagged.length ? `<section class="p-sec"><h2>Worth a closer look <span class="p-count">${flagged.length}</span></h2>
        <p class="p-note">Allowed in India, but better eaten less often.</p>
        <ul class="ings">${flaggedRows(flagged)}</ul></section>` : ''}

      ${fine.length ? `<section class="p-sec"><h2>${flagged.length ? 'The rest check out' : 'Every ingredient checks out'} <span class="p-count">${fine.length}</span></h2>
        <p class="p-note">Tap one to see why.</p>
        <div class="chips">${fineChips(fine)}</div></section>` : ''}

      ${alternatives.length ? `<section class="p-sec"><h2>Higher-scoring options</h2>
        <div class="examples p-alts">${alternatives.map((a) => `<a class="ex" href="${productPath(a)}">
          ${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="" loading="lazy" />` : ''}
          <div class="meta">${a.brand ? `<div class="brand-n">${esc(a.brand)}</div>` : ''}<div class="name">${esc(a.name)}</div><div class="verdict" style="color:${(TIER[a.verdict] || {}).color}">${esc(a.verdict)}</div></div>
          ${ring(a.score, (TIER[a.verdict] || {}).color || 'var(--ink-3)', 'sm')}</a>`).join('')}</div></section>` : ''}

      <div class="note p-fine"><p>This score rates the ingredient list using <a href="/how-we-score/">our published method</a> and public sources (FSSAI, EFSA, WHO). It is general information, not medical advice, and does not mean the product is unsafe — products sold in India meet FSSAI rules. Recipes change: check the pack in your hand. Brand owner? Write to <a href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Correction: ${nameWithBrand}`)}">${CONTACT_EMAIL}</a>.</p></div>
      ${reportForm(p, nameWithBrand, api)}
    </div>
  </div>
</div>`,
  };
}

/** /products/ -- every product, grouped by brand, A-Z. */
export function productsDirectory(products) {
  const groups = new Map();
  for (const p of products) {
    const b = (p.brand || 'Other').trim();
    const key = b.toLowerCase();
    if (!groups.has(key)) groups.set(key, { spellings: new Map(), items: [] });
    const g = groups.get(key);
    g.spellings.set(b, (g.spellings.get(b) || 0) + 1);
    g.items.push(p);
  }
  const byBrand = new Map([...groups.values()].map((g) => [[...g.spellings].sort((x, y) => y[1] - x[1])[0][0], g.items]));
  const brands = [...byBrand.keys()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return {
    path: '/products/',
    title: 'All products',
    description: `Ingredient scores for ${products.length.toLocaleString('en-IN')} packaged foods sold in India, by brand — every ingredient explained.`,
    body: `
<div class="page-head"><div class="wrap">
  <div class="eyebrow">Directory</div>
  <h1>All products</h1>
  <p>${products.length.toLocaleString('en-IN')} packaged foods, by brand. Can’t find one? <a href="${APP_URL}">Scan it in the app</a>.</p>
</div></div>
<div class="wrap dir">
${brands.map((b) => `<section class="dir-brand" id="${esc(slugify(b))}"><h2>${esc(b)}</h2><ul>${byBrand.get(b).sort((x, y) => x.name.localeCompare(y.name)).map((p) => `<li><a href="${productPath(p)}">${esc(p.name)}${p.packSize ? ` <span>${esc(p.packSize)}</span>` : ''}</a> <b style="color:${(TIER[p.verdict] || {}).color}">${p.score}</b></li>`).join('')}</ul></section>`).join('\n')}
</div>`,
  };
}
