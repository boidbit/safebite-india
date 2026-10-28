// src/pages/admin/AdminClipVideos.jsx
//
// "Clip videos": a phone clip of a pack in, a finished 9:16 short out.
//   1. pick the clip -> it is uploaded to the private promo-clips bucket and a
//      DRAFT is started on GitHub (about 2 minutes): the product the clip's
//      barcode opens, what was found in the clip, and the words Gemini wrote;
//   2. read the words; "Approve" starts the RENDER (about 6 minutes), "Write
//      again" asks Gemini for another script;
//   3. the finished video plays here, with its caption.
// All of it runs through the video-maker Edge Function
// (supabase/functions/video-maker) and the make-clip-video GitHub workflow;
// the clip, the words and the video live in the private promo-clips bucket
// and are reached only through one-hour links.
import { useEffect, useRef, useState } from 'react';
import AdminLayout from './AdminLayout';
import { supabase } from '../../services/supabaseClient';

const POLL_MS = 8000;
const KEEP = 'foodguard-clip-video-job';

async function callVideoMaker(body) {
  const { data, error } = await supabase.functions.invoke('video-maker', { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch { /* not a JSON error body */ }
    throw new Error(message);
  }
  return data;
}

const readKept = () => { try { return JSON.parse(localStorage.getItem(KEEP)) || null; } catch { return null; } };
const keep = (job) => { try { if (job) localStorage.setItem(KEEP, JSON.stringify(job)); else localStorage.removeItem(KEEP); } catch { /* private mode */ } };

const BEAT_NAMES = {
  hook: 'Opening', tease: 'Tease', turn: 'Turn the pack', fat: 'Fat', sugar: 'Sugar', serving: 'Serving vs pack', satfat: 'Saturated fat',
  sodium: 'Salt', sugarpct: 'Sugar (daily limit)', ing: 'Ingredients', scan: 'Scan', score: 'Score', app: 'The app', cta: 'End',
};

export default function AdminClipVideos() {
  const kept = useRef(readKept()).current;
  // stage: idle | uploading | drafting | review | rendering | done
  const [stage, setStage] = useState(kept ? (kept.mode === 'render' ? 'rendering' : 'drafting') : 'idle');
  const [file, setFile] = useState(null);
  const [job, setJob] = useState(kept); // { jobId, mode, clip, startedAt }
  const [status, setStatus] = useState(null);
  const [draft, setDraft] = useState(kept?.draft || null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  // Check on the running job every few seconds.
  useEffect(() => {
    if (!job || (stage !== 'drafting' && stage !== 'rendering')) return undefined;
    let stop = false;
    const check = async () => {
      try {
        const s = await callVideoMaker({ action: 'clip-status', jobId: job.jobId, mode: job.mode });
        if (stop) return;
        setStatus(s);
        if (s.state !== 'completed') return;
        if (s.conclusion !== 'success') { setError(s.error || 'It did not work.'); setStage('failed'); return; }
        if (job.mode === 'draft') {
          if (s.draft) { setDraft(s.draft); keep({ ...job, draft: s.draft }); setStage('review'); } else setError('The draft finished but could not be read.');
        } else setStage('done');
      } catch (err) {
        if (!stop) setError(err.message);
      }
    };
    check();
    const poll = setInterval(check, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { stop = true; clearInterval(poll); clearInterval(tick); };
  }, [job, stage]);

  const reset = () => { keep(null); setJob(null); setStatus(null); setDraft(null); setError(''); setFile(null); setStage('idle'); };

  const startDraft = async (clip) => {
    setError('');
    setStatus(null);
    const { jobId } = await callVideoMaker({ action: 'clip-start', clip, mode: 'draft' });
    const next = { jobId, mode: 'draft', clip, startedAt: Date.now() };
    keep(next);
    setJob(next);
    setStage('drafting');
  };

  const upload = async () => {
    if (!file) return;
    setError('');
    setStage('uploading');
    try {
      const { path, token } = await callVideoMaker({ action: 'clip-upload', name: file.name });
      const { error: upErr } = await supabase.storage.from('promo-clips').uploadToSignedUrl(path, token, file);
      if (upErr) throw new Error(/size|exceed/i.test(upErr.message) ? 'The clip is too big for the free storage (about 50 MB). Record a shorter clip, or a lower quality.' : upErr.message);
      await startDraft(path);
    } catch (err) {
      setError(err.message);
      setStage('idle');
    }
  };

  const again = async () => {
    try { await startDraft(job.clip); } catch (err) { setError(err.message); setStage('review'); }
  };

  const approve = async () => {
    setError('');
    try {
      const { jobId } = await callVideoMaker({ action: 'clip-start', clip: job.clip, mode: 'render', script: draft.lines });
      const next = { jobId, mode: 'render', clip: job.clip, startedAt: Date.now(), draft };
      keep(next);
      setJob(next);
      setStatus(null);
      setStage('rendering');
    } catch (err) {
      setError(err.message);
    }
  };

  const elapsed = job ? Math.max(0, Math.round((now - job.startedAt) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const card = { background: 'var(--bg-card)', border: '1px solid var(--separator)' };
  const btn = (primary) => ({ background: primary ? 'var(--tint)' : 'var(--fill)', color: primary ? '#fff' : 'var(--label-1)' });

  return (
    <AdminLayout>
      <p className="text-[22px] font-bold tracking-tight mb-1" style={{ color: 'var(--label-1)' }}>Clip videos</p>
      <p className="text-[13px] mb-4" style={{ color: 'var(--label-3)' }}>
        A phone clip of a pack in, a 9:16 short out: the label's numbers boxed, the barcode scanned, the real app, a voiceover. The product is the one the
        clip's barcode opens — it must already be approved in the app. Made on GitHub; nothing is shown or posted anywhere until you do it.
      </p>

      {error && <p className="text-[13px] mb-3 px-3 py-2 rounded-[10px]" style={{ color: 'var(--v-poor)', background: 'var(--bg-card)', border: '1px solid var(--v-poor)' }}>{error}</p>}

      {(stage === 'idle' || stage === 'uploading') && (
        <div className="rounded-[14px] p-4 mb-4" style={card}>
          <p className="text-[13.5px] font-semibold mb-2" style={{ color: 'var(--label-1)' }}>1. Record the clip, in this order (about 12 seconds)</p>
          <ol className="text-[13px] mb-3 pl-5" style={{ color: 'var(--label-2)', listStyle: 'decimal' }}>
            <li>The <strong>front</strong> of the pack, held still for 2 seconds.</li>
            <li>Turn it over to the <strong>back</strong> and hold the <strong>nutrition table</strong> facing the camera, still and readable, for 3 seconds.</li>
            <li>Move down to the <strong>ingredient list</strong>, then the <strong>barcode</strong>: hold the barcode up for 2 seconds.</li>
            <li>A bottle or can: turn it slowly so the table or the printed panel is flat to the camera. Good light, no glare.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" accept="video/*" disabled={stage === 'uploading'} onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-[13px]" />
            <button type="button" disabled={!file || stage === 'uploading'} onClick={upload} className="tap-scale px-4 py-2 rounded-[10px] text-[13.5px] font-semibold" style={{ ...btn(true), opacity: !file || stage === 'uploading' ? 0.5 : 1 }}>
              {stage === 'uploading' ? 'Uploading the clip…' : 'Upload & write the script'}
            </button>
          </div>
          <p className="text-[12px] mt-2" style={{ color: 'var(--label-3)' }}>Up to about 50 MB (a 10–15 second phone clip is usually 15–40 MB).</p>
        </div>
      )}

      {stage === 'drafting' && (
        <div className="rounded-[14px] p-4 mb-4 flex flex-wrap items-center gap-3" style={card}>
          <span className="text-[13.5px] flex-1" style={{ color: 'var(--label-2)' }}>
            {status?.state === 'in_progress' ? `Reading the clip and writing the script on GitHub… ${clock} (about 2 min)` : `Waiting for GitHub to start… ${clock}`}
          </span>
          {status?.url && <a href={status.url} target="_blank" rel="noreferrer" className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold" style={btn(false)}>Watch on GitHub ↗</a>}
        </div>
      )}

      {stage === 'review' && draft && (
        <div className="rounded-[14px] p-4 mb-4" style={card}>
          <p className="text-[16px] font-bold" style={{ color: 'var(--label-1)' }}>{draft.product.name}</p>
          <p className="text-[12.5px] mb-3" style={{ color: 'var(--label-3)' }}>
            {draft.product.brand || ''} {draft.product.pack ? `· ${draft.product.pack}` : ''} · score {draft.product.score} ({draft.product.verdict}) · words: {draft.source}
          </p>
          {draft.found && (
            <p className="text-[12.5px] mb-3" style={{ color: 'var(--label-2)' }}>
              Found in the clip: front 0–{draft.found.front?.[1]} s, turn to {draft.found.labelAt} s, label boxes on {draft.found.boxes?.length ? draft.found.boxes.join(', ') : 'nothing (the camera will still zoom, without boxes)'}.
              {draft.found.notes?.length > 0 && <span style={{ color: 'var(--v-caution, #b26a00)' }}> {draft.found.notes.join(' · ')}</span>}
            </p>
          )}
          <p className="text-[12.5px] font-semibold mb-1.5" style={{ color: 'var(--label-2)' }}>Read every line: is it true to the label, and fair to the brand?</p>
          <div className="rounded-[10px] mb-3" style={{ border: '1px solid var(--separator)' }}>
            {draft.beats.map((b, i) => (
              <div key={b} className="flex gap-3 px-3 py-2 text-[13.5px]" style={{ borderTop: i ? '1px solid var(--separator)' : 'none' }}>
                <span className="w-[130px] shrink-0 text-[12px] font-semibold" style={{ color: 'var(--label-3)' }}>{BEAT_NAMES[b] || b}</span>
                <span style={{ color: 'var(--label-1)' }}>{draft.shown[b]}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={approve} className="tap-scale px-4 py-2 rounded-[10px] text-[13.5px] font-semibold" style={btn(true)}>Approve — make the video</button>
            <button type="button" onClick={again} className="tap-scale px-4 py-2 rounded-[10px] text-[13.5px] font-semibold" style={btn(false)}>Write another script</button>
            <button type="button" onClick={reset} className="tap-scale px-3 py-2 text-[13px] font-semibold ml-auto" style={{ color: 'var(--label-3)' }}>Start over with another clip</button>
          </div>
        </div>
      )}

      {stage === 'rendering' && (
        <div className="rounded-[14px] p-4 mb-4 flex flex-wrap items-center gap-3" style={card}>
          <span className="text-[13.5px] flex-1" style={{ color: 'var(--label-2)' }}>
            {status?.state === 'in_progress' ? `Making the video on GitHub… ${clock} (about 6 min)` : `Waiting for GitHub to start… ${clock}`}
          </span>
          {status?.url && <a href={status.url} target="_blank" rel="noreferrer" className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold" style={btn(false)}>Watch on GitHub ↗</a>}
        </div>
      )}

      {stage === 'done' && status && (
        <div className="rounded-[14px] p-4 mb-4" style={card}>
          <p className="text-[14px] font-semibold mb-3" style={{ color: 'var(--v-good)' }}>The video is ready.</p>
          <div className="flex flex-wrap gap-5 items-start">
            {status.video && <video src={status.video} controls playsInline style={{ width: 270, borderRadius: 14, background: '#000' }} />}
            <div className="flex-1 min-w-[260px]">
              {status.download && <a href={status.download} className="tap-scale inline-block px-4 py-2 rounded-[10px] text-[13.5px] font-semibold mb-3" style={btn(true)}>Download the MP4</a>}
              <p className="text-[12.5px] font-semibold mb-1" style={{ color: 'var(--label-2)' }}>Caption</p>
              <textarea readOnly value={status.caption || ''} rows={10} className="w-full text-[12.5px] p-2 rounded-[8px]" style={{ background: 'var(--fill)', color: 'var(--label-1)' }} />
              <button type="button" className="tap-scale mt-2 px-3 py-1.5 rounded-[8px] text-[13px] font-semibold" style={btn(false)}
                onClick={() => { try { navigator.clipboard.writeText(status.caption || ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no clipboard */ } }}>
                {copied ? 'Copied ✓' : 'Copy caption'}
              </button>
              <p className="text-[12px] mt-3" style={{ color: 'var(--label-3)' }}>The links work for an hour; open this page again for fresh ones.</p>
            </div>
          </div>
          <button type="button" onClick={reset} className="tap-scale mt-4 px-4 py-2 rounded-[10px] text-[13.5px] font-semibold" style={btn(false)}>Make another</button>
        </div>
      )}

      {stage === 'failed' && (
        <div className="rounded-[14px] p-4 mb-4 flex flex-wrap items-center gap-3" style={card}>
          <span className="text-[13.5px] flex-1" style={{ color: 'var(--label-2)' }}>It did not work — the reason is above{status?.url ? ', or open the GitHub page for the full log' : ''}.</span>
          {status?.url && <a href={status.url} target="_blank" rel="noreferrer" className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold" style={btn(false)}>See why ↗</a>}
          <button type="button" onClick={reset} className="tap-scale px-4 py-2 rounded-[10px] text-[13.5px] font-semibold" style={btn(true)}>Try another clip</button>
        </div>
      )}
    </AdminLayout>
  );
}
