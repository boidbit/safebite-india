// site/pages/home.js -- foodguards.space
import { APP_URL, esc, soonPill } from '../layout.js';

const TIER_COLOR = { Excellent: 'var(--t-excellent)', Good: 'var(--t-good)', Moderate: 'var(--t-moderate)', Poor: 'var(--t-poor)', 'Very Poor': 'var(--t-verypoor)' };

function exampleCard(p) {
  const color = TIER_COLOR[p.verdict] || 'var(--ink-3)';
  return `<a class="ex" href="${APP_URL}#/p/${encodeURIComponent(p.id)}">
    ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" />` : ''}
    <div class="meta">
      ${p.brand ? `<div class="brand-n">${esc(p.brand)}</div>` : ''}
      <div class="name">${esc(p.name)}</div>
      <div class="verdict" style="color:${color}">${esc(p.verdict)}</div>
    </div>
    <div class="ring" style="--c:${color};--v:${p.score}"><span>${p.score}</span></div>
  </a>`;
}

// The decoder's example label -- a typical masala-noodles list, no brand.
// [text, 's' fine | 'c' worth a look, what it is]. Six of twelve flagged,
// which the method caps at Moderate -- the 48 the ring fills to.
const DECODER_LABEL = [
  ['Refined Wheat Flour (Maida)', 'c', 'Refined flour — the fibre is milled out'], ' (68%), ',
  ['Palm Oil', 'c', 'High in saturated fat'], ', ',
  ['Iodised Salt', 's', 'Fine in normal amounts'], ', ',
  ['Wheat Gluten', 's', 'The protein in wheat'], ', ',
  ['INS 508', 's', 'Potassium chloride — a salt'], ', ',
  ['INS 412', 's', 'Guar gum — a thickener from a bean'], ', Masala (',
  ['Spices & Condiments', 's', 'Onion, garlic, chilli, turmeric…'], ', ',
  ['Sugar', 'c', 'Added sugar'], ', ',
  ['INS 627', 'c', 'Flavour enhancer (disodium guanylate)'], ', ',
  ['INS 631', 'c', 'Flavour enhancer (disodium inosinate)'], ', ',
  ['INS 150d', 'c', 'Caramel colour'], ', ',
  ['INS 501', 's', 'Potassium carbonate — an acidity regulator'], ').',
];

function shelfItem(p, duplicate) {
  const color = TIER_COLOR[p.verdict] || 'var(--ink-3)';
  return `<a class="shelf-item" href="${APP_URL}#/p/${encodeURIComponent(p.id)}"${duplicate ? ' aria-hidden="true" tabindex="-1"' : ''}>
    <span class="shelf-pack"><img src="${esc(p.imageUrl)}" alt="${duplicate ? '' : esc(p.name)}" loading="lazy" /></span>
    <span class="shelf-badge" style="background:${color}">${p.score}</span>
    <span class="shelf-name">${esc(p.name)}</span>
  </a>`;
}

const FAQ = [
  ['Is FoodGuard free?', 'Yes. Scanning, scores and explanations are free. There are no ads selling you a "healthier" product.'],
  ['Where does the score come from?', 'From the ingredient list on the pack. Each ingredient is checked against public sources — FSSAI, the European Food Safety Authority and WHO guidance — and the product is scored on what it contains and how much of it. Where we have the real nutrition panel, too much sugar, salt or saturated fat per serving also counts. <a href="/how-we-score/">The full method is here.</a>'],
  ['Is this medical or diet advice?', 'No. The score describes an ingredient list, not your health. Allergies, pregnancy, diabetes or any medical condition — please talk to a doctor or a registered dietitian.'],
  ["Does a low score mean a product is unsafe?", 'No. Everything sold legally in India meets FSSAI rules. A low score means the ingredient list leans on things worth eating less often — refined flour, added sugar, certain additives — not that the food is dangerous.'],
  ['A product looks wrong. What do I do?', 'Use the report option on the product in the app, or write to us. New products are checked by a person before they go live, and reported mistakes are fixed quickly.'],
  ['Is there an iPhone app?', 'Not yet — the web app works in Safari on iPhone. Type or photograph the barcode, or a photo of the label. The Android app is coming soon to Google Play.'],
];

export default function home({ stats }) {
  const total = stats?.total ? stats.total.toLocaleString('en-IN') : null;
  const examples = stats?.examples || [];
  const shelf = stats?.shelf || [];
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
      <h1>Read the label.<br /><em>Finally understand it.</em></h1>
      <p class="lead">Scan the barcode or snap the ingredients. FoodGuard tells you what each ingredient is, which ones are <span class="mark">worth a second look</span>, and scores the whole pack from 0 to 100 — in seconds.</p>
      <div class="hero-ctas">
        <a class="btn btn-primary" href="${APP_URL}">Open the web app →</a>
        ${soonPill()}
      </div>
      <div class="hero-stat">
        ${total ? `<div><b>${total}</b><span>foods checked</span></div>` : ''}
        <div><b>0–100</b><span>one clear score</span></div>
        <div><b>Free</b><span>no sign-up needed</span></div>
      </div>
    </div>
    <!-- The Label Decoder: an example ingredients label read out loud --
         each ingredient lights up with what it is, and the score fills in
         (site/assets/home.js). A made-up "masala noodles" label, no brand. -->
    <div class="decoder" id="decoder" aria-label="Example: an ingredients label being decoded">
      <div class="dec-head">
        <span class="dec-live"><i></i>Decoding</span>
        <span class="dec-what">Example label · masala instant noodles</span>
        <button class="dec-replay" type="button" aria-label="Play again">↻</button>
      </div>
      <div class="dec-label">
        <div class="dec-title">INGREDIENTS:</div>
        <p class="dec-text">${DECODER_LABEL.map((t) => typeof t === 'string' ? t : `<span class="tok" data-t="${t[1]}" data-note="${t[2]}">${t[0]}</span>`).join('')}</p>
      </div>
      <div class="dec-foot">
        <div class="ring dec-ring" style="--c:var(--ink-3);--v:0"><span>0</span></div>
        <div class="dec-out">
          <div class="dec-verdict">Reading the label…</div>
          <ul class="dec-feed" aria-live="polite"></ul>
        </div>
      </div>
    </div>
  </div>
</section>

<div class="barcode-strip" aria-hidden="true"></div>

${shelf.length >= 6 ? `<section class="shelf-sec" aria-label="Products already checked">
  <div class="wrap shelf-head"><div class="eyebrow">On the shelf</div><h2>${total ? `${total} foods` : 'Thousands of foods'}, already decoded.</h2></div>
  <div class="shelf"><div class="shelf-track">${[...shelf, ...shelf].map((p, i) => shelfItem(p, i >= shelf.length)).join('')}</div></div>
</section>` : ''}

<section>
  <div class="wrap split">
    <div class="section-head" style="margin:0">
      <div class="eyebrow">How it works</div>
      <h2>The back of the pack, decoded.</h2>
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
      <div class="card"><div class="ico">🔍</div><h3>Every ingredient, explained</h3><p>What it is, why it’s added, what FSSAI and Europe say about it — in plain words, not chemistry.</p></div>
      <div class="card"><div class="ico">👨‍👩‍👧</div><h3>One scan, the whole family</h3><p>Add family members with their own priorities — less sugar for one, less salt for another — and see each person’s answer.</p></div>
      <div class="card"><div class="ico">🔁</div><h3>Better options</h3><p>A low score comes with higher-scoring products from the same category, not just a warning.</p></div>
      <div class="card"><div class="ico">📷</div><h3>Barcode, photo or name</h3><p>No barcode? Photograph the label. Small print? Zoom and focus are built in.</p></div>
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
        <p>Open FoodGuard in your browser — nothing to install. The Android app is coming soon.</p>
      </div>
      <a class="btn" href="${APP_URL}">Open the web app →</a>
    </div>
  </div>
</section>
`,
  };
}
