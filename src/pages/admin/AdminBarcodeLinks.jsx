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
import { conflictHint } from '../../services/barcodeLinkSafety';

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

// Where a saved product came from (product_reports.source).
const PRODUCT_SOURCE = { barcode: 'barcode scan / Open Food Facts', blinkit: 'Blinkit scrape', text: 'pasted label text', image: 'label photo', search: 'search' };
const HINT_COLOR = { 'different-pack': 'var(--v-poor)', 'same-product': 'var(--v-moderate)', 'same-pack': 'var(--v-moderate)', 'unknown-pack': 'var(--label-3)' };

const pairKey = (p) => `${p.barcode}|${p.lookupKey}`;

// One product in the side-by-side: photo, name, and where it came from, its pack size and score.
function ProductLine({ label, d, lookupKey }) {
  const bits = [
    PRODUCT_SOURCE[d?.source] || d?.source || 'unknown source',
    d?.pack ? `pack ${d.pack}` : 'no pack size',
    typeof d?.score === 'number' ? `score ${d.score}` : null,
    d?.status || null,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-2.5 mt-1.5">
      <ProductImage src={d?.image} size={36} expandable={false} />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] truncate" style={{ color: 'var(--label-1)' }}>
          <span className="text-[10.5px] font-bold uppercase tracking-wide mr-1.5" style={{ color: 'var(--label-3)' }}>{label}</span>
          {d?.name || lookupKey}
        </p>
        <p className="text-[11.5px] truncate" style={{ color: 'var(--label-3)' }}>{d?.brand ? `${d.brand} · ` : ''}{bits.join(' · ')}</p>
      </div>
      {d?.id && (
        <a href={`#/admin/products/${d.id}/edit`} target="_blank" rel="noreferrer" className="tap-scale text-[12.5px] font-semibold flex-shrink-0" style={{ color: 'var(--tint)' }}>Edit</a>
      )}
    </div>
  );
}

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
  const detailOf = (key) => assessment?.detailOf?.get(key);
  // Tied to more than one product -- never part of a bulk approve.
  const isConflict = (p) => p.competing > 0 || (verdictOf(p)?.reasons || []).some((r) => r.startsWith('This barcode was also'));
  // The barcode is already one of our products -- scanning it opens that
  // product anyway, so tying it to a second product would only duplicate it.
  const isInCatalog = (p) => (verdictOf(p)?.reasons || []).some((r) => r.startsWith('This barcode is already'));
  const isApprovable = (p) => !isConflict(p) && !isInCatalog(p);

  const all = rows || [];
  const safePairs = all.filter((p) => verdictOf(p)?.safe);
  const inCatalogPairs = all.filter(isInCatalog);
  const clashPairs = all.filter(isConflict);
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
    const ok = pairs.filter(isApprovable);
    const clashing = pairs.filter(isConflict).length;
    const inCatalog = pairs.filter((p) => !isConflict(p) && isInCatalog(p)).length;
    const skipped = [
      clashing && `${clashing} tied to more than one product`,
      inCatalog && `${inCatalog} already a product in our catalog`,
    ].filter(Boolean).join(' and ');
    return runBulk({
      pairs: ok,
      fn: adminApproveBarcodeLinks,
      label: 'Approving',
      confirmText: `Approve ${ok.length} ${what}? Scanning each will open its product for everyone.${skipped ? ` Left out: ${skipped}.` : ''} You can still reject any of them later from the Approved tab.`,
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
          {status === 'pending' && v?.conflicts?.length > 0 && (
            <div className="mt-2 rounded-[10px] px-2.5 py-1.5" style={{ background: 'var(--fill)' }}>
              <ProductLine label="This one" d={detailOf(p.lookupKey)} lookupKey={p.lookupKey} />
              {v.conflicts.map((k) => {
                const other = detailOf(k);
                const hint = other && detailOf(p.lookupKey) ? conflictHint(detailOf(p.lookupKey), other) : null;
                return (
                  <div key={k}>
                    <ProductLine label="Same barcode" d={other} lookupKey={k} />
                    {hint && <p className="text-[11.5px] mt-1 ml-[46px] font-semibold" style={{ color: HINT_COLOR[hint.kind] }}>{hint.text}</p>}
                  </div>
                );
              })}
            </div>
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
        {status === 'approved' && (
          <button
            disabled={busy}
            onClick={() => window.confirm('Reject this approved link? Scanning this barcode will stop opening this product.') && act(adminRejectBarcodeLink, p)}
            className="tap-scale text-[13px] font-semibold flex-shrink-0"
            style={{ color: 'var(--v-poor)' }}
          >
            Reject
          </button>
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
              {bulkButton('Reject all that clash', () => runBulk({
                pairs: clashPairs,
                fn: adminRejectBarcodeLinks,
                label: 'Rejecting',
                confirmText: `Reject ${clashPairs.length} barcodes that are tied to more than one product? Each one has another product on the same barcode, so at least one of them is wrong -- better no link than a wrong one. Nothing is deleted: they move to the Rejected tab.`,
              }), 'var(--v-poor)', assessment ? clashPairs.length : 0)}
            </div>
          </div>
          {assessment && (
            <p className="text-[12px] mt-2.5" style={{ color: 'var(--label-3)' }}>
              Quickest order: <strong>1.</strong> Approve all safe · <strong>2.</strong> Reject all already in catalog · <strong>3.</strong> Reject all that clash.
              When in doubt, reject: a missing link just shows “product not found”, a wrong link shows the wrong product.
            </p>
          )}
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
          const approvable = pairs.filter(isApprovable);
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
