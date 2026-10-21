// src/services/nutritionPhotoRead.js
//
// Reads the nutrition table printed on a pack photo (Gemini vision) -- for the
// Blinkit nutrition re-check and fix scripts. Node-only in practice (the
// scripts pass a downloaded image buffer).
import { callGemini } from './geminiService.js';

const PROMPT = `You are reading ONE photo from an Indian packaged food product's online listing.

Return ONLY JSON:
{"hasNutritionTable": boolean,
 "per100Basis": "g" | "ml" | null,
 "servingSize": string | null,
 "per100": {"caloriesKcal": n, "proteinG": n, "carbohydrateG": n, "totalSugarG": n, "addedSugarG": n, "totalFatG": n, "saturatedFatG": n, "transFatG": n, "sodiumMg": n} | null,
 "perServing": { same keys } | null}

Rules:
- Only numbers printed in the nutrition information table on the pack. hasNutritionTable false if there is no such table in this photo.
- "per100": the "per 100 g" or "per 100 ml" column. "perServing": the per-serving column. Fill whichever the table has; null for a column it doesn't have.
- Sodium in mg (convert g to mg). Energy in kcal (if only kJ is printed, divide by 4.184).
- If a row is not printed, use null for it. Never guess or calculate a value that isn't printed.`;

/**
 * The table on one photo, or null when the model gave no usable answer.
 * `check: true` is the confirming read: at temperature 0 the same request gives
 * the same answer back, which confirms nothing, so the second read is asked
 * differently (go figure by figure) with some freedom to come out different.
 */
export async function readNutritionPhoto(buf, productName, { check = false } = {}) {
  const ask = check
    ? `${PROMPT}\n\nRead the table again from scratch, row by row, checking each number against its row name and column.`
    : PROMPT;
  const body = {
    contents: [{ parts: [{ text: `${ask}\n\nProduct: ${productName}` }, { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }] }],
    generationConfig: { temperature: check ? 0.4 : 0, ...(check ? {} : { topK: 1 }), maxOutputTokens: 900, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
  };
  const { text, finishReason } = await callGemini(body);
  if (finishReason !== 'STOP' || !text) return null;
  return JSON.parse(text);
}

/** Only the numeric figures of a table. */
export const numbersOnly = (o) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) : null);

/** "100 ml (53 g)" -> 53, "1 cup (240mL)" -> 240, "238 ml" -> 238, "1 Can" -> null. Grams first: a food's per-100 column is per 100 g. */
export function servingAmount(text) {
  const s = String(text || '');
  const g = s.match(/([\d.]+)\s*g\b/i);
  const ml = s.match(/([\d.]+)\s*ml\b/i);
  const v = parseFloat((g || ml || [])[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The pack's per-100 column; worked out from the per-serving one when the pack prints only that. */
export function per100FromPhoto(photo, fallbackAmount) {
  const per100 = numbersOnly(photo?.per100);
  if (per100 && Object.keys(per100).length) return { table: per100, derived: false };
  const perServing = numbersOnly(photo?.perServing);
  const amount = servingAmount(photo?.servingSize ?? photo?.serving) || fallbackAmount;
  if (!perServing || !Object.keys(perServing).length || !amount) return { table: null, derived: false };
  const k = 100 / amount;
  return { table: Object.fromEntries(Object.entries(perServing).map(([key, v]) => [key, Math.round(v * k * 100) / 100])), derived: true };
}

const close = (a, b) => Math.abs(a - b) <= Math.max(0.15, Math.abs(b) * 0.05);
/** Two reads of the same table agree on every figure both give, and give at least 3. */
export function readsAgree(a, b) {
  const keys = Object.keys(a || {}).filter((k) => typeof b?.[k] === 'number');
  return keys.length >= 3 && keys.every((k) => close(a[k], b[k]));
}

// Our table keys -> Blinkit's own attribute names, so a table read off the pack
// goes down the same path as Blinkit's text (blinkitProductsRepo.js).
const AS_ATTRIBUTE = {
  caloriesKcal: ['Energy', 'kcal'], proteinG: ['Protein', 'g'], carbohydrateG: ['Total Carbohydrates', 'g'],
  totalSugarG: ['Total Sugar', 'g'], addedSugarG: ['Added Sugar', 'g'], totalFatG: ['Total Fat', 'g'],
  saturatedFatG: ['Saturated Fat', 'g'], transFatG: ['Trans Fat', 'g'], sodiumMg: ['Sodium', 'mg'],
};
export function asBlinkitAttributes(per100) {
  const out = {};
  for (const [k, [label, unit]] of Object.entries(AS_ATTRIBUTE)) {
    if (typeof per100?.[k] === 'number') out[label] = `${Math.round(per100[k] * 100) / 100} ${unit}`;
  }
  return out;
}

/**
 * The nutrition table from a product's gallery photos, read TWICE: the first
 * photo with a table is read again, and only two reads that agree -- and give a
 * table that isn't impossible -- count. Otherwise null, and the caller keeps
 * Blinkit's text.
 * @param {string} productName
 * @param {string[]} imageUrls - the gallery, in Blinkit's order
 * @param {{ photo: (url: string) => Promise<Buffer|null>, packAmount?: number|null, maxPhotos?: number, gapMs?: number, isImpossible?: (per100: object) => boolean }} opts
 * @returns {Promise<{ per100: object, photoNo: number } | { failed: string }>}
 */
export async function nutritionFromPhotos(productName, imageUrls, { photo, packAmount = null, maxPhotos = 8, gapMs = 4200, isImpossible = () => false } = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Gemini's "high demand" errors pass in a minute or so: two more tries before giving up.
  const read = async (buf, opts) => {
    for (let tryNo = 1; ; tryNo++) {
      try { return await readNutritionPhoto(buf, productName, opts); } catch (e) { if (tryNo === 3) throw e; await wait(30000 * tryNo); }
    }
  };
  for (const [i, url] of imageUrls.slice(0, maxPhotos).entries()) {
    const buf = await photo(url);
    if (!buf) continue;
    let first;
    try { first = await read(buf); } catch (e) { return { failed: `photo read failed: ${String(e.message).slice(0, 40)}` }; }
    await wait(gapMs);
    if (!first?.hasNutritionTable) continue;
    let second;
    try { second = await read(buf, { check: true }); } catch (e) { return { failed: `second read failed: ${String(e.message).slice(0, 40)}` }; }
    await wait(gapMs);
    const one = per100FromPhoto(first, packAmount).table;
    const two = per100FromPhoto(second, packAmount).table;
    if (!one || !two) return { failed: `table on photo ${i + 1} has no per-100 figures` };
    if (!readsAgree(one, two)) return { failed: `the two reads of photo ${i + 1} disagree` };
    if (isImpossible(two)) return { failed: `the table on photo ${i + 1} can't be right` };
    return { per100: two, photoNo: i + 1 };
  }
  return { failed: 'no nutrition table on the photos' };
}
