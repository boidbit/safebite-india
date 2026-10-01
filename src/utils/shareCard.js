// src/utils/shareCard.js
//
// Renders a shareable score-card image for "Share on WhatsApp" -- a
// wa.me link can only ever carry text (WhatsApp's own URL scheme has
// no way to pre-attach a file, for privacy/security reasons on their
// end, not a limitation of this app), so a picture has to go through
// the device's native share sheet instead. This draws that picture on
// a plain <canvas>, no rendering library.
//
// Always the light palette, regardless of the sender's own theme -- a
// shared image is a fixed artifact seen by someone else on their own
// screen, not a reflection of the sender's current display setting.

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;

const FONT = '-apple-system, "Segoe UI", Roboto, Arial, sans-serif';

// Same breakpoints as SCORE_TIERS (utils/storage.js) / VERDICT_TIERS
// (scoringEngine.js) and the same light-mode hex values as
// index.css's --v-* variables -- kept as plain hex rather than reading
// the CSS variables, since a canvas fillStyle can't reliably resolve
// var() on a detached/offscreen canvas across browsers.
const TIERS = [
  { min: 85, color: '#1e8e3e' },
  { min: 65, color: '#34c759' },
  { min: 45, color: '#e6a700' },
  { min: 25, color: '#ff9500' },
  { min: 0, color: '#ff3b30' },
];

export function tierColorFor(score) {
  return (TIERS.find((t) => score >= t.min) || TIERS[TIERS.length - 1]).color;
}

/**
 * Greedy word-wrap. Takes a `measure` function rather than a canvas
 * context directly so this one piece of real logic can be unit tested
 * in plain Node, without needing a canvas polyfill for the rest of the
 * file (which draws, and is verified by looking at the rendered image
 * instead).
 */
export function wrapText(text, maxWidth, measure) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (current && measure(attempt) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Draws the card and resolves a PNG Blob. Never throws -- any failure
 * (the logo image, canvas support) resolves null instead, so a caller
 * can fall back to the existing text-only share rather than breaking
 * the button entirely.
 *
 * @param {object} p
 * @param {string} p.productName
 * @param {number} p.score
 * @param {string} p.verdictLabel - the tier label under the score circle
 * @param {string} p.eatAnswerLabel - "Should I eat it?" answer word
 * @param {string[]} [p.flags] - worst-first concern names, top 2 shown
 * @param {string} p.logoUrl - the app's own header icon, already a
 *   same-origin bundled asset (see Result.jsx's import)
 */
export async function renderShareCardImage({ productName, score, verdictLabel, eatAnswerLabel, flags = [], logoUrl }) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const color = tierColorFor(score);

    // Page background
    ctx.fillStyle = '#f2f2f7';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Top accent band -- the one thing on the card in the exact tier
    // colour, so it reads at a glance even before anyone finds the
    // number.
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, CARD_WIDTH, 16);

    // Logo + wordmark, same pairing as the in-app header.
    const logo = await loadImage(logoUrl).catch(() => null);
    const logoSize = 76;
    const logoY = 72;
    if (logo) ctx.drawImage(logo, 64, logoY, logoSize, logoSize);
    ctx.textBaseline = 'middle';
    ctx.font = `600 42px ${FONT}`;
    ctx.fillStyle = '#1c1c1e';
    const wordmarkX = logo ? 64 + logoSize + 22 : 64;
    ctx.fillText('FoodGuard', wordmarkX, logoY + logoSize / 2);
    ctx.fillStyle = '#1e8e3e';
    ctx.fillText(' INDIA', wordmarkX + ctx.measureText('FoodGuard').width, logoY + logoSize / 2);

    // Product name, up to 3 lines.
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 54px ${FONT}`;
    ctx.fillStyle = '#1c1c1e';
    const nameLines = wrapText(productName || 'Unknown Product', CARD_WIDTH - 128, (s) => ctx.measureText(s).width).slice(0, 3);
    let y = 280;
    for (const line of nameLines) {
      ctx.fillText(line, 64, y);
      y += 64;
    }

    // Score ring.
    const cx = CARD_WIDTH / 2;
    const cy = 660;
    const r = 210;
    ctx.lineWidth = 28;
    ctx.strokeStyle = '#e5e5ea';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const pct = Math.max(0, Math.min(100, score)) / 100;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 148px ${FONT}`;
    ctx.fillStyle = '#1c1c1e';
    ctx.fillText(String(score), cx, cy - 16);
    ctx.font = `500 32px ${FONT}`;
    ctx.fillStyle = '#8e8e93';
    ctx.fillText('out of 100', cx, cy + 58);

    // Verdict label, in the tier colour.
    ctx.font = `700 58px ${FONT}`;
    ctx.fillStyle = color;
    ctx.fillText(verdictLabel, cx, cy + r + 90);

    if (eatAnswerLabel) {
      ctx.font = `500 34px ${FONT}`;
      ctx.fillStyle = '#3a3a3c';
      ctx.fillText(`Should I eat it? ${eatAnswerLabel}`, cx, cy + r + 150);
    }

    // Top two concerns, left-aligned.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let fy = cy + r + 220;
    const topFlags = flags.filter(Boolean).slice(0, 2);
    if (topFlags.length > 0) {
      ctx.font = `600 32px ${FONT}`;
      ctx.fillStyle = '#3a3a3c';
      for (const flag of topFlags) {
        const [flagLine] = wrapText(`⚠ ${flag}`, CARD_WIDTH - 128, (s) => ctx.measureText(s).width);
        ctx.fillText(flagLine, 64, fy);
        fy += 46;
      }
    }

    // Footer band.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, CARD_HEIGHT - 140, CARD_WIDTH, 140);
    ctx.textAlign = 'center';
    ctx.font = `500 30px ${FONT}`;
    ctx.fillStyle = '#8e8e93';
    ctx.fillText('Scanned with FoodGuard India', cx, CARD_HEIGHT - 82);
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = '#1e8e3e';
    ctx.fillText('boidbit.github.io/safebite-india', cx, CARD_HEIGHT - 40);

    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  }
}
