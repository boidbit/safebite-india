// supabase/functions/ai-proxy/index.ts
//
// The app's only way to reach Gemini and Cloudflare Workers AI. The API
// keys live here as Supabase secrets, never in the website/APK code (they
// used to be built into the JavaScript every visitor downloads).
//
//   POST { kind: 'gemini', model, body }   -> Gemini generateContent, keys round-robin
//   POST { kind: 'translate', texts }      -> Cloudflare IndicTrans2, English -> Hindi
//
// Guard rails: only the app's own models; the image-generation models
// (admin photo clean-up) only for a signed-in admin; request size and
// output length capped; a per-IP request limit.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   GEMINI_API_KEY, GEMINI_API_KEY_2 ... GEMINI_API_KEY_6
//   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase itself.
//
// Written as plain JavaScript inside a .ts file so the same handler can be
// run under Node in tests (scripts/test-ai-proxy.mjs).

const TEXT_MODELS = new Set(['gemini-3.1-flash-lite']);
const ADMIN_ONLY_MODELS = new Set(['gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image']);
const TRANSLATE_MODEL = '@cf/ai4bharat/indictrans2-en-indic-1B';

const MAX_BODY_BYTES = 12 * 1024 * 1024; // a phone photo, base64-encoded, fits comfortably
const MAX_OUTPUT_TOKENS = 8192;
const MAX_TRANSLATE_TEXTS = 200;
const MAX_TRANSLATE_CHARS = 60000;

// Per instance, per IP. Edge instances are short-lived and several can run
// at once, so this is a brake on a single abuser, not an exact quota.
const RATE_LIMIT_PER_MINUTE = 40;
const hits = new Map(); // ip -> { windowStart, count }

// Same round-robin + cooldown as the app used client-side (geminiService.js).
let nextKey = 0;
const cooldownUntil = new Map();
const RATE_COOLDOWN_MS = 60 * 1000;
const DAILY_COOLDOWN_MS = 60 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function geminiKeys(env) {
  return ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5', 'GEMINI_API_KEY_6']
    .map((k) => env[k])
    .filter(Boolean);
}

function rateLimited(ip, now) {
  const h = hits.get(ip);
  if (!h || now - h.windowStart > 60000) {
    hits.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  h.count += 1;
  return h.count > RATE_LIMIT_PER_MINUTE;
}

// A signed-in admin's session token (the anon key alone isn't a user).
async function isSignedInUser(req, env, fetchImpl) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token === env.SUPABASE_ANON_KEY || !env.SUPABASE_URL) return false;
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY || '' } });
    if (!res.ok) return false;
    const user = await res.json();
    return Boolean(user?.id);
  } catch {
    return false;
  }
}

async function callGemini(model, body, env, fetchImpl) {
  const keys = geminiKeys(env);
  if (keys.length === 0) return json(500, { error: { message: 'AI is not configured on the server.' } });
  const now = Date.now();
  const order = [];
  for (let n = 0; n < keys.length; n++) order.push((nextKey + n) % keys.length);
  const cooling = (i) => (cooldownUntil.get(i) || 0) > now;
  const tryOrder = [...order.filter((i) => !cooling(i)), ...order.filter(cooling)];

  let last = null;
  for (const i of tryOrder) {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys[i]}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({ error: { message: 'Bad response from Gemini.' } }));
    if (res.ok) {
      nextKey = (i + 1) % keys.length;
      cooldownUntil.delete(i);
      return json(200, payload);
    }
    const message = payload?.error?.message || '';
    last = { status: res.status, payload };
    // Out of quota on this key -> bench it and try the next one.
    if (res.status === 429 || /quota|rate limit/i.test(message)) {
      cooldownUntil.set(i, Date.now() + (/per\s?day|daily/i.test(message) ? DAILY_COOLDOWN_MS : RATE_COOLDOWN_MS));
      continue;
    }
    break; // a real error (bad request etc.) -- same answer from every key
  }
  return json(last?.status || 502, last?.payload || { error: { message: 'Gemini request failed.' } });
}

async function translate(texts, env, fetchImpl) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) return json(500, { success: false, errors: [{ message: 'Translation is not configured on the server.' }] });
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${TRANSLATE_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, source_lang: 'eng_Latn', target_lang: 'hin_Deva' }),
  });
  const payload = await res.json().catch(() => ({ success: false }));
  return json(res.status, payload);
}

/**
 * @param {Request} req
 * @param {Record<string, string>} env
 * @param {typeof fetch} [fetchImpl] - swapped out in tests
 */
export async function handler(req, env, fetchImpl = fetch) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: { message: 'POST only.' } });

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip, Date.now())) return json(429, { error: { message: 'Too many requests -- please wait a minute and try again.' } });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: { message: 'Request too large.' } });
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return json(400, { error: { message: 'Invalid JSON.' } });
  }

  if (input?.kind === 'gemini') {
    const { model, body } = input;
    if (!body || !Array.isArray(body.contents)) return json(400, { error: { message: 'Missing contents.' } });
    if (ADMIN_ONLY_MODELS.has(model)) {
      if (!(await isSignedInUser(req, env, fetchImpl))) return json(403, { error: { message: 'This AI feature is for signed-in admins only.' } });
    } else if (!TEXT_MODELS.has(model)) {
      return json(400, { error: { message: `Model not allowed: ${model}` } });
    }
    const generationConfig = { ...(body.generationConfig || {}) };
    if (!generationConfig.maxOutputTokens || generationConfig.maxOutputTokens > MAX_OUTPUT_TOKENS) generationConfig.maxOutputTokens = MAX_OUTPUT_TOKENS;
    return callGemini(model, { ...body, generationConfig }, env, fetchImpl);
  }

  if (input?.kind === 'translate') {
    const texts = input.texts;
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TRANSLATE_TEXTS || texts.some((x) => typeof x !== 'string')) {
      return json(400, { success: false, errors: [{ message: 'texts must be a non-empty array of strings.' }] });
    }
    if (texts.reduce((n, x) => n + x.length, 0) > MAX_TRANSLATE_CHARS) return json(413, { success: false, errors: [{ message: 'Too much text.' }] });
    return translate(texts, env, fetchImpl);
  }

  return json(400, { error: { message: 'Unknown kind.' } });
}

// Supabase runs this; Node (tests) imports `handler` and skips it.
if (typeof Deno !== 'undefined') {
  Deno.serve((req) => handler(req, Deno.env.toObject()));
}
