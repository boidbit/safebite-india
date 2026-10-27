// site/pages/home.js -- foodguards.space
//
// One idea, told in a few chapters: turn the pack over. The hero's pack (a made-up
// brand, so no real one is singled out) turns from its claims to its label; the
// rest is the label decoded, the shelf already read, the app in your hand, the
// rankings and the way to get it. No paste box: text pasted from the website made
// nameless "Unknown Product" rows that only cluttered the admin's review list.
import { APP_URL, PLAY_URL, esc, playButton } from '../layout.js';
import { leagueTable } from './rankings.js';

const TIER_COLOR = { Excellent: 'var(--t-excellent)', Good: 'var(--t-good)', Moderate: 'var(--t-moderate)', Poor: 'var(--t-poor)', 'Very Poor': 'var(--t-verypoor)' };

function shelfItem(p, duplicate) {
  const color = TIER_COLOR[p.verdict] || 'var(--ink-3)';
  return `<a class="shelf-item" href="${p.href || `${APP_URL}#/p/${encodeURIComponent(p.id)}`}"${duplicate ? ' aria-hidden="true" tabindex="-1"' : ''}>
    <span class="shelf-pack"><img src="${esc(p.imageUrl)}" alt="${duplicate ? '' : esc(p.name)}" loading="lazy" /></span>
    <span class="shelf-badge" style="background:${color}">${p.score}</span>
    <span class="shelf-name">${esc(p.name)}</span>
  </a>`;
}

// The decoder strip: what the words on Indian labels actually mean.
const DECODER = [
  'INS 621 is MSG',
  'Maltodextrin is a sugar, digested fast',
  'The first ingredient is the biggest one',
  'Palmolein is palm oil',
  '“No added sugar” isn’t “no sugar”',
  'INS 110 is Sunset Yellow',
  '“Edible vegetable oil” is often palm',
  'Liquid glucose is sugar too',
  '“Multigrain” can still be mostly maida',
];

// The film demo on the home page: the app's own sugar film, with a typical mango drink.
const FILM_DEMO = `${APP_URL}film/sugar-film.html?${new URLSearchParams({ name: 'A mango drink', g: '24', serving: '200 ml', period: 'year', freq: 'daily' })}`;

const FAQ = [
  ['Is FoodGuard free?', 'Yes. Scanning, scores and explanations are free, and there are no ads.'],
  ['Where does the score come from?', 'From the ingredient list on the pack. Each ingredient is checked against public sources — FSSAI, the European Food Safety Authority and WHO guidance — and the product is scored on what it contains and how much of it. Where we have the nutrition panel, too much sugar, salt or saturated fat per serving counts too. <a href="/how-we-score/">The full method is here.</a>'],
  ['Is this medical or diet advice?', 'No. The score describes an ingredient list, not your health. For allergies, pregnancy, diabetes or any medical condition, please talk to a doctor or a registered dietitian.'],
  ['Does a low score mean a product is unsafe?', 'No. Everything sold legally in India meets FSSAI rules. A low score means the list leans on things worth eating less often — refined flour, added sugar, certain additives — not that the food is dangerous.'],
  ['A product looks wrong. What do I do?', 'Use the report option on the product, in the app or on its page here, or write to us. New products are checked by a person before they appear, and reported mistakes are fixed quickly.'],
  ['Is there an iPhone app?', `Not yet — the web app works in Safari on iPhone: scan or type the barcode, or photograph the label. On Android, <a href="${PLAY_URL}" target="_blank" rel="noopener">get the app on Google Play</a>.`],
];

export default function home({ stats }) {
  const total = stats?.total ? stats.total.toLocaleString('en-IN') : null;
  const shelf = stats?.shelf || [];
  const rankings = (stats?.rankings || []).slice(0, 3);
  const onSite = stats?.productCount ? stats.productCount.toLocaleString('en-IN') : null;
  const statItems = [
    total && [total, 'Indian foods read'],
    onSite && [onSite, 'scored on this site'],
    ['0', 'ads, ever'],
    ['Free', 'no sign-up'],
  ].filter(Boolean).slice(0, 4);
  return {
    path: '/',
    title: 'FoodGuard India — read the back of the pack',
    description: 'FoodGuard reads the back of any packaged food sold in India — search it by name, photograph the label or scan the barcode: every ingredient explained in plain words, sugar and salt in teaspoons, and one score from 0 to 100. Free on Android and on the web.',
    scripts: ['/assets/film.js'],
    body: `
<section class="h-hero">
  <div class="wrap">
    <div class="h-grid">
      <div>
        <p class="h-kicker"><span class="live" aria-hidden="true"></span>${total ? `<span><b>${total}</b> Indian foods, read from the back</span>` : '<span>Packaged food in India, read from the back</span>'}</p>
        <h1 class="h-title">Ulta karke<br /><em>dekho.</em></h1>
        <p class="h-gloss">ulta karke dekho — turn it over and look</p>
        <p class="h-lead">The front of a pack is advertising. The back is where the law makes the maker tell you what’s inside, in the smallest type on the box. <b>FoodGuard reads the back for you.</b> Search a pack by name, photograph its label or scan the barcode — and get every ingredient in plain words, sugar and salt in teaspoons, and one score from 0 to 100.</p>
        <div class="h-ctas">
          ${playButton({ place: 'hero' })}
          <a class="text-link" href="${APP_URL}">Or use it in your browser →</a>
        </div>
        <div class="h-stats">${statItems.map(([n, label]) => `<div><b>${n}</b><span>${label}</span></div>`).join('')}</div>
      </div>

      <div>
        <div class="pack" aria-label="A made-up pack of masala noodles: the front says Made with real veggies and No added MSG; the back lists 1.2% vegetables and flavour enhancers INS 627 and 631, and FoodGuard scores it 41, Poor.">
          <div class="pack-in">
            <div class="pack-face pack-front" aria-hidden="true">
              <div class="pf-brand">Cruncho</div>
              <div class="pf-name">Masala noodles</div>
              <div class="pf-burst"><span><small>MADE WITH</small>Real veggies!</span></div>
              <div class="pf-tag">No added MSG*</div>
              <div class="pf-fine">*Contains flavour enhancers. Net wt. 70 g</div>
            </div>
            <div class="pack-face pack-back" aria-hidden="true">
              <div class="pb-head">INGREDIENTS</div>
              <p class="pb-list"><mark>Refined wheat flour (maida) (68%)</mark>, <mark>palm oil</mark>, iodised salt, thickener (INS 412), <mark>dehydrated vegetables (1.2%)</mark>, sugar, spices, <mark>flavour enhancers (INS 627, INS 631)</mark>, acidity regulator (INS 501).</p>
              <div class="pb-stick">
                <div class="pb-score"><span>41</span></div>
                <div class="pb-verdict"><b>Poor</b><span>FoodGuard score</span></div>
                <div class="pb-chips"><span>Veggies: 1.2%</span><span>High salt</span><span>INS 627 · 631</span></div>
              </div>
            </div>
          </div>
        </div>
        <p class="pack-note">A made-up pack. The trick on it is real.</p>
      </div>
    </div>

  </div>
</section>

<div class="h-tick" aria-label="What words on Indian labels mean">
  <div class="h-tick-track">${[...DECODER, ...DECODER].map((d, i) => `<span${i >= DECODER.length ? ' aria-hidden="true"' : ''}>${d}</span>`).join('')}</div>
</div>

<section class="ch">
  <div class="wrap">
    <div class="ch-head">
      <div class="ch-no" aria-hidden="true">01</div>
      <div>
        <p class="ch-kick">The back, decoded</p>
        <h2>Labels are written for inspectors. <em>We rewrite them for you.</em></h2>
        <p>Everything on the back follows FSSAI’s rules — the order, the names, the INS numbers. Here is one mango drink, read the way FoodGuard reads it.</p>
      </div>
    </div>
    <div class="anno">
      <div class="anno-label">
        <div class="anno-front"><small>ON THE FRONT</small>Made with<br />real mango!</div>
        <p class="anno-k">INGREDIENTS · MANGO DRINK, 1 L</p>
        <p class="anno-text">Water, <mark>Sugar</mark><sup>1</sup>, Mango Pulp <mark>(19.5%)</mark><sup>2</sup>, Acidity Regulator (INS 330), Stabiliser (INS 440), Antioxidant (INS 300), <mark>Colour (INS 110)</mark><sup>3</sup>.</p>
        <p class="anno-foot">FoodGuard does this for any pack you scan, in about two seconds.</p>
      </div>
      <ol class="anno-notes">
        <li><span><b>Sugar comes before the mango.</b>Lists run from the most to the least, so the bottle holds more sugar than fruit.</span></li>
        <li><span><b>Less than a fifth is fruit.</b>The rest is mostly water and sugar.</span></li>
        <li><span><b>INS 110 is Sunset Yellow.</b>A synthetic colour — the orange isn’t only mango.</span></li>
      </ol>
    </div>
  </div>
</section>

${shelf.length >= 6 ? `<section class="ch ch-dark" aria-label="Products already checked">
  <div class="wrap">
    <div class="shelf-row">
      <div class="ch-head" style="margin-bottom:0">
        <div class="ch-no" aria-hidden="true">02</div>
        <div>
          <p class="ch-kick">On the shelf</p>
          <h2>${total ? `${total} foods.` : 'Thousands of foods.'} <em>Already read.</em></h2>
          <p>Biscuits, namkeen, noodles, dairy, drinks — the packs on Indian shelves, each one scored and explained.</p>
        </div>
      </div>
      ${onSite ? `<a class="btn btn-light" href="/products/">Browse all ${onSite} →</a>` : ''}
    </div>
  </div>
  <div class="shelf" style="margin-top:48px"><div class="shelf-track">${[...shelf, ...shelf].map((p, i) => shelfItem(p, i >= shelf.length)).join('')}</div></div>
</section>` : ''}

<section class="ch">
  <div class="wrap">
    <div class="ch-head">
      <div class="ch-no" aria-hidden="true">${shelf.length >= 6 ? '03' : '02'}</div>
      <div>
        <p class="ch-kick">In your hand</p>
        <h2>Read the back <em>before you buy.</em></h2>
      </div>
    </div>
    <div class="hand">
      <div class="phones">
        <div class="phone p1"><img src="/assets/app-report.webp" alt="FoodGuard app: a product scored 98, Excellent, with its reasons — low salt, low saturated fat, low fat" width="780" height="1688" /></div>
        <div class="phone p2"><img src="/assets/app-nutrition.webp" alt="FoodGuard app: fat, saturated fat, sugar and salt per 100 ml, and the ingredients" width="780" height="1688" /></div>
      </div>
      <div>
        <ol class="hand-list">
          <li><span><b>No barcode needed.</b><span>Type the name, or take a photo of the ingredient list on any pack — the label is all it needs.</span></span></li>
          <li><span><b>The score, and why, at a glance.</b><span>High salt, low sugar, a flagged colour — the reasons sit right under the number.</span></span></li>
          <li><span><b>Sugar in teaspoons, not grams.</b><span>One serving, a week, a year — at the rate you actually eat it.</span></span></li>
          <li><span><b>A better pick from the same shelf.</b><span>A low score comes with higher-scoring products you can buy instead.</span></span></li>
        </ol>
        <button class="film-teaser" type="button" data-film="${esc(FILM_DEMO)}">
          <span class="play-dot" aria-hidden="true"></span>
          <span><b>Watch where the sugar goes</b><small>A 1-minute film, made for every sweet pack in the app</small></span>
        </button>
      </div>
    </div>
  </div>
</section>

${rankings.length ? `<section class="ch ch-alt">
  <div class="wrap">
    <div class="shelf-row" style="margin-bottom:48px">
      <div class="ch-head" style="margin-bottom:0">
        <div class="ch-no" aria-hidden="true">${shelf.length >= 6 ? '04' : '03'}</div>
        <div>
          <p class="ch-kick">League tables</p>
          <h2>Every shelf, <em>ranked.</em></h2>
          <p>The best-scoring packs in each category, from every product we’ve read.</p>
        </div>
      </div>
      <a class="btn btn-primary" href="/rankings/">All rankings →</a>
    </div>
    <div class="lt-grid">${rankings.map((c) => leagueTable(c, { limit: 5 })).join('')}</div>
  </div>
</section>` : ''}

<section id="faq">
  <div class="wrap qa">
    <h2>Asked <em>often.</em></h2>
    <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>
  </div>
</section>

<section class="h-end">
  <div class="wrap">
    <div>
      <h2>Pehle check karo.<br /><em>Phir khareedo.</em></h2>
      <p>Check first, then buy: search the name, photograph the label or scan the barcode. FoodGuard is free on Android and works in any browser — no account, no ads.</p>
      <div class="h-ctas">${playButton({ place: 'end' })}<a class="text-link" href="${APP_URL}">Or use it in your browser →</a></div>
    </div>
    <div class="qr"><img src="/assets/playstore-qr.png" alt="QR code: FoodGuard India on Google Play" width="220" height="220" /><p>Point your phone’s camera here</p></div>
  </div>
</section>
`,
  };
}
