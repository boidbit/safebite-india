// src/pages/admin/AdminBarcodeLinks.jsx
//
// Barcode matches: a scanned barcode the catalog didn't know, tied by
// people to a product we have (found by name or a pack photo), or read off
// a Blinkit product's photos by the scraper. Approving makes that barcode
// open the product for everyone. Waiting pairs are marked safe / needs a
// look (barcodeLinkSafety.js). Bulk actions: approve all safe ones, reject
// the ones whose barcode is already a catalog product (scanning it opens
// that product anyway), and tick-and-approve the rest -- "Needs a look" is
// grouped by brand, with each product's photo, so it can be checked fast.
import { useEffect, useMemo, useState } from 'react';
import AdminLayout from './AdminLayout';
import ProductImage from '../../components/ProductImage';
import {
  adminListBarcodeLinks, adminApproveBarcodeLink, adminRejectBarcodeLink,
  adminAssessBarcodeLinks, adminApproveBarcodeLinks, adminRejectBarcodeLinks, adminForgetBarcodeCheck,
} from '../../services/adminBarcodeLinksRepo';

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

const pairKey = (p) => `${p.barcode}|${p.lookupKey}`;

export default function AdminBarcodeLinks() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [assessment, setAssessment] = useState(null); // { verdicts, brandOf, imageOf }
  const [safetyFilter, setSafetyFilter] = useState('all');
  const [progress, setProgress] = useState(null); // { label, done, total }
  const [selected, setSelected] = useState(() => new Set());

  const load = async (s) => {
    setError('');
    setRows(null);
    setAssessment(null);
    setSelected(new Set());
    try {
      const list = await adminListBarcodeLinks({ status: s });
      setRows(list);
      if (s === 'pending') setAssessment(await adminAssessBarcodeLinks(list));
    } catch (err) {
      setRows([]);
      setError(/barcode_links/.test(err.message)
        ? 'The barcode_links table doesn’t exist yet — run supabase/barcode_links_schema.sql in the Supabase SQL Editor first.'
        : err.message);
    }
  };
  useEffect(() => { load(status); }, [status]);
  const refresh = () => { adminForgetBarcodeCheck(); load(status); };

  const act = async (fn, pair) => {
    setBusy(true);
    try {
      await fn(pair);
      // Drop the row from the list we already have -- a full reload
      // re-downloads the whole catalog for the safe check, on every click.
      // (Approving also rejects the barcode's other waiting products.)
      setRows((prev) => (prev || []).filter((p) => p.barcode !== pair.barcode || (fn === adminRejectBarcodeLink && p.lookupKey !== pair.lookupKey)));
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verdictOf = (p) => assessment?.verdicts.get(pairKey(p));
  const brandOf = (p) => assessment?.brandOf.get(pairKey(p)) || p.brand || '';
  const imageOf = (p) => assessment?.imageOf.get(p.lookupKey) || null;
  // Tied to more than one product -- never part of a bulk approve.
  const isConflict = (p) => p.competing > 0 || (verdictOf(p)?.reasons || []).some((r) => r.startsWith('This barcode was also'));

  const all = rows || [];
  const safePairs = all.filter((p) => verdictOf(p)?.safe);
  const inCatalogPairs = all.filter((p) => (verdictOf(p)?.reasons || []).some((r) => r.startsWith('This barcode is already')));
  const shown = all.filter((p) => {
    if (status !== 'pending' || !assessment || safetyFilter === 'all') return true;
    return safetyFilter === 'safe' ? verdictOf(p)?.safe : !verdictOf(p)?.safe;
  });
  const selectedPairs = all.filter((p) => selected.has(pairKey(p)));

  // "Needs a look", grouped by brand -- biggest groups first.
  const groups = useMemo(() => {
    if (status !== 'pending' || safetyFilter !== 'review' || !assessment) return null;
    const byBrand = new Map();
    for (const p of shown) {
      const b = brandOf(p) || 'Brand unknown';
      if (!byBrand.has(b)) byBrand.set(b, []);
      byBrand.get(b).push(p);
    }
    return [...byBrand].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [shown, status, safetyFilter, assessment]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (keys, on) => setSelected((prev) => {
    const next = new Set(prev);
    for (const k of keys) (on ? next.add(k) : next.delete(k));
    return next;
  });

  const runBulk = async ({ pairs, fn, label, confirmText }) => {
    if (pairs.length === 0 || !window.confirm(confirmText)) return;
    setBusy(true);
    setProgress({ label, done: 0, total: pairs.length });
    try {
      await fn(pairs, (done, total) => setProgress({ label, done, total }));
    } catch (err) {
      window.alert(err.message);
    } finally {
      setProgress(null);
      setBusy(false);
      adminForgetBarcodeCheck();
      await load(status);
    }
  };

  const approveMany = (pairs, what) => {
    const ok = pairs.filter((p) => !isConflict(p));
    const skipped = pairs.length - ok.length;
    return runBulk({
      pairs: ok,
      fn: adminApproveBarcodeLinks,
      label: 'Approving',
      confirmText: `Approve ${ok.length} ${what}? Scanning each will open its product for everyone.${skipped ? ` ${skipped} tied to more than one product are left for you to pick.` : ''} You can still reject any of them later from the Approved tab.`,
    });
  };

  const bulkButton = (label, onClick, color, count) => (
    <button
      disabled={busy || count === 0}
      onClick={onClick}
      className="tap-scale px-3.5 py-1.5 rounded-full text-[13px] font-semibold"
      style={{ background: count ? color : 'var(--fill)', color: count ? '#fff' : 'var(--label-3)', opacity: busy ? 0.6 : 1 }}
    >
      {label} ({count})
    </button>
  );

  const renderRow = (p) => {
    const v = verdictOf(p);
    const key = pairKey(p);
    return (
      <div key={key} className="rounded-[14px] p-3.5 mb-2 flex items-start gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
        {status === 'pending' && (
          <input
            type="checkbox"
            checked={selected.has(key)}
            onChange={(e) => toggle([key], e.target.checked)}
            disabled={busy}
            className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
            aria-label={`Select ${p.productName || p.barcode}`}
          />
        )}
        <ProductImage src={imageOf(p)} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold" style={{ color: 'var(--label-1)' }}>{p.productName || p.lookupKey}</p>
          <p className="text-[12.5px] mt-0.5 font-mono" style={{ color: 'var(--label-2)' }}>Barcode {p.barcode}</p>
          <p className="text-[12px] mt-1" style={{ color: 'var(--label-3)' }}>
            {brandOf(p) && <>{brandOf(p)} · </>}found by {p.sources.map((s) => SOURCE_LABEL[s] || s).join(', ') || '—'}
            {!p.sources.includes('blinkit_photo') && <> · confirmed on {p.confirmations} device{p.confirmations === 1 ? '' : 's'}</>}
            {' · '}{new Date(p.lastAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          </p>
          {p.competing > 0 && (
            <p className="text-[12px] mt-1 font-semibold" style={{ color: 'var(--v-moderate)' }}>
              ⚠ This barcode was also tied to {p.competing} other product{p.competing === 1 ? '' : 's'} — check which one is right.
            </p>
          )}
          {status === 'pending' && v && (
            v.safe ? (
              <p className="text-[12px] mt-1 font-semibold" style={{ color: 'var(--v-good)' }}>✓ Safe to approve</p>
            ) : (
              <p className="text-[12px] mt-1" style={{ color: 'var(--v-moderate)' }}>
                <span className="font-semibold">Needs a look:</span> {v.reasons.join(' · ')}
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
    );
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>
          Barcode matches {rows && <span style={{ color: 'var(--label-3)', fontWeight: 500 }}>({rows.length})</span>}
        </p>
        <button onClick={refresh} disabled={busy} className="tap-scale px-3 py-1.5 rounded-full text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)' }}>
          Refresh
        </button>
      </div>
      <p className="text-[12.5px] mb-3" style={{ color: 'var(--label-3)' }}>
        A barcode the catalog didn’t know, tied to one of our products. Approve to make scanning that barcode open the product.
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

      {status === 'pending' && all.length > 0 && (
        <div className="rounded-[14px] p-3.5 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)', position: 'sticky', top: 8, zIndex: 5 }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {SAFETY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSafetyFilter(f.id)}
                  className="tap-scale px-3 py-1 rounded-full text-[12.5px] font-semibold"
                  style={{ background: safetyFilter === f.id ? 'var(--label-1)' : 'var(--fill)', color: safetyFilter === f.id ? 'var(--bg-card)' : 'var(--label-1)' }}
                >
                  {f.label}
                  {assessment && f.id === 'safe' && ` (${safePairs.length})`}
                  {assessment && f.id === 'review' && ` (${all.length - safePairs.length})`}
                </button>
              ))}
              {!assessment && <span className="text-[12.5px] ml-1" style={{ color: 'var(--label-3)' }}>Checking which are safe…</span>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {bulkButton('Approve all safe', () => approveMany(safePairs, 'barcodes marked safe'), 'var(--v-good)', assessment ? safePairs.length : 0)}
              {bulkButton('Reject all already in catalog', () => runBulk({
                pairs: inCatalogPairs,
                fn: adminRejectBarcodeLinks,
                label: 'Rejecting',
                confirmText: `Reject ${inCatalogPairs.length} barcodes that are already a product in our catalog? Scanning them already opens that product, so these links aren't needed.`,
              }), 'var(--v-poor)', assessment ? inCatalogPairs.length : 0)}
            </div>
          </div>
          {(selectedPairs.length > 0 || progress) && (
            <div className="flex items-center gap-2 flex-wrap mt-3 pt-3" style={{ borderTop: '1px solid var(--separator)' }}>
              {progress ? (
                <span className="text-[13px] font-semibold" style={{ color: 'var(--label-1)' }}>{progress.label} {progress.done}/{progress.total}…</span>
              ) : (
                <>
                  <span className="text-[13px] font-semibold mr-1" style={{ color: 'var(--label-1)' }}>{selectedPairs.length} selected</span>
                  {bulkButton('Approve selected', () => approveMany(selectedPairs, 'selected barcodes'), 'var(--v-good)', selectedPairs.length)}
                  {bulkButton('Reject selected', () => runBulk({
                    pairs: selectedPairs,
                    fn: adminRejectBarcodeLinks,
                    label: 'Rejecting',
                    confirmText: `Reject ${selectedPairs.length} selected barcodes?`,
                  }), 'var(--v-poor)', selectedPairs.length)}
                  <button onClick={() => setSelected(new Set())} className="tap-scale text-[13px] font-semibold ml-1" style={{ color: 'var(--tint)' }}>Clear</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
      {rows === null && <p className="text-[13px]" style={{ color: 'var(--label-3)' }}>Loading…</p>}
      {rows && shown.length === 0 && !error && <p className="text-[13px] text-center py-10" style={{ color: 'var(--label-3)' }}>Nothing here.</p>}

      {groups
        ? groups.map(([brand, pairs]) => {
          const keys = pairs.map(pairKey);
          const allOn = keys.every((k) => selected.has(k));
          const approvable = pairs.filter((p) => !isConflict(p));
          return (
            <div key={brand} className="mb-5">
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <p className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>
                  {brand} <span style={{ color: 'var(--label-3)', fontWeight: 500 }}>({pairs.length})</span>
                </p>
                <div className="flex items-center gap-3">
                  <button disabled={busy} onClick={() => toggle(keys, !allOn)} className="tap-scale text-[12.5px] font-semibold" style={{ color: 'var(--tint)' }}>
                    {allOn ? 'Unselect all' : 'Select all'}
                  </button>
                  <button disabled={busy || approvable.length === 0} onClick={() => approveMany(pairs, `${brand} barcodes`)} className="tap-scale text-[12.5px] font-semibold" style={{ color: approvable.length ? 'var(--v-good)' : 'var(--label-3)' }}>
                    Approve this brand ({approvable.length})
                  </button>
                </div>
              </div>
              {pairs.map(renderRow)}
            </div>
          );
        })
        : shown.map(renderRow)}
    </AdminLayout>
  );
}
