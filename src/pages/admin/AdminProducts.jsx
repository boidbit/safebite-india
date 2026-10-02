// src/pages/admin/AdminProducts.jsx
//
// Every product in one list -- what used to be two pages, "Review" and
// "Products". Status tabs split it the way reviewing needs (new from
// scraping / new from user scans / live not reviewed / approved /
// rejected / all), each row shows whether the product is visible in the
// app, and the same row edits, approves, rejects, crops, shows history or
// deletes it. A newly added product is 'pending' -- hidden from search,
// categories and alternatives -- until approved here or from the edit form.
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import PhotoCropModal from './PhotoCropModal';
import { adminListReviewQueue, adminReviewCounts, adminSetReviewStatus, adminProductThumb, adminGetProductRow, REVIEW_TABS, DEFAULT_REVIEW_TAB } from '../../services/adminReviewRepo';
import { adminDeleteProduct, adminUpdateProduct } from '../../services/adminProductsRepo';
import { getScoreColor } from '../../utils/storage';
import { CATEGORY_KEYWORDS } from '../../data/categoryKeywords';
import { FOOD_TYPES } from '../../services/foodType';

const PAGE_SIZES = [25, 50, 100, 'all'];
const FILTER_DEBOUNCE_MS = 400;
const SOURCES = ['blinkit', 'barcode', 'search', 'image', 'text'];

// Newly added products are split by where they came from -- scraping
// vs someone's scan -- and never mixed with the products that were
// already live before review existed.
const STATUS_TABS = [
  { id: 'newScraped', label: 'New from scraping' },
  { id: 'newScans', label: 'New from user scans' },
  { id: 'live', label: 'Live, not reviewed' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

export const STATUS_LOOK = {
  pending: { label: 'New · hidden', color: 'var(--v-moderate)', bg: 'var(--v-moderate-bg)' },
  live: { label: 'Live · not reviewed', color: 'var(--tint)', bg: 'var(--tint-bg)' },
  approved: { label: 'Approved · live', color: 'var(--v-good)', bg: 'var(--v-good-bg)' },
  rejected: { label: 'Rejected · hidden', color: 'var(--v-poor)', bg: 'var(--v-poor-bg)' },
};

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'scoreAsc', label: 'Lowest score first' },
  { id: 'scoreDesc', label: 'Highest score first' },
  { id: 'updated', label: 'Recently updated' },
];

const INITIAL_FILTERS = {
  status: DEFAULT_REVIEW_TAB, search: '', brand: '', foodType: '', categoryId: '', source: '',
  scoreMin: '', scoreMax: '', hasImage: '', hasNutrition: '', hasPackSize: '', problemsOnly: false,
  addedWithinDays: '', barcode: '', hasBarcode: '', sort: 'newest', pageSize: 25,
};
const sizeOf = (f) => (f.pageSize === 'all' ? Infinity : Number(f.pageSize) || 25);

// Kept across opening a product and coming back.
const FILTERS_STORAGE_KEY = 'foodguard-admin-products-list';
const OLD_REVIEW_FILTERS_KEY = 'foodguard-admin-review-filters';

function loadStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTERS_STORAGE_KEY) || localStorage.getItem(OLD_REVIEW_FILTERS_KEY) || 'null');
    if (!parsed) return null;
    const filters = { ...INITIAL_FILTERS, ...parsed.filters };
    if (!REVIEW_TABS[filters.status]) filters.status = DEFAULT_REVIEW_TAB;
    return { filters, page: Number(parsed.page) || 0 };
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

const GRID = '28px 64px 2.4fr 1fr 1fr 0.8fr 0.7fr 1.05fr 70px 200px';

// A row's photo and ingredient count, fetched once the row scrolls into
// view -- photos are stored inside the report (often as a data URL), so
// loading them with the list made every page a megabyte or more.
const thumbCache = new Map();
function useRowThumb(id) {
  const ref = useRef(null);
  const [thumb, setThumb] = useState(() => thumbCache.get(id) || null);
  useEffect(() => {
    if (thumbCache.has(id)) return undefined; // already in state from the cache
    const el = ref.current;
    if (!el) return undefined;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      adminProductThumb(id)
        .then((t) => { thumbCache.set(id, t); if (!cancelled) setThumb(t); })
        .catch(() => { if (!cancelled) setThumb({ imageUrl: null, ingredientCount: null }); });
    }, { rootMargin: '300px' });
    observer.observe(el);
    return () => { cancelled = true; observer.disconnect(); };
  }, [id]);
  return [ref, thumb];
}

function ProductRow({ row, isSelected, onToggle, busy, onStatus, onCrop, onDelete }) {
  const [ref, thumb] = useRowThumb(row.id);
  const r = row.report || {};
  const imageUrl = thumb?.imageUrl;
  const product = [{ id: row.id, productName: row.product_name }];
  return (
    <div ref={ref} className="grid gap-3 px-4 py-2.5 items-center text-[13.5px]" style={{ gridTemplateColumns: GRID, borderBottom: '1px solid var(--separator)', background: isSelected ? 'var(--tint-bg)' : undefined }}>
      <input type="checkbox" checked={isSelected} onChange={() => onToggle(row.id)} aria-label={`Select ${row.product_name}`} />
      <button
        onClick={() => imageUrl && onCrop({ ...row, imageUrl })}
        title={imageUrl ? 'Crop photo' : thumb ? 'No photo' : 'Loading photo'}
        className="tap-scale w-14 h-14 rounded-[8px] overflow-hidden flex items-center justify-center"
        style={{ background: 'var(--fill)', cursor: imageUrl ? 'pointer' : 'default' }}
      >
        {imageUrl ? <img src={imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" /> : thumb ? <span style={{ fontSize: 20 }}>🍽️</span> : null}
      </button>
      <div className="min-w-0">
        <p className="font-semibold truncate" style={{ color: 'var(--label-1)' }}>{row.product_name || 'Unnamed product'}</p>
        <p className="text-[11px] truncate" style={{ color: 'var(--label-3)' }}>
          {row.barcode ? <span className="font-mono">{row.barcode} · </span> : 'no barcode · '}
          {typeof thumb?.ingredientCount === 'number' ? `${thumb.ingredientCount} ingredients` : '… ingredients'}{r.nutrientsPer100 ? ' · nutrition' : ' · no nutrition'}
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
        <Link to={`/admin/products/${row.id}/edit`} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--tint)' }}>Edit</Link>
        {row.review_status !== 'approved' && (
          <button disabled={busy} onClick={() => onStatus(product, 'approved')} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--v-good)' }}>Approve</button>
        )}
        {row.review_status !== 'rejected' && (
          <button disabled={busy} onClick={() => window.confirm(`Reject "${row.product_name}"? It'll stay out of the app.`) && onStatus(product, 'rejected')} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--v-poor)' }}>Reject</button>
        )}
        <details className="relative">
          <summary className="tap-scale list-none cursor-pointer text-[15px] px-1" style={{ color: 'var(--label-3)' }} title="More">⋯</summary>
          <div className="absolute right-0 top-6 z-10 min-w-[140px] rounded-[10px] py-1 shadow-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
            <a href={`#/p/${row.id}`} target="_blank" rel="noreferrer" className="block px-3 py-1.5 text-[13px]" style={{ color: 'var(--label-1)' }}>View in app ↗</a>
            <Link to={`/admin/products/${row.id}/history`} className="block px-3 py-1.5 text-[13px]" style={{ color: 'var(--label-1)' }}>History</Link>
            {imageUrl && <button onClick={() => onCrop({ ...row, imageUrl })} className="block w-full text-left px-3 py-1.5 text-[13px]" style={{ color: 'var(--label-1)' }}>Crop photo</button>}
            <button onClick={() => onDelete(row.id, row.product_name)} className="block w-full text-left px-3 py-1.5 text-[13px]" style={{ color: 'var(--v-poor)' }}>Delete</button>
          </div>
        </details>
      </div>
    </div>
  );
}

export default function AdminProducts() {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => {
    const stored = loadStored()?.filters || INITIAL_FILTERS;
    // The dashboard links straight to a tab: /admin/products?tab=newScraped
    const tab = searchParams.get('tab');
    return tab && REVIEW_TABS[tab] ? { ...stored, status: tab } : stored;
  });
  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const [page, setPage] = useState(() => (searchParams.get('tab') ? 0 : loadStored()?.page || 0));
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [croppingRow, setCroppingRow] = useState(null);
  const [savingCrop, setSavingCrop] = useState(false);

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
          hasPackSize: f.hasPackSize,
          problemsOnly: f.problemsOnly,
          addedWithinDays: f.addedWithinDays !== '' ? Number(f.addedWithinDays) : null,
          barcode: f.barcode,
          hasBarcode: f.hasBarcode,
          sort: f.sort,
          limit: sizeOf(f),
          offset: Number.isFinite(sizeOf(f)) ? pageValue * sizeOf(f) : 0,
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

  // One debounce for every filter; a page-only change fetches at once.
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

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name || 'this product'}"? This can't be undone.`)) return;
    try {
      await adminDeleteProduct(id, name);
      await load(filters, page);
    } catch (err) {
      window.alert(err.message);
    }
  };

  // The list only holds a slim row -- read the whole one; only the photo changes.
  const handleCropped = async (dataUrl) => {
    setSavingCrop(true);
    try {
      const row = await adminGetProductRow(croppingRow.id);
      await adminUpdateProduct(row.id, {
        lookupKey: row.lookup_key,
        source: row.source,
        productName: row.product_name,
        ingredientsText: row.ingredients_text,
        report: { ...row.report, imageUrl: dataUrl },
      });
      thumbCache.delete(row.id);
      setCroppingRow(null);
      await load(filters, page);
    } catch (err) {
      window.alert(err.message);
    } finally {
      setSavingCrop(false);
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

  const pageSize = sizeOf(filters);
  const totalPages = Number.isFinite(pageSize) ? Math.max(1, Math.ceil(count / pageSize)) : 1;
  const filtersActive = JSON.stringify({ ...filters, status: 'x', sort: 'x', pageSize: 'x' }) !== JSON.stringify({ ...INITIAL_FILTERS, status: 'x', sort: 'x', pageSize: 'x' });
  const select = (key, options) => (
    <select value={filters[key]} onChange={(e) => setFilter(key, e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  );

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>
            Products <span style={{ color: 'var(--label-3)', fontWeight: 500 }}>({count.toLocaleString()})</span>
          </p>
          <p className="text-[12.5px]" style={{ color: 'var(--label-3)' }}>
            Every product in one place. New ones stay hidden in the app until approved — the status on each row says whether it’s live.
          </p>
        </div>
        <Link to="/admin/products/new" className="tap-scale flex-shrink-0 px-4 py-2.5 rounded-[10px] text-[14px] font-semibold text-white" style={{ background: 'var(--tint)' }}>
          + Add new product
        </Link>
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
        <Field label="Barcode" className="min-w-[170px]">
          <input value={filters.barcode} onChange={(e) => setFilter('barcode', e.target.value)} placeholder="Barcode number" inputMode="numeric" className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]" />
        </Field>
        <Field label="Category" className="min-w-[160px]">
          <select value={filters.categoryId} onChange={(e) => setFilter('categoryId', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            <option value="">All categories</option>
            {CATEGORY_KEYWORDS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Food type" className="min-w-[140px]">
          <select value={filters.foodType} onChange={(e) => setFilter('foodType', e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
            <option value="">Any type</option>
            {FOOD_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
            <option value="__none">Not set</option>
          </select>
        </Field>
        <Field label="Source" className="min-w-[120px]">
          {select('source', [['', 'Any source'], ...SOURCES.map((s) => [s, s])])}
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
        <Field label="Photo" className="min-w-[120px]">{select('hasImage', [['', 'Any'], ['yes', 'Has photo'], ['no', 'No photo']])}</Field>
        <Field label="Nutrition" className="min-w-[130px]">{select('hasNutrition', [['', 'Any'], ['yes', 'Has nutrition'], ['no', 'No nutrition']])}</Field>
        <Field label="Pack size" className="min-w-[140px]">{select('hasPackSize', [['', 'Any'], ['yes', 'Has pack size'], ['no', 'No pack size']])}</Field>
        <Field label="Scanned barcode" className="min-w-[150px]">{select('hasBarcode', [['', 'Any'], ['yes', 'Barcode product'], ['no', 'Not a barcode product']])}</Field>
        <Field label="Added" className="min-w-[130px]">{select('addedWithinDays', [['', 'Any time'], ['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days']])}</Field>
        <Field label="Sort" className="min-w-[160px]">{select('sort', SORT_OPTIONS.map((s) => [s.id, s.label]))}</Field>
        <label className="flex items-center gap-2 px-3 py-2 rounded-[10px] text-[13px] font-semibold cursor-pointer" style={{ background: 'var(--fill)', color: 'var(--label-1)' }}>
          <input type="checkbox" checked={filters.problemsOnly} onChange={(e) => setFilter('problemsOnly', e.target.checked)} />
          Flagged or data issue
        </label>
        {filtersActive && (
          <button onClick={() => setFilters({ ...INITIAL_FILTERS, status: filters.status, sort: filters.sort, pageSize: filters.pageSize })} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--label-3)' }}>
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
        <p className="text-[13px] text-center py-10" style={{ color: 'var(--label-3)' }}>No products match these filters.</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-[14px] overflow-x-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
          <div className="min-w-[1080px]">
            <div className="grid gap-3 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide items-center" style={{ gridTemplateColumns: GRID, color: 'var(--label-3)', borderBottom: '1px solid var(--separator)' }}>
              <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} aria-label="Select all on this page" />
              <span></span>
              <span>Product</span>
              <span>Brand</span>
              <span>Score</span>
              <span>Food type</span>
              <span>Source</span>
              <span>Status in app</span>
              <span>Added</span>
              <span></span>
            </div>
            {rows.map((row) => (
              <ProductRow
                key={row.id}
                row={row}
                isSelected={selected.has(row.id)}
                onToggle={toggle}
                busy={busy}
                onStatus={setStatus}
                onCrop={setCroppingRow}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && count > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
          {count > pageSize ? (
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="tap-scale px-4 py-2 rounded-[10px] text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)', opacity: page === 0 ? 0.4 : 1 }}>
              ← Prev
            </button>
          ) : <span />}
          <div className="flex items-center gap-3 flex-wrap justify-center">
            {count > pageSize && <span className="text-[12px]" style={{ color: 'var(--label-3)' }}>Page {page + 1} of {totalPages}</span>}
            <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--label-3)' }}>
              Show
              <select value={filters.pageSize} onChange={(e) => setFilter('pageSize', e.target.value === 'all' ? 'all' : Number(e.target.value))} className="admin-field px-2 py-1 rounded-[8px] text-[13px]">
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s === 'all' ? `All (${count.toLocaleString()})` : s}</option>)}
              </select>
              per page
            </label>
          </div>
          {count > pageSize ? (
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="tap-scale px-4 py-2 rounded-[10px] text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
              Next →
            </button>
          ) : <span />}
        </div>
      )}

      {croppingRow && (
        <PhotoCropModal
          imageUrl={croppingRow.imageUrl}
          onCropped={handleCropped}
          onClose={() => !savingCrop && setCroppingRow(null)}
        />
      )}
      {savingCrop && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          <p className="px-4 py-2.5 rounded-full text-[13px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.7)' }}>Saving…</p>
        </div>
      )}
    </AdminLayout>
  );
}
