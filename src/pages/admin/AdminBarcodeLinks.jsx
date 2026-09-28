// src/pages/admin/AdminBarcodeLinks.jsx
//
// Barcode matches: a scanned barcode the catalog didn't know, tied by
// people to a product we have (found by name or a pack photo). Approving
// makes that barcode open the product for everyone.
import { useEffect, useState } from 'react';
import AdminLayout from './AdminLayout';
import { adminListBarcodeLinks, adminApproveBarcodeLink, adminRejectBarcodeLink } from '../../services/adminBarcodeLinksRepo';

const TABS = [
  { id: 'pending', label: 'Waiting' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

const SOURCE_LABEL = { name_search: 'typed name', photo: 'pack photo', off_name: 'Open Food Facts name' };

export default function AdminBarcodeLinks() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (s) => {
    setError('');
    setRows(null);
    try {
      setRows(await adminListBarcodeLinks({ status: s }));
    } catch (err) {
      setRows([]);
      setError(/barcode_links/.test(err.message)
        ? 'The barcode_links table doesn’t exist yet — run supabase/barcode_links_schema.sql in the Supabase SQL Editor first.'
        : err.message);
    }
  };
  useEffect(() => { load(status); }, [status]);

  const act = async (fn, pair) => {
    setBusy(true);
    try {
      await fn(pair);
      await load(status);
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>
        Barcode matches {rows && <span style={{ color: 'var(--label-3)', fontWeight: 500 }}>({rows.length})</span>}
      </p>
      <p className="text-[12.5px] mb-3" style={{ color: 'var(--label-3)' }}>
        A barcode the catalog didn’t know, tied by people to one of our products. Approve to make scanning that barcode open the product.
      </p>
      <div className="flex gap-1.5 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatus(tab.id)}
            className="tap-scale px-3 py-1.5 rounded-full text-[13px] font-semibold"
            style={{ background: status === tab.id ? 'var(--tint)' : 'var(--fill)', color: status === tab.id ? '#fff' : 'var(--label-1)' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
      {rows === null && <p className="text-[13px]" style={{ color: 'var(--label-3)' }}>Loading…</p>}
      {rows && rows.length === 0 && !error && <p className="text-[13px] text-center py-10" style={{ color: 'var(--label-3)' }}>Nothing here.</p>}

      {rows?.map((p) => (
        <div key={`${p.barcode}|${p.lookupKey}`} className="rounded-[14px] p-4 mb-2.5 flex items-start justify-between gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
          <div className="min-w-0">
            <p className="text-[14.5px] font-semibold" style={{ color: 'var(--label-1)' }}>{p.productName || p.lookupKey}</p>
            <p className="text-[12.5px] mt-0.5 font-mono" style={{ color: 'var(--label-2)' }}>Barcode {p.barcode}</p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--label-3)' }}>
              Confirmed on {p.confirmations} device{p.confirmations === 1 ? '' : 's'} · found by {p.sources.map((s) => SOURCE_LABEL[s] || s).join(', ') || '—'} · {new Date(p.lastAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
            </p>
            {p.competing > 0 && (
              <p className="text-[12px] mt-1 font-semibold" style={{ color: 'var(--v-moderate)' }}>
                ⚠ This barcode was also tied to {p.competing} other product{p.competing === 1 ? '' : 's'} — check which one is right.
              </p>
            )}
          </div>
          {status === 'pending' && (
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <button disabled={busy} onClick={() => act(adminApproveBarcodeLink, p)} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--v-good)' }}>Approve</button>
              <button disabled={busy} onClick={() => act(adminRejectBarcodeLink, p)} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--v-poor)' }}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </AdminLayout>
  );
}
