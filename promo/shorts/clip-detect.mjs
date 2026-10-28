// promo/shorts/clip-detect.mjs -- finds, in a phone clip of a pack, what the job
// file otherwise has to be told by hand (shorts/clip.mjs):
//   front  [from, to]  the pack's front, held up to the camera
//   flip   [from, to]  turning it over
//   label  { at, rows } the clearest look at the nutrition table, and a box
//                       round the numbers that the video calls out
//
// Gemini looks at the clip (it never reads a number into the video):
//   1. a contact sheet of the clip, one thumbnail every half second, says when
//      the pack starts to be turned and roughly when the table is clearest;
//   2. the sharpest frame within a second of that guess is cut out, and a
//      full-size look at it gives a box round the number of each row we call out.
// Every box is checked against the product's own saved figures: the box is cut out and read blind by a second look; the text read
// inside it must be the number FoodGuard has for that row (per 100 g/ml) --
// a box that doesn't match is dropped, and the video simply doesn't box that
// row. Nothing here can put a wrong number on screen.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { callGeminiRaw } from '../../src/services/geminiService.js';

const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const FPS = 30;
const COLS = 5, ROWS = 5, TILE_W = 216, TILE_H = 384; // 5 x 5 thumbnails make a 1080 x 1920 sheet

const frameFile = (srcDir, n) => path.join(srcDir, `s_${String(n).padStart(4, '0')}.jpg`);

/** Ask Gemini about images; JSON back. The two models take turns when one is busy. */
async function askJson(images, prompt, tries = 4) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const d = await Promise.race([
        callGeminiRaw({
          contents: [{ parts: [{ text: prompt + last }, ...images.map((b) => ({ inlineData: { mimeType: 'image/jpeg', data: b.toString('base64') } }))] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }, MODELS[i % 2]),
        new Promise((_, no) => setTimeout(() => no(new Error('Gemini took over 60 s')), 60000)),
      ]);
      const text = (d.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
      return JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
    } catch (e) {
      last = `\n(The last answer was not usable JSON: ${String(e.message).slice(0, 80)}. Reply with the JSON only.)`;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
}

/** A frame's sharpness: the spread of its Laplacian, on the middle of the picture. */
async function sharpness(file) {
  const st = await sharp(file).extract({ left: 90, top: 300, width: 900, height: 1300 }).greyscale().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).stats();
  return st.channels[0].stdev;
}

/** The numbers in a text, as numbers: "35.0 g" -> [35]. */
const numbersIn = (s) => [...String(s || '').replace(/,/g, '.').matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
const closeTo = (read, want) => numbersIn(read).some((v) => Math.abs(v - want) <= Math.max(0.06 * Math.abs(want), 0.06));

/**
 * @param {string} srcDir  s_0000.jpg ... at 30 fps, 1080 x 1920
 * @param {{ per100: Record<string, number>, servingG: number | null, fromT?: number, toT?: number }} facts
 *   per100: the product's figures per 100 g/ml (to check boxes against);
 *   fromT/toT: the label is looked for between these times (the barcode's time is the end)
 * @returns {Promise<{ front: [number, number], flip: [number, number], label: { at: number, rows: Record<string, number[]> }, notes: string[] } | null>}
 */
export async function detectClip(srcDir, { per100 = {}, servingG = null, toT = null } = {}) {
  const frames = fs.readdirSync(srcDir).filter((f) => /^s_\d{4}\.jpg$/.test(f)).length;
  const seconds = frames / FPS;
  const notes = [];
  // ---- 1. the contact sheet: when is the pack turned, and about when is the table clearest ----
  const step = Math.max(0.5, Math.ceil((seconds / (COLS * ROWS)) * 2) / 2);
  const idxs = [];
  for (let t = 0; t < seconds && idxs.length < COLS * ROWS; t += step) idxs.push(Math.min(frames - 1, Math.round(t * FPS)));
  const tiles = await Promise.all(idxs.map(async (n, i) => ({ input: await sharp(frameFile(srcDir, n)).resize(TILE_W, TILE_H).toBuffer(), left: (i % COLS) * TILE_W, top: Math.floor(i / COLS) * TILE_H })));
  const sheet = await sharp({ create: { width: COLS * TILE_W, height: ROWS * TILE_H, channels: 3, background: '#000' } }).composite(tiles).jpeg({ quality: 85 }).toBuffer();
  const first = await askJson([sheet], `This is a contact sheet of a phone video of a packaged food product: ${idxs.length} frames in reading order (left to right, top to bottom), one frame every ${step} seconds starting at 0 (frame 0 is the first thumbnail, top left).
The person shows the front of the pack, then turns it over to the back, holds the nutrition information table up to the camera, and finally shows the barcode.
Answer with JSON: {"front_end": <index of the last frame where the FRONT of the pack still faces the camera>, "label": <index of the frame where the nutrition information TABLE (rows of numbers per 100 g) is largest, sharpest and facing the camera>}`);
  if (!first || !Number.isInteger(first.label) || first.label < 0 || first.label >= idxs.length) return null;
  const guessT = idxs[first.label] / FPS;
  const frontEnd = Number.isInteger(first.front_end) && first.front_end >= 0 && first.front_end < first.label ? (idxs[first.front_end] + (idxs[first.front_end + 1] ?? idxs[first.front_end] + step * FPS)) / 2 / FPS : Math.max(0.8, guessT * 0.4);

  // ---- 2. the sharpest frames within a second of the guess (a few, well apart) ----
  const lo = Math.max(0, Math.round((guessT - 1) * FPS)), hi = Math.min(frames - 1, Math.round((guessT + 1) * FPS), toT != null ? Math.round(toT * FPS) - 1 : frames);
  const scored = [];
  for (let n = lo; n <= hi; n++) scored.push({ n, s: await sharpness(frameFile(srcDir, n)) });
  scored.sort((a, b) => b.s - a.s);
  const picks = [];
  for (const c of scored) if (picks.length < 3 && picks.every((p) => Math.abs(p.n - c.n) >= 6)) picks.push(c);
  if (!picks.length) picks.push({ n: Math.round(guessT * FPS), s: 0 });

  // ---- 3. a box round the number of each row, in the frame that gets the most rows right ----
  const asked = [
    ['totalFatG', 'Total Fat'], ['saturatedFatG', 'Saturated Fat'], ['sodiumMg', 'Sodium'], ['addedSugarG', 'Added Sugars (or Total Sugars)'],
  ].filter(([k]) => typeof per100[k] === 'number' && per100[k] > 0).map(([k, label]) => ({ key: k, label, want: per100[k] }));
  if (servingG) asked.push({ key: 'serving', label: 'the serving size line', want: servingG });
  let chosen = null;
  for (const p of picks) {
    const got = await boxesForFrame(frameFile(srcDir, p.n), asked);
    if (!chosen || Object.keys(got.rows).length > Object.keys(chosen.rows).length) chosen = { ...got, n: p.n };
    if (Object.keys(chosen.rows).length === asked.length) break;
  }
  notes.push(...chosen.notes);
  return {
    front: [0, Math.round(Math.min(frontEnd, chosen.n / FPS - 0.5) * 100) / 100],
    flip: [Math.round(Math.min(frontEnd, chosen.n / FPS - 0.5) * 100) / 100, Math.round((chosen.n / FPS) * 100) / 100],
    label: { at: Math.round((chosen.n / FPS) * 100) / 100, rows: chosen.rows },
    notes,
  };
}

/**
 * One frame: Gemini boxes each row's number (told roughly what to look for), then a
 * second, blind look at each box cut out of the frame -- told nothing -- reads what is
 * in it; a row counts only when that blind reading is the product's own figure.
 */
async function boxesForFrame(file, asked) {
  const notes = [];
  const img = await sharp(file).jpeg({ quality: 92 }).toBuffer();
  const found = await askJson([img], `This is one frame of a phone video: the back of a food pack with its nutrition information table. The coordinates are normalised to 1000 x 1000, as [ymin, xmin, ymax, xmax].
For each row below, give the box tightly round the NUMBER in the "per 100 g" (or "per 100 ml") column of that row -- not the row's name, not the "% RDA" column. The number is roughly what is shown in brackets; the table may be tilted, so follow the row across.
${asked.map((a) => (a.key === 'serving' ? `- "serving": the whole line of text that states the serving size (roughly "${a.want}")` : `- "${a.key}": the row "${a.label}" (about ${a.want})`)).join('\n')}
Skip a row that is not visible or not readable. Answer with JSON: {"rows": {"<key>": {"box_2d": [ymin, xmin, ymax, xmax]}}}`);
  const boxes = asked.map((a) => ({ a, box: found?.rows?.[a.key]?.box_2d })).filter((b) => Array.isArray(b.box) && b.box.length === 4 && b.box.every(Number.isFinite));
  if (!boxes.length) return { rows: {}, notes: ['no boxes could be read on the label frame'] };
  const px = boxes.map((b) => toPixels(b.box));
  const crops = await Promise.all(px.map(async ([x, y, w, h]) => {
    const pad = 16, left = Math.max(0, x - pad), top = Math.max(0, y - pad);
    return sharp(file).extract({ left, top, width: Math.min(1080 - left, w + 2 * pad), height: Math.min(1920 - top, h + 2 * pad) }).resize({ height: 160, withoutEnlargement: false }).jpeg({ quality: 92 }).toBuffer();
  }));
  const blind = await askJson(crops, `Each of these ${crops.length} images is a small crop from a printed nutrition table (image 1 first). Read the text written in each crop. Answer with JSON: {"reads": ["<text of image 1>", "<text of image 2>", ...]}`);
  const rows = {};
  boxes.forEach((b, i) => {
    const said = blind?.reads?.[i];
    if (said != null && closeTo(said, b.a.want)) rows[b.a.key] = px[i];
    else notes.push(`${b.a.key}: the box reads "${said ?? '?'}", the product has ${b.a.want} -- not boxed`);
  });
  return { rows, notes };
}

/** A box in 0-1000 [ymin, xmin, ymax, xmax] -> the clip's pixels [x, y, w, h], a little roomy. */
function toPixels([y0, x0, y1, x1]) {
  const W = 1080, H = 1920, pad = 6;
  const x = Math.max(0, (x0 / 1000) * W - pad), y = Math.max(0, (y0 / 1000) * H - pad);
  return [Math.round(x), Math.round(y), Math.round(Math.min(W, (x1 / 1000) * W + pad) - x), Math.round(Math.min(H, (y1 / 1000) * H + pad) - y)];
}
