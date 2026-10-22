// site/pages/home.js -- foodguards.space
import { APP_URL, PLAY_URL, esc, playButton } from '../layout.js';
import { leagueTable } from './rankings.js';

const TIER_COLOR = { Excellent: 'var(--t-excellent)', Good: 'var(--t-good)', Moderate: 'var(--t-moderate)', Poor: 'var(--t-poor)', 'Very Poor': 'var(--t-verypoor)' };

function exampleCard(p) {
  const color = TIER_COLOR[p.verdict] || 'var(--ink-3)';
  return `<a class="ex" href="${p.href || `${APP_URL}#/p/${encodeURIComponent(p.id)}`}">
    ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" />` : ''}
    <div class="meta">
      ${p.brand ? `<div class="brand-n">${esc(p.brand)}</div>` : ''}
      <div class="name">${esc(p.name)}</div>
      <div class="verdict" style="color:${color}">${esc(p.verdict)}</div>
    </div>
    <div class="ring" style="--c:${color};--v:${p.score}"><span>${p.score}</span></div>
  </a>`;
}

function shelfItem(p, duplicate) {
  const color = TIER_COLOR[p.verdict] || 'var(--ink-3)';
  return `<a class="shelf-item" href="${p.href || `${APP_URL}#/p/${encodeURIComponent(p.id)}`}"${duplicate ? ' aria-hidden="true" tabindex="-1"' : ''}>
    <span class="shelf-pack"><img src="${esc(p.imageUrl)}" alt="${duplicate ? '' : esc(p.name)}" loading="lazy" /></span>
    <span class="shelf-badge" style="background:${color}">${p.score}</span>
    <span class="shelf-name">${esc(p.name)}</span>
  </a>`;
}

// The paste box's "Or try" labels -- typical lists, no brand.
const SAMPLES = [
  ['Masala noodles', 'Refined Wheat Flour (Maida) (68%), Palm Oil, Iodised Salt, Wheat Gluten, INS 508, INS 412, Masala (Spices & Condiments, Sugar, INS 627, INS 631, INS 150d, INS 501).'],
  ['Chocolate biscuit', 'Wheat Flour, Sugar, Palm Oil, Skimmed Milk Powder, Cocoa Powder, Salt, Raising Agents (INS 500ii, INS 503ii), Emulsifier (INS 322), Artificial Flavour (Vanilla).'],
  ['Mango drink', 'Water, Sugar, Mango Pulp (19.5%), Acidity Regulator (INS 330), Stabiliser (INS 440), Antioxidant (INS 300), Colour (INS 110).'],
];

// What the big words on the front usually hide.
const CLAIMS = [
  ['“No maida”', 'Look for “refined wheat flour” in the list — it’s the same thing under its other name.'],
  ['“Multigrain”', 'Many grains can still mean mostly refined flour. The first ingredient is the biggest one.'],
  ['“No added sugar”', 'Watch for maltodextrin, liquid glucose and fruit concentrates — sugar by another name.'],
  ['“Baked, not fried”', 'Baked snacks can still list palm oil near the top. Check where the fat comes in.'],
];

const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  explain: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  family: icon('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.4 5 2.8 5 5.8"/>'),
  swap: icon('<path d="M7 4 3 8l4 4"/><path d="M3 8h14"/><path d="m17 20 4-4-4-4"/><path d="M21 16H7"/>'),
  camera: icon('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
};

const FAQ = [
  ['Is FoodGuard free?', 'Yes. Scanning, scores and explanations are free. There are no ads selling you a "healthier" product.'],
  ['Where does the score come from?', 'From the ingredient list on the pack. Each ingredient is checked against public sources — FSSAI, the European Food Safety Authority and WHO guidance — and the product is scored on what it contains and how much of it. Where we have the real nutrition panel, too much sugar, salt or saturated fat per serving also counts. <a href="/how-we-score/">The full method is here.</a>'],
  ['Is this medical or diet advice?', 'No. The score describes an ingredient list, not your health. Allergies, pregnancy, diabetes or any medical condition — please talk to a doctor or a registered dietitian.'],
  ["Does a low score mean a product is unsafe?", 'No. Everything sold legally in India meets FSSAI rules. A low score means the ingredient list leans on things worth eating less often — refined flour, added sugar, certain additives — not that the food is dangerous.'],
  ['A product looks wrong. What do I do?', 'Use the report option on the product in the app, or write to us. New products are checked by a person before they go live, and reported mistakes are fixed quickly.'],
  ['Is there an iPhone app?', `Not yet — the web app works in Safari on iPhone. Type or photograph the barcode, or a photo of the label. On Android, <a href="${PLAY_URL}" target="_blank" rel="noopener">get the app on Google Play</a>.`],
];

export default function home({ stats }) {
  const total = stats?.total ? stats.total.toLocaleString('en-IN') : null;
  const examples = stats?.examples || [];
  const shelf = stats?.shelf || [];
  const rankings = (stats?.rankings || []).slice(0, 3);
  return {
    path: '/',
    title: 'FoodGuard India — know what’s in your food',
    description: 'Scan any packaged food sold in India and see what’s really in it: an ingredient score from 0 to 100, every ingredient explained in plain language, and better options.',
    scripts: ['/assets/home.js'],
    body: `
<section class="hero">
  <div class="wrap">
    <div>
      <div class="eyebrow">For packaged food in India</div>
      <h1 style="margin-top:14px">The front sells.<br /><em>The back tells.</em></h1>
      <p class="lead">FoodGuard reads the back of the pack — the part written for regulators — and tells you what each ingredient is, which ones are <span class="mark">worth a second look</span>, and scores the whole thing from 0 to 100.</p>
      <div class="hero-ctas">
        ${playButton({ place: 'hero' })}
        <a class="btn btn-primary" href="${APP_URL}">Open the web app →</a>
      </div>
      <div class="hero-stat">
        ${total ? `<div><b>${total}</b><span>foods checked</span></div>` : ''}
        <div><b>0–100</b><span>one clear score</span></div>
        <div><b>Free</b><span>no sign-up needed</span></div>
      </div>
    </div>
    <form class="paste" id="paste" action="${APP_URL}" method="get">
      <div class="paste-head"><h2>Paste a label</h2><span class="paste-free">Free · no install</span></div>
      <label for="paste-text">Ingredients, as printed on the pack</label>
      <textarea id="paste-text" name="paste" maxlength="3000" rows="6" placeholder="Copy the ingredients from a pack or a shopping site and paste them here…" required>${esc(SAMPLES[0][1])}</textarea>
      <div class="paste-try"><span>Or try:</span>${SAMPLES.map(([name, text]) => `<button type="button" data-label="${esc(text)}">${esc(name)}</button>`).join('')}</div>
      <button class="paste-go" type="submit">Decode this label →</button>
      <p class="paste-err" role="alert" hidden>Paste an ingredient list first.</p>
      <p class="paste-note">Opens the FoodGuard web app with your label and scores it there.</p>
    </form>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head">
      <div class="eyebrow">Turn the pack around</div>
      <h2>Big words on the front. The facts are on the back.</h2>
    </div>
    <div class="fvb">
      <div class="fvb-front">
        <div class="eyebrow">Front of pack · example</div>
        <div><div class="fvb-claim">Made with<br />real mango!</div><span class="fvb-badge">Goodness of fruit</span></div>
        <div>Mango drink · 1 L</div>
      </div>
      <div class="fvb-back">
        <div class="eyebrow">Back of pack · decoded</div>
        <p class="fvb-label">Water, <mark>Sugar</mark>, Mango Pulp <mark>(19.5%)</mark>, Acidity Regulator (INS 330), Stabiliser (INS 440), Antioxidant (INS 300), <mark>Colour (INS 110)</mark>.</p>
        <ul class="fvb-points">
          <li><b>Sugar comes before the mango.</b> Ingredient lists run from the most to the least.</li>
          <li><b>Under a fifth is fruit.</b> Most of the bottle is sweetened water.</li>
          <li><b>INS 110 is Sunset Yellow,</b> a synthetic colour — the orange isn’t only mango.</li>
        </ul>
        <div class="fvb-foot">FoodGuard does this for every pack — in about two seconds.</div>
      </div>
    </div>
  </div>
</section>

${shelf.length >= 6 ? `<section class="shelf-sec" aria-label="Products already checked">
  <div class="wrap shelf-head"><div><div class="eyebrow">On the shelf</div><h2>${total ? `${total} foods` : 'Thousands of foods'}, already decoded.</h2></div>
    ${stats?.productCount ? `<a class="btn btn-primary shelf-all" href="/products/">Browse ${stats.productCount.toLocaleString('en-IN')} products →</a>` : ''}</div>
  <div class="shelf"><div class="shelf-track">${[...shelf, ...shelf].map((p, i) => shelfItem(p, i >= shelf.length)).join('')}</div></div>
</section>` : ''}

<section class="alt">
  <div class="wrap">
    <div class="section-head">
      <div class="eyebrow">Claims decoded</div>
      <h2>What the front of the pack usually means.</h2>
      <p>Four phrases you’ll see on Indian shelves this week, and the line on the back that tells the real story.</p>
    </div>
    <div class="claims">${CLAIMS.map(([claim, what]) => `<div class="claim"><h3>${claim}</h3><p>${what}</p></div>`).join('')}</div>
  </div>
</section>

${rankings.length ? `<section>
  <div class="wrap">
    <div class="shelf-head section-head" style="max-width:none">
      <div><div class="eyebrow">League tables</div><h2>Every shelf, ranked.</h2><p>The best-scoring packs in each category, from every product we’ve checked.</p></div>
      <a class="btn btn-primary" href="/rankings/">All rankings →</a>
    </div>
    <div class="lt-grid">${rankings.map((c) => leagueTable(c, { limit: 5 })).join('')}</div>
  </div>
</section>` : ''}

<section class="showcase">
  <div class="wrap">
    <div class="section-head center">
      <div class="eyebrow">In the aisle</div>
      <h2>Turn any pack around in two seconds.</h2>
      <p>Scan the barcode, see the score, read the reasons — and a better pick from the same shelf. Free on Android.</p>
    </div>
    <div class="shots">
      <figure><div class="phone-frame"><img src="/assets/app-home.webp" alt="FoodGuard home screen with scan button" width="540" height="960" /></div><figcaption>Scan or search</figcaption></figure>
      <figure class="mid"><div class="phone-frame"><img src="/assets/app-score.webp" alt="A product's 0 to 100 score with verdict" width="540" height="960" /></div><figcaption>One clear score</figcaption></figure>
      <figure><div class="phone-frame"><img src="/assets/app-details.webp" alt="Ingredient-by-ingredient explanations" width="540" height="960" /></div><figcaption>Every ingredient explained</figcaption></figure>
    </div>
    <div class="showcase-cta">${playButton({ place: 'showcase' })}</div>
  </div>
</section>

<section>
  <div class="wrap split">
    <div class="section-head" style="margin:0">
      <div class="eyebrow">How it works</div>
      <h2>Scan. Score. Swap.</h2>
      <p>Ingredient lists are written for regulators, not for you. INS numbers, “permitted emulsifiers”, three kinds of sugar under three names. We do the reading.</p>
    </div>
    <div class="label">
      <div class="label-title">FoodGuard Facts</div>
      <div class="label-sub"><span>Serving: 1 scan</span><span>about 10 seconds</span></div>
      <div class="label-row"><div class="n">01</div><div><h3>Scan</h3><p>Point the camera at the barcode — or take a photo of the ingredients list, or type the name.</p></div></div>
      <div class="label-row"><div class="n">02</div><div><h3>Score</h3><p>Every ingredient is looked up and explained. The pack gets one score, 0 to 100, with the reasons.</p></div></div>
      <div class="label-row"><div class="n">03</div><div><h3>Swap</h3><p>See better-scoring products from the same shelf, so the next pick is an easy one.</p></div></div>
    </div>
  </div>
</section>

<section class="alt">
  <div class="wrap">
    <div class="section-head">
      <div class="eyebrow">What you get</div>
      <h2>Built for the Indian shelf.</h2>
      <p>Namkeen, biscuits, masala, instant noodles, chocolate, ghee — the foods on our shelves, with the INS codes and names printed on Indian labels.</p>
    </div>
    <div class="cards">
      <div class="card"><div class="ico">${ICONS.explain}</div><h3>Every ingredient, explained</h3><p>What it is, why it’s added, what FSSAI and Europe say about it — in plain words, not chemistry.</p></div>
      <div class="card"><div class="ico">${ICONS.family}</div><h3>One scan, the whole family</h3><p>Add family members with their own priorities — less sugar for one, less salt for another — and see each person’s answer.</p></div>
      <div class="card"><div class="ico">${ICONS.swap}</div><h3>Better options</h3><p>A low score comes with higher-scoring products from the same category, not just a warning.</p></div>
      <div class="card"><div class="ico">${ICONS.camera}</div><h3>Barcode, photo or name</h3><p>No barcode? Photograph the label. Small print? Zoom and focus are built in.</p></div>
    </div>
  </div>
</section>

${examples.length ? `<section>
  <div class="wrap">
    <div class="section-head">
      <div class="eyebrow">Real scores</div>
      <h2>Popular products, scored.</h2>
      <p>A few of the products people check most. Tap one to see every ingredient and the reasons behind its score.</p>
    </div>
    <div class="examples">${examples.map(exampleCard).join('')}</div>
  </div>
</section>` : ''}

<section class="${examples.length ? 'alt' : ''}">
  <div class="wrap">
    <div class="section-head">
      <div class="eyebrow">The score</div>
      <h2>One number. Five bands.</h2>
      <p>The score rates the ingredient list — what’s in it and how much. One harmful ingredient caps it low however clean the rest is. <a href="/how-we-score/">Read the full method →</a></p>
    </div>
    <div class="scale">
      <div><i style="background:var(--t-excellent)"></i><b>Excellent</b><span>85–100</span></div>
      <div><i style="background:var(--t-good)"></i><b>Good</b><span>65–84</span></div>
      <div><i style="background:var(--t-moderate)"></i><b>Moderate</b><span>45–64</span></div>
      <div><i style="background:var(--t-poor)"></i><b>Poor</b><span>25–44</span></div>
      <div><i style="background:var(--t-verypoor)"></i><b>Very Poor</b><span>0–24</span></div>
    </div>
  </div>
</section>

<section id="faq">
  <div class="wrap">
    <div class="section-head"><div class="eyebrow">Questions</div><h2>Asked often.</h2></div>
    <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap">
    <div class="cta-band">
      <div>
        <h2>Your next grocery run, decoded.</h2>
        <p>Free on Android, and in any browser — no sign-up, nothing to pay.</p>
      </div>
      <div class="cta-actions">${playButton({ place: 'cta' })}<a class="btn" href="${APP_URL}">Use the web app →</a></div>
    </div>
  </div>
</section>
`,
  };
}
