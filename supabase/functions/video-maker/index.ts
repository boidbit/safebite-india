// supabase/functions/video-maker/index.ts
//
// The admin panel's "Make video" button. Starts the GitHub workflow that
// renders a product's short (.github/workflows/make-video.yml) and reports how
// that run is going. The video is made on GitHub's machine and downloaded
// from the run's page, so nothing is stored in Supabase and no table is needed:
// each request carries a short job id, which the workflow puts in its run name.
//
//   POST { action: 'start', productId, kind }  -> { jobId }
//        kind: 'decoded' (default) | 'swap' (side by side with a better pick)
//   POST { action: 'status', jobId }     -> { state, conclusion, url }
//        state: 'queued' | 'in_progress' | 'completed'
//
// Also the clip-video actions (clip-upload / clip-start / clip-status, below).
//
// Signed-in admins only (the anon key alone isn't a user).
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   GH_VIDEO_TOKEN -- a fine-grained GitHub token for this one repository
//                     with "Actions: Read and write"
//   GH_REPO        -- optional, defaults to boidbit/safebite-india
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase itself.
//
// Plain JavaScript in a .ts file, like ai-proxy, so the handler runs under
// Node in tests.

const WORKFLOW = 'make-video.yml';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function isSignedInUser(req, env, fetchImpl) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token || token === env.SUPABASE_ANON_KEY || !env.SUPABASE_URL) return false;
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY || '' } });
    if (!res.ok) return false;
    return Boolean((await res.json())?.id);
  } catch {
    return false;
  }
}

const github = (env, fetchImpl, pathname, init = {}) => fetchImpl(`https://api.github.com/repos/${env.GH_REPO || 'boidbit/safebite-india'}${pathname}`, {
  ...init,
  headers: { Authorization: `Bearer ${env.GH_VIDEO_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'foodguard-video-maker', ...(init.headers || {}) },
});

// ---- clip videos ----
//
//   POST { action: 'clip-upload', name }                 -> { path, token }   one-off upload token for the clip
//        the page then uploads with supabase.storage.from('promo-clips').uploadToSignedUrl(path, token, file)
//   POST { action: 'clip-start', clip, mode, script? }   -> { jobId }
//        mode 'draft' (the words + what was found in the clip) | 'render' (the video, with the approved script)
//   POST { action: 'clip-status', jobId, mode }          -> { state, conclusion, url, draft?, video?, caption?, error? }
//
// The clip, the job file (jobs/<id>.json) and the results (out/<id>-draft.json,
// out/<id>.mp4, out/<id>-caption.txt, out/<id>-error.json) are all in the
// private promo-clips bucket, reached with the service role key; the page only
// ever gets an upload token and one-hour download links.
const BUCKET = 'promo-clips';
const CLIP_WORKFLOW = 'make-clip-video.yml';
const hex8 = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8);

const storage = (env, fetchImpl, pathname, init = {}) => fetchImpl(`${env.SUPABASE_URL}/storage/v1${pathname}`, {
  ...init,
  headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY, ...(init.headers || {}) },
});

/** A script handed back by the page -- { beat: { show, say, sticker? } }, strings only, nothing else -- or null. */
export function cleanScript(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [beat, line] of Object.entries(raw)) {
    if (!/^[a-z]{2,10}$/.test(beat) || !line || typeof line.show !== 'string' || typeof line.say !== 'string') return null;
    if (line.show.length > 300 || line.say.length > 400) return null;
    out[beat] = { show: line.show, say: line.say, ...(typeof line.sticker === 'string' ? { sticker: line.sticker.slice(0, 40) } : {}) };
  }
  const n = Object.keys(out).length;
  return n > 0 && n <= 16 ? out : null;
}

async function readJson(env, fetchImpl, path) {
  const res = await storage(env, fetchImpl, `/object/${BUCKET}/${path}`);
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

async function readText(env, fetchImpl, path) {
  const res = await storage(env, fetchImpl, `/object/${BUCKET}/${path}`);
  return res.ok ? res.text() : null;
}

/** A one-hour link to a file in the bucket (name: the file name a download is saved under). */
async function signed(env, fetchImpl, path, name) {
  const res = await storage(env, fetchImpl, `/object/sign/${BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
  if (!res.ok) return null;
  const { signedURL } = await res.json().catch(() => ({}));
  return signedURL ? `${env.SUPABASE_URL}/storage/v1${signedURL}${name ? `&download=${encodeURIComponent(name)}` : ''}` : null;
}

async function clipAction(input, env, fetchImpl) {
  if (input.action === 'clip-upload') {
    const ext = /\.(mp4|mov|webm)$/i.exec(String(input.name || ''))?.[1]?.toLowerCase() || 'mp4';
    const path = `clips/web-${hex8()}.${ext}`;
    const res = await storage(env, fetchImpl, `/object/upload/sign/${BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) return json(502, { error: `Storage refused the upload (${res.status}).` });
    const body = await res.json().catch(() => ({}));
    const token = body.token || new URL(body.url || '', 'https://storage.invalid').searchParams.get('token');
    if (!token) return json(502, { error: 'Storage gave no upload token.' });
    return json(200, { path, token });
  }

  if (input.action === 'clip-start') {
    const clip = String(input.clip || '');
    if (!/^clips\/web-[0-9a-f]{8}\.(mp4|mov|webm)$/.test(clip)) return json(400, { error: 'Not an uploaded clip.' });
    const mode = input.mode === 'render' ? 'render' : 'draft';
    const script = input.script == null ? null : cleanScript(input.script);
    if (input.script != null && !script) return json(400, { error: 'The script is not in the expected shape.' });
    const jobId = hex8();
    // check: a script that comes from the page is held to the same rules as Gemini's own (promo/shorts/clip.mjs).
    const wrote = await storage(env, fetchImpl, `/object/${BUCKET}/jobs/${jobId}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' },
      body: JSON.stringify({ clip, check: true, ...(script ? { script } : {}) }),
    });
    if (!wrote.ok) return json(502, { error: `Could not save the job (${wrote.status}).` });
    const res = await github(env, fetchImpl, `/actions/workflows/${CLIP_WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { bucket_job: `jobs/${jobId}.json`, mode, job_id: jobId } }),
    });
    if (res.status !== 204) {
      const detail = await res.text().catch(() => '');
      return json(502, { error: `GitHub refused to start the video (${res.status}). ${detail.slice(0, 200)}` });
    }
    return json(200, { jobId });
  }

  if (input.action === 'clip-status') {
    const jobId = String(input.jobId || '');
    if (!/^[0-9a-f]{8}$/.test(jobId)) return json(400, { error: 'Bad jobId.' });
    const res = await github(env, fetchImpl, `/actions/workflows/${CLIP_WORKFLOW}/runs?event=workflow_dispatch&per_page=30`);
    if (!res.ok) return json(502, { error: `GitHub status check failed (${res.status}).` });
    const { workflow_runs: runs = [] } = await res.json();
    const run = runs.find((r) => String(r.display_title || '').includes(`[${jobId}]`));
    if (!run) return json(200, { state: 'queued', conclusion: null, url: null });
    const state = run.status === 'completed' ? 'completed' : run.status === 'in_progress' ? 'in_progress' : 'queued';
    const out = { state, conclusion: run.conclusion, url: run.html_url };
    if (state !== 'completed') return json(200, out);
    if (run.conclusion !== 'success') {
      out.error = (await readJson(env, fetchImpl, `out/${jobId}-error.json`))?.error || null;
    } else if (input.mode === 'render') {
      out.video = await signed(env, fetchImpl, `out/${jobId}.mp4`);
      out.download = await signed(env, fetchImpl, `out/${jobId}.mp4`, `foodguard-short-${jobId}.mp4`);
      out.caption = await readText(env, fetchImpl, `out/${jobId}-caption.txt`);
    } else {
      out.draft = await readJson(env, fetchImpl, `out/${jobId}-draft.json`);
    }
    return json(200, out);
  }

  return json(400, { error: 'Unknown action.' });
}

/**
 * @param {Request} req
 * @param {Record<string, string>} env
 * @param {typeof fetch} [fetchImpl] - swapped out in tests
 */
export async function handler(req, env, fetchImpl = fetch) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only.' });
  if (!(await isSignedInUser(req, env, fetchImpl))) return json(403, { error: 'Sign in to the admin panel first.' });
  if (!env.GH_VIDEO_TOKEN) return json(500, { error: 'Video maker is not set up: GH_VIDEO_TOKEN secret is missing.' });

  let input;
  try { input = await req.json(); } catch { return json(400, { error: 'Invalid JSON.' }); }

  if (input?.action === 'start') {
    const productId = String(input.productId || '');
    if (!/^[0-9a-f-]{36}$/i.test(productId)) return json(400, { error: 'productId must be a product id.' });
    const kind = input.kind === 'swap' ? 'swap' : 'decoded';
    const jobId = crypto.randomUUID().slice(0, 8);
    const res = await github(env, fetchImpl, `/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { product: productId, kind, job_id: jobId } }),
    });
    if (res.status !== 204) {
      const detail = await res.text().catch(() => '');
      return json(502, { error: `GitHub refused to start the video (${res.status}). ${detail.slice(0, 200)}` });
    }
    return json(200, { jobId });
  }

  if (input?.action === 'status') {
    const jobId = String(input.jobId || '');
    if (!/^[0-9a-f]{8}$/.test(jobId)) return json(400, { error: 'Bad jobId.' });
    const res = await github(env, fetchImpl, `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`);
    if (!res.ok) return json(502, { error: `GitHub status check failed (${res.status}).` });
    const { workflow_runs: runs = [] } = await res.json();
    const run = runs.find((r) => String(r.display_title || '').includes(`[${jobId}]`));
    // GitHub takes a few seconds to list a run it has just accepted.
    if (!run) return json(200, { state: 'queued', conclusion: null, url: null });
    return json(200, { state: run.status === 'completed' ? 'completed' : run.status === 'in_progress' ? 'in_progress' : 'queued', conclusion: run.conclusion, url: run.html_url });
  }

  // ---- clip videos: a phone clip of a pack -> a short (.github/workflows/make-clip-video.yml) ----
  // The clip, the job and the results live in the private promo-clips bucket,
  // reached here with the service role key; the browser only ever gets a
  // one-off upload token and, later, a one-hour download link.
  if (typeof input?.action === 'string' && input.action.startsWith('clip-')) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json(500, { error: 'Clip videos are not set up: the function has no service role key.' });
    return clipAction(input, env, fetchImpl);
  }

  return json(400, { error: 'Unknown action.' });
}

if (typeof Deno !== 'undefined') {
  Deno.serve((req) => handler(req, Deno.env.toObject()));
}
