// src/pages/admin/AdminDuplicates.jsx
//
// The same product saved more than once (src/utils/productFamilies.js) --
// "Parle-G Biscuit", "Parle G", "parle - G" from a scrape, a barcode and
// someone's scan, often with different scores. Each group shows what's
// needed to pick the copy to keep: photo, pack size, barcode, score,
// nutrition, ingredients, source, status, scans, open flags, and how
// complete its data is. Keeping one HIDES the others (review status
// 'rejected' -- Products > Rejected brings one back) and moves their
// barcodes to the kept copy, so scanning any of them opens it.
// Only copies whose name says the same thing (same identifying words) and
// whose barcode doesn't differ are ticked to hide by default -- an extra
// word ("Barista", "Malai", "Smoked") is often a different product, so each
// row shows the words its name adds or lacks next to the kept one.
import { useEffect, useMemo, useState } from 'react';
import AdminLayout from './AdminLayout';
import ProductImage from '../../components/ProductImage';
import { StatusPill } from './AdminProducts';
import { adminLoadDuplicateGroups, adminResolveDuplicates } from '../../services/adminDuplicatesRepo';
import { getScoreColor } from '../../utils/storage';
import { sizeLabel, nameDifference, sameSize } from '../../utils/productFamilies';

const PAGE = 15;
const DISMISSED_KEY = 'foodguard-admin-duplicates-dismissed';
const SOURCE_LABEL = { blinkit: 'Blinkit', barcode: 'Barcode (OFF)', search: 'User search', image: 'Label photo', text: 'Pasted text' };

const VIEWS = [
  { id: 'all', label: 'All groups' },
  { id: 'scoreGap', label: 'Scores differ (5+)' },
  { id: 'sameBarcode', label: 'Clear duplicates (one barcode or none)' },
  { id: 'brand', label: 'Brand looks wrong' },
];
const SORTS = [
  { id: 'copies', label: 'Most copies' },
  { id: 'gap', label: 'Biggest score gap' },
  { id: 'scans', label: 'Most scanned' },
];

function loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set(); }
}

const codesOf = (p) => p.barcodes.filter((b) => b.status === 'own' || b.status === 'approved').map((b) => b.barcode);

function Chip({ children, color = 'var(--label-2)', bg = 'var(--fill)' }) {
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap" style={{ background: bg, color }}>{children}</span>;
}

function Nutrition({ per100 }) {
  if (!per100) return <span style={{ color: 'var(--label-3)' }}>no nutrition</span>;
  const sugar = per100.addedSugarG ?? per100.totalSugarG;
  const parts = [
    typeof sugar === 'number' && `sugar ${+sugar.toFixed(1)}g`,
    typeof per100.sodiumMg === 'number' && `sodium ${Math.round(per100.sodiumMg)}mg`,
    typeof per100.saturatedFatG === 'number' && `sat fat ${+per100.saturatedFatG.toFixed(1)}g`,
    typeof per100.caloriesKcal === 'number' && `${Math.round(per100.caloriesKcal)} kcal`,
  ].filter(Boolean);
  return <span>{parts.join(' · ') || 'no nutrition'}</span>;
}

function GroupCard({ group, onResolved, onDismiss }) {
  const [keepId, setKeepId] = useState(group.suggestedKeepId);
  const keep = group.products.find((p) => p.id === keepId);
  // Different barcode from the kept copy -> probably another pack size.
  const differs = (p) => p.id !== keepId && codesOf(p).length > 0 && !codesOf(p).some((c) => codesOf(keep).includes(c));
  const diffOf = (p) => nameDifference(keep.profile, p.profile);
  const sameName = (p) => { const d = diffOf(p); return d.added.length === 0 && d.missing.length === 0; };
  // Both sizes known and different -> a different pack, never ticked for you.
  const otherSize = (p) => p.id !== keepId && !sameSize(keep.profile, p.profile);
  const defaultHide = () => new Set(group.products.filter((p) => p.id !== keepId && !differs(p) && !otherSize(p) && sameName(p)).map((p) => p.id));
  const [hideIds, setHideIds] = useState(defaultHide);
  useEffect(() => { setHideIds(defaultHide()); }, [keepId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);

  const gap = group.scoreMax != null && group.scoreMin != null ? group.scoreMax - group.scoreMin : 0;
  const hide = group.products.filter((p) => hideIds.has(p.id) && p.id !== keepId);

  const resolve = async () => {
    const moving = [...new Set(hide.flatMap(codesOf))].filter((c) => !codesOf(keep).includes(c));
    if (!window.confirm(`Keep "${keep.productName}" and hide ${hide.length} other cop${hide.length === 1 ? 'y' : 'ies'}?\n\nHidden products move to Products → Rejected (you can bring them back).${moving.length ? `\n${moving.length} barcode(s) will open the kept product.` : ''}`)) return;
    setBusy(true);
    try {
      await adminResolveDuplicates(keep, hide);
      onResolved(group.key);
    } catch (err) {
      window.alert(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[14px] p-4 mb-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[15px] font-bold mr-1" style={{ color: 'var(--label-1)' }}>{group.brand}</span>
          {group.variant && <Chip>{group.variant.replace(/\+/g, ' · ')}</Chip>}
          <Chip>{group.size ? `Size ${group.size}${group.someSizeUnknown ? ' (some unknown)' : ''}` : 'Size not known'}</Chip>
          <Chip>{group.products.length} copies</Chip>
          {gap > 0 && (
            <Chip color={gap > 5 ? 'var(--v-poor)' : 'var(--label-2)'} bg={gap > 5 ? 'var(--v-poor-bg)' : 'var(--fill)'}>
              Scores {group.scoreMin}–{group.scoreMax}
            </Chip>
          )}
          {group.otherSizes.length > 0 && <Chip color="var(--tint)" bg="var(--tint-bg)">Also in this family: {group.otherSizes.join(', ')}</Chip>}
        </div>
        <button onClick={() => onDismiss(group.key)} className="tap-scale text-[12.5px] font-semibold" style={{ color: 'var(--label-3)' }}>
          Not duplicates — hide this group
        </button>
      </div>
      {group.distinctBarcodes > 1 && (
        <p className="text-[12px] mb-2 px-3 py-2 rounded-[10px]" style={{ background: 'var(--v-moderate-bg)', color: 'var(--v-moderate)' }}>
          ⚠ {group.distinctBarcodes} different barcodes here — a different barcode is usually a different pack size. Copies with a different barcode are left unticked; only hide one if you’re sure it’s the same packet.
        </p>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[1050px]">
          <div className="grid gap-3 px-2 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide" style={{ gridTemplateColumns: '44px 44px 56px 2.2fr 1.2fr 0.7fr 0.8fr 1.5fr 0.8fr 0.5fr 0.7fr 90px', color: 'var(--label-3)' }}>
            <span>Keep</span><span>Hide</span><span></span><span>Product</span><span>Barcode</span><span>Size</span><span>Score</span><span>Nutrition / 100</span><span>Ingredients</span><span>Scans</span><span>Data</span><span></span>
          </div>
          {group.products.map((p) => {
            const isKeep = p.id === keepId;
            const different = differs(p);
            const color = typeof p.score === 'number' ? getScoreColor(p.score) : null;
            return (
              <div
                key={p.id}
                className="grid gap-3 px-2 py-2 items-center text-[13px] rounded-[10px]"
                style={{ gridTemplateColumns: '44px 44px 56px 2.2fr 1.2fr 0.7fr 0.8fr 1.5fr 0.8fr 0.5fr 0.7fr 90px', background: isKeep ? 'var(--v-good-bg)' : hideIds.has(p.id) ? 'var(--fill)' : 'transparent', opacity: hideIds.has(p.id) && !isKeep ? 0.75 : 1 }}
              >
                <input type="radio" checked={isKeep} onChange={() => setKeepId(p.id)} aria-label={`Keep ${p.productName}`} />
                <input
                  type="checkbox"
                  disabled={isKeep}
                  checked={!isKeep && hideIds.has(p.id)}
                  onChange={(e) => setHideIds((prev) => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })}
                  aria-label={`Hide ${p.productName}`}
                />
                <ProductImage src={p.imageUrl} size={52} />
                <div className="min-w-0">
                  <p className="font-semibold truncate" style={{ color: 'var(--label-1)' }}>
                    {p.id === group.suggestedKeepId && <span title="Suggested: most complete data">⭐ </span>}{p.productName}
                  </p>
                  <p className="text-[11.5px] truncate" style={{ color: p.profile.brandLooksWrong ? 'var(--v-poor)' : 'var(--label-3)' }}>
                    {p.profile.brandLooksWrong ? `⚠ brand "${p.brand}" — name says ${p.profile.suggestedBrand}` : p.brand || 'no brand'}
                  </p>
                  {!isKeep && (() => {
                    const d = diffOf(p);
                    if (!d.added.length && !d.missing.length) return <p className="text-[11.5px] font-semibold" style={{ color: 'var(--v-good)' }}>same name words as the kept one</p>;
                    return (
                      <p className="text-[11.5px] font-semibold" style={{ color: 'var(--v-moderate)' }}>
                        name differs: {[...d.added.map((w) => `+ ${w}`), ...d.missing.map((w) => `− ${w}`)].join('  ')}
                      </p>
                    );
                  })()}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Chip>{SOURCE_LABEL[p.source] || p.source}</Chip>
                    <StatusPill status={p.reviewStatus} />
                    {p.openProblems > 0 && <Chip color="var(--v-poor)" bg="var(--v-poor-bg)">{p.openProblems} open flag{p.openProblems === 1 ? '' : 's'}</Chip>}
                  </div>
                </div>
                <div className="min-w-0 text-[12px]">
                  {p.barcodes.length === 0 && <span style={{ color: 'var(--label-3)' }}>none</span>}
                  {p.barcodes.map((b) => (
                    <p key={b.barcode + b.status} className="font-mono truncate" style={{ color: b.status === 'pending' ? 'var(--label-3)' : 'var(--label-1)' }}>
                      {b.barcode}{b.status === 'pending' ? ' (waiting)' : ''}
                    </p>
                  ))}
                  {different && <p className="text-[11px] font-semibold" style={{ color: 'var(--v-moderate)' }}>different barcode — maybe another pack size</p>}
                </div>
                <span className="text-[12.5px]" style={{ color: p.profile.size ? 'var(--label-1)' : 'var(--label-3)' }}>
                  {p.profile.size ? sizeLabel(p.profile.size) : '—'}
                  {p.profile.sizeFrom === 'name' && <span className="block text-[10.5px]" style={{ color: 'var(--label-3)' }}>from name</span>}
                  {otherSize(p) && <span className="block text-[10.5px] font-semibold" style={{ color: 'var(--v-moderate)' }}>different pack size</span>}
                </span>
                <span>
                  {color ? <span className="px-2 py-0.5 rounded-full text-[12px] font-bold" style={{ background: color.bg, color: color.color }}>{p.score}</span> : '—'}
                </span>
                <span className="text-[11.5px]" style={{ color: 'var(--label-2)' }}><Nutrition per100={p.per100} /></span>
                <span className="text-[12px]" title={p.ingredientsText} style={{ color: p.ingredientCount >= 3 ? 'var(--label-1)' : 'var(--v-poor)', cursor: 'help' }}>
                  {p.ingredientsText ? `${p.ingredientCount} listed` : 'none'}
                </span>
                <span className="text-[12px] tabular-nums" style={{ color: 'var(--label-2)' }}>{p.scanCount}</span>
                <span className="text-[12px]" title="photo · barcode · pack size · nutrition · 3+ ingredients · brand · approved">
                  <span className="font-bold" style={{ color: p.completeness >= 5 ? 'var(--v-good)' : p.completeness >= 3 ? 'var(--v-moderate)' : 'var(--v-poor)' }}>{p.completeness}/7</span>
                </span>
                <span className="flex flex-col gap-0.5 text-[12px]">
                  <a href={`#/admin/products/${p.id}/edit`} target="_blank" rel="noreferrer" style={{ color: 'var(--tint)' }}>Edit ↗</a>
                  <a href={`#/p/${p.id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--label-2)' }}>View ↗</a>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <button
          onClick={resolve}
          disabled={busy || hide.length === 0}
          className="tap-scale px-4 py-2 rounded-[10px] text-[13px] font-semibold text-white"
          style={{ background: hide.length ? 'var(--tint)' : 'var(--label-3)', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Saving…' : hide.length ? `Keep the green one, hide ${hide.length} ticked` : 'Tick the copies to hide'}
        </button>
        <span className="text-[11.5px]" style={{ color: 'var(--label-3)' }}>Hidden copies go to Products → Rejected and can be brought back. Their barcodes will open the kept product.</span>
      </div>
    </div>
  );
}

export default function AdminDuplicates() {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('all');
  const [sort, setSort] = useState('copies');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [doneCount, setDoneCount] = useState(0);

  const load = async () => {
    setError('');
    setGroups(null);
    try {
      setGroups(await adminLoadDuplicateGroups());
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => { load(); }, []);

  const dismiss = (key) => {
    const next = new Set(dismissed).add(key);
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
  };
  const resolved = (key) => {
    setGroups((prev) => prev.filter((g) => g.key !== key));
    setDoneCount((n) => n + 1);
  };

  const list = useMemo(() => {
    if (!groups) return [];
    const q = search.trim().toLowerCase();
    const gapOf = (g) => (g.scoreMax ?? 0) - (g.scoreMin ?? 0);
    return groups
      .filter((g) => !dismissed.has(g.key))
      .filter((g) => !q || g.brand.toLowerCase().includes(q) || g.products.some((p) => p.productName.toLowerCase().includes(q)))
      .filter((g) => view === 'all'
        || (view === 'scoreGap' && gapOf(g) > 5)
        || (view === 'sameBarcode' && g.distinctBarcodes <= 1)
        || (view === 'brand' && g.products.some((p) => p.profile.brandLooksWrong)))
      .sort((a, b) => (sort === 'gap' ? gapOf(b) - gapOf(a)
        : sort === 'scans' ? b.products.reduce((n, p) => n + p.scanCount, 0) - a.products.reduce((n, p) => n + p.scanCount, 0)
        : b.products.length - a.products.length));
  }, [groups, dismissed, search, view, sort]);

  return (
    <AdminLayout>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-1">
        <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>
          Duplicates {groups && <span style={{ color: 'var(--label-3)', fontWeight: 500 }}>({list.length} groups)</span>}
        </p>
        {doneCount > 0 && <span className="text-[12.5px] font-semibold" style={{ color: 'var(--v-good)' }}>✓ {doneCount} group{doneCount === 1 ? '' : 's'} sorted this session</span>}
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--label-3)' }}>
        Products that look like the same one saved more than once — same brand and flavour, similar name, same pack size (or one not known). ⭐ = suggested copy to keep (most complete data). Only copies whose name says exactly the same thing are ticked for you; “name differs” shows the extra or missing words, which often mean a different product. Checking the whole catalog takes about 15 seconds.
      </p>

      {groups && (
        <div className="flex items-end gap-3 flex-wrap mb-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Search brand or name</label>
            <input value={search} onChange={(e) => { setSearch(e.target.value); setShown(PAGE); }} placeholder="e.g. maggi" className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]" />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {VIEWS.map((v) => (
              <button key={v.id} onClick={() => { setView(v.id); setShown(PAGE); }} className="tap-scale px-3 py-1.5 rounded-full text-[12.5px] font-semibold" style={{ background: view === v.id ? 'var(--tint)' : 'var(--fill)', color: view === v.id ? '#fff' : 'var(--label-1)' }}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="min-w-[160px]">
            <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--label-3)' }}>Sort</label>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px]">
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          {dismissed.size > 0 && (
            <button
              onClick={() => { setDismissed(new Set()); try { localStorage.removeItem(DISMISSED_KEY); } catch { /* private mode */ } }}
              className="tap-scale text-[12.5px] font-semibold"
              style={{ color: 'var(--label-3)' }}
            >
              Show {dismissed.size} hidden group{dismissed.size === 1 ? '' : 's'} again
            </button>
          )}
        </div>
      )}

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}
      {groups === null && !error && <p className="text-[13px]" style={{ color: 'var(--label-3)' }}>Checking the whole catalog for duplicates…</p>}
      {groups && list.length === 0 && <p className="text-[13px] text-center py-10" style={{ color: 'var(--label-3)' }}>Nothing here. 🎉</p>}

      {list.slice(0, shown).map((g) => (
        <GroupCard key={g.key} group={g} onResolved={resolved} onDismiss={dismiss} />
      ))}
      {list.length > shown && (
        <button onClick={() => setShown((n) => n + PAGE)} className="tap-scale w-full py-2.5 rounded-[12px] text-[13px] font-semibold" style={{ background: 'var(--fill)', color: 'var(--label-1)' }}>
          Show more ({list.length - shown} left)
        </button>
      )}
    </AdminLayout>
  );
}
