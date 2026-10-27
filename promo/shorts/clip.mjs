// promo/shorts/clip.mjs -- a short cut from a real phone clip of the pack:
// the footage plays underneath, the facts land on top of it, a voice reads
// them out.
//
//   node shorts/clip.mjs ../promo/clips/<job>.json --out out/video     (GitHub: make-clip-video.yml)
//   node shorts/clip.mjs <job> --work <dir> --preview --no-voice       (timeline + stills' inputs, no video)
//
// The job file (promo/clips/*.json) names the product and the clip (its
// path in the private promo-clips Storage bucket -- never a link, the repo
// is public) and says where in the clip things are -- seconds, and boxes in
// the clip's own 1080x1920 pixels:
//   clip   "clips/<name>.mp4"
//   front  [from, to]   the pack's front, held still
//   flip   [from, to]   turning it over (played fast)
//   label  { at, rows } the clearest look at the nutrition table, frozen
//                       there, and boxes around its numbers:
//                       rows: { totalFatG, saturatedFatG, sodiumMg, addedSugarG: [x, y, w, h] }
//   pan    [from, to]   moving down the ingredient list
// The finished video and caption also go to promo-clips/out/. Reading and
// writing that bucket takes SUPABASE_SERVICE_ROLE_KEY (a repo secret on GitHub).
//
// What is said comes from the product's saved report, as in make.mjs: facts
// from the pack, neutral wording, the daily limits the app itself uses
// (dailyHabitCheck.js). The voice (shorts/voice.py) is a free Microsoft
// neural voice; its lines are written in Hindi script so they sound natural,
// and the captions show the same words in Hinglish.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { supabase } from '../../src/services/supabaseClient.js';
import { isJunkIngredient } from '../../src/services/typoIngredient.js';
import { verdictFor } from '../../src/services/scoringEngine.js';
import { NUTRIENT_LIMITS } from '../../src/services/dailyHabitCheck.js';
import { captureAppScreen } from './app-screen.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.foodguard.india';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const OUT = path.resolve(opt('--out') || path.join(HERE, '..', 'out'));
const PREVIEW = args.includes('--preview');
const NO_VOICE = args.includes('--no-voice');
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

// ---- 1. the product (the same checks as make.mjs) ----
const { data: row } = await supabase.from('product_reports').select('id, product_name, review_status, report').eq('id', job.product).maybeSingle();
if (!row) fail(`no product ${job.product}`);
const r = row.report || {};
const name = row.product_name;
if (row.review_status !== 'approved') fail(`"${name}" is ${row.review_status}, not approved`);
if (r.isInfantFormula) fail('infant formula gets no public video');
if (typeof r.overallScore !== 'number') fail('no score');
const ings = (r.ingredients || []).filter((i) => i?.name && !isJunkIngredient(i));
if (ings.length < 4) fail(`only ${ings.length} readable ingredients`);
const score = r.overallScore;
const verdict = verdictFor(score);
const HEADING = /^(noodles?|masala|tastemaker|masala tastemaker|seasoning|filling|coating|dough|base|cream|wafers?|biscuits?)$/i;
const flagged = ings.filter((i) => (i.status === 'concerning' || i.status === 'harmful') && !HEADING.test(i.name.trim()));

// ---- 2. the facts, from the pack's nutrition panel ----
// Daily limits as in the app; a 5 ml teaspoon of cooking oil weighs about
// 4.6 g, one of sugar about 4 g.
const LIMIT = Object.fromEntries(NUTRIENT_LIMITS.map((n) => [n.key, n.limit]));
const OIL_G_PER_TSP = 4.6;
const SUGAR_G_PER_TSP = 4;
const per100 = r.nutrientsPer100 || {};
const pack = String(r.packSize || '').replace(/\s+/g, ' ').trim();
const packM = pack.match(/(\d+(?:\.\d+)?)\s*(ml|g)\b/i);
const packAmount = packM ? Number(packM[1]) : null;
const unit = packM ? packM[2].toLowerCase() : 'g';
// "In one pack" only for a pack one person gets through; a 1 kg bag is told per 100 g.
const perPack = Boolean(packAmount && packAmount <= 400);
const q = (k) => (perPack ? (per100[k] * packAmount) / 100 : per100[k]);
const unitSay = unit === 'ml' ? 'मिलीलीटर' : 'ग्राम';
const whereShow = perPack ? `ek ${pack} pack mein` : `har 100 ${unit} mein`;
const whereSay = perPack ? `एक ${packAmount} ${unitSay} पैक में` : `हर 100 ${unitSay} में`;
const whereTag = perPack ? `POORA PACK (${pack})` : `PER 100 ${unit.toUpperCase()}`;

const facts = [];
if (per100.addedSugarG > 0) {
  const g = q('addedSugarG');
  const tsp = Math.round((g / SUGAR_G_PER_TSP) * 2) / 2;
  if (tsp >= 2) facts.push({ key: 'addedSugarG', kind: 'sugar', g, tsp });
}
if (per100.totalFatG > 0) {
  const g = q('totalFatG');
  const tsp = Math.round(g / OIL_G_PER_TSP);
  if (tsp >= 3) facts.push({ key: 'totalFatG', kind: 'oil', g, tsp });
}
if (per100.saturatedFatG > 0) {
  const g = q('saturatedFatG');
  const pct = Math.round((g / LIMIT.saturatedFatG) * 100);
  if (pct >= 30) facts.push({ key: 'saturatedFatG', kind: 'limit', g, pct });
}
if (per100.sodiumMg > 0) {
  const g = q('sodiumMg');
  const pct = Math.round((g / LIMIT.sodiumMg) * 100);
  if (pct >= 40) facts.push({ key: 'sodiumMg', kind: 'limit', g, pct });
}
if (!facts.length) fail('nothing on the nutrition panel stands out -- this clip format needs at least one fact (use make.mjs for this product)');
const shown = facts.slice(0, 2); // two facts on the frozen label; a short keeps moving

// Each line: what the voice says (Hindi script), what the captions show.
const tspShow = (v) => String(v).replace('.5', '½');
const FACT_LINE = {
  sugar: (f) => ({
    say: `हर 100 ${unitSay} में ${num(per100.addedSugarG)} ग्राम ऐडेड शुगर${perPack ? ` — पूरे पैक में ${num(f.g)} ग्राम` : ''}।`,
    show: `Har 100 ${unit} mein ${num(per100.addedSugarG)} g added sugar${perPack ? ` — poore pack mein ${num(f.g)} g` : ''}.`,
    card: { tag: `ADDED SUGAR · ${whereTag}`, v: `${num(f.g)} g`, d: `≈ ${tspShow(f.tsp)} chammach chini`, spoons: Math.ceil(f.tsp), fill: 'sugar' },
    mark: 'Added sugar',
  }),
  oil: (f) => ({
    say: `हर 100 ${unitSay} में ${num(per100.totalFatG)} ग्राम फैट${perPack ? ` — पूरे पैक में ${num(f.g)} ग्राम` : ''}।`,
    show: `Har 100 ${unit} mein ${num(per100.totalFatG)} g fat${perPack ? ` — poore pack mein ${num(f.g)} g` : ''}.`,
    card: { tag: `FAT · ${whereTag}`, v: `${num(f.g)} g`, d: `≈ ${f.tsp} chammach tel jitna`, spoons: f.tsp, fill: 'oil' },
    mark: 'Total fat',
  }),
  limit: (f) => (f.key === 'sodiumMg' ? {
    say: `सोडियम ${num(f.g)} मिलीग्राम — WHO की रोज़ की सीमा का ${f.pct} प्रतिशत।`,
    show: `Sodium ${num(f.g)} mg — WHO ki roz ki seema ka ${f.pct}%.`,
    card: { tag: `SODIUM · ${whereTag}`, v: `${num(f.g)} mg`, d: `WHO limit 2000 mg/din ka ${f.pct}%`, bar: f.pct },
    mark: 'Sodium',
  } : {
    say: `सैचुरेटेड फैट ${num(f.g)} ग्राम — WHO की रोज़ की सीमा का करीब ${f.pct} प्रतिशत।`,
    show: `Saturated fat ${num(f.g)} g — WHO ki roz ki seema ka ~${f.pct}%.`,
    card: { tag: `SATURATED FAT · ${whereTag}`, v: `${num(f.g)} g`, d: `WHO limit 22 g/din ka ~${f.pct}%`, bar: f.pct, foot: '2000 kcal reference diet' },
    mark: 'Saturated fat',
  }),
};
const lead = facts[0];
const HOOK = lead.kind === 'sugar'
  ? { show: [`${tspShow(lead.tsp)} chammach chini.`, `${whereShow[0].toUpperCase()}${whereShow.slice(1)}.`], say: `${whereSay}, ${lead.tsp} चम्मच चीनी।` }
  : lead.kind === 'oil'
    ? { show: [`${lead.tsp} chammach tel jitna fat.`, `${whereShow[0].toUpperCase()}${whereShow.slice(1)}.`], say: `${whereSay}, ${lead.tsp} चम्मच तेल जितना फैट।` }
    : lead.key === 'sodiumMg'
      ? { show: [`Din ke namak ka ${lead.pct}%.`, `${whereShow[0].toUpperCase()}${whereShow.slice(1)}.`], say: `${whereSay}, दिन भर के नमक का ${lead.pct} प्रतिशत।` }
      : { show: [`${num(lead.g)} g saturated fat.`, `${whereShow[0].toUpperCase()}${whereShow.slice(1)}.`], say: `${whereSay}, ${num(lead.g)} ग्राम सैचुरेटेड फैट।` };
const flagNames = [...new Set(flagged.map((i) => i.name.replace(/\s*\(.*\)$/, '').trim()))].slice(0, 3);
const LINES = {
  hook: { say: HOOK.say, show: '' },
  flip: { say: 'पीछे पलटो।', show: 'Peeche palto.' },
  ...Object.fromEntries(shown.map((f, k) => [`fact${k}`, FACT_LINE[f.kind](f)])),
  ing: flagNames.length
    ? { say: `ध्यान देने लायक: ${list(flagNames, 'और')}।`, show: `Dhyaan dene laayak: ${list(flagNames, 'aur')}.` }
    : { say: `सारे ${ings.length} ingredients ठीक।`, show: `Saare ${ings.length} ingredients theek.` },
  score: { say: `FoodGuard स्कोर: 100 में से ${score}। ${verdict}।`, show: '' },
  app: { say: 'हर ingredient का मतलब, app में।', show: '' },
  cta: { say: 'पहले चेक करो, फिर खरीदो। FoodGuard India, Play Store पर free।', show: '' },
};

// ---- 3. the work folder: the clip's frames, the voice, the app screen ----
const slug = `clip-${jobName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
const work = path.resolve(opt('--work') || path.join(HERE, slug));
const srcDir = path.join(work, 'src');
fs.mkdirSync(srcDir, { recursive: true });
const ffmpeg = () => require('ffmpeg-static');
const BUCKET = 'promo-clips';
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
console.log(`${name}: clip ${clipSeconds.toFixed(2)} s, score ${score} ${verdict}, facts: ${shown.map((f) => f.key).join(', ')}`);

// The voice: one file per line, silence trimmed off both ends. Without it
// (no Python locally, or the voice service down) the timing is estimated
// and the short is captions-only.
const voiceDir = path.join(work, 'voice');
const lineIds = Object.keys(LINES);
const secs = {};
let voiced = false;
if (!NO_VOICE) {
  try {
    fs.mkdirSync(voiceDir, { recursive: true });
    const spec = path.join(voiceDir, 'lines.json');
    fs.writeFileSync(spec, JSON.stringify({ voice: job.voice || 'hi-IN-SwaraNeural', rate: job.rate || '+12%', lines: lineIds.map((id) => LINES[id].say) }, null, 1));
    execFileSync(process.env.PYTHON || 'python3', [path.join(HERE, 'voice.py'), spec, voiceDir], { stdio: 'inherit' });
    const trim = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse';
    lineIds.forEach((id, i) => {
      const wav = path.join(voiceDir, `${id}.wav`);
      execFileSync(ffmpeg(), ['-y', '-v', 'error', '-i', path.join(voiceDir, `v${String(i).padStart(2, '0')}.mp3`), '-af', trim, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
      secs[id] = wavSeconds(fs.readFileSync(wav));
    });
    voiced = true;
  } catch (e) {
    console.log(`::warning title=No voice::the voiceover wasn't made (${String(e.message).split('\n')[0]}) -- captions only`);
  }
}
for (const id of lineIds) if (!voiced) secs[id] = 0.15 + 0.3 * (LINES[id].show || LINES[id].say).split(/\s+/).length;
function wavSeconds(buf) {
  for (let o = 12; o + 8 <= buf.length;) {
    const id = buf.toString('ascii', o, o + 4), size = buf.readUInt32LE(o + 4);
    if (id === 'data') return size / (44100 * 2);
    o += 8 + size + (size % 2);
  }
  return 0;
}

// ---- 4. the timeline ----
const clip = [];      // output time -> clip time
const cam = [];       // where the camera looks: a point in the clip, zoom, blur
const voice = [];     // when each line is spoken
const captions = [];  // the words on screen, a few at a time
const sfx = [];
const play = (t0, t1, s0, s1, { min = 0.75, max = 3 } = {}) => {
  const speed = (s1 - s0) / (t1 - t0);
  if (speed < min) { const tm = t0 + (s1 - s0) / min; clip.push({ t0, t1: tm, s0, s1 }, { t0: tm, t1, s0: s1, s1 }); }
  else clip.push({ t0, t1, s0, s1: speed > max ? s0 + (t1 - t0) * max : s1 });
};
const say = (id, t) => {
  voice.push({ id, t: r2(t), file: voiced ? `voice/${id}.wav` : null });
  // A unit or a dash stays with the word before it ("15.3 g", "fat —").
  const words = (LINES[id].show || '').split(/\s+/).filter(Boolean)
    .reduce((ws, w) => (ws.length && /^(g|mg|ml|kcal|—)[.,]?$/.test(w) ? [...ws.slice(0, -1), `${ws[ws.length - 1]} ${w}`] : [...ws, w]), []);
  if (!words.length) return;
  // Each word lights up as it is said: timed by its share of the line's letters.
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  let at = t, chunk = [];
  const push = () => { if (chunk.length) captions.push({ words: chunk }); chunk = []; };
  for (const w of words) {
    if (chunk.length >= 3 || chunk.reduce((n, [x]) => n + x.length + 1, 0) + w.length > 18) push();
    chunk.push([w, r2(at)]);
    at += (secs[id] * (w.length + 1)) / total;
  }
  push();
};
const box = (k) => job.label?.rows?.[k] || null;

// 4a. Hook: the front of the pack, the line from the first frame.
const [fr0, fr1] = job.front;
const hookEnd = round1(Math.max(1.8, 0.1 + secs.hook + 0.3));
play(0, hookEnd, fr0, fr1);
cam.push({ t: 0, x: 540, y: 960, z: 1.02 }, { t: hookEnd, x: 540, y: 960, z: 1.12 });
say('hook', 0.1);

// 4b. The turn, fast, into the frozen label.
const flipEnd = round1(hookEnd + Math.max(1.0, secs.flip + 0.25));
play(hookEnd, flipEnd, job.flip[0], job.label.at, { max: 3.2 });
cam.push({ t: hookEnd + 0.01, x: 540, y: 960, z: 1.12, blur: 3 }, { t: flipEnd - 0.05, x: 540, y: 960, z: 1.0, blur: 2 });
say('flip', hookEnd + 0.05);

// 4c. The label, frozen: the camera goes to each number in turn, it is
// boxed, and a card says what it means for the pack.
const marks = [], cards = [], spoons = [];
let t = flipEnd;
clip.push({ t0: flipEnd, t1: 0, s0: job.label.at, s1: job.label.at });
sfx.push({ t: flipEnd, kind: 's' });
const rowsBox = shown.map((f) => box(f.key)).filter(Boolean);
const tableX = rowsBox.length ? rowsBox.reduce((n, b) => n + b[0] + b[2] / 2, 0) / rowsBox.length + 60 : 540;
cam.push({ t: flipEnd, x: 540, y: 960, z: 1.0 });
t += 0.5;
shown.forEach((f, k) => {
  const id = `fact${k}`;
  const b = box(f.key);
  const dur = secs[id] + 0.5;
  const zoom = 2.2 + k * 0.15;
  if (b) cam.push({ t, x: tableX, y: b[1] + b[3] / 2 - 120, z: zoom }, { t: t + dur - 0.3, x: tableX, y: b[1] + b[3] / 2 - 110, z: zoom + 0.06 });
  else cam.push({ t, x: 540, y: 960, z: 1.1 }, { t: t + dur - 0.3, x: 540, y: 960, z: 1.14 });
  say(id, t + 0.1);
  if (b) { marks.push({ t0: round1(t + 0.15), t1: round1(t + dur), box: b, label: LINES[id].mark }); sfx.push({ t: round1(t + 0.15), kind: 'c' }); }
  const card = { ...LINES[id].card, t0: round1(t + 0.35), t1: round1(t + dur) };
  cards.push(card);
  if (card.spoons) for (let i = 0; i < card.spoons; i++) spoons.push(r2(t + 0.9 + i * 0.16));
  t += dur;
});
const labelEnd = round1(t);
clip[clip.length - 1].t1 = labelEnd;

// 4d. Down the ingredient list, the ones worth a look named as they're said.
const panEnd = round1(labelEnd + Math.max(2.2, secs.ing + 0.45));
play(labelEnd, panEnd, job.pan[0], Math.min(job.pan[1], clipSeconds - 0.04), { min: 0.8, max: 1.8 });
cam.push({ t: labelEnd, x: 540, y: 960, z: 1.0 }, { t: panEnd, x: 540, y: 960, z: 1.1 });
const capBefore = captions.length;
say('ing', labelEnd + 0.15);
const ingWords = captions.slice(capBefore).flatMap((c) => c.words);
const chips = flagNames.map((n) => {
  const first = n.split(/\s+/)[0].toLowerCase();
  const w = ingWords.find(([x]) => x.toLowerCase().replace(/[^a-z]/g, '') === first.replace(/[^a-z]/g, ''));
  return { t: w ? w[1] : labelEnd + 0.6, text: n };
});
chips.forEach((c) => sfx.push({ t: c.t, kind: 'c' }));

// 4e. The score, over the last frame, blurred.
const verdictEnd = round1(panEnd + Math.max(2.8, 0.35 + secs.score + 0.6));
clip.push({ t0: panEnd, t1: 9999, s0: clip[clip.length - 1].s1, s1: clip[clip.length - 1].s1 });
cam.push({ t: panEnd + 0.01, x: 540, y: 960, z: 1.1, blur: 0 }, { t: panEnd + 0.5, x: 540, y: 960, z: 1.25, blur: 22 });
say('score', panEnd + 0.35);

// 4f. The real app on a phone, then 4g. the end card with the QR code.
const APP_SECONDS = 5;
const app = PREVIEW && args.includes('--no-app') ? null : await captureAppScreen(row.id, name, work);
let ctaStart = verdictEnd;
const scenes = { hook: [0, hookEnd], label: [hookEnd, labelEnd], facts: [labelEnd, panEnd], verdict: [panEnd, verdictEnd] };
const transitions = [{ t: hookEnd, kind: 'zoom' }, { t: flipEnd, kind: 'push' }, { t: labelEnd, kind: 'push' }, { t: panEnd, kind: 'burst' }];
if (app) {
  ctaStart = round1(verdictEnd + APP_SECONDS);
  scenes.app = [verdictEnd, ctaStart];
  transitions.push({ t: verdictEnd, kind: 'push' });
  say('app', verdictEnd + 0.5);
}
const duration = Math.ceil(ctaStart + Math.max(4.5, 0.4 + secs.cta + 1.2));
scenes.cta = [ctaStart, duration];
transitions.push({ t: ctaStart, kind: 'wipe' });
say('cta', ctaStart + 0.4);
cam.push({ t: duration, x: 540, y: 960, z: 1.25, blur: 22 });
cam.sort((a, b) => a.t - b.t);
clip[clip.length - 1].t1 = duration;

const pickBy = (xs, salt) => xs[[...`${row.id}${salt}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % xs.length];
const TL = {
  _: `Made by shorts/clip.mjs from ${path.basename(jobFile)} and product ${row.id} (${name}). Facts from the pack's nutrition panel and ingredient list as saved in FoodGuard.`,
  duration, music: pickBy(['warm', 'bright', 'chill', 'pulse', 'lofi'], 'music'), musicGain: voiced ? 0.42 : 1,
  scenes, transitions, firstToken: hookEnd, tokenStep: 0, tokens: [], sfx, spoons,
  frames, clip, cam, freezeAt: flipEnd, marks, cards, chips, captions, voice,
  hook: HOOK.show, score, verdict,
  flaggedLine: flagged.length ? `${flagged.length} of ${ings.length} ingredients worth a closer look` : `All ${ings.length} ingredients check out`,
  cta: 'Pehle check karo.<br /><em>Phir khareedo.</em>',
  fine: `From the pack’s own nutrition panel${perPack ? ` (per 100 ${unit} × ${pack})` : ''} & ingredient list. WHO daily limits. General information, not medical advice.`,
  product: { id: row.id, name },
};
if (app) {
  TL.app = app;
  TL.appHeads = [
    'Score aur uski wajah,<br /><em>ek nazar mein.</em>',
    ...(app.marks.nutrition != null ? ['Chini, namak, fat —<br /><em>aasan bhasha mein.</em>'] : []),
    ...(app.marks.ingredients != null ? ['Har ingredient ka<br /><em>matlab, ek tap pe.</em>'] : []),
  ];
}
fs.writeFileSync(path.join(work, 'timeline.json'), JSON.stringify(TL, null, 1));
fs.copyFileSync(path.join(HERE, '_clip.html'), path.join(work, 'index.html'));
console.log(`timeline: ${duration} s${voiced ? ', voiced' : ', no voice'}${app ? ', app screen' : ''} -> ${work}`);
if (PREVIEW) process.exit(0);

// ---- 5. render, caption, hand over ----
if (path.dirname(work) !== HERE) fail('a video is rendered from promo/shorts/<name>/ (leave out --work)');
execFileSync(process.execPath, [path.join(HERE, 'build-short.cjs'), slug, String(duration)], { cwd: path.join(HERE, '..'), stdio: 'inherit' });
const caption = `${name} — ${HOOK.show.join(' ').replace(/\.$/, '')} 🔍

Pack palta, label padha${pack ? ` (${pack})` : ''}:
${shown.map((f) => `• ${FACT_LINE[f.kind](f).show}`).join('\n')}
${flagNames.length ? `🟠 Worth a closer look: ${flagNames.join(', ')}` : '✅ No ingredient flagged'}

FoodGuard ingredient score: ${score}/100 · ${verdict}

📲 Pehle check karo, phir khareedo — FoodGuard India, free on Google Play:
${PLAY_URL}

From the nutrition panel and ingredient list printed on the pack. WHO daily limits (saturated fat: 2000 kcal reference diet). General information, not medical advice.

#ReadTheLabel #FoodLabel #NutritionFacts #IndianSnacks #EatSmart #FoodGuardIndia
`;
fs.mkdirSync(OUT, { recursive: true });
const base = slug.replace(/^clip-/, '');
const mp4 = path.join(OUT, `${base}.mp4`);
fs.copyFileSync(path.join(HERE, '..', 'out', `${slug}.mp4`), mp4);
fs.writeFileSync(path.join(OUT, `${base}-caption.txt`), caption);
fs.rmSync(path.join(HERE, '..', 'out', `${slug}.mp4`), { force: true });
fs.rmSync(path.join(HERE, '..', 'out', `${slug}.wav`), { force: true });
// Also next to the clip, so it can be fetched without opening GitHub.
for (const [file, contentType] of [[mp4, 'video/mp4'], [path.join(OUT, `${base}-caption.txt`), 'text/plain; charset=utf-8']]) {
  const { error } = await supabase.storage.from(BUCKET).upload(`out/${path.basename(file)}`, fs.readFileSync(file), { contentType, upsert: true });
  console.log(error ? `::warning::${path.basename(file)} not saved to ${BUCKET}: ${error.message}` : `saved ${BUCKET}/out/${path.basename(file)}`);
}
console.log(`MADE: ${mp4}`);
