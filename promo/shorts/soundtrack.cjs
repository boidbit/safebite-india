// promo/shorts/soundtrack.cjs -- the music and sound effects for a short,
// synthesized from scratch (no samples, no licensed tracks) and timed from the
// same promo/shorts/<name>/timeline.json the picture uses, so every tick,
// whoosh and hit lands on its frame.
//
//   node shorts/soundtrack.cjs winkin-cold-coffee     -> out/winkin-cold-coffee.wav
//
// Bed: A-minor pad (Am F C G), bass, kick/hat/clap. Effects: a bright "ting"
// as a fine ingredient lights up, a low "bloop" for one worth a closer look,
// whooshes on transitions, spoon clinks, a riser into the verdict and an
// impact on it, a sparkle on the call to action.
const fs = require('fs');
const path = require('path');

const name = process.argv[2];
if (!name) { console.error('usage: node shorts/soundtrack.cjs <name>'); process.exit(1); }
const TL = JSON.parse(fs.readFileSync(path.join(__dirname, name, 'timeline.json'), 'utf8'));
const SR = 44100;
const N = Math.ceil(TL.duration * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const sendL = new Float32Array(N), sendR = new Float32Array(N); // reverb send
const BEAT = 60 / TL.bpm;
const TAU = Math.PI * 2;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

function add(t0, len, fn, { gain = 1, pan = 0, send = 0 } = {}) {
  const s0 = Math.max(0, Math.floor(t0 * SR));
  const s1 = Math.min(N, Math.floor((t0 + len) * SR));
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let s = s0; s < s1; s++) {
    const t = (s - s0) / SR;
    const v = fn(t, len);
    L[s] += v * gl; R[s] += v * gr;
    if (send) { sendL[s] += v * gl * send; sendR[s] += v * gr * send; }
  }
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

// ---- instruments ----
function pad(t0, len, notes, gain) {
  for (const [k, m] of notes.entries()) {
    for (const det of [-0.12, 0.12]) {
      const f = midi(m) * Math.pow(2, det / 12);
      add(t0, len + 0.8, (t, l) => {
        const a = Math.min(1, t / 0.6) * Math.min(1, Math.max(0, (l - t) / 0.8));
        return a * (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * 2 * f * t) + 0.12 * Math.sin(TAU * 3 * f * t));
      }, { gain: gain / 6, pan: (k - 1) * 0.35 + det, send: 0.5 });
    }
  }
}
const bass = (t0, m, gain) => add(t0, BEAT * 1.8, (t) => env(t, 0.01, 0.35) * (Math.sin(TAU * midi(m) * t) + 0.4 * Math.sin(TAU * 2 * midi(m) * t)), { gain });
const kick = (t0, gain = 0.9, decay = 0.28, low = 45) => add(t0, decay * 3, (t) => {
  const f = low + 75 * Math.exp(-t / 0.035);
  return Math.exp(-t / decay) * Math.sin(TAU * f * t * (1 + t * 2));
}, { gain });
function noiseHit(t0, len, decay, cutoff, gain, pan = 0, hp = false) {
  let y = 0, prev = 0;
  const a = 1 - Math.exp(-TAU * cutoff / SR);
  add(t0, len, (t) => { const x = rnd(); y += a * (x - y); const out = hp ? x - y : y; prev = x; return Math.exp(-t / decay) * out; }, { gain, pan, send: 0.15 });
}
const hat = (t0) => noiseHit(t0, 0.08, 0.025, 7000, 0.18, 0.3, true);
const clap = (t0) => { for (const d of [0, 0.012, 0.024]) noiseHit(t0 + d, 0.25, 0.09, 2200, 0.22, -0.2); };
const ting = (t0) => add(t0, 0.9, (t) => env(t, 0.003, 0.22) * (Math.sin(TAU * 1318.5 * t) + 0.45 * Math.sin(TAU * 2637 * t) + 0.2 * Math.sin(TAU * 3955 * t)), { gain: 0.22, pan: 0.25, send: 0.55 });
const bloop = (t0) => add(t0, 0.5, (t) => {
  const f = 330 - 120 * Math.min(1, t / 0.18);
  const tri = (2 / Math.PI) * Math.asin(Math.sin(TAU * f * t));
  return env(t, 0.004, 0.16) * tri;
}, { gain: 0.32, pan: -0.25, send: 0.3 });
const clink = (t0) => add(t0, 0.6, (t) => env(t, 0.001, 0.12) * (Math.sin(TAU * 2450 * t) + 0.7 * Math.sin(TAU * 3720 * t) + 0.5 * Math.sin(TAU * 5180 * t)), { gain: 0.16, pan: 0.4, send: 0.6 });
function whoosh(tc, len = 0.75, gain = 0.5) {
  let y = 0; const t0 = tc - len * 0.55;
  add(t0, len, (t, l) => {
    const p = t / l;
    const cutoff = 300 + 5200 * Math.sin(Math.PI * p);
    const a = 1 - Math.exp(-TAU * cutoff / SR);
    y += a * (rnd() - y);
    return Math.sin(Math.PI * p) ** 2 * y;
  }, { gain, pan: 0, send: 0.35 });
}
function riser(t0, t1) {
  let y = 0;
  add(t0, t1 - t0, (t, l) => {
    const p = t / l;
    const a = 1 - Math.exp(-TAU * (400 + 6000 * p * p) / SR);
    y += a * (rnd() - y);
    const tone = Math.sin(TAU * (180 * t + 500 * t * t / l));
    return p * p * (0.8 * y + 0.35 * tone);
  }, { gain: 0.45, send: 0.4 });
}
function impact(t0) {
  kick(t0, 1.2, 0.7, 32);
  noiseHit(t0, 2.2, 0.8, 5000, 0.55);
  add(t0, 2.5, (t) => Math.exp(-t / 1.1) * Math.sin(TAU * 55 * t), { gain: 0.5 });
}
function sparkle(t0) {
  [81, 84, 88, 93, 96].forEach((m, i) => add(t0 + i * 0.09, 1.2, (t) => env(t, 0.004, 0.35) * (Math.sin(TAU * midi(m) * t) + 0.3 * Math.sin(TAU * 2 * midi(m) * t)), { gain: 0.14, pan: -0.4 + i * 0.2, send: 0.7 }));
}

// ---- arrangement ----
const S = TL.scenes;
const drumsOn = (t) => (t >= S.label[0] && t < S.facts[1] - 0.6) || (t >= S.verdict[0] && t < S.cta[0]);
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const BAR = BEAT * 4;
for (let bar = 0; bar * BAR < TL.duration; bar++) {
  const t0 = bar * BAR;
  const ch = CHORDS[bar % 4];
  const quiet = t0 >= S.facts[1] - 1.5 && t0 < S.verdict[0];
  pad(t0, BAR, ch.map((m) => m + 12), quiet ? 0.18 : 0.32);
  for (let b = 0; b < 4; b++) {
    const tb = t0 + b * BEAT;
    if (tb >= TL.duration) break;
    if (tb >= S.label[0] - 0.01 && !(tb >= S.facts[1] - 0.6 && tb < S.verdict[0])) bass(tb, ch[0] - 12, b % 2 === 0 ? 0.35 : 0.22);
    if (drumsOn(tb)) {
      kick(tb, b === 0 ? 0.85 : 0.65);
      hat(tb + BEAT / 2);
      if (b % 2 === 1 && tb > TL.firstToken) clap(tb);
    }
  }
}
// The hook: a soft pulse before the beat drops.
for (let tb = 0.4; tb < S.hook[1] - 0.3; tb += BEAT) add(tb, 0.4, (t) => env(t, 0.01, 0.12) * Math.sin(TAU * 110 * t), { gain: 0.25 });

TL.tokens.forEach(([, kind], i) => (kind === 'c' ? bloop : ting)(TL.firstToken + i * TL.tokenStep));
for (const tr of TL.transitions) {
  if (tr.kind === 'burst') continue; // the impact covers it
  whoosh(tr.t, tr.kind === 'zoom' ? 0.9 : 0.7, tr.kind === 'wipe' ? 0.45 : 0.55);
}
TL.spoons.forEach(clink);
riser(S.verdict[0] - 1.6, S.verdict[0]);
impact(S.verdict[0]);
ting(S.verdict[0] + 0.9); ting(S.verdict[0] + 0.95);
sparkle(S.cta[0] + 0.7);

// ---- reverb (a few feedback delays on the send), master ----
for (const [buf, out, offs] of [[sendL, L, [0.031, 0.047, 0.073, 0.101]], [sendR, R, [0.037, 0.053, 0.067, 0.113]]]) {
  for (const d of offs) {
    const D = Math.floor(d * SR);
    const line = new Float32Array(N);
    for (let s = 0; s < N; s++) {
      line[s] = buf[s] + (s >= D ? line[s - D] * 0.55 : 0);
      out[s] += line[s] * 0.12;
    }
  }
}
const fadeOut = 1.6;
let peak = 0;
for (let s = 0; s < N; s++) {
  const t = s / SR;
  const g = Math.min(1, t / 0.05) * Math.min(1, (TL.duration - t) / fadeOut);
  L[s] = Math.tanh(L[s] * g * 1.1); R[s] = Math.tanh(R[s] * g * 1.1);
  peak = Math.max(peak, Math.abs(L[s]), Math.abs(R[s]));
}
const norm = 0.89 / (peak || 1);

const data = Buffer.alloc(N * 4);
for (let s = 0; s < N; s++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[s] * norm)) * 32767), s * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[s] * norm)) * 32767), s * 4 + 2);
}
const head = Buffer.alloc(44);
head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22);
head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 4, 28); head.writeUInt16LE(4, 32); head.writeUInt16LE(16, 34);
head.write('data', 36); head.writeUInt32LE(data.length, 40);
const out = path.join(__dirname, '..', 'out', `${name}.wav`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, data]));
console.log(`wrote ${out} (${TL.duration}s)`);
