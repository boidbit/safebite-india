// site/pages/about.js
import { APP_URL, CONTACT_EMAIL, playButton } from '../layout.js';

export default function about() {
  return {
    path: '/about/',
    title: 'About & contact',
    description: 'FoodGuard India helps families in India understand what’s in packaged food — every ingredient explained, one clear score. Contact us at hello@foodguards.space.',
    body: `
<div class="page-head"><div class="wrap">
  <div class="eyebrow">About</div>
  <h1>Why FoodGuard exists</h1>
  <p>Because the back of a packet shouldn’t need a chemistry degree.</p>
</div></div>
<div class="wrap"><div class="prose">
<p>Indian food labels are full of INS numbers, “permitted” this and “nature-identical” that. Most of us read the front of the pack, see “made with real fruit” or “no maida”, and move on. FoodGuard India reads the back for you.</p>
<p>Scan a barcode, photograph an ingredients list or type a product’s name. You get each ingredient in plain language, a score from 0 to 100 with the reasons behind it, and better-scoring products from the same shelf.</p>

<h2>What we believe</h2>
<ul>
  <li><strong>Plain words.</strong> If an explanation needs a dictionary, we rewrite it.</li>
  <li><strong>Open rules.</strong> The way we score is <a href="/how-we-score/">written down</a>, the same for every brand.</li>
  <li><strong>No fear-mongering.</strong> A low score means “eat less often”, not “dangerous”.</li>
  <li><strong>Your data stays yours.</strong> No account needed; your history and family profiles stay on your phone. See the <a href="${APP_URL}#/privacy">privacy policy</a>.</li>
</ul>

<h2>Get the app</h2>
<p>Install the free Android app from Google Play, or <a href="${APP_URL}">open the web app</a> in any browser — nothing to install.</p>
<p>${playButton({ place: 'about' })}</p>

<h2>Contact</h2>
<p>Questions, a product that looks wrong, a brand that wants a label corrected, or a partnership idea — write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. We read everything.</p>
</div></div>
`,
  };
}
