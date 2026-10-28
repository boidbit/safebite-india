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
import { callGeminiRaw } from '../../src/services/geminiService.js';

// The script is written once per video, so a stronger model than the app's lite one.
const SCRIPT_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];

// What a line may never say -- English, Hinglish and Hindi script.
const BANNED = /\b(harm(ful)?|toxic|poison|cancer|deadly|danger(ous)?|unhealthy|junk|avoid|never eat|kill(er|s)?|disease|heart attack|diabetes|obes(e|ity)|cheat(ing)?|scam|fraud|lie|lying|liar|fake|zeher|zahar|khatarnak|bimari|beemari|maut|dhokha|jhoo?th|loot|mat khao|band karo|bekaar|ganda)\b|ज़?हर|ख़?तरनाक|बीमारी|कैंसर|मौत|धोखा|झूठ|लूट|मत खाओ|जानलेवा|बेकार|गंदा/i;

const HOOKS = {
  shock: 'The hook is already written (fixed, not yours): the whole pack holds {pack_tsp} chammach of {lead_word}, "and you finish the whole pack". Do not write hook or tease.',
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
  serving: 'one serving vs the whole pack: must contain {serving_g}, {serving_tsp} and {pack_tsp} -- say which is which ("ek serving ({serving_g}) mein ..., poore {pack_word} mein ...")',
  satfat: 'must contain {sat_pct} -- the share of the DAY limit of saturated fat in one pack; say "din" (din ki limit) so it is clear it is a daily limit',
  sodium: 'must contain {sodium_pct} -- the share of the DAY limit of sodium in one pack; say "din" (din ki limit) so it is clear it is a daily limit',
  sugarpct: 'must contain {sugar_pct} -- the share of the DAY limit of added sugar in one {pack_word}; say "din" (din ki limit) so it is clear it is a daily limit',
  ing: 'the ingredient list: must contain {named} (the ones worth a closer look)',
  scan: 'about to scan the barcode with the app; 3-6 words',
  score: 'must contain {score}, {verdict}, {ask} and {advice}; {advice} is the app\'s own answer to "{ask}?" and is used as that answer, e.g. "… {ask}? {advice}."',
  app: 'the app on screen: every ingredient explained; short',
  cta: 'end: check your own pack with FoodGuard India, it is free; short',
};
const SHOCK_RULES = {
  turn: 'right after the hook: turn the pack to the label to check it; 3-6 words, ends with "…"',
  fat: 'the proof for the hook: the label gives {lead_g} of fat in the whole pack, which is the {pack_tsp} chammach tel -- must contain {lead_g} and {pack_tsp}',
  sugar: 'the proof for the hook: the label gives {lead_g} of added sugar in the whole pack, which is the {sugar_tsp} chammach chini -- must contain {lead_g} and {sugar_tsp}',
};
const REQUIRED = { hook: [], tease: [], turn: [], fat: ['pack_tsp'], sugar: ['sugar_tsp'], serving: ['serving_g', 'serving_tsp', 'pack_tsp'], satfat: ['sat_pct'], sodium: ['sodium_pct'], sugarpct: ['sugar_pct'], ing: ['named'], scan: [], score: ['score', 'verdict', 'advice', 'ask'], app: [], cta: [] };

// The template: used when Gemini can't be reached or none of its tries pass.
const TEMPLATE = {
  hook: {
    // Three sentences, spoken one by one ("|"): the video times its big number to the second.
    shock: { show: 'Ek {pack_word}. *{pack_tsp}* chammach {lead_word}. Aur aap {whole} {eat} jaate ho.', say: 'एक {pack_word}।|{pack_tsp} चम्मच {lead_word}।|और आप {whole} {eat} जाते हो।' },
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
  turn: { show: 'Chalo, label padhte hain…', say: 'चलो, लेबल पढ़ते हैं…' },
  fat: {
    shock: { show: 'Label dekho: {in_whole} *{lead_g}* fat. Yaani {pack_tsp} chammach tel.', say: 'लेबल देखो: {in_whole} {lead_g} फैट। यानी {pack_tsp} चम्मच तेल।' },
    show: '…lagbhag *{pack_tsp}* chammach tel jitna fat.', say: '…लगभग {pack_tsp} चम्मच तेल जितना फैट।',
  },
  sugar: {
    shock: { show: 'Label dekho: {in_whole} *{lead_g}* added sugar. Yaani {sugar_tsp} chammach chini.', say: 'लेबल देखो: {in_whole} {lead_g} एडेड शुगर। यानी {sugar_tsp} चम्मच चीनी।' },
    show: '…lagbhag *{sugar_tsp}* chammach chini.', say: '…लगभग {sugar_tsp} चम्मच चीनी।',
  },
  serving: { show: 'Ek serving ({serving_g}) mein {serving_tsp} chammach. {in_whole} *{pack_tsp}*!', say: 'एक सर्विंग ({serving_g}) में {serving_tsp} चम्मच। {in_whole} {pack_tsp}!' },
  satfat: { show: 'Saturated fat? Din ki limit ka *{sat_pct}*… ek hi {pack_word} mein.', say: 'सैचुरेटेड फैट? दिन भर की लिमिट का {sat_pct}… एक ही {pack_word} में।' },
  sugarpct: { show: 'Chini? Din bhar ki limit ka *{sugar_pct}*… ek hi {pack_word} mein.', say: 'चीनी? दिन भर की लिमिट का {sugar_pct}… एक ही {pack_word} में।' },
  sodium: { show: 'Namak? Din bhar ki limit ka *{sodium_pct}*.', say: 'नमक? दिन भर की लिमिट का {sodium_pct}।' },
  ing: { show: 'Label pe dhyaan dene laayak: {named}.', say: 'लेबल पे ध्यान देने लायक: {named}।' },
  scan: { show: 'Ab scan karke dekhte hain.', say: 'अब स्कैन करके देखते हैं।' },
  score: { show: 'FoodGuard score: *{score}*, {verdict}. {ask}? {advice}.', say: 'FoodGuard स्कोर: {score}, {verdict}। {ask}? {advice}।' },
  app: { show: 'Har ingredient ka matlab, ek tap pe.', say: 'हर इंग्रेडिएंट का मतलब, एक टैप पे।' },
  cta: { show: 'Apna {pack_word} khud check karo. FoodGuard India, free hai.', say: 'अपना {pack_word} ख़ुद चेक करो। FoodGuard India, फ़्री है।' },
};

// After the "shock" hook the fat / sugar beat is the proof (the label's grams), not the reveal.
const requiredFor = (beat, hookType) => (hookType === 'shock' && (beat === 'fat' || beat === 'sugar') ? ['lead_g', beat === 'fat' ? 'pack_tsp' : 'sugar_tsp'] : REQUIRED[beat] || []);

// Lines about a daily limit must say it is a daily one ("limit ka 70%" alone reads as the pack's own limit).
const MUST_SAY_DAY = { satfat: 1, sodium: 1, sugarpct: 1 };

const placeholders = (s) => [...String(s || '').matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);

/** Problems with one line, [] when it passes. */
export function checkLine(beat, line, known, hookType) {
  const bad = [];
  if (!line || typeof line.show !== 'string' || typeof line.say !== 'string') return ['missing show/say'];
  for (const k of ['show', 'say', 'sticker']) {
    const s = line[k];
    if (s == null) continue;
    if (/[0-9०-९]/.test(s.replace(/\{[a-z_]+\}/g, ''))) bad.push(`${k} has its own number`);
    if (BANNED.test(s)) bad.push(`${k} uses a banned word`);
    for (const p of placeholders(s)) if (!known.has(p)) bad.push(`${k} uses unknown {${p}}`);
  }
  for (const p of requiredFor(beat, hookType)) {
    if (!placeholders(line.show).includes(p)) bad.push(`show lacks {${p}}`);
    if (!placeholders(line.say).includes(p)) bad.push(`say lacks {${p}}`);
  }
  if (line.show.replace(/\{[a-z_]+\}/g, 'x').split(/\s+/).length > 11) bad.push('show is too long (11 words at most)');
  if (!/[ऀ-ॿ]/.test(line.say)) bad.push('say is not in Hindi script');
  if (MUST_SAY_DAY[beat] && !/\b(din|daily|roz)\b/i.test(line.show)) bad.push('show must say it is the DAY limit ("din ki limit")');
  // The "shock" hook is told in big type on screen, so it has no sticker; the older openers do.
  if ((beat === 'hook' || beat === 'tease') && hookType !== 'shock' && (!line.sticker || line.sticker.replace(/\{[a-z_]+\}/g, 'xxxx').length > 26)) bad.push('sticker missing or too long');
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
  const shock = facts.hookType === 'shock';
  const template = () => Object.fromEntries(facts.beats.map((b) => [b, TEMPLATE[b][facts.hookType] || TEMPLATE[b]]));
  // The "shock" hook is fixed, not Gemini's: the strongest opener we have, with the pack's own number.
  const fixed = shock ? { hook: TEMPLATE.hook.shock } : {};
  const ask = facts.beats.filter((b) => !fixed[b]);
  const ruleOf = (b) => (shock && SHOCK_RULES[b]) || BEAT_RULES[b];
  const tries = [];
  if (useAi) {
    const prompt = `You write the voiceover for a 35-second YouTube Short / Instagram Reel for FoodGuard India, an app that reads Indian food labels.
The video: a real phone clip of someone holding "${facts.product}" by ${facts.brand} (${facts.pack}, ${facts.foodType}), turning it over to the label, then scanning its barcode in the app.

Write one line for each beat, in this order: ${ask.join(', ')}.
${ask.map((b) => `- ${b}: ${ruleOf(b)}`).join('\n')}
Hook style: ${HOOKS[facts.hookType]}
${shock ? 'The opening, already recorded: "Ek {pack_word}. {pack_tsp} chammach {lead_word}. Aur aap {whole} {eat} jaate ho." Continue from there without repeating it.\n' : ''}${facts.drink ? `This is a DRINK (a ${facts.word}): it is drunk, never eaten -- write "{pack_word}", "pee", "peeyein", never "khana", "packet" or "khaayein".\n` : ''}
Facts are placeholders -- use them exactly as written, never write a number yourself (no digits at all):
${[...known].map((k) => `{${k}} = ${facts.values[k]}`).join('\n')}

Tone: how a friend talks to you in Hinglish -- short, punchy, a little playful, a question now and then, "aap"/"tum" allowed. Not a news reader, not a lecture. Natural grammar ("label kehta hai", "pack mein"). Keep every line to 10 words or fewer: it is spoken in a few seconds.
The tone, for a different product (do not reuse these words):
  turn "Chalo, peeche dekhte hain…"
  sugar "Poori bottle mein *{sugar_tsp}* chammach chini!"
  score "FoodGuard score {score}, {verdict}. {ask}? {advice}."
  cta "Apni bottle khud scan karo, FoodGuard free hai."
Rules: only these facts. Say only what the facts say: the label states amounts (grams, serving size, ingredients); it never "recommends", "allows" or "approves" anything, so do not write that it does. Neutral about the brand -- no insults, no "harmful", "unhealthy", "junk", "avoid", "zeher", "jhooth", "dhokha", no health or disease claims, no emoji.
Each line: "show" = Hinglish in Roman letters, at most 10 words, you may wrap ONE key word in *stars*; "say" = the very same sentence in Hindi (Devanagari) script for a Hindi text-to-speech voice (English product words like Palmolein may stay in Roman).${ask.some((b) => b === 'hook' || b === 'tease') ? ' hook and tease also get a "sticker": 2-5 words, at most 24 letters, for a big on-screen sticker.' : ''}

Reply with JSON only: {"lines": {"${ask[0]}": {${ask[0] === 'hook' ? '"sticker": "...", ' : ''}"show": "...", "say": "..."}, ...}}`;
    // Each retry is told what was wrong with the last answer. The best answer
    // seen is kept: if no try passes whole, its passing lines are used and
    // only the failing ones come from the template.
    let feedback = '';
    let best = null;
    for (let i = 0; i < 4; i++) {
      try {
        const data = await Promise.race([
          // The stronger model first; the app's lite one if it is busy.
          callGeminiRaw({ contents: [{ parts: [{ text: prompt + feedback }] }], generationConfig: { temperature: 0.9, responseMimeType: 'application/json' } }, SCRIPT_MODELS[i % 2]),
          new Promise((_, no) => setTimeout(() => no(new Error('Gemini took over 60 s')), 60000)),
        ]);
        const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
        const got = JSON.parse(String(text).replace(/^```(json)?|```$/g, '').trim()).lines || {};
        const lines = { ...got, ...fixed };
        const problems = ask.flatMap((b) => checkLine(b, lines[b], known, facts.hookType).map((p) => `${b}: ${p}`));
        if (!problems.length) return { lines: Object.fromEntries(facts.beats.map((b) => [b, lines[b]])), source: shock ? 'gemini (the hook is fixed)' : 'gemini', tries };
        tries.push(problems.slice(0, 4).join('; '));
        const passing = facts.beats.filter((b) => fixed[b] || !checkLine(b, lines[b], known, facts.hookType).length);
        if (!best || passing.length > best.passing.length) best = { lines, passing };
        feedback = `\n\nYour last answer was rejected: ${problems.join('; ')}.\nFix exactly these. Remember: not a single digit outside the {placeholders} (write {serving_g}, never the number), at most 10 words per line, and every "say" in Devanagari script.`;
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
  // (The model now and then wraps a placeholder in `backticks`: not for the screen or the voice.)
  const put = (s, v) => String(s || '').replace(/`/g, '').replace(/\{([a-z_]+)\}/g, (_, k) => v[k] ?? '');
  // A placeholder can open a sentence ("{in_whole} 8!"): a capital letter after . ! ? and at the start.
  const capital = (s) => s.replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return { show: capital(put(line.show, values)), say: put(line.say, valuesSay), sticker: line.sticker ? put(line.sticker, values) : undefined };
}
