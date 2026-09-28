// src/pages/admin/AdminActivityLog.jsx
//
// Who changed what, and when -- not load-bearing while there's a single
// admin, but cheap to have from day one (see adminActivityRepo.js and
// supabase/admin_activity_log_schema.sql).
import { useEffect, useState } from 'react';
import AdminLayout from './AdminLayout';
import { adminListActivity } from '../../services/adminActivityRepo';

const ACTION_LABEL = {
  create: 'Added',
  update: 'Edited',
  delete: 'Deleted',
  merge: 'Merged',
  resolve_flag: 'Resolved flag on',
  reopen_flag: 'Re-opened flag on',
  import: 'Imported',
  approve_product: 'Approved',
  reject_product: 'Rejected',
  unreview_product: 'Moved back to review',
  approve_barcode_link: 'Approved barcode match for',
  reject_barcode_link: 'Rejected barcode match for',
};

export default function AdminActivityLog() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    adminListActivity()
      .then(setRows)
      .catch((err) => {
        if (/does not exist|schema cache/i.test(err.message)) setNeedsSetup(true);
        else setError(err.message);
      });
  }, []);

  if (needsSetup) {
    return (
      <AdminLayout>
        <p className="text-[22px] font-bold tracking-tight mb-3" style={{ color: 'var(--label-1)' }}>Activity log</p>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--bg-card)' }}>
          <p className="text-[13.5px]" style={{ color: 'var(--label-2)' }}>
            This needs one-time setup: run <code>supabase/admin_activity_log_schema.sql</code> in the Supabase SQL Editor, then reload this page.
          </p>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <p className="text-[22px] font-bold tracking-tight mb-4" style={{ color: 'var(--label-1)' }}>Activity log</p>

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
      {rows === null && !error && <p className="text-[13px]" style={{ color: 'var(--label-3)' }}>Loading…</p>}
      {rows?.length === 0 && <p className="text-[13px] text-center py-10" style={{ color: 'var(--label-3)' }}>Nothing logged yet.</p>}

      {rows?.map((entry) => (
        <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]" style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--separator)' }}>
          <span className="font-semibold flex-shrink-0" style={{ color: 'var(--tint)' }}>{ACTION_LABEL[entry.action] || entry.action}</span>
          <span className="truncate flex-1" style={{ color: 'var(--label-1)' }}>{entry.product_name || '—'}</span>
          <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--label-3)' }}>{entry.actor_email || 'unknown'}</span>
          <span className="text-[12px] flex-shrink-0" style={{ color: 'var(--label-3)' }}>
            {new Date(entry.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      ))}
    </AdminLayout>
  );
}
