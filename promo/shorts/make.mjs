// promo/shorts/make.mjs -- one product in, one finished short out.
//
//   node shorts/make.mjs "winkin cow cold coffee"          (a name, or a product id)
//   node shorts/make.mjs <id> --out ../../videos
//
// Finds an APPROVED product, checks it is fit for a public video (a photo, a
// clean ingredient list, not infant formula), builds the short's
// timeline.json from the product's own report -- the label, what each
// flagged ingredient is, facts from the pack's nutrition panel -- and renders
// it with the shared template (_template.html), the synthesized soundtrack
// and a caption file. Wording stays neutral: facts from the pack, "worth a
// closer look", never "harmful" or "avoid".
//
// Writes <out>/<slug>.mp4 and <slug>-caption.txt (default out: promo/out).
// Needs the Supabase env (.env locally, secrets in CI), Playwright's Chromium
// and ffmpeg-static (see build-short.cjs).
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { supabase } from '../../src/services/supabaseClient.js';
import { isJunkIngredient } from '../../src/services/typoIngredient.js';
import { verdictFor } from '../../src/services/scoringEngine.js';
import { planSwap } from './swap-plan.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : path.join(HERE, '..', 'out');
// --plan: print the hook, sign-off, music and facts it would use, render nothing.
const PLAN = args.includes('--plan');
// --swap: a side-by-side with a higher-scoring product from the same shelf (swap-plan.mjs).
const SWAP = args.includes('--swap');
const query = args.filter((a, i) => a !== '--plan' && a !== '--swap' && (outIdx === -1 || (i !== outIdx && i !== outIdx + 1))).join(' ').trim();
// On GitHub the reason also goes to the top of the run's page (an error
// annotation and the job summary), which is where the admin panel sends you.
const fail = (msg) => {
  console.error(`NOT MADE: ${msg}`);
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::error title=Video not made::${msg}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Video not made

${msg}
`);
  }
  process.exit(2);
};
if (!query) fail('give a product name or id');

const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/, '');
const firstSentence = (s) => { const t = String(s || '').trim(); const m = t.match(/^.+?[.!?](\s|$)/); return (m ? m[0] : t).trim().replace(/\.$/, ''); };
const shorten = (s, n) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')}…`);
const round1 = (v) => Math.round(v * 10) / 10;

// ---- 1. the product ----
const COLS = 'id, product_name, review_status, scan_count, ingredients_text, report';
let row;
if (/^[0-9a-f-]{36}$/i.test(query)) {
  ({ data: row } = await supabase.from('product_reports').select(COLS).eq('id', query).maybeSingle());
} else {
  let q = supabase.from('product_reports').select(COLS).eq('review_status', 'approved');
  for (const w of query.split(/\s+/).filter((x) => x.length > 1)) q = q.ilike('product_name', `%${w}%`);
  const { data } = await q.limit(20);
  const list = (data || []).sort((a, b) => (b.scan_count || 0) - (a.scan_count || 0));
  if (list.length > 1) console.log(`${list.length} matches, using the most scanned:\n${list.slice(0, 5).map((r) => `  ${r.product_name} (${r.id})`).join('\n')}`);
  row = list[0];
}
if (!row) fail(`no approved product matches "${query}"`);
const r = row.report || {};
const name = row.product_name;
const brand = r.brand || '';

// ---- --swap: product A vs a higher-scoring product from the same shelf ----
if (SWAP) {
  const pick = (list, salt) => list[[...`${row.id}${salt}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % list.length];
  const plan = await planSwap(supabase, row, pick);
  if (plan.why) fail(plan.why);
  const { a, b, TL } = plan;
  const slug = `auto-swap-${slugify(`${a.brand && !slugify(a.name).startsWith(slugify(a.brand)) ? `${a.brand} ` : ''}${a.name}`)}`;
  const dir = path.join(HERE, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(HERE, '_swap.html'), path.join(dir, 'index.html'));
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(TL, null, 2));
  for (const [file, p] of [['a.jpg', a], ['b.jpg', b]]) {
    const photo = Buffer.from(await (await fetch(p.imageUrl)).arrayBuffer());
    await sharp(photo).flatten({ background: '#ffffff' }).trim({ threshold: 18 }).extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff' }).jpeg({ quality: 92 }).toFile(path.join(dir, file));
  }
  console.log(`${a.name} (${a.score}) vs ${b.name} (${b.score}), ${TL.rows.length} rows, ${TL.duration}s, music ${TL.music}`);
  if (PLAN) { console.log(JSON.stringify({ a: a.name, b: b.name, rows: TL.rows, cta: TL.cta }, null, 1)); process.exit(0); }
  execFileSync(process.execPath, [path.join(HERE, 'build-short.cjs'), slug, String(TL.duration)], { cwd: path.join(HERE, '..'), stdio: 'inherit' });
  const caption = `${a.name} vs ${b.name} — same shelf, two labels 🔍

${TL.rows.map((r) => `• ${r.label}: ${r.a} vs ${r.b}`).join('\n')}

Higher ingredient score: ${b.name} (${b.score}/100 · ${b.verdict}) vs ${a.score}/100 · ${a.verdict}.

Compare any two products 👉 foodguards.space (link in bio)

Based on the ingredient lists and nutrition panels printed on each pack. FoodGuard ingredient score (FSSAI, EFSA, WHO sources) — general information, not medical advice.

#ReadTheLabel #FoodSwap #HealthyChoices #NutritionFacts #IndianFood #EatSmart #FoodGuardIndia
`;
  fs.mkdirSync(OUT, { recursive: true });
  const base = slug.replace(/^auto-/, '');
  fs.copyFileSync(path.join(HERE, '..', 'out', `${slug}.mp4`), path.join(OUT, `${base}.mp4`));
  fs.writeFileSync(path.join(OUT, `${base}-caption.txt`), caption);
  fs.rmSync(path.join(HERE, '..', 'out', `${slug}.mp4`), { force: true });
  fs.rmSync(path.join(HERE, '..', 'out', `${slug}.wav`), { force: true });
  console.log(`MADE: ${path.join(OUT, `${base}.mp4`)}\n      ${path.join(OUT, `${base}-caption.txt`)}`);
  process.exit(0);
}

// ---- 2. fit for a public video? ----
if (row.review_status !== 'approved') fail(`"${name}" is ${row.review_status}, not approved`);
if (r.isInfantFormula) fail('infant formula gets no public video');
if (!r.imageUrl) fail(`"${name}" has no product photo`);
const all = r.ingredients || [];
const ings = all.filter((i) => i?.name && !isJunkIngredient(i));
if (ings.length < 4) fail(`only ${ings.length} readable ingredients`);
// Junk that scores nothing (a stray "Allergen Note", an OCR fragment) is just
// left out of the video. Junk that still carries a penalty would make the score
// on screen wrong, so that one has to be fixed first.
const scoredJunk = all.filter((i) => i?.name && isJunkIngredient(i) && ((i.penalty || 0) > 0 || i.status === 'concerning' || i.status === 'harmful'));
if (scoredJunk.length) fail(`typo / unreadable ingredient(s) that still affect the score: ${scoredJunk.map((i) => `"${i.name}"`).join(', ')} -- fix them in Admin > Manual review first`);
if (ings.length !== all.length) console.log(`left out of the video (label text, not ingredients): ${all.filter((i) => i?.name && isJunkIngredient(i)).map((i) => i.name).join(', ')}`);
if (typeof r.overallScore !== 'number') fail('no score');
const score = r.overallScore;
const verdict = verdictFor(score);
const isFlagged = (i) => i.status === 'concerning' || i.status === 'harmful';
const flaggedAll = ings.filter(isFlagged);

// ---- 3. the label and what to decode (every flagged one, up to 6, then the first fine ones, 9 at most) ----
// Section headings the label prints over a group ("NOODLES", "MASALA
// TASTEMAKER") stay on the label but aren't decoded as if they were ingredients.
const HEADING = /^(noodles?|masala|tastemaker|masala tastemaker|seasoning|filling|coating|dough|base|cream|wafers?|biscuits?)$/i;
const decodable = (i) => !HEADING.test(i.name.trim());
const pick = new Set(flaggedAll.filter(decodable).slice(0, 6).map((i) => ings.indexOf(i)));
for (let k = 0; k < ings.length && pick.size < 9; k++) if (decodable(ings[k])) pick.add(k);
const order = [...pick].sort((a, b) => a - b);
const tokens = order.map((k) => {
  const i = ings[k];
  return [i.name, isFlagged(i) ? 'c' : 's', shorten(firstSentence(i.whatIsIt || i.reason) || (isFlagged(i) ? 'Worth a closer look' : 'Fine'), 66)];
});
// Written like the pack: neighbours that share a class name are grouped --
// "Stabilizers (INS 471), Stabilizers (INS 407)" -> "Stabilizers (INS 471, 407)".
const print = [];
const classOf = (n) => { const m = n.match(/^([^(]{3,40}?)\s*\((.+)\)$/); return m ? [m[1].trim(), m[2].trim()] : null; };
for (let k = 0; k < ings.length;) {
  if (k) print.push(', ');
  const c = classOf(ings[k].name);
  let end = k + 1;
  while (c && end < ings.length && classOf(ings[end].name)?.[0] === c[0]) end++;
  const mark = (idx, txt) => { const t = order.indexOf(idx); print.push(t === -1 ? txt : [t, txt]); };
  if (c && end - k > 1) {
    print.push(`${c[0]} (`);
    for (let j = k; j < end; j++) { if (j > k) print.push(', '); mark(j, j === k ? classOf(ings[j].name)[1] : classOf(ings[j].name)[1].replace(/^INS\s+/i, '')); }
    print.push(')');
  } else {
    mark(k, ings[k].name);
  }
  k = end;
}
print.push('.');
const labelChars = print.reduce((n, p) => n + (typeof p === 'string' ? p : p[1]).length, 0);
const labelFont = Math.max(28, Math.min(46, Math.round(44 * Math.sqrt(300 / labelChars))));

// ---- 4. facts, only from the pack ----
const per100 = r.nutrientsPer100 || {};
const pack = String(r.packSize || '');
const packM = pack.match(/(\d+(?:\.\d+)?)\s*(ml|g)\b/i);
const packAmount = packM ? Number(packM[1]) : null;
const unit = packM ? packM[2].toLowerCase() : /drink|beverage|juice|milk|shake|coffee|tea|water|soda/i.test(`${r.foodType} ${name}`) ? 'ml' : 'g';
const facts = [];
const main = ings[0];
if (typeof main.percentage === 'number' && main.percentage >= 25 && !isFlagged(main)) {
  facts.push({ tone: 'good', k: 'The first ingredient', v: `${round1(main.percentage)}%`, d: main.name });
} else if (per100.proteinG >= 6) {
  facts.push({ tone: 'good', k: 'Protein', v: `${round1(per100.proteinG)} g`, d: `per 100 ${unit}` });
}
const additives = ings.filter((i) => i.insCode).length;
// What those additives are, from this product's own list ("leavening agents, emulsifier").
const kinds = [...new Set(ings.filter((i) => i.insCode).map((i) => (classOf(i.name)?.[0] || i.category || '').toLowerCase()).filter((k) => k && !/^ins\b/.test(k)))];
if (additives >= 2) facts.push({ tone: 'neutral', k: 'Additives (INS codes)', v: String(additives), d: kinds.length ? shorten(kinds.slice(0, 3).join(', '), 40) : 'listed by INS number' });
if (per100.addedSugarG > 0) {
  const perPack = packAmount && packAmount <= 400;
  const grams = perPack ? (per100.addedSugarG * packAmount) / 100 : per100.addedSugarG;
  const tsp = grams / 4;
  if (tsp >= 0.5 && tsp <= 10) {
    const spoons = [];
    for (let left = tsp; left > 0.15 && spoons.length < 10; left -= 1) spoons.push(Math.round(Math.min(1, left) * 100 / 25) * 25);
    const tspText = tsp < 1 ? 'under 1' : Number.isInteger(Math.round(tsp * 2) / 2) ? String(Math.round(tsp)) : String(Math.round(tsp * 2) / 2).replace('.5', '½');
    facts.push({ tone: 'sugar', k: perPack ? `Added sugar, per pack (${pack})` : `Added sugar, per 100 ${unit}`, v: `~${Math.round(grams)} g`, d: `about ${tspText} teaspoon${tsp >= 1.5 ? 's' : ''}`, spoons });
  }
}
// The ingredient the product is named after, with its share on the label
// ("Cheesy" cup noodles -> Cheese 4.8%).
// "cheesy" and "cheese" both stem to "chees". A printed share has at most one
// decimal ("4.8"); an estimated one (1.2857...) isn't from the label.
const stem = (w) => w.replace(/(ies|es|y|s|e)$/, '');
const nameWords = new Set(name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).map(stem));
const printed = (p) => Math.abs(p * 10 - Math.round(p * 10)) < 1e-6;
const named = ings.find((i, k) => k > 0 && typeof i.percentage === 'number' && i.percentage < 25 && printed(i.percentage)
  && i.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && nameWords.has(stem(w))));
if (named && facts.length < 3) facts.unshift({ tone: 'neutral', k: 'In the name, on the label', v: `${round1(named.percentage)}%`, d: named.name });
if (facts.length < 3) facts.push({ tone: 'neutral', k: 'On the label', v: String(ings.length), d: 'ingredients — each one explained' });
const sugarFact = facts.find((fc) => fc.spoons);

// ---- 5. timeline ----
const firstToken = 4.3, tokenStep = 1.12;
const labelEnd = round1(firstToken + tokens.length * tokenStep + 0.6);
const factsEnd = round1(labelEnd + 1.4 + facts.length * 0.9 + (sugarFact ? 0.4 * sugarFact.spoons.length : 0));
const verdictEnd = round1(factsEnd + 4);
const duration = Math.ceil(verdictEnd + 4.6);
const spoonStart = labelEnd + 0.15 + (facts.indexOf(sugarFact) * 0.45) + 1.0;
const shortName = brand && name.toLowerCase().startsWith(brand.toLowerCase()) ? name.slice(brand.length).trim() : name;
const hookName = shortName.length <= 26 ? shortName : shortName.split(/\s+/).slice(0, 4).join(' ');
const chips = flaggedAll.filter(decodable).slice(0, 4).map((i) => [i.insCode ? `INS ${i.insCode}` : shorten(i.name.replace(/\s*\(.*\)$/, ''), 22), 'c']);
if (facts[0]?.tone === 'good') chips.push([`${facts[0].v} ${facts[0].k === 'Protein' ? 'protein' : main.name.toLowerCase().split(/\s+/).pop()}`, 's']);
const drink = unit === 'ml';

// The hook leads with this product's most telling fact, so no two videos open
// the same way. First match wins; every line is a plain fact from the pack.
const packWord = drink ? (/\bcan\b/i.test(name) ? 'can' : 'bottle') : /\bcup\b/i.test(name) ? 'cup' : 'pack';
const sugarTsp = sugarFact ? Number(sugarFact.d.match(/about ([\d½]+)/)?.[1]?.replace('½', '.5')) : 0;
const flavourWord = named ? name.split(/\s+/).find((w) => stem(w.toLowerCase().replace(/[^a-z]/g, '')) === stem(named.name.toLowerCase().split(/\s+/).find((x) => nameWords.has(stem(x.replace(/[^a-z]/g, '')))) || '')) : null;
const hook =
  sugarFact && sugarTsp >= 2 && sugarFact.k.includes('per pack') ? [`${sugarFact.d.replace('about ', '').replace(/^./, (c) => c.toUpperCase())} of added sugar.`, `In one ${pack} ${packWord}.`]
  : named && named.percentage < 10 && flavourWord ? [`“${flavourWord.replace(/[^A-Za-z]/g, '')}” ${hookNameTail(shortName, flavourWord)}.`, `${round1(named.percentage)}% ${named.name.toLowerCase()}.`]
  : additives >= 6 ? [`${additives} additives.`, `In one ${packWord}.`]
  : score >= 85 ? ['A label that passes.', `All ${ings.length} ingredients check out.`]
  : [`${hookName}.`, 'What’s really inside?'];
function hookNameTail(full, word) {
  // "Spicy Cheesy Cup Noodles" + "Cheesy" -> "cup noodles"
  const words = full.split(/\s+/);
  const i = words.findIndex((w) => w.toLowerCase().includes(word.toLowerCase()));
  return words.slice(i + 1).join(' ').toLowerCase() || 'pack';
}

// The sign-off and the soundtrack change from product to product (picked by
// its id, so the same product always gets the same ones).
const pickBy = (list, salt) => list[[...`${row.id}${salt}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % list.length];
const CTAS = drink
  ? ['Know it<br />before you <em>sip.</em>', 'Check it<br />before you <em>pour.</em>', 'Your fridge,<br /><em>decoded.</em>', 'Scan yours<br /><em>free.</em>']
  : ['Know it<br />before you <em>buy.</em>', 'Your shelf,<br /><em>decoded.</em>', 'Scan yours<br /><em>free.</em>', 'Read any label<br />in <em>seconds.</em>'];
const MUSIC = ['warm', 'bright', 'chill', 'pulse', 'lofi'];
const TL = {
  _: `Made by shorts/make.mjs from product ${row.id} (${name}). Facts from the pack's ingredient list and nutrition panel as saved in FoodGuard.`,
  duration, music: pickBy(MUSIC, 'music'),
  scenes: { hook: [0, 3.4], label: [3.4, labelEnd], facts: [labelEnd, factsEnd], verdict: [factsEnd, verdictEnd], cta: [verdictEnd, duration] },
  transitions: [{ t: 3.4, kind: 'zoom' }, { t: labelEnd, kind: 'push' }, { t: factsEnd, kind: 'burst' }, { t: verdictEnd, kind: 'wipe' }],
  firstToken, tokenStep, tokens, print, labelFont,
  spoons: sugarFact ? sugarFact.spoons.map((_, i) => round1(spoonStart + i * 0.35)) : [],
  facts, chips, score, verdict,
  flaggedLine: flaggedAll.length ? `${flaggedAll.length} of ${ings.length} ingredients worth a closer look` : `All ${ings.length} ingredients check out`,
  hook,
  cta: pickBy(CTAS, 'cta'),
  product: { id: row.id, name, brand, title: `${shorten(name, 38)}${pack ? ` · ${pack}` : ''}` },
};

// ---- 6. render ----
const slug = `auto-${slugify(`${brand && !slugify(name).startsWith(slugify(brand)) ? `${brand} ` : ''}${name}`)}`;
const dir = path.join(HERE, slug);
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(path.join(HERE, '_template.html'), path.join(dir, 'index.html'));
fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(TL, null, 2));
if (PLAN) {
  console.log(JSON.stringify({ product: name, hook: TL.hook, cta: TL.cta.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), music: TL.music, facts: TL.facts.map((fc) => `${fc.k}: ${fc.v} (${fc.d})`), score: `${score} ${verdict}` }, null, 1));
  process.exit(0);
}
// White margins trimmed off so the pack fills its card (a listing photo can be half empty).
const photo = Buffer.from(await (await fetch(r.imageUrl)).arrayBuffer());
await sharp(photo).flatten({ background: '#ffffff' }).trim({ threshold: 18 }).extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff' }).jpeg({ quality: 92 }).toFile(path.join(dir, 'pack.jpg'));
console.log(`${name}: score ${score} ${verdict}, ${tokens.length} ingredients decoded, ${facts.length} facts, ${duration}s`);
execFileSync(process.execPath, [path.join(HERE, 'build-short.cjs'), slug, String(duration)], { cwd: path.join(HERE, '..'), stdio: 'inherit' });

const pageSlug = slugify(brand && !slugify(name).startsWith(slugify(brand)) ? `${brand} ${name}` : name);
let link = 'foodguards.space';
try { if ((await fetch(`https://foodguards.space/product/${pageSlug}/`, { method: 'HEAD' })).ok) link = `foodguards.space/product/${pageSlug}`; } catch { /* offline: keep the home page */ }
const caption = `${name} — what’s actually inside? 🔍

We read the label${pack ? ` (${pack})` : ''}:
${facts.map((fc) => `• ${fc.k}: ${fc.v} — ${fc.d}`).join('\n')}
${flaggedAll.length ? `🟠 Worth a closer look: ${flaggedAll.filter(decodable).slice(0, 5).map((i) => i.name).join(', ')}` : '✅ No ingredient flagged'}

Ingredient score: ${score}/100 · ${verdict}

Every ingredient explained 👉 ${link} (link in bio)

Based on the ingredient list and nutrition panel printed on the pack. FoodGuard ingredient score (FSSAI, EFSA, WHO sources) — general information, not medical advice.

#ReadTheLabel #FoodLabel #HealthyChoices #NutritionFacts #IndianFood #EatSmart #FoodGuardIndia
`;
fs.mkdirSync(OUT, { recursive: true });
const base = slug.replace(/^auto-/, '');
fs.copyFileSync(path.join(HERE, '..', 'out', `${slug}.mp4`), path.join(OUT, `${base}.mp4`));
fs.writeFileSync(path.join(OUT, `${base}-caption.txt`), caption);
fs.rmSync(path.join(HERE, '..', 'out', `${slug}.mp4`), { force: true });
fs.rmSync(path.join(HERE, '..', 'out', `${slug}.wav`), { force: true });
console.log(`MADE: ${path.join(OUT, `${base}.mp4`)}\n      ${path.join(OUT, `${base}-caption.txt`)}`);
