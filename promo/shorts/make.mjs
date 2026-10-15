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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx !== -1 ? path.resolve(args[outIdx + 1]) : path.join(HERE, '..', 'out');
const query = args.filter((a, i) => outIdx === -1 || (i !== outIdx && i !== outIdx + 1)).join(' ').trim();
const fail = (msg) => { console.error(`NOT MADE: ${msg}`); process.exit(2); };
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

// ---- 2. fit for a public video? ----
if (row.review_status !== 'approved') fail(`"${name}" is ${row.review_status}, not approved`);
if (r.isInfantFormula) fail('infant formula gets no public video');
if (!r.imageUrl) fail(`"${name}" has no product photo`);
const all = r.ingredients || [];
const ings = all.filter((i) => i?.name && !isJunkIngredient(i));
if (ings.length < 4) fail(`only ${ings.length} readable ingredients`);
if (ings.length !== all.length) fail(`${all.length - ings.length} unreadable / typo ingredient(s) on the report -- fix them in Manual review first`);
if (typeof r.overallScore !== 'number') fail('no score');
const score = r.overallScore;
const verdict = verdictFor(score);
const isFlagged = (i) => i.status === 'concerning' || i.status === 'harmful';
const flaggedAll = ings.filter(isFlagged);

// ---- 3. the label and what to decode (every flagged one, up to 6, then the first fine ones, 9 at most) ----
const pick = new Set(flaggedAll.slice(0, 6).map((i) => ings.indexOf(i)));
for (let k = 0; k < ings.length && pick.size < 9; k++) pick.add(k);
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
if (!facts.length) facts.push({ tone: 'neutral', k: 'On the label', v: String(ings.length), d: 'ingredients, each one explained' });
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
const chips = flaggedAll.slice(0, 4).map((i) => [i.insCode ? `INS ${i.insCode}` : shorten(i.name.replace(/\s*\(.*\)$/, ''), 22), 'c']);
if (facts[0]?.tone === 'good') chips.push([`${facts[0].v} ${facts[0].k === 'Protein' ? 'protein' : main.name.toLowerCase().split(/\s+/).pop()}`, 's']);
const drink = unit === 'ml';
const TL = {
  _: `Made by shorts/make.mjs from product ${row.id} (${name}). Facts from the pack's ingredient list and nutrition panel as saved in FoodGuard.`,
  duration, bpm: 104,
  scenes: { hook: [0, 3.4], label: [3.4, labelEnd], facts: [labelEnd, factsEnd], verdict: [factsEnd, verdictEnd], cta: [verdictEnd, duration] },
  transitions: [{ t: 3.4, kind: 'zoom' }, { t: labelEnd, kind: 'push' }, { t: factsEnd, kind: 'burst' }, { t: verdictEnd, kind: 'wipe' }],
  firstToken, tokenStep, tokens, print, labelFont,
  spoons: sugarFact ? sugarFact.spoons.map((_, i) => round1(spoonStart + i * 0.35)) : [],
  facts, chips, score, verdict,
  flaggedLine: flaggedAll.length ? `${flaggedAll.length} of ${ings.length} ingredients worth a closer look` : `All ${ings.length} ingredients check out`,
  hook: [`${hookName}.`, 'What’s really inside?'],
  cta: `Know it<br />before you <em>${drink ? 'sip' : 'buy'}.</em>`,
  product: { id: row.id, name, brand, title: `${shorten(name, 38)}${pack ? ` · ${pack}` : ''}` },
};

// ---- 6. render ----
const slug = `auto-${slugify(`${brand && !slugify(name).startsWith(slugify(brand)) ? `${brand} ` : ''}${name}`)}`;
const dir = path.join(HERE, slug);
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(path.join(HERE, '_template.html'), path.join(dir, 'index.html'));
fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(TL, null, 2));
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
${flaggedAll.length ? `🟠 Worth a closer look: ${flaggedAll.slice(0, 5).map((i) => i.name).join(', ')}` : '✅ No ingredient flagged'}

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
