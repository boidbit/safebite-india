// site/layout.js -- the shell every website page shares (scripts/build-site.js).

export const SITE_URL = 'https://foodguards.space';
export const APP_URL = '/app/';
export const CONTACT_EMAIL = 'hello@foodguards.space';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Old app addresses were foodguards.space/#/p/123, /#/admin, /#/privacy...
// The app now lives at /app/, so any address carrying a #/ route is sent
// there, route intact -- before anything renders.
const FORWARD_OLD_APP_LINKS = `<script>if (location.hash.indexOf('#/') === 0) location.replace('/app/' + location.search + location.hash);</script>`;

export function soonPill() {
  return `<span class="pill-soon"><span aria-hidden="true">▶</span><span><b>Android app</b>Coming soon to Google Play</span></span>`;
}

export function layout({ path, title, description, body, scripts = [], ogImage = `${SITE_URL}/assets/app-score.webp` }) {
  const url = `${SITE_URL}${path}`;
  const fullTitle = path === '/' ? title : `${title} · FoodGuard India`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${FORWARD_OLD_APP_LINKS}
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="FoodGuard India" />
<meta property="og:title" content="${esc(fullTitle)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${ogImage}" />
<meta name="theme-color" content="#0f5132" />
<link rel="icon" type="image/png" href="/assets/logo.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;0,9..144,800;1,9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/site.css" />
</head>
<body>
<header class="nav">
  <div class="wrap">
    <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="32" height="32" />FoodGuard<small>INDIA</small></a>
    <nav class="nav-links" aria-label="Main">
      <a href="/products/">Products</a>
      <a class="hide-sm" href="/how-we-score/">How we score</a>
      <a class="hide-sm" href="/about/">About</a>
      <a class="btn btn-primary btn-sm" href="${APP_URL}">Open the app</a>
    </nav>
  </div>
</header>
<main>
${body}
</main>
<footer>
  <div class="wrap">
    <div class="cols">
      <div>
        <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="32" height="32" />FoodGuard<small>INDIA</small></a>
        <p>Scan any packaged food sold in India and see what's really in it — every ingredient explained, in plain language.</p>
      </div>
      <div>
        <h4>Product</h4>
        <a href="/products/">All products</a>
        <a href="${APP_URL}">Open the web app</a>
        <a href="/how-we-score/">How we score</a>
        <a href="/#faq">FAQ</a>
      </div>
      <div>
        <h4>Company</h4>
        <a href="/about/">About &amp; contact</a>
        <a href="/disclaimer/">Disclaimer</a>
        <a href="${APP_URL}#/privacy">Privacy policy</a>
        <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
      </div>
    </div>
    <p class="fine">FoodGuard India rates ingredient lists using public sources (FSSAI, EFSA, WHO). It is general information, not medical or dietary advice. Brand names and product images belong to their owners and are shown only to identify the product. Spotted a mistake? <a style="display:inline" href="mailto:${CONTACT_EMAIL}">Tell us</a>. © ${new Date().getFullYear()} FoodGuard India.</p>
  </div>
</footer>
${scripts.map((src) => `<script src="${src}" defer></script>`).join('')}
</body>
</html>
`;
}
