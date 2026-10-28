// promo/shorts/clip.mjs -- a short cut from a real phone clip of the pack:
// the footage plays underneath, the facts land on top of it, a voice reads
// them out, the pack's barcode is scanned and the real app opens on a phone.
//
//   node shorts/clip.mjs ../promo/clips/<job>.json --out out/video     (GitHub: make-clip-video.yml)
//   node shorts/clip.mjs <job> --work <dir> --preview [--no-voice] [--no-app] [--no-ai]
//                                       (timeline + inputs for preview stills, no video)
//
// The job file (promo/clips/*.json) names the clip -- its path in the
// private promo-clips Storage bucket, never a link (the repo is public) --
// and says where in it things are, in seconds and in the clip's own
// 1080x1920 pixels:
//   clip   "clips/<name>.mp4"
//   front  [from, to]   the pack's front, held still
//   flip   [from, to]   turning it over (played fast)
//   label  { at, rows } the clearest look at the nutrition table, frozen
//                       there, and boxes round its numbers:
//                       rows: { totalFatG, saturatedFatG, sodiumMg, addedSugarG, serving: [x, y, w, h, deg?] }
// Optional: product (an id, instead of the barcode), barcode ({ code, at,
// box } instead of reading it), hook (serving | guess | pov | pass),
// script (lines to use instead of Gemini's), voice, rate.
//
// The product is the one the pack's barcode opens in the app: ZXing reads
// it off the frames (clip-barcode.mjs), and no approved product for that
// barcode means no video. The words are Gemini's, held to the product's
// saved facts (clip-script.mjs); the voice is a free Microsoft neural voice
// (voice.py); the app scene is the real report page, recorded frame by
// frame (app-record.mjs). The finished video, caption, script and timeline
// also go to promo-clips/out/. Reading and writing that bucket takes
// SUPABASE_SERVICE_ROLE_KEY (a repo secret on GitHub).
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { supabase } from '../../src/services/supabaseClient.js';
import { isJunkIngredient } from '../../src/services/typoIngredient.js';
import { verdictFor } from '../../src/services/scoringEngine.js';
import { NUTRIENT_LIMITS } from '../../src/services/dailyHabitCheck.js';
import { GRAMS_FAT_PER_TEASPOON_OIL } from '../../src/services/nutrientProjection.js';
import { GRAMS_PER_TEASPOON } from '../../src/services/sugarProjection.js';
import { geminiVoice, TTS_MODEL, TTS_FALLBACK } from './voice-gemini.mjs';
import { findBarcode } from './clip-barcode.mjs';
import { writeScript, fill } from './clip-script.mjs';
import { recordAppScreen } from './app-record.mjs';
import { captureAppScreen } from './app-screen.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.foodguard.india';
const BUCKET = 'promo-clips';
const FPS = 60; // rendered at 60, blended to 30 for motion blur (build-short.cjs)
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const OUT = path.resolve(opt('--out') || path.join(HERE, '..', 'out'));
const PREVIEW = args.includes('--preview');
const fail = (msg) => {
  console.error(`NOT MADE: ${msg}`);
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::error title=Video not made::${msg}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Video not made\n\n${msg}\n`);
  }
  process.exit(2);
};
if (!args[0]) fail('give a job file (promo/clips/*.json)');
const jobFile = path.resolve(args[0]);
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const jobName = path.basename(jobFile, '.json');
const round1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => String(v >= 100 ? Math.round(v) : round1(v));
const list = (xs, and) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`);

// ---- 1. the clip's frames ----
const slug = `clip-${jobName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
const work = path.resolve(opt('--work') || path.join(HERE, slug));
const srcDir = path.join(work, 'src');
fs.mkdirSync(srcDir, { recursive: true });
const ffmpeg = () => require('ffmpeg-static');
if (!fs.existsSync(path.join(srcDir, 's_0000.jpg'))) {
  if (!job.clip) fail('the job file has no clip (its path in the promo-clips bucket)');
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(job.clip);
  if (error) fail(`couldn't fetch the clip ${job.clip} (${error.message || error.name})${process.env.SUPABASE_SERVICE_ROLE_KEY ? '' : ' -- SUPABASE_SERVICE_ROLE_KEY is not set (Settings -> Secrets and variables -> Actions)'}`);
  const clip = path.join(work, 'clip.mp4');
  fs.writeFileSync(clip, Buffer.from(await blob.arrayBuffer()));
  // Every frame at 30 fps, filling 1080x1920 (a phone's own rotation applied).
  execFileSync(ffmpeg(), ['-y', '-v', 'error', '-i', clip, '-vf', 'fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    '-q:v', '3', '-start_number', '0', path.join(srcDir, 's_%04d.jpg')]);
  fs.rmSync(clip, { force: true });
}
const frames = fs.readdirSync(srcDir).filter((f) => /^s_\d{4}\.jpg$/.test(f)).length;
const clipSeconds = frames / 30;

// ---- 2. the barcode, and the product it opens ----
const barcode = job.barcode || await findBarcode(srcDir, { from: job.label?.at || 0 });
if (!barcode && !job.product) fail('no barcode could be read in the clip -- hold the barcode up to the camera for a second at the end');
const COLS = 'id, product_name, review_status, report, lookup_key';
let row = null;
if (job.product) {
  ({ data: row } = await supabase.from('product_reports').select(COLS).eq('id', job.product).maybeSingle());
} else {
  // As the app's scanner does: the product saved under the barcode, else an approved barcode match.
  ({ data: row } = await supabase.from('product_reports').select(COLS).eq('lookup_key', `barcode:${barcode.code}`).eq('review_status', 'approved').maybeSingle());
  if (!row) {
    const { data: link } = await supabase.from('barcode_links').select('lookup_key').eq('barcode', barcode.code).eq('status', 'approved').limit(1).maybeSingle();
    if (link) ({ data: row } = await supabase.from('product_reports').select(COLS).eq('lookup_key', link.lookup_key).eq('review_status', 'approved').maybeSingle());
  }
}
if (!row) fail(job.product ? `no product ${job.product}` : `barcode ${barcode.code} doesn't open an approved product in the app -- link it first (Admin > Barcode matches)`);
const r = row.report || {};
const name = row.product_name;
if (row.review_status !== 'approved') fail(`"${name}" is ${row.review_status}, not approved`);
if (r.isInfantFormula) fail('infant formula gets no public video');
if (typeof r.overallScore !== 'number') fail('no score');
const ings = (r.ingredients || []).filter((i) => i?.name && !isJunkIngredient(i));
if (ings.length < 4) fail(`only ${ings.length} readable ingredients`);
const score = r.overallScore;
const verdict = verdictFor(score);
const brand = r.brand || '';
const HEADING = /^(noodles?|masala|tastemaker|masala tastemaker|seasoning|filling|coating|dough|base|cream|wafers?|biscuits?)$/i;
const flagged = ings.filter((i) => (i.status === 'concerning' || i.status === 'harmful') && !HEADING.test(i.name.trim()));
console.log(`${name} (${row.id})${barcode ? `, barcode ${barcode.code} read on ${barcode.reads} frames` : ''}: score ${score} ${verdict}`);

// ---- 3. the facts, from the pack's nutrition panel ----
// Daily limits and teaspoons as in the app, so the short and the report page agree.
const LIMIT = Object.fromEntries(NUTRIENT_LIMITS.map((n) => [n.key, n.limit]));
const per100 = r.nutrientsPer100 || {};
const pack = String(r.packSize || '').replace(/\s+/g, ' ').trim();
const packM = pack.match(/(\d+(?:\.\d+)?)\s*(ml|g)\b/i);
const packAmount = packM ? Number(packM[1]) : null;
const unit = packM ? packM[2].toLowerCase() : 'g';
// "The whole pack" only for a pack one person gets through; a 1 kg bag is told per 100 g.
if (!packAmount || packAmount > 400) fail('this format needs a pack one person finishes (a pack size up to 400 g/ml)');
const servingG = Number(r.realNutrientsServingGrams) || null;
const perPack = (k) => (per100[k] * packAmount) / 100;
const half = (v) => Math.round(v * 2) / 2;
const oilTsp = per100.totalFatG > 0 ? Math.round(perPack('totalFatG') / GRAMS_FAT_PER_TEASPOON_OIL) : 0;
const sugarTsp = per100.addedSugarG > 0 ? half(perPack('addedSugarG') / GRAMS_PER_TEASPOON) : 0;
const leadKind = sugarTsp >= 2 ? 'sugar' : oilTsp >= 3 ? 'fat' : null;
if (!leadKind) fail('nothing on the nutrition panel stands out (no teaspoons of oil or sugar worth showing) -- use make.mjs for this product');
const leadKey = leadKind === 'sugar' ? 'addedSugarG' : 'totalFatG';
const packTsp = leadKind === 'sugar' ? sugarTsp : oilTsp;
const servingTsp = servingG && servingG < packAmount ? half((per100[leadKey] * servingG) / 100 / (leadKind === 'sugar' ? GRAMS_PER_TEASPOON : GRAMS_FAT_PER_TEASPOON_OIL)) : null;
const satPct = per100.saturatedFatG > 0 ? Math.round((perPack('saturatedFatG') / LIMIT.saturatedFatG) * 100) : 0;
const sodiumPct = per100.sodiumMg > 0 ? Math.round((perPack('sodiumMg') / LIMIT.sodiumMg) * 100) : 0;
const second = satPct >= 30 ? 'satfat' : sodiumPct >= 40 ? 'sodium' : null;
// The ingredients to name: the oils among those worth a look first (they are the fat), then the rest.
const OIL = /palm|olein|cotton|vanaspati|hydrogenat|shortening|\boil\b/i;
const flagNames = [...new Set(flagged.map((i) => i.name.replace(/\s*\(.*\)$/, '').trim()))];
const named = [...flagNames.filter((n) => OIL.test(n)), ...flagNames.filter((n) => !OIL.test(n))].slice(0, leadKind === 'fat' && flagNames.some((n) => OIL.test(n)) ? Math.min(2, flagNames.filter((n) => OIL.test(n)).length) : 3);
const pickBy = (xs, salt) => xs[[...`${row.id}${salt}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % xs.length];
// "shock": the pack's own number up front ("Ek packet. 7 chammach tel. Aur aap poora kha jaate ho.");
// serving | guess | pov | pass are the older openers (job.hook).
const hookType = job.hook || (score >= 85 ? 'pass' : 'shock');
const beats = ['hook', ...(hookType === 'shock' ? [] : ['tease']), 'turn', leadKind, ...(servingTsp != null ? ['serving'] : []), ...(second ? [second] : []), ...(named.length ? ['ing'] : []), ...(barcode ? ['scan'] : []), 'score', 'app', 'cta'];

const ADVICE = { Excellent: ['Haan', 'हां'], Good: ['Zyaadatar haan', 'ज़्यादातर हां'], Moderate: ['Kabhi-kabhi', 'कभी-कभी'], Poor: ['Bahut kam', 'बहुत कम'], 'Very Poor': ['Bahut hi kam', 'बहुत ही कम'] }[verdict];
const halfShow = (v) => (v === 0.5 ? '½' : String(v).replace('.5', '½'));
const halfSay = (v) => ({ 0.5: 'आधा', 1.5: 'डेढ़', 2.5: 'ढाई' }[v] || (v % 1 ? `साढ़े ${Math.floor(v)}` : String(v)));
const unitSay = unit === 'ml' ? 'मिलीलीटर' : 'ग्राम';
const values = {
  product: name, pack_g: `${packAmount} ${unit}`, pack_tsp: halfShow(packTsp), lead_word: leadKind === 'sugar' ? 'chini' : 'tel',
  score: String(score), verdict, advice: ADVICE[0], named: list(named, 'aur'), lead_g: `${num(perPack(leadKey))} g`,
  ...(servingG ? { serving_g: `${servingG} ${unit}` } : {}),
  ...(servingTsp != null ? { serving_tsp: halfShow(servingTsp) } : {}),
  ...(second === 'satfat' ? { sat_pct: `${satPct}%` } : {}), ...(second === 'sodium' ? { sodium_pct: `${sodiumPct}%` } : {}),
  ...(leadKind === 'sugar' ? { sugar_tsp: halfShow(packTsp) } : {}),
};
const valuesSay = {
  ...values, pack_g: `${packAmount} ${unitSay}`, pack_tsp: halfSay(packTsp), lead_word: leadKind === 'sugar' ? 'चीनी' : 'तेल', advice: ADVICE[1], named: list(named, 'और'), lead_g: `${num(perPack(leadKey))} ग्राम`,
  ...(servingG ? { serving_g: `${servingG} ${unitSay}` } : {}),
  ...(servingTsp != null ? { serving_tsp: halfSay(servingTsp) } : {}),
  ...(second === 'satfat' ? { sat_pct: `${satPct} प्रतिशत` } : {}), ...(second === 'sodium' ? { sodium_pct: `${sodiumPct} प्रतिशत` } : {}),
  ...(leadKind === 'sugar' ? { sugar_tsp: halfSay(packTsp) } : {}),
};

// ---- 4. the words ----
const script = job.script
  ? { lines: job.script, source: 'job file', tries: [] }
  : await writeScript({ product: name, brand, pack, foodType: r.foodType || 'packaged food', hookType, beats, values }, { useAi: !args.includes('--no-ai') });
const missing = beats.filter((b) => !script.lines[b]);
if (missing.length) fail(`the script has no ${missing.join(', ')} line`);
const LINES = Object.fromEntries(beats.map((b) => [b, fill(script.lines[b], values, valuesSay)]));
console.log(`script (${script.source}${script.tries.length ? `, ${script.tries.length} rejected tries` : ''}):\n${beats.map((b) => `  ${b.padEnd(8)} ${LINES[b].sticker ? `[${LINES[b].sticker}] ` : ''}${LINES[b].show}`).join('\n')}`);

// ---- 5. the voice: one file per line, silence trimmed off both ends ----
// Without it (no Python locally, or the service down) the timing is
// estimated and the short is captions-only.
const voiceDir = path.join(work, 'voice');
const secs = {};
const offsets = {}; // beat -> where each of its sentences ("|" in the line) starts, in seconds into the line
let voiced = false;
// How each line is said: Gemini's voice takes the direction in words.
const STYLE = {
  hook: ['amused and a little teasing, setting the scene, a short pause after.', 'stunned and wide-eyed, hitting the number hard.', 'cheeky, the voice rising at the end as if saying "really?".'],
  tease: 'playful and curious, a smile in the voice.',
  turn: 'intrigued and curious, a little slower, clearly spoken -- not a whisper.',
  fat: 'stunned and amused, stressing the numbers, a little laugh in the voice.',
  sugar: 'stunned and amused, stressing the numbers, a little laugh in the voice.',
  serving: 'matter-of-fact at first, then surprised at the second number.',
  satfat: 'serious and building up, stressing the percentage.',
  sodium: 'serious and building up, stressing the percentage.',
  ing: 'curious and pointing things out, slightly slower on the names.',
  scan: 'quick and upbeat, like pressing a button.',
  score: 'calm, confident, announcing the verdict.',
  app: 'friendly and upbeat.',
  cta: 'warm and smiling, inviting the viewer.',
};
// The old flat voice (a free Microsoft neural voice through edge-tts), if Gemini's can't be had.
const edgeVoice = () => {
  const spec = path.join(voiceDir, 'lines.json');
  // Questions lift a little; the reveals (the numbers) come a touch slower.
  const prosody = (b) => (/\?\s*$/.test(LINES[b].say) ? { pitch: '+6Hz' } : ['fat', 'sugar', 'satfat', 'sodium', 'score'].includes(b) ? { rate: '+8%' } : {});
  fs.writeFileSync(spec, JSON.stringify({ voice: 'hi-IN-SwaraNeural', rate: job.rate || '+15%', lines: beats.map((b) => ({ text: LINES[b].say.replace(/\*/g, '').replace(/\|/g, ' '), ...prosody(b) })) }, null, 1));
  execFileSync(process.env.PYTHON || 'python3', [path.join(HERE, 'voice.py'), spec, voiceDir], { stdio: 'inherit' });
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse';
  beats.forEach((b, i) => {
    const wav = path.join(voiceDir, `${b}.wav`);
    execFileSync(ffmpeg(), ['-y', '-v', 'error', '-i', path.join(voiceDir, `v${String(i).padStart(2, '0')}.mp3`), '-af', trim, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    secs[b] = wavSeconds(fs.readFileSync(wav));
  });
};
if (!args.includes('--no-voice')) {
  fs.mkdirSync(voiceDir, { recursive: true });
  try {
    // Takes are kept in the bucket: a re-run (or the render after a local preview) speaks the same words the same way.
    const cache = {
      get: async (key) => { const { data } = await supabase.storage.from(BUCKET).download(`voice-cache/${key}.pcm`); return data ? Buffer.from(await data.arrayBuffer()) : null; },
      put: (key, pcm) => supabase.storage.from(BUCKET).upload(`voice-cache/${key}.pcm`, pcm, { contentType: 'application/octet-stream', upsert: true }),
    };
    const spoken = beats.map((b) => ({ id: b, text: LINES[b].say.replace(/\*/g, ''), style: STYLE[b] || STYLE.app }));
    let v;
    for (const model of [TTS_MODEL, TTS_FALLBACK]) {
      try { v = await geminiVoice(spoken, voiceDir, { model, attempts: model === TTS_MODEL ? 3 : 6, tempo: job.tempo || undefined, cache }); console.log(`voice: ${model}`); break; } catch (e) {
        if (!e.tryNextModel || model === TTS_FALLBACK) throw e;
        console.log(`::warning title=Voice model::${model} gave no usable take (${String(e.message).slice(0, 110)}) -- the whole video is voiced with ${TTS_FALLBACK}`);
      }
    }
    Object.assign(secs, v.secs); Object.assign(offsets, v.offsets);
    voiced = true;
  } catch (e) {
    console.log(`::warning title=Gemini voice::${String(e.message).split('\n')[0]} -- using the flat voice`);
    try { edgeVoice(); voiced = true; } catch (e2) {
      console.log(`::warning title=No voice::the voiceover wasn't made (${String(e2.message).split('\n')[0]}) -- captions only`);
    }
  }
}
// Without the voice (or its sentence times) the timing is estimated from the words.
for (const b of beats) {
  const parts = LINES[b].say.split('|');
  if (!voiced) { let at = 0; offsets[b] = parts.map((p) => { const o = r2(at); at += 0.2 + 0.32 * p.trim().split(/\s+/).length + 0.2; return o; }); secs[b] = at - 0.2; }
  else if (!offsets[b]) { const total = parts.reduce((n, p) => n + p.length, 0); let at = 0; offsets[b] = parts.map((p) => { const o = r2((at / total) * secs[b]); at += p.length; return o; }); }
}
function wavSeconds(buf) {
  for (let o = 12; o + 8 <= buf.length;) {
    const id = buf.toString('ascii', o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === 'data') return size / (44100 * 2);
    o += 8 + size + (size % 2);
  }
  return 0;
}

// ---- 6. the timeline ----
const clip = [];      // output time -> clip time
const cam = [];       // where the camera looks: a point in the clip, zoom, blur, sideways blur
const voice = [];     // when each line is spoken
const captions = [];  // the words on screen, a few at a time
const sfx = [];       // sound effects (soundtrack.cjs)
const spoons = [];    // spoon clinks
const marks = [];     // boxes round numbers on the frozen label
const cards = [];
const shakes = [];    // camera shakes on impacts
const play = (t0, t1, s0, s1, { min = 0.75, max = 3, ease = false } = {}) => {
  const speed = (s1 - s0) / (t1 - t0);
  if (speed < min) { const tm = t0 + (s1 - s0) / min; clip.push({ t0, t1: tm, s0, s1, ease }, { t0: tm, t1, s0: s1, s1 }); }
  else clip.push({ t0, t1, s0, s1: speed > max ? s0 + (t1 - t0) * max : s1, ease });
};
const hold = (t0, t1, s) => clip.push({ t0, t1, s0: s, s1: s });
const camKey = (t, x, y, z, more = {}) => cam.push({ t: r2(t), x, y, z, ...more });
const say = (b, t, caps = true) => {
  voice.push({ id: b, t: r2(t), file: voiced ? `voice/${b}.wav` : null });
  if (!caps) return; // the hook's own big type says it
  // Each word lights up as it is said, timed by its share of the line's
  // letters. A unit or a dash stays with the word before it ("70%", "fat —");
  // a starred word, or one with a number in it, is the line's key word.
  const words = LINES[b].show.split(/\s+/).filter(Boolean)
    .reduce((ws, w) => (ws.length && /^(g|mg|ml|kcal|—|–)[.,]?$/.test(w) ? [...ws.slice(0, -1), `${ws[ws.length - 1]} ${w}`] : [...ws, w]), []);
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  let at = t, chunk = [];
  const push = () => { if (chunk.length) captions.push({ words: chunk, end: r2(t + secs[b] + 0.25) }); chunk = []; };
  for (const w of words) {
    if (chunk.length >= 3 || chunk.reduce((n, [x]) => n + x.length + 1, 0) + w.length > 14) push();
    const emph = /\*/.test(w) || /\d/.test(w);
    chunk.push([w.replace(/\*/g, ''), r2(at), emph ? 1 : 0]);
    at += (secs[b] * (w.length + 1)) / total;
  }
  push();
};
const slot = (b, min, pad = 0.25) => Math.max(min, secs[b] + pad);
const rows = job.label?.rows || {};
const centre = (bx) => [bx[0] + bx[2] / 2, bx[1] + bx[3] / 2];
const L = job.label.at;
let t = 0;
const scenes = {};

// 6a. Hook. "Serving" opens on the label's serving line; the others on the pack's front.
const [fr0, fr1] = job.front;
const hookEnd = r2(hookType === 'shock' ? 0.08 + secs.hook + 0.55 : slot('hook', 1.7));
let hero = null;
if (hookType === 'shock') {
  // Three sentences, each spoken on its own, so the big number lands on its word:
  // EK PACKET / the number, the bowl filling teaspoon by teaspoon / AUR AAP POORA KHA JAATE HO.
  const tP = offsets.hook.map((x) => r2(0.08 + x));
  const n = Math.ceil(packTsp);
  const p1Len = (offsets.hook[2] ?? secs.hook) - offsets.hook[1] - 0.2;
  const step = Math.min(0.17, Math.max(0.07, (p1Len - 0.15) / n));
  const ticks = Array.from({ length: n }, (_, i) => r2(tP[1] + 0.1 + i * step));
  const p2Len = secs.hook - (offsets.hook[2] ?? 0);
  hero = {
    parts: tP, n: halfShow(packTsp), fill: leadKind === 'sugar' ? 'sugar' : 'oil', word: leadKind === 'sugar' ? 'CHAMMACH CHINI' : 'CHAMMACH TEL', ticks,
    lines: [{ text: 'AUR AAP', t: tP[2] }, { text: 'POORA', t: r2(tP[2] + p2Len * 0.3) }, { text: 'KHA JAATE HO', t: r2(tP[2] + p2Len * 0.52) }], end: hookEnd,
  };
  ticks.forEach((x) => spoons.push(x));
  shakes.push(r2(tP[1] + 0.02), r2(hero.lines[1].t));
  sfx.push({ t: 0.05, kind: 'pop' }, { t: tP[1] + 0.02, kind: 'hit' }, { t: tP[2], kind: 'pop' }, { t: hero.lines[1].t, kind: 'hit' }, { t: hero.lines[2].t, kind: 'pop' });
  play(0, hookEnd, fr0, fr1);
  camKey(0, 540, 960, 1.04); camKey(tP[1], 540, 960, 1.08); camKey(tP[1] + 0.15, 540, 960, 1.2); camKey(tP[2], 540, 960, 1.22); camKey(hookEnd, 540, 960, 1.34, { whip: 30 });
} else if (hookType === 'serving') {
  hold(0, hookEnd, L);
  const [sx, sy] = centre(rows.serving);
  camKey(0, sx + 60, sy - 40, 2.5); camKey(hookEnd, sx + 60, sy - 40, 2.75);
  marks.push({ t0: 0.12, t1: hookEnd, box: rows.serving, label: 'Serving size' });
  sfx.push({ t: 0.12, kind: 'ding' });
} else {
  play(0, hookEnd, fr0, fr0 + (fr1 - fr0) * 0.5);
  camKey(0, 540, 960, 1.04); camKey(hookEnd, 540, 960, 1.14);
}
say('hook', 0.08, !hero);
if (!hero) sfx.push({ t: 0.05, kind: 'pop' });
t = hookEnd;

// 6b. Tease: a whip to the pack's front (the older openers; the shock hook has none).
if (!hero) {
  const teaseEnd = r2(t + slot('tease', 1.6));
  play(t, teaseEnd, hookType === 'serving' ? fr0 : fr0 + (fr1 - fr0) * 0.5, fr1);
  camKey(t, 540, 960, 1.2, { whip: 60 }); camKey(t + 0.22, 540, 960, 1.06); camKey(teaseEnd, 540, 960, 1.12);
  sfx.push({ t, kind: 'whoosh' }, { t: t + 0.25, kind: 'pop' });
  say('tease', t + 0.12);
  t = teaseEnd;
}
scenes.hook = [0, t];

// 6c. The turn, fast, with a speed ramp and a shake, into the frozen label.
const turnEnd = r2(t + slot('turn', 0.9, 0.15));
play(t, turnEnd, job.flip[0], L, { max: 3.4, ease: true });
camKey(t, 540, 960, 1.12, { whip: 25 }); camKey(t + (turnEnd - t) / 2, 540, 960, 1.0, { whip: 40 }); camKey(turnEnd - 0.02, 540, 960, 1.0);
sfx.push({ t: t + 0.1, kind: 'whoosh' });
say('turn', t + 0.05);
t = turnEnd;
scenes.label = [t, 0];
const freezeAt = t;

// 6d. The frozen label: the camera punches in on each number in turn, it
// is boxed, and a card says what it means for the pack.
let labelHoldFrom = t;
const factBeat = (b, key, card) => {
  const box = rows[key];
  const dur = slot(b, 2.2, 0.35);
  if (box) {
    const [cx, cy] = centre(box);
    camKey(t, cx + 120, cy - 130, 2.45, { punch: 1 }); camKey(t + dur - 0.2, cx + 120, cy - 120, 2.55);
    marks.push({ t0: r2(t + 0.12), t1: r2(t + dur), box, label: card.mark });
  } else {
    camKey(t, 540, 960, 1.15); camKey(t + dur - 0.2, 540, 960, 1.2);
  }
  sfx.push({ t: t + 0.12, kind: 'c' });
  say(b, t + 0.1);
  cards.push({ ...card, t0: r2(t + 0.25), t1: r2(t + dur) });
  t += dur;
};
if (leadKind && hero) {
  // The proof for the hook: the label's grams, divided by the grams in a teaspoon, make the number.
  const start = t;
  const sentences = LINES[leadKind].say.split(/[।?!]/).filter((s) => s.trim());
  const share = sentences.length > 1 ? 1 - sentences[sentences.length - 1].length / sentences.join('').length : 0.5;
  const t3 = r2(start + 0.1 + secs[leadKind] * share);
  const perTsp = leadKind === 'sugar' ? GRAMS_PER_TEASPOON : GRAMS_FAT_PER_TEASPOON_OIL;
  factBeat(leadKind, leadKey, {
    kind: 'proof', tag: `${leadKind === 'sugar' ? 'ADDED SUGAR' : 'FAT'} · POORA PACK · ${pack}`, g: num(perPack(leadKey)), gWord: leadKind === 'sugar' ? 'added sugar' : 'fat',
    per: `÷ ${perTsp} g = 1 chammach ${leadKind === 'sugar' ? 'chini' : 'tel'}`, n: halfShow(packTsp), unitWord: leadKind === 'sugar' ? 'chammach chini' : 'chammach tel', t3, fill: hero.fill,
    mark: leadKind === 'sugar' ? 'Added sugar' : 'Total fat',
  });
  sfx.push({ t: start + 0.3, kind: 'pop' }, { t: start + 0.75, kind: 'pop' }, { t: t3, kind: 'hit' });
  shakes.push(t3);
  hero.proofAt = t3;
} else if (leadKind) {
  const unitTag = `POORA PACK · ${pack}`;
  const ticks = [];
  for (let i = 0; i < Math.ceil(packTsp); i++) ticks.push(r2(t + 0.6 + i * Math.min(0.22, (slot(leadKind, 2.2, 0.35) - 1.1) / Math.ceil(packTsp))));
  ticks.forEach((x) => spoons.push(x));
  factBeat(leadKind, leadKey, leadKind === 'sugar'
    ? { kind: 'bowl', fill: 'sugar', tag: `ADDED SUGAR · ${unitTag}`, n: packTsp, unitWord: 'chammach chini', sub: `= ${num(perPack('addedSugarG'))} g added sugar`, ticks, mark: 'Added sugar' }
    : { kind: 'bowl', fill: 'oil', tag: `FAT · ${unitTag}`, n: packTsp, unitWord: 'chammach tel jitna', sub: `= ${num(perPack('totalFatG'))} g fat`, ticks, mark: 'Total fat' });
}
if (servingTsp != null) {
  const box = rows.serving;
  const dur = slot('serving', 2.2, 0.35);
  if (box) { const [cx, cy] = centre(box); camKey(t, cx + 60, cy - 40, 2.4, { punch: 1 }); camKey(t + dur - 0.2, cx + 60, cy - 40, 2.5); marks.push({ t0: r2(t + 0.1), t1: r2(t + dur), box, label: 'Serving size' }); }
  say('serving', t + 0.1);
  cards.push({ kind: 'vs', fill: leadKind === 'sugar' ? 'sugar' : 'oil', t0: r2(t + 0.2), t1: r2(t + dur), a: { k: `1 serving · ${servingG} ${unit}`, n: servingTsp }, b: { k: `Poora pack · ${pack}`, n: packTsp }, unitWord: 'chammach' });
  sfx.push({ t: t + 0.2, kind: 'pop' }, { t: t + 0.9, kind: 'pop' });
  t += dur;
}
if (second === 'satfat') {
  const start = t;
  factBeat('satfat', 'saturatedFatG', { kind: 'bar', tag: `SATURATED FAT · POORA PACK · ${pack}`, v: `${num(perPack('saturatedFatG'))} g`, d: `WHO limit 22 g/din ka ~${satPct}%`, pct: satPct, foot: '2000 kcal reference diet', mark: 'Saturated fat' });
  sfx.push({ t: start + 0.55, kind: 'riser', t1: start + 1.45 }, { t: start + 1.45, kind: 'hit' });
  shakes.push(r2(start + 1.45));
} else if (second === 'sodium') {
  const start = t;
  factBeat('sodium', 'sodiumMg', { kind: 'bar', tag: `SODIUM · POORA PACK · ${pack}`, v: `${num(perPack('sodiumMg'))} mg`, d: `WHO limit 2000 mg/din ka ${sodiumPct}%`, pct: sodiumPct, mark: 'Sodium' });
  sfx.push({ t: start + 0.55, kind: 'riser', t1: start + 1.45 }, { t: start + 1.45, kind: 'hit' });
  shakes.push(r2(start + 1.45));
}
hold(labelHoldFrom, t, L);
scenes.label[1] = r2(t);

// 6e. Down the ingredient list to the barcode, the ones worth a look named as they're said.
const scanAt = barcode ? Math.min(barcode.at, clipSeconds - 0.04) : clipSeconds - 0.04;
let chips = [];
let ingAt = null;
if (named.length) {
  ingAt = t;
  const end = r2(t + slot('ing', 2.0, 0.3));
  // Too far to cover in the time: start later down the list.
  const from = Math.max(L, scanAt - (end - t) * 2.2);
  play(t, end, from, scanAt, { min: 0.6, max: 2.4 });
  camKey(t, 540, 960, 1.15, { whip: 35 }); camKey(t + 0.2, 540, 960, 1.0); camKey(end, 540, 960, 1.08);
  sfx.push({ t, kind: 'whoosh' });
  const before = captions.length;
  say('ing', t + 0.12);
  const ws = captions.slice(before).flatMap((c) => c.words);
  chips = named.map((n) => {
    const first = n.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    const w = ws.find(([x]) => x.toLowerCase().replace(/[^a-z]/g, '') === first);
    return { t: w ? w[1] : t + 0.6, text: n };
  });
  chips.forEach((c) => sfx.push({ t: c.t, kind: 'pop' }));
  scenes.facts = [scenes.label[1], end];
  t = end;
} else {
  scenes.facts = [t, t];
}

// 6f. The scan: corners lock onto the barcode, a laser sweeps, the digits
// type out, a beep -- then the camera dives into the barcode, into the app.
let scan = null;
if (barcode) {
  const dur = slot('scan', 1.6, 0.35);
  const [bx, by, bw, bh] = barcode.box;
  const z = Math.min(1.6, (1080 * 0.62) / bw);
  hold(t, t + dur + 0.45, scanAt);
  camKey(t, 540, 960, 1.08); camKey(t + 0.35, bx + bw / 2, by + bh / 2 + 60, z); camKey(t + dur, bx + bw / 2, by + bh / 2 + 40, z * 1.04);
  camKey(t + dur + 0.45, bx + bw / 2, by + bh / 2, z * 5.5, { blur: 18 });
  scan = { t0: r2(t + 0.2), lock: r2(t + 0.2 + Math.min(1.0, dur - 0.5)), t1: r2(t + dur + 0.3), box: barcode.box, code: barcode.code };
  sfx.push({ t: t + 0.25, kind: 'whoosh' }, { t: scan.lock, kind: 'beep' }, { t: t + dur + 0.2, kind: 'whoosh' });
  say('scan', t + 0.15);
  t = r2(t + dur + 0.45);
}

// 6g. The real app on a phone: the score fills, then Nutrition, then Ingredients.
const phoneStart = t;
const phoneDur = Math.max(5.2, 0.35 + secs.score + 0.35 + secs.app + 0.6);
const app = args.includes('--no-app') ? null : await recordAppScreen(row.id, name, work, { seconds: Math.ceil(phoneDur + 0.5), fps: 30 });
const still = app || args.includes('--no-app') ? null : await captureAppScreen(row.id, name, work);
say('score', t + 0.35);
say('app', t + 0.35 + secs.score + 0.35);
sfx.push({ t: t + 0.05, kind: 'hit' }, { t: t + 2.0, kind: 'ding' });
shakes.push(r2(t + 0.05));
hold(t, 9999, scanAt);
t = r2(t + phoneDur);
scenes.verdict = [phoneStart, t];

// 6h. The end card with the QR code, long enough to scan it off a screen.
const ctaStart = t;
const duration = Math.ceil(ctaStart + Math.max(4.5, 0.35 + secs.cta + 1.0));
scenes.cta = [ctaStart, duration];
say('cta', ctaStart + 0.35);
camKey(duration, 540, 960, 1.2, { blur: 24 });
cam.sort((a, b) => a.t - b.t);
clip.sort((a, b) => a.t0 - b.t0);
clip[clip.length - 1].t1 = duration;
// A coloured band sweeps across (the cut happens under it); the soundtrack whooshes on each.
const transitions = [{ t: hookEnd, kind: hero ? 'swipe' : 'push' }, ...(ingAt != null ? [{ t: ingAt, kind: 'swipe' }] : []), { t: phoneStart, kind: 'burst' }, { t: ctaStart, kind: 'wipe' }];

const TL = {
  _: `Made by shorts/clip.mjs from ${path.basename(jobFile)} and product ${row.id} (${name}). Facts from the pack's nutrition panel and ingredient list as saved in FoodGuard; words: ${script.source}.`,
  duration, fps: FPS, music: pickBy(['warm', 'bright', 'chill', 'pulse', 'lofi'], 'music'), musicGain: voiced ? 0.4 : 1,
  scenes, transitions, firstToken: scenes.label[0], tokenStep: 0, tokens: [], sfx, spoons,
  frames, clip, cam, freezeAt, marks, cards, chips, scan, shakes, captions, voice,
  hook: { type: hookType, stickers: [LINES.hook.sticker || '', LINES.tease?.sticker || ''], at: [0.05, hookEnd + 0.22], hero },
  score, verdict, advice: ADVICE[0],
  phone: { t0: phoneStart, scoreAt: phoneStart + 1.9 },
  app: app ? { frames: app.frames, fps: app.fps, width: app.width, height: app.height } : null,
  still: still || null,
  cta: 'Pehle check karo.<br /><em>Phir khareedo.</em>',
  fine: `From the pack’s own nutrition panel (per 100 ${unit} × ${pack}) & ingredient list. WHO daily limits, 2000 kcal diet. General information, not medical advice.`,
  product: { id: row.id, name },
};
fs.writeFileSync(path.join(work, 'timeline.json'), JSON.stringify(TL, null, 1));
fs.writeFileSync(path.join(work, 'script.json'), JSON.stringify({ source: script.source, rejected: script.tries, hookType, lines: script.lines, filled: LINES }, null, 1));
fs.copyFileSync(path.join(HERE, '_clip.html'), path.join(work, 'index.html'));
console.log(`timeline: ${duration} s${voiced ? ', voiced' : ', no voice'}${app ? ', app recorded' : still ? ', app still' : ''}, hook "${hookType}" -> ${work}`);
if (PREVIEW) process.exit(0);

// ---- 7. render, caption, hand over ----
if (path.dirname(work) !== HERE) fail('a video is rendered from promo/shorts/<name>/ (leave out --work)');
execFileSync(process.execPath, [path.join(HERE, 'build-short.cjs'), slug, String(duration)], { cwd: path.join(HERE, '..'), stdio: 'inherit', env: { ...process.env, RENDER_FPS: String(FPS) } });
const brandTag = brand.replace(/[^A-Za-z]/g, '');
const caption = `${LINES.hook.show.replace(/\*/g, '')} ${LINES.tease ? LINES.tease.show.replace(/\*/g, '') : ''}

${brand && !name.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ` : ''}${name} (${pack}), label padha:
${leadKind === 'sugar' ? `🥄 Poora pack = lagbhag ${halfShow(packTsp)} chammach chini (${num(perPack('addedSugarG'))} g added sugar)` : `🛢️ Poora pack = lagbhag ${packTsp} chammach tel jitna fat (${num(perPack('totalFatG'))} g)`}
${servingTsp != null ? `🍽️ 1 serving (${servingG} ${unit}) = ${halfShow(servingTsp)} chammach\n` : ''}${second === 'satfat' ? `⚠️ Saturated fat: ${num(perPack('saturatedFatG'))} g — din bhar ki limit ka ~${satPct}%\n` : second === 'sodium' ? `🧂 Sodium: ${num(perPack('sodiumMg'))} mg — din bhar ki limit ka ${sodiumPct}%\n` : ''}${named.length ? `🟠 Dhyaan dene laayak: ${named.join(', ')}\n` : ''}
FoodGuard score: ${score}/100 · ${verdict} — khaayein? ${ADVICE[0]}.

Aapke ghar mein kaunsa packet hai? Comment karo, agla video usi ka 👇

📲 Apna packet khud check karo — FoodGuard India (free):
${PLAY_URL}

Pack ke nutrition label aur ingredient list se. WHO daily limits (2000 kcal diet). General information, not medical advice.

#ReadTheLabel ${brandTag ? `#${brandTag} ` : ''}#FoodLabel #HealthyIndia #EatSmart #FoodGuardIndia
`;
fs.mkdirSync(OUT, { recursive: true });
const base = slug.replace(/^clip-/, '');
const mp4 = path.join(OUT, `${base}.mp4`);
fs.copyFileSync(path.join(HERE, '..', 'out', `${slug}.mp4`), mp4);
fs.writeFileSync(path.join(OUT, `${base}-caption.txt`), caption);
fs.copyFileSync(path.join(work, 'timeline.json'), path.join(OUT, `${base}-timeline.json`));
fs.copyFileSync(path.join(work, 'script.json'), path.join(OUT, `${base}-script.json`));
fs.rmSync(path.join(HERE, '..', 'out', `${slug}.mp4`), { force: true });
fs.rmSync(path.join(HERE, '..', 'out', `${slug}.wav`), { force: true });
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${name} — ${duration} s\n\nWords: ${script.source}\n\n${beats.map((b) => `- **${b}** ${LINES[b].sticker ? `[${LINES[b].sticker}] ` : ''}${LINES[b].show}`).join('\n')}\n`);
// Also next to the clip, so it can be fetched without opening GitHub; the
// script and timeline are what the next one gets tuned by.
for (const [file, contentType] of [[mp4, 'video/mp4'], [path.join(OUT, `${base}-caption.txt`), 'text/plain; charset=utf-8'], [path.join(OUT, `${base}-timeline.json`), 'application/json'], [path.join(OUT, `${base}-script.json`), 'application/json']]) {
  const { error } = await supabase.storage.from(BUCKET).upload(`out/${path.basename(file)}`, fs.readFileSync(file), { contentType, upsert: true });
  console.log(error ? `::warning::${path.basename(file)} not saved to ${BUCKET}: ${error.message}` : `saved ${BUCKET}/out/${path.basename(file)}`);
}
console.log(`MADE: ${mp4}`);
