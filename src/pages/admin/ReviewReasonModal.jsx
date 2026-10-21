// src/pages/admin/ReviewReasonModal.jsx
//
// Asks why, before a product is approved or rejected: a few common reasons to
// tap, and a line to write one's own. Both are optional. The reason is kept
// with the approve/reject in the activity log (adminSetReviewStatus), shown on
// the product's row and in its History -- so later it's clear why a product is
// out of the app, or what was checked before it went in.
import { useState } from 'react';

const PRESETS = {
  rejected: [
    'Nutrition table wrong — needs the pack photo',
    'Duplicate of another product',
    'Photo wrong or unclear',
    'Ingredients incomplete or unreadable',
    'Wrong barcode',
    'Not a packaged food',
  ],
  approved: [
    'Checked against the pack',
    'Nutrition fixed from the pack photo',
    'Data looks right',
    'Kept copy of a duplicate',
  ],
};

/**
 * @param {{ status: 'approved'|'rejected', count: number, name?: string, busy?: boolean,
 *   onConfirm: (reason: string) => void, onClose: () => void }} props
 */
export default function ReviewReasonModal({ status, count, name, busy, onConfirm, onClose }) {
  const [preset, setPreset] = useState('');
  const [note, setNote] = useState('');
  const reject = status === 'rejected';
  const what = name ? `“${name}”` : `${count} product${count === 1 ? '' : 's'}`;
  const reason = [preset, note.trim()].filter(Boolean).join(' — ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={onClose}>
      <div
        className="w-full max-w-[460px] rounded-[16px] p-5"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <p className="text-[17px] font-bold" style={{ color: 'var(--label-1)' }}>{reject ? 'Reject' : 'Approve'} {what}?</p>
        <p className="text-[12.5px] mt-1" style={{ color: 'var(--label-3)' }}>
          {reject ? 'It stays out of the app and the website. You can approve it again later from the Rejected tab.' : 'It goes live in the app and on the website.'}
          {' '}Why? (optional — kept in the product’s history)
        </p>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {PRESETS[status].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(preset === p ? '' : p)}
              className="tap-scale px-2.5 py-1 rounded-full text-[12.5px] font-semibold"
              style={{ background: preset === p ? 'var(--label-1)' : 'var(--fill)', color: preset === p ? 'var(--bg-card)' : 'var(--label-1)' }}
            >
              {p}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add your own note…"
          rows={2}
          className="admin-field w-full mt-3 px-3 py-2 rounded-[10px] text-[13.5px]"
        />

        <div className="flex items-center justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="tap-scale px-3.5 py-1.5 rounded-[8px] text-[13px] font-semibold" style={{ color: 'var(--label-2)' }}>Cancel</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(reason)}
            className="tap-scale px-3.5 py-1.5 rounded-[8px] text-[13px] font-semibold text-white"
            style={{ background: reject ? 'var(--v-poor)' : 'var(--v-good)', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Saving…' : reject ? 'Reject' : 'Approve & publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
