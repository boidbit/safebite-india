// src/pages/admin/AdminBarcodeBackfill.jsx
//
// Live view of scripts/backfill-blinkit-barcodes.js: reading barcodes off
// the photos of Blinkit products scraped before the scraper did that
// itself. Auto-refreshes every 10s; every number reads straight from the
// tables the script writes to.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import { adminBarcodeBackfillProgress } from '../../services/adminBarcodeLinksRepo';

const REFRESH_MS = 10_000;
// The script saves at least every 10 pages (~1 minute); well past that and
// it has stopped without saying so (closed window, crash).
const QUIET_AFTER_MS = 5 * 60 * 1000;

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-[14px] p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--label-3)' }}>{label}</p>
      <p className="text-[26px] font-bold mt-1 tabular-nums" style={{ color: 'var(--label-1)' }}>{value}</p>
      {hint && <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--label-3)' }}>{hint}</p>}
    </div>
  );
}

function runState(run) {
  if (!run) return { color: 'var(--label-3)', text: 'Not started yet' };
  const quiet = Date.now() - new Date(run.updated_at).getTime() > QUIET_AFTER_MS;
  if (run.status === 'running' && !quiet) return { color: 'var(--v-good)', text: 'Running now' };
  if (run.status === 'running') return { color: 'var(--v-moderate)', text: `Not responding — last update ${timeAgo(run.updated_at)}` };
  if (run.status === 'finished') return { color: 'var(--v-good)', text: `Finished ${timeAgo(run.updated_at)}` };
  return { color: 'var(--label-3)', text: `Stopped ${timeAgo(run.updated_at)} — run it again to carry on` };
}

export default function AdminBarcodeBackfill() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const load = async () => {
    try {
      setData(await adminBarcodeBackfillProgress());
      setError('');
      setLastRefreshed(new Date());
    } catch (err) {
      setError(/barcode_backfill_progress/.test(err.message)
        ? 'The progress table doesn’t exist yet — run supabase/barcode_backfill_migration.sql in the Supabase SQL Editor first.'
        : err.message);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const cats = data?.categories || [];
  const sum = (k) => cats.reduce((s, c) => s + (c[k] || 0), 0);
  const matched = sum('matched');
  const found = sum('barcodes_found');
  const state = runState(data?.run);

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>Barcode backfill</p>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <p className="text-[12px]" style={{ color: 'var(--label-3)' }}>
              Refreshed {lastRefreshed.toLocaleTimeString('en-IN')} · every 10s
            </p>
          )}
          <button onClick={load} className="tap-scale px-3 py-1.5 rounded-full text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)' }}>
            Refresh now
          </button>
        </div>
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--label-3)' }}>
        Reading barcodes off the photos of Blinkit products we already had. Every barcode found waits in{' '}
        <Link to="/admin/barcode-links" style={{ color: 'var(--tint)' }}>Barcode matches</Link> for approval.
      </p>

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
      {!data && !error && <p className="text-[13px]" style={{ color: 'var(--label-3)' }}>Loading…</p>}

      {data && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: state.color }} />
            <p className="text-[13px] font-semibold" style={{ color: state.color }}>{state.text}</p>
          </div>
          {data.run?.last_product && (
            <p className="text-[12.5px] mb-4" style={{ color: 'var(--label-2)' }}>Last product checked: {data.run.last_product}</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <StatCard label="Products checked" value={`${matched.toLocaleString('en-IN')}`} hint={`of ${data.totalProducts.toLocaleString('en-IN')} Blinkit products`} />
            <StatCard label="Barcodes found" value={found.toLocaleString('en-IN')} hint={matched ? `${Math.round((found / matched) * 100)}% of products checked` : null} />
            <StatCard label="Pages opened" value={sum('pages_checked').toLocaleString('en-IN')} />
            <StatCard label="Waiting for approval" value={data.byStatus.pending.toLocaleString('en-IN')} hint="all Blinkit-photo barcodes" />
            <StatCard label="Approved" value={data.byStatus.approved.toLocaleString('en-IN')} />
            <StatCard label="Rejected" value={data.byStatus.rejected.toLocaleString('en-IN')} />
          </div>

          <p className="text-[15px] font-bold mb-2" style={{ color: 'var(--label-1)' }}>Latest barcodes found</p>
          <div className="rounded-[14px] overflow-hidden mb-6" style={{ border: '1px solid var(--separator)' }}>
            {data.recent.map((r, i) => (
              <div key={`${r.barcode}${r.created_at}`} className="px-3 py-2 flex items-center justify-between gap-3 text-[13px]" style={{ background: i % 2 ? 'transparent' : 'var(--bg-card)', borderTop: i ? '1px solid var(--separator)' : 'none' }}>
                <span className="min-w-0 truncate" style={{ color: 'var(--label-1)' }}>{r.product_name}</span>
                <span className="flex-shrink-0 font-mono text-[12px]" style={{ color: 'var(--label-2)' }}>{r.barcode} · {r.status} · {timeAgo(r.created_at)}</span>
              </div>
            ))}
            {data.recent.length === 0 && <p className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--label-3)' }}>None yet.</p>}
          </div>

          <p className="text-[15px] font-bold mb-2" style={{ color: 'var(--label-1)' }}>Categories</p>
          <div className="rounded-[14px] overflow-x-auto" style={{ border: '1px solid var(--separator)' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: 'var(--fill)' }}>
                  <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--label-2)' }}>Category</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: 'var(--label-2)' }}>Checked</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: 'var(--label-2)' }}>Barcodes</th>
                  <th className="text-center px-3 py-2 font-semibold" style={{ color: 'var(--label-2)' }}>Status</th>
                  <th className="text-right px-3 py-2 font-semibold" style={{ color: 'var(--label-2)' }}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c, i) => (
                  <tr key={c.category} style={{ background: i % 2 ? 'transparent' : 'var(--bg-card)', borderTop: '1px solid var(--separator)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--label-1)' }}>{c.category}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--label-1)' }}>{c.matched} / {c.total_urls ?? '?'}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--label-1)' }}>{c.barcodes_found}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: c.exhausted ? 'var(--v-good-bg)' : 'var(--fill)', color: c.exhausted ? 'var(--v-good)' : 'var(--label-2)' }}>
                        {c.exhausted ? 'complete' : 'in progress'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--label-3)' }}>{timeAgo(c.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cats.length === 0 && <p className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--label-3)' }}>No category started yet.</p>}
          </div>
        </>
      )}
    </AdminLayout>
  );
}
