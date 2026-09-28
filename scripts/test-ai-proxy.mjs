// Tests supabase/functions/ai-proxy's handler under Node with a fake
// fetch -- no real Gemini/Cloudflare calls, no quota used.
// Run: node --test scripts/test-ai-proxy.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../supabase/functions/ai-proxy/index.ts';

const env = {
  GEMINI_API_KEY: 'k1', GEMINI_API_KEY_2: 'k2',
  CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'cf',
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon',
};
let ipSeq = 0;
const req = (payload, { auth = 'Bearer anon', ip } = {}) => new Request('https://x/functions/v1/ai-proxy', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: auth, 'x-forwarded-for': ip || `10.0.0.${++ipSeq}` },
  body: JSON.stringify(payload),
});
const body = { contents: [{ parts: [{ text: 'hi' }] }] };

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const [match, respond] of routes) if (String(url).includes(match)) return respond(String(url), init, calls);
    throw new Error('unexpected fetch ' + url);
  };
  fn.calls = calls;
  return fn;
}
const ok = (payload) => new Response(JSON.stringify(payload), { status: 200 });

test('text model goes through, key stays on the server', async () => {
  const f = fakeFetch([['generativelanguage', () => ok({ candidates: [{ content: { parts: [{ text: 'hello' }] } }] })]]);
  const res = await handler(req({ kind: 'gemini', model: 'gemini-3.1-flash-lite', body }), env, f);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).candidates[0].content.parts[0].text, 'hello');
  assert.match(f.calls[0].url, /key=k[12]/);
  assert.equal(JSON.parse(f.calls[0].init.body).generationConfig.maxOutputTokens, 8192); // capped when missing
});

test('a model the app does not use is refused', async () => {
  const res = await handler(req({ kind: 'gemini', model: 'gemini-9-ultra', body }), env, fakeFetch([]));
  assert.equal(res.status, 400);
});

test('image models need a signed-in admin', async () => {
  const noUser = await handler(req({ kind: 'gemini', model: 'gemini-3.1-flash-image', body }), env, fakeFetch([]));
  assert.equal(noUser.status, 403);
  const f = fakeFetch([
    ['/auth/v1/user', () => ok({ id: 'admin-1' })],
    ['generativelanguage', () => ok({ candidates: [] })],
  ]);
  const withUser = await handler(req({ kind: 'gemini', model: 'gemini-3.1-flash-image', body }, { auth: 'Bearer user-jwt' }), env, f);
  assert.equal(withUser.status, 200);
});

test('an out-of-quota key falls through to the next one', async () => {
  const f = fakeFetch([['generativelanguage', (url) => (url.includes('key=k1')
    ? new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 })
    : ok({ candidates: [{ content: { parts: [{ text: 'from k2' }] } }] }))]]);
  // two calls so both starting keys get tried at least once
  const r1 = await handler(req({ kind: 'gemini', model: 'gemini-3.1-flash-lite', body }), env, f);
  const r2 = await handler(req({ kind: 'gemini', model: 'gemini-3.1-flash-lite', body }), env, f);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
});

test('translation forwards to Cloudflare with the server token', async () => {
  const f = fakeFetch([['api.cloudflare.com', (url, init) => ok({ success: true, result: { translations: ['नमस्ते'] }, auth: init.headers.Authorization })]]);
  const res = await handler(req({ kind: 'translate', texts: ['Hello'] }), env, f);
  const out = await res.json();
  assert.equal(out.result.translations[0], 'नमस्ते');
  assert.equal(out.auth, 'Bearer cf');
});

test('bad input, oversized input and floods are refused', async () => {
  assert.equal((await handler(req({ kind: 'translate', texts: [] }), env, fakeFetch([]))).status, 400);
  assert.equal((await handler(req({ kind: 'nope' }), env, fakeFetch([]))).status, 400);
  const huge = { kind: 'gemini', model: 'gemini-3.1-flash-lite', body: { contents: [{ parts: [{ text: 'x'.repeat(13 * 1024 * 1024) }] }] } };
  assert.equal((await handler(req(huge), env, fakeFetch([]))).status, 413);
  const f = fakeFetch([['generativelanguage', () => ok({ candidates: [] })]]);
  let last;
  for (let i = 0; i < 45; i++) last = await handler(req({ kind: 'gemini', model: 'gemini-3.1-flash-lite', body }, { ip: '9.9.9.9' }), env, f);
  assert.equal(last.status, 429);
});
