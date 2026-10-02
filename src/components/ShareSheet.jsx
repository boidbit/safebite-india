// src/components/ShareSheet.jsx
//
// Where to share a result: WhatsApp, Instagram, X, or the phone's own share
// sheet. Every button calls straight into the browser from the tap itself
// (no await first) -- navigator.share() only counts as a user gesture
// before any await, which is why the score-card picture is made ahead of
// time by Result.jsx and handed in as `imageBlob`.
//
// Instagram has no "post this" link for the web, so it gets the picture
// through the phone's share sheet (Instagram is offered there), or, where
// that can't carry a file, the picture is downloaded with a line saying
// to add it from Instagram.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { whatsappShareUrl, xShareUrl } from '../utils/share';

const FILE_NAME = 'foodguard-score.png';

function downloadBlob(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const Icon = {
  whatsapp: (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.05 21.8h-.01a9.8 9.8 0 0 1-5-1.37l-.36-.21-3.72.98 1-3.63-.24-.37a9.77 9.77 0 0 1-1.5-5.21c0-5.41 4.41-9.82 9.83-9.82 2.62 0 5.09 1.02 6.94 2.88a9.76 9.76 0 0 1 2.87 6.95c0 5.41-4.41 9.8-9.81 9.8zm8.36-18.17A11.75 11.75 0 0 0 12.05.2C5.5.2.17 5.53.17 12.08c0 2.09.55 4.14 1.6 5.94L.07 24.2l6.34-1.66a11.85 11.85 0 0 0 5.64 1.44h.01c6.54 0 11.87-5.33 11.87-11.88 0-3.17-1.24-6.16-3.48-8.4z" />
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.67l7.73-8.84L1.25 2.25h6.83l4.71 6.23 5.45-6.23zm-1.16 17.52h1.83L7.08 4.13H5.12l11.96 15.64z" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  ),
};

export default function ShareSheet({ text, link, imageBlob, onClose, t }) {
  const [note, setNote] = useState('');
  const file = imageBlob ? new File([imageBlob], FILE_NAME, { type: 'image/png' }) : null;
  const canShareFile = Boolean(file && navigator.canShare?.({ files: [file] }));

  const options = [
    {
      key: 'whatsapp', label: 'WhatsApp', bg: '#25D366', fg: '#fff',
      onClick: () => window.open(whatsappShareUrl(text), '_blank', 'noopener,noreferrer'),
    },
    {
      key: 'instagram', label: 'Instagram', bg: 'linear-gradient(45deg, #f9ce34, #ee2a7b 50%, #6228d7)', fg: '#fff',
      onClick: () => {
        if (canShareFile) { navigator.share({ files: [file] }).catch(() => {}); return; }
        if (imageBlob) { downloadBlob(imageBlob); setNote(t('shareInstagramSaved')); return; }
        setNote(t('shareCardNotReady'));
      },
    },
    {
      key: 'x', label: 'X', bg: '#000', fg: '#fff',
      onClick: () => window.open(xShareUrl(text), '_blank', 'noopener,noreferrer'),
    },
    {
      key: 'more', label: t('shareMore'), bg: 'var(--fill)', fg: 'var(--label-1)',
      onClick: () => {
        if (navigator.share) {
          navigator.share(canShareFile ? { files: [file], text } : { text }).catch(() => {});
          return;
        }
        navigator.clipboard?.writeText(link || text).then(() => setNote(t('shareLinkCopied')), () => {});
      },
    },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="relative w-full sm:max-w-[420px] rounded-t-[24px] sm:rounded-[20px] p-5 pb-7"
        style={{ background: 'var(--bg-card)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('shareTitle')}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-[17px] font-bold" style={{ color: 'var(--label-1)' }}>{t('shareTitle')}</p>
          <button onClick={onClose} aria-label={t('ariaClose')} className="tap-scale w-8 h-8 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--fill)', color: 'var(--label-2)' }}>×</button>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {options.map((o) => (
            <button key={o.key} onClick={o.onClick} className="tap-scale flex flex-col items-center gap-1.5">
              <span className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: o.bg, color: o.fg }}>{Icon[o.key]}</span>
              <span className="text-[12px] font-semibold" style={{ color: 'var(--label-1)' }}>{o.label}</span>
            </button>
          ))}
        </div>
        {note && <p className="text-[12.5px] text-center mt-4" style={{ color: 'var(--label-2)' }}>{note}</p>}
      </div>
    </div>,
    document.body,
  );
}
