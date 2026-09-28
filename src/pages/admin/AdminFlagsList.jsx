// src/pages/admin/AdminFlagsList.jsx
//
// Real users have been able to report a problem with a result for a
// while (productFlags.js), but nothing ever showed what they'd sent in
// -- this is that missing other half.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import { adminListFlags, adminResolveFlag, adminReopenFlag, adminFindProductByLookupKey, adminOrphanedFlags } from '../../services/adminFlagsRepo';
import { FLAG_REASONS, NAME_SUGGESTION_REASON } from '../../services/productFlags';
import { adminGetProduct, adminUpdateProduct } from '../../services/adminProductsRepo';

const REASON_LABEL = { ...Object.fromEntries(FLAG_REASONS.map((r) => [r.key, r.label])), [NAME_SUGGESTION_REASON]: 'Name suggestion from a user' };

export default function AdminFlagsList() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Flag ids whose product genuinely has no matching row left, by
  // EITHER lookup_key or product_name -- see adminOrphanedFlags for why
  // a key-only check isn't enough (a re-keyed-but-still-present product,
  // e.g. after its barcode was corrected, isn't "removed"). Checked
  // once per list load, not per click.
  const [orphanedIds, setOrphanedIds] = useState(() => new Set());

  const load = async (statusValue) => {
    setLoading(true);
    setError('');
    try {
      const { rows: r, count: c } = await adminListFlags({ status: statusValue, limit: 100 });
      setRows(r);
      setCount(c);
      setOrphanedIds(await adminOrphanedFlags(r));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(status); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResolve = async (id, productName) => {
    try {
      await adminResolveFlag(id, productName);
      load(status);
    } catch (err) {
      window.alert(err.message);
    }
  };

  const handleReopen = async (id, productName) => {
    try {
      await adminReopenFlag(id, productName);
      load(status);
    } catch (err) {
      window.alert(err.message);
    }
  };

  // One click for a user's name suggestion: renames the catalog product
  // (column and the name inside its report) through the normal admin
  // update -- so it's in the product's edit history -- then resolves it.
  const handleApplyName = async (flag) => {
    const suggested = (flag.remarks || '').trim();
    if (!suggested) return;
    if (!window.confirm(`Rename "${flag.product_name || 'this product'}" to "${suggested}" for everyone?`)) return;
    try {
      const found = await adminFindProductByLookupKey(flag.lookup_key, flag.product_name);
      if (!found) { window.alert('This product is no longer in the catalog.'); return; }
      const row = await adminGetProduct(found.id);
      await adminUpdateProduct(row.id, {
        lookupKey: row.lookup_key,
        source: row.source,
        productName: suggested,
        ingredientsText: row.ingredients_text,
        report: { ...row.report, productName: suggested },
      });
      await handleResolve(flag.id, suggested);
    } catch (err) {
      window.alert(err.message);
    }
  };

  const handleGoToProduct = async (lookupKey, productName) => {
    const product = await adminFindProductByLookupKey(lookupKey, productName);
    // The batched orphanedIds check already hides "Edit product" for a
    // confirmed-gone row (see below) -- this only fires if the product
    // was removed in the moment between that check and this click.
    if (product) navigate(`/admin/products/${product.id}/edit`);
    else window.alert('This product is no longer in the catalog (removed since this was flagged) -- there’s nothing left to edit. Mark it resolved instead.');
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>
          Reported issues <span style={{ color: 'var(--label-3)', fontWeight: 500 }}>({count})</span>
        </p>
        <div className="flex gap-2">
          {['open', 'resolved', 'all'].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className="tap-scale px-3 py-1.5 rounded-full text-[13px] font-semibold capitalize"
              style={{ background: status === s ? 'var(--tint)' : 'var(--fill)', color: status === s ? '#fff' : 'var(--label-1)' }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
      {loading && <p className="text-[13px]" style={{ color: 'var(--label-3)' }}>Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-[13px] text-center py-10" style={{ color: 'var(--label-3)' }}>
          {status === 'open' ? 'Nothing reported right now.' : 'No flags here.'}
        </p>
      )}

      {rows.map((flag) => (
        <div key={flag.id} className="rounded-[14px] p-4 mb-2.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold" style={{ color: 'var(--label-1)' }}>{flag.product_name || 'Unnamed product'}</p>
              <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--tint)' }}>{REASON_LABEL[flag.reason] || flag.reason}</p>
              {flag.remarks && (
                <p className="text-[13px] mt-1.5" style={{ color: 'var(--label-2)' }}>
                  {flag.reason === NAME_SUGGESTION_REASON ? <>Suggested name: <strong>{flag.remarks}</strong></> : <>“{flag.remarks}”</>}
                </p>
              )}
              <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--label-3)' }}>
                Seen as {flag.score_at_flag ?? '—'}/100 ({flag.verdict_at_flag || '—'}) · {new Date(flag.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              {flag.lookup_key && !orphanedIds.has(flag.id) && (
                <button onClick={() => handleGoToProduct(flag.lookup_key, flag.product_name)} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--tint)' }}>
                  Edit product
                </button>
              )}
              {flag.lookup_key && orphanedIds.has(flag.id) && (
                <p className="text-[11.5px] text-right max-w-[140px]" style={{ color: 'var(--label-3)' }}>
                  Product removed from catalog
                </p>
              )}
              {flag.status === 'open' && flag.reason === NAME_SUGGESTION_REASON && flag.remarks && !orphanedIds.has(flag.id) && (
                <button onClick={() => handleApplyName(flag)} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--v-good)' }}>
                  Apply this name
                </button>
              )}
              {flag.status === 'open' ? (
                <button onClick={() => handleResolve(flag.id, flag.product_name)} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--v-good)' }}>
                  Mark resolved
                </button>
              ) : (
                <button onClick={() => handleReopen(flag.id, flag.product_name)} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--label-3)' }}>
                  Re-open
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </AdminLayout>
  );
}
