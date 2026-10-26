// site/pages/how-we-score.js -- the method, in plain words. Kept in step
// with src/services/scoringEngine.js, finalizeScore.js and
// nutritionDensity.js: change the scoring there, change this page too.
import { APP_URL, CONTACT_EMAIL } from '../layout.js';

export default function howWeScore() {
  return {
    path: '/how-we-score/',
    title: 'How we score',
    description: 'How FoodGuard India turns an ingredient list into a score from 0 to 100: ingredient checks against FSSAI, EFSA and WHO guidance, caps for harmful and concerning ingredients, and nutrition limits.',
    body: `
<div class="page-head"><div class="wrap">
  <div class="eyebrow">Method</div>
  <h1>How we score</h1>
  <p>Every score comes from the same written rules — no hidden weighting, no paid placement, and no AI deciding a number on a whim.</p>
</div></div>
<div class="wrap"><div class="prose">

<h2>1. We read the ingredient list</h2>
<p>The list printed on the pack is split into individual ingredients — including the ones inside brackets, like the parts of a “masala (…)” — and INS codes are matched to the additive they stand for.</p>

<h2>2. Each ingredient is checked</h2>
<p>Every ingredient is looked up in our ingredient library, which is built from public sources: the <strong>FSSAI</strong> food additive regulations, the <strong>European Food Safety Authority (EFSA)</strong> opinions, and <strong>WHO</strong> guidance. Each one gets a status:</p>
<ul>
  <li><strong>Safe</strong> — no concern at normal amounts.</li>
  <li><strong>Concerning</strong> — allowed, but worth eating less often: refined flour, added sugars, some colours and preservatives.</li>
  <li><strong>Harmful</strong> — restricted or banned elsewhere, or with strong evidence against it.</li>
</ul>
<p>How much an ingredient counts also depends on how much of it there is. Labels list ingredients from most to least, and where a percentage is printed we use it.</p>

<h2>3. The product gets one score</h2>
<p>The ingredients add up to a score from 0 to 100. Two rules stop a long list of harmless ingredients from hiding a problem:</p>
<ul>
  <li>Any <strong>harmful</strong> ingredient caps the score in the Very Poor band (24 or below).</li>
  <li>Any <strong>concerning</strong> ingredient caps it at Moderate (64 or below). The exception is zero-calorie sweeteners such as sucralose: they are still flagged and still cost points, but on their own they only keep a product out of Excellent (84 or below) instead of holding it at Moderate.</li>
</ul>

<h2>4. Nutrition, when we have the real panel</h2>
<p>A clean ingredient list can still be a lot of sugar, salt or saturated fat. When we have the product’s actual nutrition panel, a serving that uses up a large share (30% or more) of the WHO daily limit for one of these keeps the score at Moderate or below. Fried and energy-dense snacks are also held to the Moderate band at best. Spices and condiments, eaten a pinch at a time, are not judged per 100 g.</p>
<p>We never estimate nutrition numbers. No real panel, no nutrition rule.</p>

<h2>The five bands</h2>
<table>
  <tr><th>Score</th><th>Band</th><th>What it means</th></tr>
  <tr><td>85–100</td><td>Excellent</td><td>A clean list — nothing flagged.</td></tr>
  <tr><td>65–84</td><td>Good</td><td>Mostly fine, a minor note or two.</td></tr>
  <tr><td>45–64</td><td>Moderate</td><td>Something worth eating less often.</td></tr>
  <tr><td>25–44</td><td>Poor</td><td>Several concerning ingredients.</td></tr>
  <tr><td>0–24</td><td>Very Poor</td><td>A harmful ingredient, or a list full of concerns.</td></tr>
</table>

<h2>What the score is not</h2>
<ul>
  <li><strong>Not a safety verdict.</strong> Food sold legally in India meets FSSAI rules. A low score is about what to eat less often, not about danger.</li>
  <li><strong>Not about your portion.</strong> The score rates the product, not how much of it you eat.</li>
  <li><strong>Not medical advice.</strong> Allergies, diabetes, pregnancy or any condition — talk to a doctor or a registered dietitian.</li>
</ul>

<h2>Where the data comes from</h2>
<p>Ingredient lists and nutrition panels come from the product’s own pack: photos and text from public product listings, Open Food Facts, and scans by people using the app. New products are checked by a person before they appear in search. Typos and unreadable bits of a label are never allowed to count against a product.</p>

<div class="note"><p style="margin:0"><strong>Something wrong?</strong> Labels change and photos can be misread. Use the report option on the product in the <a href="${APP_URL}">app</a>, or write to <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> — we correct mistakes quickly.</p></div>
</div></div>
`,
  };
}
