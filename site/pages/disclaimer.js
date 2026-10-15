// site/pages/disclaimer.js
import { CONTACT_EMAIL } from '../layout.js';

export default function disclaimer() {
  return {
    path: '/disclaimer/',
    title: 'Disclaimer',
    description: 'FoodGuard India scores ingredient lists for general information. It is not medical or dietary advice and does not say any product is unsafe.',
    body: `
<div class="page-head"><div class="wrap">
  <div class="eyebrow">Legal</div>
  <h1>Disclaimer</h1>
  <p>Please read this before relying on a score.</p>
</div></div>
<div class="wrap"><div class="prose">
<h2>General information only</h2>
<p>FoodGuard India gives general information about the ingredients of packaged food. It is <strong>not medical, nutritional or dietary advice</strong>, and it is not a substitute for advice from a doctor or a registered dietitian. If you have an allergy, a medical condition, are pregnant, or are choosing food for an infant, please consult a qualified professional.</p>

<h2>Scores describe ingredient lists</h2>
<p>A score is our assessment of a product’s ingredient list, and of its nutrition panel where available, using the method on <a href="/how-we-score/">How we score</a> and public sources (FSSAI, EFSA, WHO). It is an opinion produced by fixed rules. It does not claim that any product is unsafe, unlawful or unfit to eat — products sold legally in India meet FSSAI requirements.</p>

<h2>Accuracy</h2>
<p>Ingredient lists and nutrition values come from product packaging, public listings, Open Food Facts and people using the app. Recipes change and labels can be misread. We work to keep data correct but cannot guarantee it is complete or current — always check the pack in your hand, especially for allergens.</p>

<h2>Brands and images</h2>
<p>Brand names, trademarks and product images belong to their respective owners and are used only to identify products. FoodGuard India is not affiliated with, endorsed by or sponsored by any brand shown.</p>

<h2>Corrections</h2>
<p>If you are a manufacturer or brand owner and something about your product is wrong or out of date, write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> with the current label. We review every request and correct errors promptly.</p>
</div></div>
`,
  };
}
