// src/services/geminiService.js
// Handles all Gemini AI API calls for ingredient analysis

// Works both in the browser (Vite injects import.meta.env at build time)
// and in Node -- the Netlify scheduled function reuses this same service,
// where env vars come from process.env instead.
//
// Six keys (six separate free-tier quotas, 500 requests/day each) so
// this pipeline work and real user scans don't all compete for one shared
// pool. _2 through _6 are optional -- everything still works with just the
// first key configured.
export const GEMINI_API_KEYS = [
  import.meta.env?.VITE_GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY,
  import.meta.env?.VITE_GEMINI_API_KEY_2 || process.env.VITE_GEMINI_API_KEY_2,
  import.meta.env?.VITE_GEMINI_API_KEY_3 || process.env.VITE_GEMINI_API_KEY_3,
  import.meta.env?.VITE_GEMINI_API_KEY_4 || process.env.VITE_GEMINI_API_KEY_4,
  import.meta.env?.VITE_GEMINI_API_KEY_5 || process.env.VITE_GEMINI_API_KEY_5,
  import.meta.env?.VITE_GEMINI_API_KEY_6 || process.env.VITE_GEMINI_API_KEY_6,
].filter(Boolean);

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';

function apiUrl(key, model = DEFAULT_MODEL) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
}

function isQuotaError(message) {
  return /quota|rate limit|429/i.test(message || '');
}

// Every call goes to the NEXT key in turn (round-robin) instead of using
// key 1 until it runs dry: each key has its own free-tier quota AND its own
// per-minute rate limit, so spreading calls evenly across all of them gives
// roughly N times the throughput and uses every key's daily quota at the
// same steady rate. A key that answers "quota exceeded" is put on a
// cooldown and skipped -- a minute for a per-minute limit, an hour for a
// daily cap -- rather than being retried on every call.
let nextKey = 0;
const cooldownUntil = new Map(); // key index -> timestamp (ms)
const RATE_COOLDOWN_MS = 60 * 1000;
const DAILY_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * The order in which to try the keys for one call: starting at `start`,
 * wrapping around, with any key still cooling down moved to the back (so
 * it is only tried when every healthy key has already failed). Pure --
 * exported for testing.
 */
export function orderKeys(count, start, cooldowns, now) {
  const order = [];
  for (let n = 0; n < count; n++) order.push((start + n) % count);
  const cooling = (i) => (cooldowns.get(i) || 0) > now;
  return [...order.filter((i) => !cooling(i)), ...order.filter(cooling)];
}

/** How long to bench a key after a quota error, from the API's own wording. */
export function cooldownFor(message) {
  return /per\s?day|daily/i.test(message || '') ? DAILY_COOLDOWN_MS : RATE_COOLDOWN_MS;
}

/**
 * POST one request to Gemini, round-robin across the configured keys and
 * falling through to the next key when one is out of quota. Returns the
 * raw parsed response JSON; throws (with the real API error message) once
 * every key has failed. `model` defaults to the text model -- the photo
 * clean-up (geminiImageService.js) passes an image model instead.
 */
export async function callGeminiRaw(requestBody, model = DEFAULT_MODEL) {
  if (GEMINI_API_KEYS.length === 0) throw new Error('No Gemini API key configured');
  let lastMessage = 'API request failed';
  const order = orderKeys(GEMINI_API_KEYS.length, nextKey, cooldownUntil, Date.now());
  for (const [position, i] of order.entries()) {
    const response = await fetch(apiUrl(GEMINI_API_KEYS[i], model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      nextKey = (i + 1) % GEMINI_API_KEYS.length;
      cooldownUntil.delete(i);
      return response.json();
    }

    const error = await response.json().catch(() => null);
    lastMessage = error?.error?.message || 'API request failed';

    if (isQuotaError(lastMessage)) {
      cooldownUntil.set(i, Date.now() + cooldownFor(lastMessage));
      if (position + 1 < order.length) {
        console.warn(`Gemini key ${i + 1}/${GEMINI_API_KEYS.length} is out of quota -- switching to the next key.`);
        continue;
      }
    }
    throw new Error(lastMessage);
  }
  throw new Error(lastMessage);
}

/**
 * Text-model call: same as callGeminiRaw, reduced to
 * { text, finishReason } for the existing analysis callers.
 */
export async function callGemini(requestBody) {
  const data = await callGeminiRaw(requestBody);
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text,
    finishReason: data.candidates?.[0]?.finishReason,
  };
}

const ANALYSIS_PROMPT = `You are a food safety expert specializing in Indian food regulations (FSSAI) and EU/EFSA standards. Your job is to help Indian consumers understand what's in their packaged food.

Analyze the provided food ingredients and return ONLY a valid JSON response. No markdown, no explanation, just pure JSON.

Return this exact JSON structure:
{
  "productName": "Unknown Product",
  "overallScore": 75,
  "verdict": "Moderately Healthy",
  "summary": "2-3 sentence plain English summary of the product's health profile",
  "ingredients": [
    {
      "name": "ingredient name as written on label",
      "status": "safe",
      "fssaiStatus": "permitted",
      "euStatus": "permitted",
      "reason": "Plain, simple explanation of what this is and any concerns",
      "category": "preservative",
      "whatIsIt": "One short plain-English sentence on what this substance actually is (natural, synthetic, derived from what, INS number meaning if applicable)",
      "commonlyFoundIn": ["other common foods/products this ingredient is usually found in, 2-4 examples"],
      "healthEffects": "One short sentence on known health effects — short-term and long-term if relevant. If genuinely no concerns, say so plainly instead of inventing risk."
    }
  ],
  "flags": ["High Sugar", "Contains Palm Oil"],
  "positives": ["No artificial colors", "Contains real spices"],
  "recommendation": "One clear sentence advice for the consumer"
}

Rules for status field:
- "safe" = no concerns, natural ingredient or fully safe additive
- "concerning" = legal but worth knowing about (palm oil, added sugar, MSG, artificial sweeteners, carrageenan, sodium >500mg/100g)
- "harmful" = FSSAI banned/restricted, or serious health risk

Rules for fssaiStatus / euStatus:
- "permitted" = allowed
- "restricted" = allowed with limits
- "banned" = not allowed
- "not_regulated" = no specific regulation found

Score rubric (be honest, don't be too generous):
- 85-100: Very healthy — whole/natural ingredients, no concerning additives
- 65-84: Good — minor concerns only, mostly natural
- 45-64: Moderate — some additives, high sugar or sodium, palm oil
- 25-44: Poor — multiple concerning additives, very processed
- 0-24: Very poor — harmful/banned substances, extremely unhealthy profile

FSSAI-specific flags to ALWAYS check:
- Potassium Bromate (INS 924): BANNED in India → status: harmful
- Brominated Vegetable Oil: BANNED → status: harmful  
- Metanil Yellow, Rhodamine B: BANNED artificial colors → status: harmful
- Palm oil / palmolein: Legal but concerning → status: concerning
- Added sugar >10% of ingredients: concerning
- Artificial sweeteners (aspartame, saccharin, sucralose): concerning
- MSG / Monosodium glutamate: concerning
- TBHQ / BHA / BHT preservatives: concerning
- Carrageenan: concerning
- High Fructose Corn Syrup: harmful/concerning

Always write reasons in simple English that a non-expert Indian consumer can understand.`;

/**
 * Analyze ingredients from text input
 */
export async function analyzeIngredients(ingredientsText) {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error('Gemini API key not found. Please add VITE_GEMINI_API_KEY to your .env file.');
  }

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${ANALYSIS_PROMPT}\n\nIngredients to analyze:\n${ingredientsText}`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 1,
      topP: 0.8,
      maxOutputTokens: 8192,
      thinkingConfig: {
        thinkingLevel: 'low',
      },
    }
  };

  const { text, finishReason } = await callGemini(requestBody);

  if (!text) throw new Error('Empty response from Gemini');

  return extractJson(text, finishReason);
}

const EXTRACTION_PROMPT = `You are transcribing the ingredients list and, if visible in this same photo, the nutrition table from a photo of an Indian packaged food label.

Read the image carefully and return ONLY valid JSON, no markdown, no explanation:
{
  "productName": "product name if visible on the pack, otherwise 'Unknown Product'",
  "ingredientsText": "the full ingredients list exactly as printed, comma separated, keep INS numbers and sub-brackets as written",
  "readable": true,
  "notes": "short note ONLY if the photo was blurry, the list looked cut off, small/faded text was hard to read, or you are not fully confident you captured everything — otherwise an empty string",
  "nutrition": {
    "energyKcal": 0, "proteinG": 0, "totalCarbG": 0, "totalSugarG": 0, "addedSugarG": 0,
    "totalFatG": 0, "saturatedFatG": 0, "transFatG": 0, "fiberG": 0, "sodiumMg": 0, "calciumMg": 0
  },
  "servingGrams": 0
}

If the label truly cannot be read at all, set "readable": false, leave "ingredientsText" empty, and explain why in "notes".
Never invent or guess ingredients that aren't legible — it is better to leave something out and note it than to make it up.
If NO nutrition table is visible in this photo at all, omit the "nutrition" key and the "servingGrams" key entirely rather than guessing numbers. If a nutrition table IS visible, only include the specific fields it actually states — per 100g/100ml, not per serving — and never invent a value for a field the table doesn't show.`;

/**
 * Extract (transcribe) the ingredients list from a food label photo.
 * This is a cheap, short-output OCR-style pass — it does NOT run the
 * full FSSAI/EU analysis. The extracted text is meant to be shown to
 * the user for review/editing before analyzeIngredients() is called
 * on the confirmed text, since small print often gets missed or
 * misread and the user should get a chance to fix it first.
 */
export async function extractIngredientsFromImage(imageFile) {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error('Gemini API key not found. Please add VITE_GEMINI_API_KEY to your .env file.');
  }

  const base64Image = await fileToBase64(imageFile);
  const mimeType = imageFile.type;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: EXTRACTION_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 1,
      topP: 0.8,
      maxOutputTokens: 1536,
      thinkingConfig: {
        thinkingLevel: 'low',
      },
    }
  };

  const { text, finishReason } = await callGemini(requestBody);

  if (!text) throw new Error('Empty response from Gemini');

  return extractJson(text, finishReason);
}

const IDENTIFY_PROMPT = `This is a photo of the FRONT of an Indian packaged food product. Identify the product exactly as printed on the pack.

Return ONLY a JSON object, no other text:
{"readable": true|false, "brand": "...", "productName": "...", "packSize": "..."}

- brand: the maker's brand as printed (e.g. "Parle", "Britannia", "Haldiram's"). Empty string if not visible.
- productName: the product's own name as printed, including its variant/flavour (e.g. "Parle-G Gluco Biscuits", "Dark Fantasy Choco Fills"). Do NOT invent words that aren't on the pack.
- packSize: net quantity if printed (e.g. "250 g", "1 L"). Empty string if not visible.
- readable: false if this isn't a food pack or the name can't be read.`;

/**
 * Reads the brand, product name and pack size off a front-of-pack photo --
 * for when a scanned barcode isn't in the catalog, so the product can be
 * found by name instead. Uses the same free text model and photo input as
 * extractIngredientsFromImage; no image generation involved.
 *
 * @returns {Promise<{ readable: boolean, brand: string, productName: string, packSize: string }>}
 */
export async function identifyProductFromPhoto(imageFile) {
  if (GEMINI_API_KEYS.length === 0) throw new Error('Gemini API key not found.');
  const requestBody = {
    contents: [{ parts: [{ text: IDENTIFY_PROMPT }, { inline_data: { mime_type: imageFile.type, data: await fileToBase64(imageFile) } }] }],
    generationConfig: { temperature: 0.1, topK: 1, topP: 0.8, maxOutputTokens: 256, thinkingConfig: { thinkingLevel: 'low' } },
  };
  const { text, finishReason } = await callGemini(requestBody);
  if (!text) throw new Error('Empty response from Gemini');
  const out = extractJson(text, finishReason) || {};
  return {
    readable: out.readable !== false && Boolean(out.productName || out.brand),
    brand: String(out.brand || '').trim(),
    productName: String(out.productName || '').trim(),
    packSize: String(out.packSize || '').trim(),
  };
}

const RESEARCH_PROMPT = `You are a food safety researcher specializing in Indian FSSAI regulations and EU/EFSA standards.

You will be given a list of food ingredients found on Indian packaged food labels. Research EACH one and return ONLY a valid JSON array — no markdown, no explanation.

Each array element must be exactly this shape:
{
  "canonicalName": "the exact lowercase key you were given for this ingredient",
  "displayName": "Properly Cased Name",
  "recognized": true,
  "insCode": "322" or null,
  "scientificName": "chemical/scientific name, or null if it's a whole food",
  "category": "preservative | sweetener | color | emulsifier | flavour | acidity regulator | antioxidant | stabilizer | raising agent | oil | fat | protein | spice | vitamin | natural | other",
  "status": "safe | concerning | harmful",
  "fssaiStatus": "permitted | restricted | banned | not_regulated",
  "euStatus": "permitted | restricted | banned | not_regulated",
  "reason": "One plain-English sentence a non-expert Indian consumer understands",
  "whatIsIt": "One short sentence on what this substance actually is",
  "healthEffects": "One short sentence on known health effects. If genuinely harmless, say so plainly rather than inventing risk.",
  "commonlyFoundIn": ["2-4 other common foods containing this"],
  "synonyms": ["other names/spellings this appears under on labels, lowercase"],
  "penalty": 0,
  "confidence": "high | medium | low",
  "evidenceType": "regulatory | scientific_consensus | limited_evidence | heuristic"
}

Set "recognized" to false ONLY when the given name is not a real food ingredient, additive, or edible substance at all -- a person's name, a random word, a typo, or gibberish (e.g. "Talib", "asdfgh", "xyz123"). Stay true for any real ingredient you're simply not fully certain about, obscure regional ingredients, or unusual INS codes -- research those normally. When recognized is false, still fill in every other field with your best-effort placeholder guess (the app will not score or display these, but every field must still be valid JSON).

"penalty" is how much this ingredient should pull a product's health score down, 0-40. Judge NUTRITIONAL QUALITY, not just legal/safety status — an ingredient can be 100% legal and non-toxic and still deserve a real penalty because it's nutritionally poor (refined, stripped of fiber/nutrients, high glycemic impact). Being "not banned" does not mean "penalty near 0".
- 0-2: genuinely whole/unrefined foods and harmless nutrients (water, whole wheat flour, vitamins, whole spices, fresh fruit/vegetable pieces)
- 3-8: mildly processed or moderate-impact items (iodised salt, small amounts of added sugar, natural flavours, most starches/thickeners)
- 9-18: refined/processed staples and notable concerns — this includes REFINED FLOUR / MAIDA (low fiber, high glycemic index, nutritionally stripped compared to whole grain — this is a real, common penalty case, not a harmless one), palm oil, MSG, artificial sweeteners, artificial colors, carrageenan
- 19-30: serious concerns (TBHQ/BHA/BHT, high fructose corn syrup, trans fats)
- 31-40: FSSAI-banned or seriously harmful (potassium bromate INS 924, brominated vegetable oil, metanil yellow, rhodamine B)

"evidenceType" is WHAT KIND of basis backs your status/penalty for this specific ingredient -- pick exactly one:
- "regulatory": an explicit FSSAI/EU permitted/restricted/banned classification is the main reason (e.g. potassium bromate is banned, so this is regulatory)
- "scientific_consensus": no specific regulatory ban/restriction, but the nutritional concern is well-established and broadly agreed (e.g. refined flour's low fiber and high glycemic impact, trans fat)
- "limited_evidence": the concern is real but based on emerging, mixed, or still-debated research (e.g. some long-term artificial sweetener studies)
- "heuristic": a general nutritional-quality judgment with no specific regulatory ruling or study behind THIS ingredient (e.g. a default "mildly processed" penalty for an ordinary thickener)

"confidence" is how sure you are that your status/penalty for THIS ingredient is correct, given the evidenceType above -- "high" for regulatory or well-established scientific_consensus cases, "medium" for limited_evidence or a scientific_consensus call you're less certain generalizes to this exact ingredient, "low" for a heuristic guess or an obscure/unusual ingredient you have limited information on. Confidence is about YOUR certainty, not about how severe the ingredient is -- a "safe" whole food can still be "high" confidence.

Be accurate and honest — this data is stored permanently and reused for every future scan, so a wrong answer here becomes a wrong answer forever. Your own "reason" and "healthEffects" text must be consistent with the penalty you assign — if you write that something is nutritionally poor, its penalty must reflect that, not sit near 0.
Return exactly one array element per ingredient given, in the same order.`;

/**
 * Research a batch of previously-unknown ingredients in ONE call.
 *
 * This is the only AI call the ingredient-library approach needs, and it
 * only runs for ingredients we've never seen before — once saved, they're
 * served from the database for free forever.
 */
// A cross-check on the model's OWN "recognized" boolean, not a
// replacement for it -- an LLM's free-text explanation and its
// structured field can disagree even in the same response. Confirmed
// against a real scanned product (Storia Coffee Shake): asked to
// research "Quot" (a fragment of a leaked "&quot;" HTML entity, itself
// a separate bug), Gemini correctly wrote "This is a typographical
// error or formatting artifact, not an ingredient" in its own "reason"
// field -- while still leaving "recognized" as true, which let the
// product score a false 100/100 "Very Healthy" off one fabricated
// ingredient. Rather than trust a single boolean the prompt asks for,
// also check whether the model's own explanation contradicts it.
const SELF_DISQUALIFYING_RE =
  /\b(not a (real )?(food|ingredient|edible substance|food substance)\b|not an? (ingredient|edible substance)\b|typo(graphical)? error|formatting artifact|ocr (error|artifact)|transcription error|isn'?t a (real )?(food|ingredient)|doesn'?t (appear|seem) to be a (food|real ingredient)|random word|gibberish)/i;

export function looksSelfDisqualifying(record) {
  const text = [record?.reason, record?.whatIsIt, record?.healthEffects].filter(Boolean).join(' ');
  return SELF_DISQUALIFYING_RE.test(text);
}

export async function researchIngredients(items) {
  if (GEMINI_API_KEYS.length === 0) {
    throw new Error('Gemini API key not found. Please add VITE_GEMINI_API_KEY to your .env file.');
  }
  if (!items || items.length === 0) return [];

  const list = items
    .map((it, i) => `${i + 1}. key="${it.canonicalName}" name="${it.name}"${it.insCode ? ` INS code=${it.insCode}` : ''}`)
    .join('\n');

  const requestBody = {
    contents: [
      {
        parts: [{ text: `${RESEARCH_PROMPT}\n\nIngredients to research:\n${list}` }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 1,
      topP: 0.8,
      maxOutputTokens: 8192,
      thinkingConfig: {
        thinkingLevel: 'low',
      },
    },
  };

  const { text, finishReason } = await callGemini(requestBody);

  if (!text) throw new Error('Empty response from Gemini');

  const parsed = extractJson(text, finishReason, 'array');
  if (!Array.isArray(parsed)) return [];

  return parsed.map((record) =>
    record && record.recognized !== false && looksSelfDisqualifying(record)
      ? { ...record, recognized: false }
      : record,
  );
}

/**
 * Pull the JSON object out of a Gemini text response, even if it's
 * wrapped in markdown fences, has stray text before/after it, or has
 * a stray trailing comma before a closing } or ].
 */
function extractJson(text, finishReason, shape = 'object') {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  const [open, close] = shape === 'array' ? ['[', ']'] : ['{', '}'];
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  const candidate = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;

  try {
    return JSON.parse(candidate);
  } catch {
    // Common LLM slip-up: a trailing comma right before a closing bracket.
    const repaired = candidate.replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(repaired);
    } catch {
      console.error('Could not parse Gemini response:', { finishReason, text });
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('The AI response was cut off because it ran too long. Please try again — this should be less likely on retry.');
      }
      throw new Error('Could not parse AI response. Please try again.');
    }
  }
}

const INSIGHTS_PROMPT = `You are writing the short human-facing text on a food product's health report for Indian consumers.

Return ONLY valid JSON, no markdown, no preamble:
{
  "summary": "...",
  "recommendation": "...",
  "isCondimentOrSeasoning": false,
  "isInfantFormula": false,
  "foodType": "other",
  "isDeepFried": false,
  "usefulContext": null,
  "story": null
}

"summary" -- ONE or TWO short, natural sentences (35 words max) that:
- React specifically to THIS product's real profile -- not a generic template. Positive, neutral, or concerned, whichever is actually true.
- If there are concerning or harmful ingredients, name the actual ones given below (not a vague category).
- Sound like a knowledgeable friend, not a warning label. Vary your opening every time -- never reuse the same stock phrase across different products.
- Describe what is going on with this product. Do NOT give advice here -- "recommendation" covers that.
- Do NOT invent ingredients or facts not given below.
- EXCEPTION for infant formula (isInfantFormula true below): never react to the score or call it healthy/unhealthy/good/concerning -- write one neutral, factual sentence describing what the product is (e.g. its stage/intended age if the name states one) instead.

"recommendation" -- ONE short sentence (25 words max) of practical advice for THIS specific product:
- Say what someone should actually do: how often, in what quantity, what to watch for, or what to look for instead.
- Tie it to what is actually in THIS product. "Fine occasionally" could describe thousands of products -- be specific about why.
- Never alarmist, never preachy, never medical advice.
- EXCEPTION for infant formula: never give feeding/frequency advice -- write one sentence pointing to following the label's preparation/age instructions and a pediatrician for individual feeding decisions.

"isCondimentOrSeasoning" -- true ONLY if this product is normally used in small amounts as part of another dish rather than eaten on its own: spice blends and masalas, seasonings, stock cubes, food colours and essences, baking powder, pickles and chutneys eaten as a side relish, ketchup and sauces used as condiments.
false for anything eaten as a food in its own right -- biscuits, noodles, chips, namkeen, drinks, dairy, bread, chocolates. Also false for cooking oils, flours, rice and sugar: those are bulk ingredients eaten in real quantity, not small-quantity seasonings.

"isInfantFormula" -- true ONLY for infant formula / infant milk substitute products explicitly intended as a complete or partial substitute for breast milk for infants (e.g. named "Infant Formula", "Stage 1/2", "Follow-up Formula" for the under-1 stage, branded infant milk powders like Similac, Nan, Lactogen, Enfamil, Furilac). This is a specially regulated product category (FSSAI Infant Milk Substitutes Act, Codex Standard for Infant Formula) whose ingredient-based score should not be read the way an ordinary food's score is -- it is formulated to meet mandated nutritional requirements, not judged by "less processed is better".
false for: regular milk and milk powder, toddler/growing-up milk marketed for children over 2 years, general baby food and cereals (e.g. Cerelac) unless the specific product is itself labelled as an infant formula/infant milk substitute, and anything for adults or general consumption.

"foodType" -- exactly ONE of: "fried-snack" (namkeen, bhujia, sev, chivda, mixture, chips, wafers, murukku, papdi, banana/potato/tapioca chips, puffs and extruded snacks made by frying), "sweet-snack" (biscuits, cookies, cakes, pastries, wafer bars, chocolates, candies, mithai), "baked-snack" (baked/roasted crackers, khakhra, roasted namkeen, makhana, popcorn), "beverage" (juices, soft drinks, energy drinks, tea/coffee drinks, lassi, buttermilk, milk drinks), "dairy" (milk, curd, paneer, cheese, ghee-free dairy), "staple" (atta, rice, dal, pulses, flours, oats, cereals, bread, pasta, noodles), "oil-fat" (cooking oils, ghee, butter, vanaspati), "nuts-seeds" (plain or roasted nuts, seeds, dry fruit), "condiment" (masalas, sauces, pickles, chutneys, spreads used in small amounts), "supplement" (protein powders, vitamins, health/nutrition supplements, electrolyte/ORS), "infant" (infant formula and baby foods), "ready-meal" (instant meals, soups, frozen/ready-to-eat dishes), or "other". Pick by what the product actually IS, from its name and ingredients.
"isDeepFried" -- true ONLY if the product itself is made by deep frying (its ingredients list frying oil like palmolein/refined vegetable oil and it is a fried snack); false for baked, roasted, air-popped or non-snack foods.

"usefulContext" -- null for ordinary everyday foods. A product's ingredient score alone can't say WHY it exists, and some products genuinely have a real, specific purpose that a low or middling score would otherwise hide -- oral rehydration salts and electrolyte drinks, glucose/dextrose energy powders, protein or meal-replacement supplements. For exactly these, ONE short sentence (25 words max) naming the actual real-world situation this product is genuinely useful for (e.g. "During dehydration, heat exhaustion, or after intense exercise, for fast glucose and electrolyte replacement."). Never invent or guess at a use case that isn't well-established for this exact kind of product -- when in doubt, return null.

"story" -- the content for a separate "Story" tab on the report: this product or its ingredients' history, why it's used, any real controversy, and myth vs fact. Return null ONLY when the brand is unfamiliar/generic AND its ingredients are too ordinary to say anything specific (plain atta, plain milk, an unbranded namkeen) -- for everything else, fill it in. Object shape:
{
  "headline": "one punchy line, under 12 words, that hooks a reader into tapping the tab",
  "history": "2-4 sentences on real, well-documented history/origin -- of this exact brand/product if you genuinely know it (e.g. why it was created, a well-known milestone), otherwise of its category or defining ingredient (e.g. how instant noodles or refined flour became an Indian household staple). Never state a specific date, lawsuit, recall or event as fact unless you are confident it is real and well-known.",
  "whyItsUsed": "2-3 sentences on why manufacturers actually use these ingredients -- what functional job they do (shelf life, texture, cost, taste) -- so the reader understands the reasoning, not just the ingredient list.",
  "controversy": "2-4 sentences on a real, documented controversy, ban, recall, or ongoing health debate tied to this product/brand or its ingredients (e.g. palm oil and deforestation, MSG safety debates, a specific brand's real recall). If you genuinely know of none, say so plainly -- e.g. 'No major controversy is tied to this product or its ingredients.' -- rather than inventing one.",
  "mythVsFact": [{ "myth": "a common misconception people actually hold", "fact": "the real, accurate correction" }]
}
"mythVsFact" must have 2-4 pairs, specific to this product's category or actual ingredients (e.g. "MSG causes headaches" for a product containing it) -- never generic, unrelated nutrition trivia. Every field in "story" must be something you are genuinely confident is accurate; when you lack specific, confident knowledge about this exact brand, write about its ingredient/category instead of guessing at brand-specific facts.`;

/**
 * Write the report's human-facing text for one product in a single call:
 * the summary, a product-specific recommendation, whether this is a
 * seasoning used in small amounts (which changes how its score should be
 * read -- a masala scoring 95 is not an invitation to eat it by the
 * spoonful), whether it's a functional/medicinal-use product whose real
 * value a plain ingredient score can't express (glucose powders, ORS,
 * protein supplements -- a middling score for "eaten as an everyday food"
 * doesn't mean it isn't exactly what it should be for its actual
 * purpose), whether it's an infant formula (a specially regulated
 * category the Result page stops showing a normal 0-100 score for
 * entirely -- see result.isInfantFormula in Result.jsx -- so a real
 * report of "78/Good" never reads as "healthy for a baby"), and the
 * long-form "Story" tab content (history/legacy, why it's used,
 * controversy, myth vs fact).
 *
 * Called once per genuinely new product (the result gets cached in
 * product_reports forever after), never per repeat scan. Returns null on
 * any failure so the caller can fall back to the rule-based text instead
 * of breaking the whole report over this.
 */
export async function generateProductInsights({ productName, brand, score, verdict, harmfulNames, concerningNames, ingredientCount, ingredientNames = [] }) {
  if (GEMINI_API_KEYS.length === 0) return null;

  const details = `Product: ${productName}${brand ? ` (brand: ${brand})` : ''}
Score: ${score}/100 (${verdict})
Total ingredients: ${ingredientCount}
Ingredients: ${ingredientNames.length ? ingredientNames.join(', ') : 'not listed'}
Harmful ingredients: ${harmfulNames.length ? harmfulNames.join(', ') : 'none'}
Concerning ingredients: ${concerningNames.length ? concerningNames.join(', ') : 'none'}`;

  const requestBody = {
    contents: [{ parts: [{ text: `${INSIGHTS_PROMPT}\n\n${details}` }] }],
    generationConfig: {
      // Higher than the analysis calls on purpose -- the summary and
      // recommendation are creative writing where varied phrasing is the
      // point, not deterministic scoring where we want the same answer
      // every time. Not so high that the boolean gets unreliable.
      temperature: 0.8,
      topK: 40,
      topP: 0.95,
      // Gemini's "thinking" tokens count against this budget too, and
      // can eat 100+ tokens on their own before it writes anything --
      // too tight a limit here silently truncates the reply. Raised from
      // 1000 to fit the "story" section (history/controversy/myths) on
      // top of the original summary/recommendation.
      maxOutputTokens: 2200,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };

  try {
    const { text, finishReason } = await callGemini(requestBody);
    // Cut-off text is worse than no AI text at all -- fall back to the
    // rule-based version rather than show a broken half-sentence.
    if (!text || finishReason !== 'STOP') return null;

    const parsed = extractJson(text, finishReason);
    const clean = (s) => (typeof s === 'string' ? s.trim().replace(/^["'\s]+|["'\s]+$/g, '') : null);

    const story = (() => {
      const s = parsed?.story;
      if (!s || typeof s !== 'object') return null;
      const history = clean(s.history);
      const whyItsUsed = clean(s.whyItsUsed);
      const controversy = clean(s.controversy);
      const mythVsFact = Array.isArray(s.mythVsFact)
        ? s.mythVsFact
            .map((pair) => ({ myth: clean(pair?.myth), fact: clean(pair?.fact) }))
            .filter((pair) => pair.myth && pair.fact)
        : [];
      // A "story" with only a headline, or only myths, isn't a real
      // Story tab -- require at least one real narrative section.
      if (!history && !whyItsUsed && !controversy) return null;
      return { headline: clean(s.headline), history, whyItsUsed, controversy, mythVsFact };
    })();

    return {
      summary: clean(parsed?.summary),
      recommendation: clean(parsed?.recommendation),
      isCondimentOrSeasoning: parsed?.isCondimentOrSeasoning === true,
      isInfantFormula: parsed?.isInfantFormula === true,
      foodType: typeof parsed?.foodType === 'string' ? parsed.foodType.trim().toLowerCase() : null,
      isDeepFried: parsed?.isDeepFried === true,
      usefulContext: clean(parsed?.usefulContext),
      story,
    };
  } catch {
    // extractJson throws on unparseable output -- same fallback as any
    // other failure here, never surface it as a broken report.
    return null;
  }
}

const LABEL_REPAIR_PROMPT = `You are repairing a bracket-matching error in a food ingredients label (a missing or extra bracket, almost always from OCR or printing) that breaks automated parsing.

Rewrite the text with correctly balanced brackets. Follow these rules strictly:
- Do NOT add, remove, reorder, or reword any ingredient, word, or number. Every ingredient name and value must appear exactly as given.
- Do NOT invent anything that isn't in the original text.
- Only adjust punctuation -- brackets ( ) [ ] { }, commas, and periods -- so the structure is well-formed and each ingredient/group is clearly delimited.
- Return ONLY the corrected text as plain text. No markdown, no explanation, no preamble.`;

/**
 * Ask Gemini to fix a label's bracket punctuation when our own
 * deterministic bracket-counting can't (there's more than one plausible
 * place a missing/extra bracket belongs, which needs understanding what
 * the label means, not just counting characters). Only ever called when
 * isBracketBalanced() has already found a real problem -- most labels
 * never reach this, and it's a one-time cost per new product either way.
 * Returns null on any failure so the caller parses the original text.
 */
export async function repairLabelPunctuation(rawText) {
  if (GEMINI_API_KEYS.length === 0) return null;

  const requestBody = {
    contents: [{ parts: [{ text: `${LABEL_REPAIR_PROMPT}\n\nText to repair:\n${rawText}` }] }],
    generationConfig: {
      temperature: 0,
      topK: 1,
      topP: 0.8,
      maxOutputTokens: 2000,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };

  try {
    const { text, finishReason } = await callGemini(requestBody);
    if (!text || finishReason !== 'STOP') return null;

    return text.trim().replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  } catch {
    return null;
  }
}

// Real examples from the static curated list (didYouKnowTips.js) --
// not asking Gemini to write in the app's voice from a description,
// but showing it. "Do not repeat these" doubles as the few-shot
// examples that set tone/specificity.
//
// The topic allowlist/banlist below exists because of a real failure:
// the very first live generation confidently described the FSSAI
// veg/non-veg mark as "a green square logo" with "a brown triangle"
// for non-veg -- it's actually a green (or brown) DOT inside a square
// OUTLINE, not a colored square or a triangle. "Only answer if you're
// confident" did nothing, because it WAS confident, just wrong.
// Visual/appearance details (shape, color, position of a symbol) are
// exactly the kind of specific claim that's easy to state fluently and
// wrong, so they're banned outright rather than left to "be careful."
const DAILY_FACT_PROMPT = `You write one "Did you know?" fact for FoodGuard India, an Indian packaged-food ingredient scanner.

ONLY write about these topic categories -- pick one:
1. Ingredient list STRUCTURE/ORDER rules (e.g. descending order by weight).
2. Naming/definition differences (INS vs E numbers, "maida" vs whole wheat, "added sugar" vs "total sugar", "natural" vs "nature-identical" flavour).
3. What a claim on a label does or doesn't legally guarantee (e.g. "no added sugar" doesn't mean sugar-free) -- WITHOUT citing a specific number/threshold unless it is extremely well-established and simple (e.g. "heaviest ingredient first").
4. Which specific named substances are banned/restricted in India but legal elsewhere, or vice versa (name the substance, not a numeric limit).
5. What a mandatory disclosure category exists and why (e.g. allergen declarations, FSSAI license numbers) -- WITHOUT describing what it looks like.

NEVER do any of these, even if you feel confident:
- Describe the APPEARANCE of any symbol, logo, mark, or icon -- its shape, color, or position. If the fact is about a mark's existence, say only that a mark exists and what it's FOR, never what it looks like.
- State a specific percentage, gram, or mg threshold unless it is one already well-known and simple (do not invent or recall a precise regulatory number for something visual, chemical, or procedural that you have not seen stated many times).
- Make a medical claim ("causes cancer", "is dangerous") -- describe regulation/labeling/composition, not health outcomes.
- Imply a company is hiding something by following a real, disclosed rule.

If you cannot think of a fact that is both interesting AND fits topic categories 1-5 above with total confidence, write a simpler, more conservative fact within those categories rather than reaching for something more specific.

Examples of the right tone and specificity (do not repeat these or their exact topic):
- "FSSAI requires ingredients to be listed by weight, heaviest first -- so whatever's listed first is genuinely the biggest part of the product."
- "INS numbers and E numbers are usually the same substance -- INS is India's naming system, E numbers are Europe's, for the same additive."
- "Maida (refined wheat flour) isn't a banned or illegal ingredient -- it's just been stripped of the bran and germ, which is where most of the fibre and nutrients were."

Return ONLY a JSON object, no markdown, in this exact shape:
{"shortFact": "one sentence, under 200 characters, same voice as the examples", "detail": "3-5 sentences giving more context or nuance than the short fact -- not just restating it, still following every rule above"}`;

/**
 * Generates today's homepage "Did you know?" fact -- see
 * scripts/generate-daily-fact.js, which calls this once a day and
 * saves the result to daily_facts. Returns null on any failure
 * (including a response that doesn't parse or is missing a field);
 * the caller leaves the static curated rotation in place for that day
 * rather than saving anything.
 *
 * @param {string[]} avoidTopics - recent facts' short_fact text, so the
 *   same topic doesn't repeat day after day.
 */
// A deterministic backstop, not just a prompt instruction -- the prompt
// alone already told Gemini not to describe a symbol's appearance, and
// it did anyway on the very first real run ("a green square logo...a
// brown triangle"). Rejects any fact whose wording combines a shape/
// symbol word with a color word near each other, regardless of how the
// prompt is worded, so a future prompt regression can't silently
// reopen the exact failure this was built to close.
const APPEARANCE_CLAIM_RE =
  /\b(square|triangle|circle|dot|logo|icon|symbol|badge|stamp)\b[^.]{0,40}\b(green|brown|red|maroon|yellow|colou?r(?:ed)?)\b|\b(green|brown|red|maroon|yellow|colou?r(?:ed)?)\b[^.]{0,40}\b(square|triangle|circle|dot|logo|icon|symbol|badge|stamp)\b/i;

export async function generateDailyFact(avoidTopics = []) {
  if (GEMINI_API_KEYS.length === 0) return null;

  const avoid = avoidTopics.length
    ? `\n\nAlready used recently -- write about a genuinely different topic, not a rephrasing of any of these:\n${avoidTopics.map((t) => `- ${t}`).join('\n')}`
    : '';

  const requestBody = {
    contents: [{ parts: [{ text: DAILY_FACT_PROMPT + avoid }] }],
    generationConfig: {
      // Some variety is the point (a different real fact each day), but
      // not so high the "genuinely confident" instruction gets ignored.
      temperature: 0.8,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 500,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };

  try {
    const { text, finishReason } = await callGemini(requestBody);
    if (!text || finishReason !== 'STOP') return null;

    const parsed = extractJson(text, finishReason);
    const shortFact = typeof parsed?.shortFact === 'string' ? parsed.shortFact.trim() : null;
    const detail = typeof parsed?.detail === 'string' ? parsed.detail.trim() : null;
    if (!shortFact || !detail) return null;

    if (APPEARANCE_CLAIM_RE.test(shortFact) || APPEARANCE_CLAIM_RE.test(detail)) {
      console.warn('Rejected a generated fact for describing a symbol\'s appearance:', shortFact);
      return null;
    }

    return { shortFact, detail };
  } catch {
    // extractJson throws on unparseable output -- same as any other
    // failure here, the caller just leaves the static rotation in place.
    return null;
  }
}

const NEWS_SUMMARY_PROMPT = `You are writing short, plain-language summaries for FoodGuard India's News & Research page, for Indian consumers who are not scientists or journalists. This page is specifically about Indian packaged food safety, adulteration, recalls, nutrition and food regulation -- NOT general news.

You will get a JSON array of real items pulled from a keyword search, which sometimes matches something unrelated that just happens to contain one of the search words (e.g. a general current-affairs roundup that mentions "FDA" in passing). For EACH item, decide:

"relevant" -- true if this item is genuinely about food safety, food adulteration, nutrition, a food product/recall/regulation, or food-safety research -- India-focused or globally relevant to an Indian packaged-food audience. false if it's about something else entirely that just matched the search terms incidentally (general politics/economy/exams/crime/entertainment, etc, even if a food-adjacent word appears once).

"summary" -- ONLY when relevant is true: ONE short, plain-language sentence (25 words max) explaining what it's actually about and why it matters to someone eating packaged food in India -- not just rephrasing the title with simpler words. When relevant is false, set summary to an empty string.

Rules for the summary, type "news":
- This is third-party media reporting, not an official confirmed fact -- FoodGuard is summarizing what was REPORTED, not asserting it happened. Use attributing language: "Reports say...", "According to [source type, e.g. regulators/the report]...", "X has reportedly...". Never state a contested claim (a company did something wrong, a product is unsafe, legal action's outcome) as flat fact in FoodGuard's own voice.
- Exception: routine, undisputed facts (a study was published, an agency issued a statement, a shop was inspected) don't need hedging -- attribution is for contested/allegation-type claims specifically, not everything.
- Base it ONLY on the given title and excerpt -- never invent a specific number, finding, brand name, or outcome that isn't stated in them.

Rules for the summary, type "research":
- Describe what the study looked at/its topic, not a result it never stated in the title (e.g. "Looks at how much ultra-processed food urban Indian teenagers eat and how it relates to their health" -- NOT "Found that 60% of teenagers eat too much" unless that number is actually given).
- This is observational research -- use "associated with" / "linked to" / "looked at the relationship between", never "causes" or "proves", even if the title itself uses stronger language.

General rules for all summaries:
- No medical claims and no alarmist framing beyond what the source itself says.
- Plain conversational language -- explain any technical term inline (INS numbers, FSSAI, adulteration, etc.) instead of using it bare.

"eventKey" -- ONLY for type "news": if this item is clearly reporting on the SAME real-world event as another "news" item in this batch (e.g. five outlets all covering one regulator's action against one company on one day), give both the exact same short lowercase-hyphenated slug (e.g. "fssai-nestle-infant-formula-probe"). A list of already-known event keys from previous days may be given below -- reuse one of those exactly if this item is clearly a continuation of that same ongoing story, rather than inventing a new key for it. If this item is standalone (no other item in this batch or list is about the same event), set eventKey to null. Never invent a shared key for items that are merely on a similar TOPIC but a different specific event -- only cluster the same actual event. type "research" items always get eventKey null.

Return ONLY a valid JSON array, no markdown, one entry per input item, "id" copied exactly as given:
[{"id": "same id string as given", "relevant": true, "summary": "the one-sentence summary, or empty string if relevant is false", "eventKey": "shared-slug-or-null"}]`;

/**
 * Batches every given item into ONE Gemini call (not one call per item --
 * keeps this within the free-tier per-day request quota even as the
 * research/news table grows) and returns plain-language summaries plus a
 * story-clustering key (see news_items_add_event_key_migration.sql and
 * News.jsx, which groups same-eventKey items into one card instead of
 * one per publisher -- confirmed live as the biggest readability problem
 * with the raw per-article feed). Called by scripts/summarize-news.js for
 * whatever news_items rows don't have a summary yet; the app itself never
 * calls this directly, same separation as generateDailyFact.
 *
 * @param {{id: string, type: string, title: string, source: ?string, source_excerpt: ?string}[]} items
 * @param {{key: string, title: string}[]} existingClusters - recent
 *   event_key -> representative title pairs, so a new item continuing an
 *   already-tracked story reuses its key instead of only ever clustering
 *   within its own batch (same idea as generateDailyFact's avoidTopics).
 * @returns {Promise<{id: string, relevant: boolean, summary: string, eventKey: ?string}[]>}
 *   only the items Gemini actually returned a usable verdict for --
 *   callers should leave any missing id unprocessed rather than treat
 *   this as a hard failure. `summary` is '' when `relevant` is false.
 */
export async function summarizeNewsItems(items, existingClusters = []) {
  if (GEMINI_API_KEYS.length === 0 || items.length === 0) return [];

  const payload = items.map((item) => ({
    id: item.id,
    type: item.type,
    title: item.title,
    source: item.source || null,
    excerpt: item.source_excerpt || null,
  }));

  const clustersText = existingClusters.length
    ? `\n\nAlready-known event keys from recent days (reuse one of these exactly if a "news" item continues that same story):\n${existingClusters.map((c) => `- ${c.key}: "${c.title}"`).join('\n')}`
    : '';

  const requestBody = {
    contents: [{ parts: [{ text: `${NEWS_SUMMARY_PROMPT}${clustersText}\n\nItems:\n${JSON.stringify(payload)}` }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: Math.min(2048, 200 + items.length * 100),
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };

  try {
    const { text, finishReason } = await callGemini(requestBody);
    if (!text) return [];

    const parsed = extractJson(text, finishReason, 'array');
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((r) => r && typeof r.id === 'string' && typeof r.relevant === 'boolean')
      .map((r) => ({
        id: r.id,
        relevant: r.relevant,
        summary: r.relevant && typeof r.summary === 'string' ? r.summary.trim() : '',
        eventKey: r.relevant && typeof r.eventKey === 'string' && r.eventKey.trim() ? r.eventKey.trim() : null,
      }))
      .filter((r) => !r.relevant || r.summary); // relevant=true with an empty summary is a malformed response, not usable either way
  } catch (err) {
    console.error('summarizeNewsItems failed:', err.message);
    return [];
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      // Remove the "data:image/jpeg;base64," prefix
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
}
