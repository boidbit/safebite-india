// site/layout.js -- the shell every website page shares (scripts/build-site.js).

export const SITE_URL = 'https://foodguards.space';
export const APP_URL = '/app/';
export const CONTACT_EMAIL = 'hello@foodguards.space';
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.foodguard.india';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Old app addresses were foodguards.space/#/p/123, /#/admin, /#/privacy...
// The app now lives at /app/, so any address carrying a #/ route is sent
// there, route intact -- before anything renders.
const FORWARD_OLD_APP_LINKS = `<script>if (location.hash.indexOf('#/') === 0) location.replace('/app/' + location.search + location.hash);</script>`;

const PLAY_ICON = `<svg viewBox="0 0 24 26" width="22" height="24" aria-hidden="true"><path fill="#00d7fe" d="M1.2.9C.9 1.2.7 1.7.7 2.3v21.4c0 .6.2 1.1.5 1.4l.1.1L13.3 13V12.8L1.3.8z"/><path fill="#ffce00" d="m17.3 17-4-4v-.3l4-4 .1.1 4.7 2.7c1.3.8 1.3 2 0 2.8z"/><path fill="#f43249" d="M17.4 16.900 13.300 12.800 1.200 24.900c.4.500 1.200.5 2 .1z"/><path fill="#00f076" d="M17.400 8.700 3.200.8C2.400.3 1.600.4 1.200.9l12.100 12z"/></svg>`;

// The "Get it on Google Play" button -- the one place the Play Store link lives.
export function playButton({ place = 'site' } = {}) {
  return `<a class="play-btn" href="${PLAY_URL}" target="_blank" rel="noopener" data-place="${place}" aria-label="Get FoodGuard India on Google Play">${PLAY_ICON}<span><small>GET IT ON</small>Google Play</span></a>`;
}

// Google Analytics (GA4). Same measurement ID as the app (index.html).
const GA_TAG = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-C77145W3R7"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-C77145W3R7');
</script>`;

export function layout({ path, title, description, body, scripts = [], ogImage = `${SITE_URL}/assets/app-score.webp` }) {
  const url = `${SITE_URL}${path}`;
  const fullTitle = path === '/' ? title : `${title} · FoodGuard India`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${FORWARD_OLD_APP_LINKS}
${GA_TAG}
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="FoodGuard India" />
<meta property="og:title" content="${esc(fullTitle)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${ogImage}" />
<meta name="theme-color" content="#fbf7ee" />
<link rel="icon" type="image/png" href="/assets/logo.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/site.css" />
${path === '/' ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'MobileApplication', name: 'FoodGuard India', operatingSystem: 'ANDROID', applicationCategory: 'HealthApplication', url: PLAY_URL, offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' } })}</script>` : ''}
</head>
<body>
<header class="nav">
  <div class="wrap">
    <a class="brand" href="/"><img src="/assets/logo.png" alt="" width="32" height="32" />FoodGuard<small>INDIA</small></a>
    <nav class="nav-links" aria-label="Main">
      <a href="/rankings/">Rankings</a>
      <a class="hide-sm" href="/products/">Products</a>
      <a class="hide-sm" href="/how-we-score/">How we score</a>
      <a class="hide-sm" href="/about/">About</a>
      <a class="btn btn-ghost btn-sm hide-sm" href="${APP_URL}">Web app</a>
      <a class="btn btn-primary btn-sm" href="${PLAY_URL}" target="_blank" rel="noopener">Get the app</a>
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
        <a href="/rankings/">Rankings by category</a>
        <a href="${PLAY_URL}" target="_blank" rel="noopener">Android app (Google Play)</a>
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
