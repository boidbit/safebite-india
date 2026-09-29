// src/pages/admin/AdminBarcodeLinks.jsx
//
// Barcode matches: a scanned barcode the catalog didn't know, tied by
// people to a product we have (found by name or a pack photo), or read off
// a Blinkit product's photos by the scraper. Approving makes that barcode
// open the product for everyone. Waiting pairs are marked safe / needs a
// look (barcodeLinkSafety.js), and the safe ones can be approved in one go.
import { useEffect, useState } from 'react';
import AdminLayout from './AdminLayout';
import { adminListBarcodeLinks, adminApproveBarcodeLink, adminRejectBarcodeLink, adminAssessBarcodeLinks, adminApproveBarcodeLinks } from '../../services/adminBarcodeLinksRepo';

const SAFETY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'safe', label: 'Safe' },
  { id: 'review', label: 'Needs a look' },
];

const TABS = [
  { id: 'pending', label: 'Waiting' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

const SOURCE_LABEL = { name_search: 'typed name', photo: 'pack photo', off_name: 'Open Food Facts name', blinkit_photo: 'Blinkit photo (barcode read twice)' };

export default function AdminBarcodeLinks() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [safety, setSafety] = useState(null); // Map "barcode|lookupKey" -> { safe, reasons }
  const [safetyFilter, setSafetyFilter] = useState('all');
  const [approving, setApproving] = useState(null); // { done, total }

  const load = async (s) => {
    setError('');
    setRows(null);
    setSafety(null);
    try {
      const list = await adminListBarcodeLinks({ status: s });
      setRows(list);
      if (s === 'pending') setSafety(await adminAssessBarcodeLinks(list));
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

  const verdictOf = (p) => safety?.get(`${p.barcode}|${p.lookupKey}`);
  const safePairs = (rows || []).filter((p) => verdictOf(p)?.safe);
  const shown = (rows || []).filter((p) => {
    if (status !== 'pending' || !safety || safetyFilter === 'all') return true;
    return safetyFilter === 'safe' ? verdictOf(p)?.safe : !verdictOf(p)?.safe;
  });

  const approveAllSafe = async () => {
    if (!window.confirm(`Approve ${safePairs.length} barcode${safePairs.length === 1 ? '' : 's'} marked safe? Scanning each will open its product for everyone. You can still reject any of them later from the Approved tab.`)) return;
    setBusy(true);
    setApproving({ done: 0, total: safePairs.length });
    try {
      await adminApproveBarcodeLinks(safePairs, (done, total) => setApproving({ done, total }));
    } catch (err) {
      window.alert(err.message);
    } finally {
      setApproving(null);
      setBusy(false);
      await load(status);
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

      {status === 'pending' && rows && rows.length > 0 && (
        <div className="rounded-[14px] p-3.5 mb-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            {SAFETY_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setSafetyFilter(f.id)}
                className="tap-scale px-3 py-1 rounded-full text-[12.5px] font-semibold"
                style={{ background: safetyFilter === f.id ? 'var(--label-1)' : 'var(--fill)', color: safetyFilter === f.id ? 'var(--bg-card)' : 'var(--label-1)' }}
              >
                {f.label}
                {safety && f.id === 'safe' && ` (${safePairs.length})`}
                {safety && f.id === 'review' && ` (${rows.length - safePairs.length})`}
              </button>
            ))}
            {!safety && <span className="text-[12.5px] ml-1" style={{ color: 'var(--label-3)' }}>Checking which are safe…</span>}
          </div>
          <button
            disabled={busy || !safety || safePairs.length === 0}
            onClick={approveAllSafe}
            className="tap-scale px-3.5 py-1.5 rounded-full text-[13px] font-semibold"
            style={{ background: safePairs.length ? 'var(--v-good)' : 'var(--fill)', color: safePairs.length ? '#fff' : 'var(--label-3)', opacity: busy ? 0.6 : 1 }}
          >
            {approving ? `Approving ${approving.done}/${approving.total}…` : `Approve all safe (${safePairs.length})`}
          </button>
        </div>
      )}

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
      {rows === null && <p className="text-[13px]" style={{ color: 'var(--label-3)' }}>Loading…</p>}
      {rows && shown.length === 0 && !error && <p className="text-[13px] text-center py-10" style={{ color: 'var(--label-3)' }}>Nothing here.</p>}

      {shown.map((p) => (
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
            {status === 'pending' && verdictOf(p) && (
              verdictOf(p).safe ? (
                <p className="text-[12px] mt-1 font-semibold" style={{ color: 'var(--v-good)' }}>✓ Safe to approve — read twice, only this product, company code matches the brand</p>
              ) : (
                <p className="text-[12px] mt-1" style={{ color: 'var(--v-moderate)' }}>
                  <span className="font-semibold">Needs a look:</span> {verdictOf(p).reasons.join(' · ')}
                </p>
              )
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
