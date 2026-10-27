// promo/shorts/clip-script.mjs -- the words of a clip short (shorts/clip.mjs):
// written fresh for each product by Gemini, in casual Hinglish, but held to
// the facts.
//
// Gemini never sees or writes a number. It gets the beats to fill and the
// facts as placeholders ({pack_tsp}, {sat_pct}, {score} ...) and writes
// sentences around them; the code puts the real values in. Then every line
// is checked: no digits of its own, only known placeholders, the ones each
// beat must carry, short enough to say in its slot, and none of the words a
// public video about a real brand must not use ("harmful", "zeher",
// "jhooth" ...). Three tries, then the hand-written template below.
//
// Each line comes back as { show, say, sticker? }: show is Hinglish in
// Roman letters (the captions; *one word* may be starred for emphasis), say
// is the same sentence in Hindi script for the voice.
import { callGemini } from '../../src/services/geminiService.js';

// What a line may never say -- English, Hinglish and Hindi script.
const BANNED = /\b(harm(ful)?|toxic|poison|cancer|deadly|danger(ous)?|unhealthy|junk|avoid|never eat|kill(er|s)?|disease|heart attack|diabetes|obes(e|ity)|cheat(ing)?|scam|fraud|lie|lying|liar|fake|zeher|zahar|khatarnak|bimari|beemari|maut|dhokha|jhoo?th|loot|mat khao|band karo|bekaar|ganda)\b|ज़?हर|ख़?तरनाक|बीमारी|कैंसर|मौत|धोखा|झूठ|लूट|मत खाओ|जानलेवा|बेकार|गंदा/i;

const HOOKS = {
  serving: 'The label says one serving is {serving_g}. Hook: point that out; tease: ask who really stops at {serving_g} (people eat the whole pack). Do not reveal the teaspoons yet.',
  guess: 'Hook: ask the viewer to guess how many teaspoons of {lead_word} one pack holds. Tease: offer a couple of guesses as words ("ek? do?"), no answer yet.',
  pov: 'Hook: a POV opener -- finishing the whole pack in one sitting (with a movie, after school, at the office). Tease: "but what did the label say?"',
  pass: 'This product scores well. Hook: "does this label pass?"; tease: "let\'s read it".',
};

const BEAT_RULES = {
  hook: 'opens the video, a sticker + one spoken line',
  tease: 'second line over the front of the pack, a sticker + one spoken line',
  turn: 'the pack is turned over; 2-5 words that lead into the reveal (ends with "…")',
  fat: 'the reveal: must contain {pack_tsp} -- teaspoons of oil the fat in the whole pack equals ("chammach tel jitna fat")',
  sugar: 'the reveal: must contain {sugar_tsp} -- teaspoons of added sugar in the whole pack',
  serving: 'one serving vs the whole pack: must contain {serving_tsp} and {pack_tsp}',
  satfat: 'must contain {sat_pct} -- the share of the daily saturated-fat limit in one pack',
  sodium: 'must contain {sodium_pct} -- the share of the daily sodium limit in one pack',
  ing: 'the ingredient list: must contain {named} (the ones worth a closer look)',
  scan: 'about to scan the barcode with the app; 3-6 words',
  score: 'must contain {score}, {verdict} and {advice}; {advice} is the app\'s own answer to "khaayein?" and is used as that answer, e.g. "… Khaayein? {advice}."',
  app: 'the app on screen: every ingredient explained; short',
  cta: 'end: check your own pack with FoodGuard India, it is free; short',
};
const REQUIRED = { hook: [], tease: [], turn: [], fat: ['pack_tsp'], sugar: ['sugar_tsp'], serving: ['serving_tsp', 'pack_tsp'], satfat: ['sat_pct'], sodium: ['sodium_pct'], ing: ['named'], scan: [], score: ['score', 'verdict', 'advice'], app: [], cta: [] };

// The template: used when Gemini can't be reached or none of its tries pass.
const TEMPLATE = {
  hook: {
    serving: { sticker: 'Serving: sirf {serving_g}', show: 'Packet kehta hai: ek serving sirf {serving_g}.', say: 'पैकेट कहता है: एक सर्विंग सिर्फ़ {serving_g}।' },
    guess: { sticker: 'Guess karo!', show: 'Is pack mein kitne chammach {lead_word}?', say: 'इस पैक में कितने चम्मच {lead_word}?' },
    pov: { sticker: 'POV: poora pack khatam', show: 'Movie khatam, pack bhi khatam.', say: 'मूवी ख़त्म, पैक भी ख़त्म।' },
    pass: { sticker: 'Label pass ya fail?', show: 'Ye label pass hoga ya nahi?', say: 'ये लेबल पास होगा या नहीं?' },
  },
  tease: {
    serving: { sticker: 'Aap kitna khaate ho?', show: 'Par sach batao… {serving_g} pe kaun rukta hai?', say: 'पर सच बताओ… {serving_g} पे कौन रुकता है?' },
    guess: { sticker: 'Ek? Do? Teen?', show: 'Ek? Do? Ya usse bhi zyada?', say: 'एक? दो? या उससे भी ज़्यादा?' },
    pov: { sticker: 'Label kya kehta hai?', show: 'Par label ne kya bataya?', say: 'पर लेबल ने क्या बताया?' },
    pass: { sticker: 'Chalo padhte hain', show: 'Chalo, peeche ka label padhte hain.', say: 'चलो, पीछे का लेबल पढ़ते हैं।' },
  },
  turn: { show: 'Poora pack khao, to…', say: 'पूरा पैक खाओ, तो…' },
  fat: { show: '…lagbhag *{pack_tsp}* chammach tel jitna fat.', say: '…लगभग {pack_tsp} चम्मच तेल जितना फैट।' },
  sugar: { show: '…lagbhag *{sugar_tsp}* chammach chini.', say: '…लगभग {sugar_tsp} चम्मच चीनी।' },
  serving: { show: 'Ek serving: {serving_tsp} chammach. Poora pack: *{pack_tsp}*.', say: 'एक सर्विंग: {serving_tsp} चम्मच। पूरा पैक: {pack_tsp}।' },
  satfat: { show: 'Saturated fat? Din bhar ki limit ka *{sat_pct}*… ek hi pack mein.', say: 'सैचुरेटेड फैट? दिन भर की लिमिट का {sat_pct}… एक ही पैक में।' },
  sodium: { show: 'Namak? Din bhar ki limit ka *{sodium_pct}*.', say: 'नमक? दिन भर की लिमिट का {sodium_pct}।' },
  ing: { show: 'Label pe dhyaan dene laayak: {named}.', say: 'लेबल पे ध्यान देने लायक: {named}।' },
  scan: { show: 'Ab scan karke dekhte hain.', say: 'अब स्कैन करके देखते हैं।' },
  score: { show: 'FoodGuard score: *{score}*, {verdict}. Khaayein? {advice}.', say: 'FoodGuard स्कोर: {score}, {verdict}। खाएं? {advice}।' },
  app: { show: 'Har ingredient ka matlab, ek tap pe.', say: 'हर इंग्रेडिएंट का मतलब, एक टैप पे।' },
  cta: { show: 'Apna packet khud check karo. FoodGuard India, free hai.', say: 'अपना पैकेट ख़ुद चेक करो। FoodGuard India, फ़्री है।' },
};

const placeholders = (s) => [...String(s || '').matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);

/** Problems with one line, [] when it passes. */
export function checkLine(beat, line, known) {
  const bad = [];
  if (!line || typeof line.show !== 'string' || typeof line.say !== 'string') return ['missing show/say'];
  for (const k of ['show', 'say', 'sticker']) {
    const s = line[k];
    if (s == null) continue;
    if (/[0-9०-९]/.test(s.replace(/\{[a-z_]+\}/g, ''))) bad.push(`${k} has its own number`);
    if (BANNED.test(s)) bad.push(`${k} uses a banned word`);
    for (const p of placeholders(s)) if (!known.has(p)) bad.push(`${k} uses unknown {${p}}`);
  }
  for (const p of REQUIRED[beat] || []) {
    if (!placeholders(line.show).includes(p)) bad.push(`show lacks {${p}}`);
    if (!placeholders(line.say).includes(p)) bad.push(`say lacks {${p}}`);
  }
  if (line.show.replace(/\{[a-z_]+\}/g, 'x').split(/\s+/).length > 13) bad.push('show is too long');
  if (!/[ऀ-ॿ]/.test(line.say)) bad.push('say is not in Hindi script');
  if ((beat === 'hook' || beat === 'tease') && (!line.sticker || line.sticker.replace(/\{[a-z_]+\}/g, 'xxxx').length > 26)) bad.push('sticker missing or too long');
  return bad;
}

/**
 * @param {{ product: string, brand: string, pack: string, foodType: string, hookType: string, beats: string[], values: Record<string, string> }} facts
 *   values: placeholder -> how it reads on screen (the voice gets valuesSay)
 * @returns {Promise<{ lines: Record<string, {show: string, say: string, sticker?: string}>, source: string, tries: string[] }>}
 *   lines still hold their placeholders
 */
export async function writeScript(facts, { useAi = true } = {}) {
  const known = new Set(Object.keys(facts.values));
  const template = () => Object.fromEntries(facts.beats.map((b) => [b, TEMPLATE[b][facts.hookType] || TEMPLATE[b]]));
  const tries = [];
  if (useAi) {
    const prompt = `You write the voiceover for a 25-second YouTube Short / Instagram Reel for FoodGuard India, an app that reads Indian food labels.
The video: a real phone clip of someone holding "${facts.product}" by ${facts.brand} (${facts.pack}, ${facts.foodType}), turning it over to the label, then scanning its barcode in the app.

Write one line for each beat, in this order: ${facts.beats.join(', ')}.
${facts.beats.map((b) => `- ${b}: ${BEAT_RULES[b]}`).join('\n')}
Hook style: ${HOOKS[facts.hookType]}

Facts are placeholders -- use them exactly as written, never write a number yourself (no digits at all):
${[...known].map((k) => `{${k}} = ${facts.values[k]}`).join('\n')}

Tone: how a friend talks to you in Hinglish -- short, punchy, a little playful, a question now and then, "aap"/"tum" allowed. Not a news reader, not a lecture. Natural grammar ("label kehta hai", "pack mein").
The tone, for a different product with a "guess" hook (do not reuse these words):
  hook [Kitni chini? Guess karo] "Is chhoti si bottle mein kitni chini?"
  tease [Ek? Do? Teen?] "Ek chammach? Do? Ya usse bhi zyada?"
  turn "Chalo, peeche dekhte hain…"
  sugar "Poori bottle mein *{sugar_tsp}* chammach chini!"
  score "FoodGuard score {score}, {verdict}. Roz peeyein? {advice}."
  cta "Apni bottle khud scan karo, FoodGuard free hai."
Rules: only these facts; neutral about the brand -- no insults, no "harmful", "unhealthy", "junk", "avoid", "zeher", "jhooth", "dhokha", no health or disease claims, no emoji.
Each line: "show" = Hinglish in Roman letters, at most 12 words, you may wrap ONE key word in *stars*; "say" = the very same sentence in Hindi (Devanagari) script for a Hindi text-to-speech voice (English product words like Palmolein may stay in Roman). hook and tease also get a "sticker": 2-5 words, at most 24 letters, for a big on-screen sticker.

Reply with JSON only: {"lines": {"${facts.beats[0]}": {"sticker": "...", "show": "...", "say": "..."}, ...}}`;
    // Each retry is told what was wrong with the last answer. The best answer
    // seen is kept: if no try passes whole, its passing lines are used and
    // only the failing ones come from the template.
    let feedback = '';
    let best = null;
    for (let i = 0; i < 4; i++) {
      try {
        const { text } = await Promise.race([
          callGemini({ contents: [{ parts: [{ text: prompt + feedback }] }], generationConfig: { temperature: 0.9, responseMimeType: 'application/json' } }),
          new Promise((_, no) => setTimeout(() => no(new Error('Gemini took over 45 s')), 45000)),
        ]);
        const lines = JSON.parse(String(text).replace(/^```(json)?|```$/g, '').trim()).lines || {};
        const problems = facts.beats.flatMap((b) => checkLine(b, lines[b], known).map((p) => `${b}: ${p}`));
        if (!problems.length) return { lines: Object.fromEntries(facts.beats.map((b) => [b, lines[b]])), source: 'gemini', tries };
        tries.push(problems.slice(0, 4).join('; '));
        const passing = facts.beats.filter((b) => !checkLine(b, lines[b], known).length);
        if (!best || passing.length > best.passing.length) best = { lines, passing };
        feedback = `\n\nYour last answer was rejected: ${problems.join('; ')}.\nFix exactly these. Remember: not a single digit outside the {placeholders} (write {serving_g}, never the number), and every "say" in Devanagari script.`;
      } catch (e) {
        tries.push(String(e.message || e).split('\n')[0].slice(0, 120));
        // "high demand" and quota blips pass in a few seconds.
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    // Mostly right: keep Gemini's passing lines, the template fills the rest.
    if (best && best.passing.length >= facts.beats.length * 0.7) {
      const t = template();
      return { lines: Object.fromEntries(facts.beats.map((b) => [b, best.passing.includes(b) ? best.lines[b] : t[b]])), source: `gemini (${facts.beats.filter((b) => !best.passing.includes(b)).join(', ')} from the template)`, tries };
    }
  }
  return { lines: template(), source: 'template', tries };
}

/** A line with its placeholders filled: show for the captions, say for the voice. */
export function fill(line, values, valuesSay) {
  const put = (s, v) => String(s || '').replace(/\{([a-z_]+)\}/g, (_, k) => v[k] ?? '');
  return { show: put(line.show, values), say: put(line.say, valuesSay), sticker: line.sticker ? put(line.sticker, values) : undefined };
}
