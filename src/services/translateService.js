// src/services/translateService.js
//
// Translates the AI-generated per-product report text to Hindi (Devanagari)
// via Cloudflare Workers AI's hosted IndicTrans2 model -- a completely
// separate service and free-tier quota from the Gemini keys used for
// scoring/insights, so translation work never competes with real scans.
//
// Only ever called once per product -- the result is cached on the report
// (report.hi) forever after, same caching philosophy as everything else
// in this app. Unlike the hand-translated UI chrome (src/i18n/strings.js),
// this text is different for every product, so there's no fixed
// dictionary to draw from -- it has to actually be translated.
//
// Works both in the browser (Vite injects import.meta.env at build time)
// and in Node (generate-reports.js, discover scripts), same pattern as
// geminiService.js.
// `typeof process` (not a direct reference) so this never throws
// "process is not defined" in the browser when the Vite-side env var
// happens to be unset at build time -- e.g. a fresh clone or a CI build
// before the Cloudflare secret is added, same as any other page load
// should still work without translation, not crash outright.
//
// Like the Gemini keys (see geminiService.js), the Cloudflare token is read
// only in Node scripts -- never built into the website/APK. There, the
// translation goes through the ai-proxy Edge Function (aiProxy.js).
import { callAiProxy, isAiProxyAvailable } from './aiProxy.js';

const serverEnv = typeof process !== 'undefined' && process.env ? process.env : {};
const ACCOUNT_ID = serverEnv.VITE_CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = serverEnv.VITE_CLOUDFLARE_API_TOKEN;
const MODEL = '@cf/ai4bharat/indictrans2-en-indic-1B';
const hasDirectAccess = Boolean(ACCOUNT_ID && API_TOKEN);

export const isTranslateConfigured = hasDirectAccess || isAiProxyAvailable;

/**
 * Translates a batch of English strings to Hindi in ONE API call
 * (order-preserving) -- far cheaper than one call per field, and this
 * model genuinely supports it. Returns null on any failure so callers
 * fall back to showing the English text instead of a broken report.
 */
async function translateBatch(texts) {
  if (!isTranslateConfigured || texts.length === 0) return null;

  if (!hasDirectAccess) {
    const res = await callAiProxy({ kind: 'translate', texts });
    const translations = res.ok && res.data?.success ? res.data.result?.translations : null;
    return Array.isArray(translations) && translations.length === texts.length ? translations : null;
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: texts, source_lang: 'eng_Latn', target_lang: 'hin_Deva' }),
      }
    );
    if (!response.ok) return null;

    const data = await response.json();
    if (!data?.success) return null;

    const translations = data.result?.translations;
    return Array.isArray(translations) && translations.length === texts.length ? translations : null;
  } catch {
    return null;
  }
}

/**
 * Translates every translatable field of a product report to Hindi in
 * one batched call. Returns a "hi" object mirroring the shape of the
 * fields that exist on the report (only the ones that had real text),
 * or null if translation isn't configured or the call fails -- callers
 * should keep showing English in that case, never a half-broken report.
 *
 * Deliberately does NOT translate: the product name/brand (proper nouns
 * stay as-is), and per-ingredient explanations (those live in the shared
 * ingredient library, not the report, and need their own translation
 * pass keyed by ingredient rather than by product).
 */
export async function translateReportToHindi(report) {
  if (!isTranslateConfigured) return null;

  // Flatten every translatable string into one ordered job list,
  // remembering each value's index so results can be put back exactly
  // where they came from once the batched response comes back.
  const jobs = [];
  const take = (value) => {
    jobs.push(value);
    return jobs.length - 1;
  };

  const summaryIdx = report.summary ? take(report.summary) : null;
  const recommendationIdx = report.recommendation ? take(report.recommendation) : null;
  const usefulContextIdx = report.usefulContext ? take(report.usefulContext) : null;
  const flagIdxs = (report.flags || []).map((f) => take(f));
  const positiveIdxs = (report.positives || []).map((p) => take(p));

  const story = report.story;
  const storyHeadlineIdx = story?.headline ? take(story.headline) : null;
  const storyHistoryIdx = story?.history ? take(story.history) : null;
  const storyWhyIdx = story?.whyItsUsed ? take(story.whyItsUsed) : null;
  const storyControversyIdx = story?.controversy ? take(story.controversy) : null;
  const mythFactIdxs = (story?.mythVsFact || []).map((pair) => ({
    mythIdx: take(pair.myth),
    factIdx: take(pair.fact),
  }));

  if (jobs.length === 0) return null;

  const translations = await translateBatch(jobs);
  if (!translations) return null;

  const hi = {};
  if (summaryIdx !== null) hi.summary = translations[summaryIdx];
  if (recommendationIdx !== null) hi.recommendation = translations[recommendationIdx];
  if (usefulContextIdx !== null) hi.usefulContext = translations[usefulContextIdx];
  if (flagIdxs.length) hi.flags = flagIdxs.map((i) => translations[i]);
  if (positiveIdxs.length) hi.positives = positiveIdxs.map((i) => translations[i]);

  if (story) {
    hi.story = {
      headline: storyHeadlineIdx !== null ? translations[storyHeadlineIdx] : null,
      history: storyHistoryIdx !== null ? translations[storyHistoryIdx] : null,
      whyItsUsed: storyWhyIdx !== null ? translations[storyWhyIdx] : null,
      controversy: storyControversyIdx !== null ? translations[storyControversyIdx] : null,
      mythVsFact: mythFactIdxs.map(({ mythIdx, factIdx }) => ({
        myth: translations[mythIdx],
        fact: translations[factIdx],
      })),
    };
  }

  return hi;
}
