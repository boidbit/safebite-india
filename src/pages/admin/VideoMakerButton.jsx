// src/pages/admin/VideoMakerButton.jsx
//
// "Make video" on an approved product's edit page. Asks the video-maker Edge
// Function (supabase/functions/video-maker) to start the GitHub workflow that
// renders the product's short, then checks on it every few seconds. The
// finished MP4 + caption are downloaded from the GitHub run's page -- they're
// never stored in Supabase. The job is remembered per product on this device,
// so leaving the page and coming back still shows how it went.
import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

const POLL_MS = 12000;
const KEEP_DAYS = 30; // GitHub keeps the download this long
const storageKey = (id) => `foodguard-video-job-${id}`;

async function callVideoMaker(body) {
  const { data, error } = await supabase.functions.invoke('video-maker', { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* not a JSON error body */ }
    throw new Error(message);
  }
  return data;
}

function readJob(id) {
  try {
    const job = JSON.parse(localStorage.getItem(storageKey(id)));
    return job && Date.now() - job.startedAt < KEEP_DAYS * 864e5 ? job : null;
  } catch {
    return null;
  }
}

export default function VideoMakerButton({ productId }) {
  const [job, setJob] = useState(() => readJob(productId));
  const [status, setStatus] = useState(null); // { state, conclusion, url }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const done = status?.state === 'completed';
  const ok = done && status.conclusion === 'success';

  useEffect(() => {
    if (!job || done) return undefined;
    let stop = false;
    const check = async () => {
      try {
        const s = await callVideoMaker({ action: 'status', jobId: job.jobId });
        if (!stop) setStatus(s);
      } catch (err) {
        if (!stop) setError(err.message);
      }
    };
    check();
    const poll = setInterval(check, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; clearInterval(poll); clearInterval(tick); };
  }, [job, done]);

  const start = async () => {
    setBusy(true);
    setError('');
    setStatus(null);
    try {
      const { jobId } = await callVideoMaker({ action: 'start', productId });
      const next = { jobId, startedAt: Date.now() };
      try { localStorage.setItem(storageKey(productId), JSON.stringify(next)); } catch { /* private mode */ }
      setJob(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const elapsed = job ? Math.max(0, Math.round((now - job.startedAt) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const running = job && !done && !error;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 px-3.5 py-2.5 rounded-[12px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
      <span className="text-[12.5px] font-semibold" style={{ color: 'var(--label-2)' }}>🎬 Short video</span>
      <span className="text-[12px] flex-1 min-w-[200px]" style={{ color: 'var(--label-3)' }}>
        {running && (status?.state === 'in_progress' ? `Making the video on GitHub… ${clock} (takes 3–4 min)` : `Waiting for GitHub to start… ${clock}`)}
        {ok && 'Ready — download “video” from the bottom of the GitHub page (MP4 + caption).'}
        {done && !ok && 'It didn’t work. The GitHub page says why (often: no photo, or typo ingredients to fix in Manual review).'}
        {!job && !error && 'A 30-second 9:16 short of this product — real label, score, music and a caption. Made on GitHub, nothing stored here.'}
        {error && <span style={{ color: 'var(--v-poor)' }}>{error}</span>}
      </span>
      <div className="flex items-center gap-2 ml-auto">
        {status?.url && (
          <a href={status.url} target="_blank" rel="noreferrer" className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-white" style={{ background: ok ? 'var(--v-good)' : done ? 'var(--v-poor)' : 'var(--label-3)' }}>
            {ok ? 'Download ↗' : done ? 'See why ↗' : 'Watch on GitHub ↗'}
          </a>
        )}
        {(!running || error) && (
          <button type="button" disabled={busy} onClick={start} className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)', opacity: busy ? 0.5 : 1 }}>
            {busy ? 'Starting…' : job ? 'Make again' : 'Make video'}
          </button>
        )}
      </div>
    </div>
  );
}
