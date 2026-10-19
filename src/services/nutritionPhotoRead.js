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

/** The table on one photo, or null when the model gave no usable answer. */
export async function readNutritionPhoto(buf, productName) {
  const body = {
    contents: [{ parts: [{ text: `${PROMPT}\n\nProduct: ${productName}` }, { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }] }],
    generationConfig: { temperature: 0, topK: 1, maxOutputTokens: 900, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
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
