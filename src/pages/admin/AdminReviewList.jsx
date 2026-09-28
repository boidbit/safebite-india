// src/pages/admin/AdminReviewList.jsx
//
// The review queue: every product, filterable, so an admin can check each
// one before it's shown in the app. A newly added product is 'pending' --
// hidden from search/categories/alternatives -- until approved here (or
// from the edit form, which "Review" opens). Products that were already
// live before review existed are listed as "Live, not reviewed".
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import { adminListReviewQueue, adminReviewCounts, adminSetReviewStatus } from '../../services/adminReviewRepo';
import { getScoreColor } from '../../utils/storage';
import { CATEGORY_KEYWORDS } from '../../data/categoryKeywords';
import { FOOD_TYPES } from '../../services/foodType';

const PAGE_SIZE = 25;
const FILTER_DEBOUNCE_MS = 400;
const SOURCES = ['blinkit', 'barcode', 'search', 'image', 'text'];

const STATUS_TABS = [
  { id: 'unreviewed', label: 'Not reviewed' },
  { id: 'pending', label: 'New (hidden)' },
  { id: 'live', label: 'Live, not reviewed' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

export const STATUS_LOOK = {
  pending: { label: 'New · hidden', color: 'var(--v-moderate)', bg: 'var(--v-moderate-bg)' },
  live: { label: 'Live · not reviewed', color: 'var(--tint)', bg: 'var(--tint-bg)' },
  approved: { label: 'Approved', color: 'var(--v-good)', bg: 'var(--v-good-bg)' },
  rejected: { label: 'Rejected', color: 'var(--v-poor)', bg: 'var(--v-poor-bg)' },
};

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'scoreAsc', label: 'Lowest score first' },
  { id: 'scoreDesc', label: 'Highest score first' },
  { id: 'updated', label: 'Recently updated' },
];

const INITIAL_FILTERS = {
  status: 'unreviewed', search: '', brand: '', foodType: '', categoryId: '', source: '',
  scoreMin: '', scoreMax: '', hasImage: '', hasNutrition: '', problemsOnly: false,
  addedWithinDays: '', sort: 'newest',
};

// Kept across opening a product and coming back, like the Products list.
const FILTERS_STORAGE_KEY = 'foodguard-admin-review-filters';

function loadStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTERS_STORAGE_KEY) || 'null');
    if (!parsed) return null;
    return { filters: { ...INITIAL_FILTERS, ...parsed.filters }, page: Number(parsed.page) || 0 };
  } catch {
    return null;
  }
}

function ScorePill({ score }) {
  if (typeof score !== 'number') return <span style={{ color: 'var(--label-3)' }}>—</span>;
  const { label, color, bg } = getScoreColor(score);
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold" style={{ background: bg, color }}>
      {score} · {label}
    </span>
  );
}

export function StatusPill({ status }) {
  const look = STATUS_LOOK[status];
  if (!look) return <span style={{ color: 'var(--label-3)' }}>—</span>;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap" style={{ background: look.bg, color: look.color }}>
      {look.label}
    </span>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>{label}</label>
      {children}
    </div>
  );
}

const GRID = '28px 72px 2.2fr 1fr 1fr 0.9fr 0.8fr 1fr 80px 190px';

export default function AdminReviewList() {
  const [filters, setFilters] = useState(() => loadStored()?.filters || INITIAL_FILTERS);
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const [page, setPage] = useState(() => loadStored()?.page || 0);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ filters, page })); } catch { /* private mode */ }
  }, [filters, page]);

  const load = async (f, pageValue) => {
    setLoading(true);
    setError('');
    try {
      const category = CATEGORY_KEYWORDS.find((c) => c.id === f.categoryId);
      const [{ rows: r, count: c }, statusCounts] = await Promise.all([
        adminListReviewQueue({
          status: f.status,
          search: f.search,
          brand: f.brand,
          foodType: f.foodType,
          source: f.source,
          categoryKeywords: category?.keywords || null,
          scoreMin: f.scoreMin !== '' ? Number(f.scoreMin) : null,
          scoreMax: f.scoreMax !== '' ? Number(f.scoreMax) : null,
          hasImage: f.hasImage,
          hasNutrition: f.hasNutrition,
          problemsOnly: f.problemsOnly,
          addedWithinDays: f.addedWithinDays !== '' ? Number(f.addedWithinDays) : null,
          sort: f.sort,
          limit: PAGE_SIZE,
          offset: pageValue * PAGE_SIZE,
        }),
        adminReviewCounts(),
      ]);
      setRows(r);
      setCount(c);
      setCounts(statusCounts);
      setSelected(new Set());
    } catch (err) {
      setError(/review_status/.test(err.message)
        ? 'The review columns don’t exist yet — run supabase/product_reports_review_status_migration.sql in the Supabase SQL Editor first.'
        : err.message);
    } finally {
      setLoading(false);
    }
  };

  // Same debounce/page-reset behaviour as the Products list.
  const prevFiltersRef = useRef(filters);
  const mountedRef = useRef(false);
  useEffect(() => {
    const filtersChanged = prevFiltersRef.current !== filters;
    prevFiltersRef.current = filters;
    if (filtersChanged && mountedRef.current && page !== 0) {
      setPage(0);
      return;
    }
    const delay = mountedRef.current && filtersChanged ? FILTER_DEBOUNCE_MS : 0;
    const timer = setTimeout(() => load(filters, page), delay);
    mountedRef.current = true;
    return () => clearTimeout(timer);
  }, [filters, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const setStatus = async (products, status) => {
    setBusy(true);
    try {
      await adminSetReviewStatus(products, status);
      await load(filters, page);
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const selectedProducts = rows.filter((r) => selected.has(r.id)).map((r) => ({ id: r.id, productName: r.product_name }));
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const filtersActive = JSON.stringify({ ...filters, status: 'x', sort: 'x' }) !== JSON.stringify({ ...INITIAL_FILTERS, status: 'x', sort: 'x' });

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>
            Review <span style={{ color: 'var(--label-3)', fontWeight: 500 }}>({count})</span>
          </p>
          <p className="text-[12.5px]" style={{ color: 'var(--label-3)' }}>
            New products stay hidden in the app until approved. Open one to check and fix it in the edit form.
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUS_TABS.map((tab) => {
          const active = filters.status === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setFilter('status', tab.id)}
              className="tap-scale px-3 py-1.5 rounded-full text-[13px] font-semibold"
              style={{ background: active ? 'var(--tint)' : 'var(--fill)', color: active ? '#fff' : 'var(--label-1)' }}
            >
              {tab.label}{counts ? ` · ${(counts[tab.id] ?? 0).toLocaleString()}` : ''}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-2">
        <Field label="Product name" className="flex-1 min-w-[180px]">
          <input value={filters.search} onChange={(e) => setFilter('search', e.target.value)} placeholder="Contains…" className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]" />
        </Field>
        <Field label="Brand" className="flex-1 min-w-[150px]">
          <input value={filters.brand} onChange={(e) => setFilter('brand', e.target.value)} placeholder="Any brand" className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]" />
        </Field>
        <Field label="Food type" className="min-w-[150px]">
          <select value={filters.foodType} onChange={(e) => setFilter('foodType', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            <option value="">Any type</option>
            {FOOD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
            <option value="__none">Not set</option>
          </select>
        </Field>
        <Field label="Category" className="min-w-[160px]">
          <select value={filters.categoryId} onChange={(e) => setFilter('categoryId', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            <option value="">All categories</option>
            {CATEGORY_KEYWORDS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Source" className="min-w-[130px]">
          <select value={filters.source} onChange={(e) => setFilter('source', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            <option value="">Any source</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="Score range" className="min-w-[150px]">
          <div className="flex items-center gap-1.5">
            <input type="number" min="0" max="100" value={filters.scoreMin} onChange={(e) => setFilter('scoreMin', e.target.value)} placeholder="0" className="admin-field w-16 px-2 py-2 rounded-[10px] text-[14px]" />
            <span style={{ color: 'var(--label-3)' }}>–</span>
            <input type="number" min="0" max="100" value={filters.scoreMax} onChange={(e) => setFilter('scoreMax', e.target.value)} placeholder="100" className="admin-field w-16 px-2 py-2 rounded-[10px] text-[14px]" />
          </div>
        </Field>
        <Field label="Photo" className="min-w-[120px]">
          <select value={filters.hasImage} onChange={(e) => setFilter('hasImage', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            <option value="">Any</option>
            <option value="yes">Has photo</option>
            <option value="no">No photo</option>
          </select>
        </Field>
        <Field label="Nutrition" className="min-w-[130px]">
          <select value={filters.hasNutrition} onChange={(e) => setFilter('hasNutrition', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            <option value="">Any</option>
            <option value="yes">Has nutrition</option>
            <option value="no">No nutrition</option>
          </select>
        </Field>
        <Field label="Added" className="min-w-[130px]">
          <select value={filters.addedWithinDays} onChange={(e) => setFilter('addedWithinDays', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            <option value="">Any time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </Field>
        <Field label="Sort" className="min-w-[160px]">
          <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] font-semibold cursor-pointer" style={{ background: 'var(--fill)', color: 'var(--label-1)' }}>
          <input type="checkbox" checked={filters.problemsOnly} onChange={(e) => setFilter('problemsOnly', e.target.checked)} />
          Data issue or flag only
        </label>
        {filtersActive && (
          <button onClick={() => setFilters({ ...INITIAL_FILTERS, status: filters.status, sort: filters.sort })} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--label-3)' }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Bulk actions for the rows ticked on this page */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[12px]" style={{ background: 'var(--tint-bg)' }}>
          <span className="text-[13px] font-semibold" style={{ color: 'var(--label-1)' }}>{selected.size} selected</span>
          <button disabled={busy} onClick={() => setStatus(selectedProducts, 'approved')} className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold text-white" style={{ background: 'var(--v-good)' }}>
            Approve & publish
          </button>
          <button
            disabled={busy}
            onClick={() => window.confirm(`Reject ${selected.size} product(s)? They'll stay out of the app.`) && setStatus(selectedProducts, 'rejected')}
            className="tap-scale px-3 py-1.5 rounded-[8px] text-[13px] font-semibold"
            style={{ background: 'var(--v-poor-bg)', color: 'var(--v-poor)' }}
          >
            Reject
          </button>
          <button onClick={() => setSelected(new Set())} className="tap-scale text-[13px] font-semibold ml-auto" style={{ color: 'var(--label-3)' }}>Clear selection</button>
        </div>
      )}

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
      {loading && <p className="text-[13px]" style={{ color: 'var(--label-3)' }}>Loading…</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-[13px] text-center py-10" style={{ color: 'var(--label-3)' }}>Nothing to review with these filters.</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-[14px] overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
          <div className="min-w-[1000px]">
            <div className="grid gap-3 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide items-center" style={{ gridTemplateColumns: GRID, color: 'var(--label-3)', borderBottom: '1px solid var(--separator)' }}>
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} aria-label="Select all on this page" />
              <span></span>
              <span>Product</span>
              <span>Brand</span>
              <span>Score</span>
              <span>Food type</span>
              <span>Source</span>
              <span>Status</span>
              <span>Added</span>
              <span></span>
            </div>
            {rows.map((row) => {
              const r = row.report || {};
              const product = [{ id: row.id, productName: row.product_name }];
              return (
                <div key={row.id} className="grid gap-3 px-4 py-2.5 items-center text-[13.5px]" style={{ gridTemplateColumns: GRID, borderBottom: '1px solid var(--separator)', background: selected.has(row.id) ? 'var(--tint-bg)' : undefined }}>
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.product_name}`} />
                  <div className="w-14 h-14 rounded-[8px] overflow-hidden flex items-center justify-center" style={{ background: 'var(--fill)' }}>
                    {r.imageUrl ? <img src={r.imageUrl} alt="" className="w-full h-full object-cover" /> : <span style={{ fontSize: 20 }}>🍽️</span>}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate" style={{ color: 'var(--label-1)' }}>{row.product_name || 'Unnamed product'}</p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--label-3)' }}>
                      {(r.ingredients || []).length} ingredients{r.nutrientsPer100 ? ' · nutrition' : ' · no nutrition'}
                    </p>
                  </div>
                  <span className="truncate" style={{ color: 'var(--label-2)' }}>{r.brand || '—'}</span>
                  <ScorePill score={r.overallScore} />
                  <span className="text-[12.5px]" style={{ color: 'var(--label-2)' }}>{r.foodType || '—'}</span>
                  <span className="text-[12.5px]" style={{ color: 'var(--label-2)' }}>{row.source}</span>
                  <StatusPill status={row.review_status} />
                  <span className="text-[12px]" style={{ color: 'var(--label-3)' }}>
                    {row.created_at ? new Date(row.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                  </span>
                  <div className="flex items-center gap-2.5 justify-end">
                    <Link to={`/admin/products/${row.id}/edit?review=1`} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--tint)' }}>Review</Link>
                    {row.review_status !== 'approved' && (
                      <button disabled={busy} onClick={() => setStatus(product, 'approved')} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--v-good)' }}>Approve</button>
                    )}
                    {row.review_status !== 'rejected' && (
                      <button disabled={busy} onClick={() => window.confirm(`Reject "${row.product_name}"? It'll stay out of the app.`) && setStatus(product, 'rejected')} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--v-poor)' }}>Reject</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && count > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="tap-scale px-4 py-2 rounded-[10px] text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)', opacity: page === 0 ? 0.4 : 1 }}>
            ← Prev
          </button>
          <span className="text-[12px]" style={{ color: 'var(--label-3)' }}>Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="tap-scale px-4 py-2 rounded-[10px] text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </AdminLayout>
  );
}
