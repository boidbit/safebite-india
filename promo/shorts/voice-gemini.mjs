// promo/shorts/voice-gemini.mjs -- the voiceover of a clip short (shorts/clip.mjs)
// spoken by Gemini's text-to-speech (voice "Kore"): unlike the flat neural
// voices it can be told how to say each line -- amused, stunned, curious --
// and it does. Uses the same Gemini keys as the script (round-robin, so the
// free quota is shared out), no other service.
//
// A line may hold several sentences separated by "|": each is spoken on its
// own, so the video knows exactly when each one starts (the hook's big
// number lands on its word). Pure Node: the silence is trimmed and the audio
// resampled here, so nothing but the keys is needed.
//
//   const { secs, offsets } = await geminiVoice([{ id: 'hook', text: 'एक पैकेट।|…', style: ['…', '…'] }], dir)
//   -> <dir>/<id>.wav (mono 16-bit, 44.1 kHz); secs[id] its length; offsets[id][i] where sentence i starts in it
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { callGeminiRaw } from '../../src/services/geminiService.js';

export const TTS_MODEL = 'gemini-3.8-flash-tts';
// Each TTS model has its own free daily quota: when the first is used up (error.quota), the whole video is re-voiced with this one.
export const TTS_FALLBACK = 'gemini-3.1-flash-tts-preview';
export const TTS_VOICE = 'Kore';
const OUT_RATE = 44100;
const GAP = 0.14; // seconds of silence between the sentences of one line
const TEMPO = 1.2; // the voice speaks slowly; sped up this much without changing its pitch
const DIRECT = 'Speak in natural spoken Hindi (Hinglish words as an Indian reel creator says them). You are a young Indian woman on Instagram Reels, ';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** One sentence -> mono float samples at OUT_RATE, silence trimmed off both ends. */
async function speak(text, style, { model, voice, cache }) {
  const prompt = `${DIRECT}${style} Brisk pace, not like a news reader. Say: ${text}`;
  // A take already made for exactly this text, direction and voice is reused: the same
  // take in the preview and in the render, and no second use of the free quota.
  const key = createHash('sha1').update([model, voice, prompt].join('\n')).digest('hex').slice(0, 24);
  const cached = await cache?.get(key).catch(() => null);
  if (cached) return Float32Array.from({ length: cached.length >> 1 }, (_, i) => cached.readInt16LE(i * 2) / 32768);
  const take = await record(text, prompt, { model, voice });
  const pcm = Buffer.alloc(take.length * 2);
  take.forEach((v, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  await cache?.put(key, pcm).catch(() => {});
  return take;
}

async function record(text, prompt, { model, voice }) {
  // The model now and then runs on past the sentence (speaks 10 s for 2 words): a take
  // longer than the words can take is thrown away and asked for again.
  const limit = 1.0 + 0.55 * text.split(/\s+/).length;
  let last = 'no audio';
  let shortest = null;
  let quotaHits = 0;
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      const d = await callGeminiRaw({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }, model);
      const part = d.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (part) {
        const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
        const take = trim(resample(pcmToFloat(Buffer.from(part.inlineData.data, 'base64')), rate, OUT_RATE), OUT_RATE);
        if (take.length / OUT_RATE <= limit) return take;
        if (!shortest || take.length < shortest.length) shortest = take;
        last = `a ${(take.length / OUT_RATE).toFixed(1)} s take for ${text.split(/\s+/).length} words`;
        continue;
      }
      last = `no audio (${d.candidates?.[0]?.finishReason || 'empty answer'})`;
    } catch (e) {
      last = String(e.message || e).split('\n')[0].slice(0, 160);
      // Every key is out of quota: once more after a pause (a per-minute limit passes),
      // then give up on this model -- the free tier's daily cap does not.
      if (/quota/i.test(last) && ++quotaHits >= 2) throw Object.assign(new Error(last), { quota: true });
      await wait(/quota/i.test(last) ? 20000 : 3000 + attempt * 2000); // rate-limit blips pass in a few seconds
    }
    await wait(500);
  }
  // Never a clean take: the shortest one, if it is not wildly long.
  if (shortest && shortest.length / OUT_RATE <= limit * 1.6) return shortest;
  throw new Error(`Gemini voice failed: ${last}`);
}

const pcmToFloat = (buf) => Float32Array.from({ length: buf.length >> 1 }, (_, i) => buf.readInt16LE(i * 2) / 32768);

function resample(x, from, to) {
  if (from === to) return x;
  const out = new Float32Array(Math.floor((x.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from) / to, i0 = Math.floor(p), f = p - i0;
    out[i] = x[i0] * (1 - f) + (x[Math.min(i0 + 1, x.length - 1)] ?? 0) * f;
  }
  return out;
}

/** Cut the quiet off both ends (a little room kept), judged against the line's own peak. */
function trim(x, rate) {
  const win = Math.round(rate * 0.01);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const thr = Math.max(0.01, peak * 0.04);
  const loud = (w) => { for (let i = w * win; i < Math.min(x.length, (w + 1) * win); i++) if (Math.abs(x[i]) > thr) return true; return false; };
  const n = Math.ceil(x.length / win);
  let a = 0, b = n - 1;
  while (a < b && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  const from = Math.max(0, (a - 4) * win), to = Math.min(x.length, (b + 9) * win);
  const y = x.slice(from, to);
  const fade = Math.round(rate * 0.006); // no click at the cut
  for (let i = 0; i < Math.min(fade, y.length); i++) { y[i] *= i / fade; y[y.length - 1 - i] *= i / fade; }
  return y;
}

/**
 * Speed `x` up by `speed` without raising its pitch (WSOLA): short windows are
 * laid over each other, each taken from where it best continues the last one.
 */
function stretch(x, speed, rate) {
  if (speed === 1 || x.length < rate) return x;
  const N = Math.round(rate * 0.032), Hs = N >> 1, Ha = Hs * speed, tol = Math.round(rate * 0.012);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); // Hann: half-overlapped, it sums to 1
  const y = new Float32Array(Math.ceil(x.length / speed) + 2 * N);
  for (let i = 0; i < N; i++) y[i] += x[i] * win[i];
  let prev = 0, k = 1;
  for (;; k++) {
    const target = Math.round(k * Ha);
    if (target + N + tol >= x.length) break;
    const ref = prev + Hs; // where the last window would carry on
    let best = target, bestScore = -Infinity;
    for (let c = Math.max(0, target - tol); c <= target + tol; c += 2) {
      let s = 0;
      for (let i = 0; i < N; i += 4) s += x[ref + i] * x[c + i];
      if (s > bestScore) { bestScore = s; best = c; }
    }
    for (let i = 0; i < N; i++) y[k * Hs + i] += x[best + i] * win[i];
    prev = best;
  }
  return y.slice(0, (k - 1) * Hs + N);
}

function wavFile(x, rate) {
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/**
 * @param {{ id: string, text: string, style: string | string[] }[]} lines
 * @returns {Promise<{ secs: Record<string, number>, offsets: Record<string, number[]> }>}
 */
export async function geminiVoice(lines, dir, { model = TTS_MODEL, voice = TTS_VOICE, tempo = TEMPO, cache = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const secs = {}, offsets = {};
  for (const line of lines) {
    const parts = line.text.split('|').map((s) => s.trim()).filter(Boolean);
    const pieces = [];
    for (const [i, text] of parts.entries()) {
      pieces.push(stretch(await speak(text, Array.isArray(line.style) ? line.style[i] ?? line.style[line.style.length - 1] : line.style, { model, voice, cache }), tempo, OUT_RATE));
    }
    const gap = Math.round(OUT_RATE * GAP);
    const all = new Float32Array(pieces.reduce((n, p) => n + p.length, 0) + gap * (pieces.length - 1));
    offsets[line.id] = [];
    let at = 0;
    pieces.forEach((p, i) => { offsets[line.id].push(Math.round((at / OUT_RATE) * 100) / 100); all.set(p, at); at += p.length + gap; });
    fs.writeFileSync(path.join(dir, `${line.id}.wav`), wavFile(all, OUT_RATE));
    secs[line.id] = all.length / OUT_RATE;
  }
  return { secs, offsets };
}
