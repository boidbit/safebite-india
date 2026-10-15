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

  return json(400, { error: 'Unknown action.' });
}

if (typeof Deno !== 'undefined') {
  Deno.serve((req) => handler(req, Deno.env.toObject()));
}
