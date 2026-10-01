// src/utils/share.js
//
// WhatsApp sharing for a product report. Pure functions only -- the
// Result page decides WHEN to share; this decides WHAT gets sent.

// The public web app, hardcoded rather than read from window.location:
// inside the Android app that's a local capacitor/localhost address the
// person receiving the message could never open.
export const PUBLIC_APP_URL = 'https://boidbit.github.io/safebite-india/';

export function productShareUrl(reportId) {
  return `${PUBLIC_APP_URL}#/p/${encodeURIComponent(reportId)}`;
}

// wa.me rather than whatsapp:// -- it works from a desktop browser too
// (opens WhatsApp Web), and on a phone it hands off to the app.
export function whatsappShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * The message itself. Takes `t` (the i18n function) so the wording
 * lives in strings.js with the rest of the app's copy. Flags are the
 * report's own worst-first ingredient concerns (scoringEngine.js), at
 * most two -- enough to say why, short enough to read in a chat bubble.
 *
 * @param {object} p
 * @param {string} p.productName
 * @param {number} p.score
 * @param {string} p.verdict - the tier label shown on the score circle
 * @param {string[]} [p.flags]
 * @param {string|null} p.link - a product link, or null when the
 *   product was never saved to the shared cache (then the app's home
 *   page is shared instead, since there's no report to link to)
 */
export function buildProductShareText({ productName, score, verdict, flags = [], link }, t) {
  const lines = [t('shareMessage', { name: productName || 'a product', score, verdict })];

  const worst = flags.filter(Boolean).slice(0, 2);
  if (worst.length > 0) lines.push(t('shareFlagsLine', { flags: worst.join(', ') }));

  lines.push('');
  lines.push(link ? t('shareSeeReport', { link }) : t('shareTryApp', { link: PUBLIC_APP_URL }));
  return lines.join('\n');
}
