// src/pages/admin/AdminHomeFeatures.jsx
//
// Admin > Home screen: steering the home screen's hook sections -- the shock
// reel, the "Looks healthy, but…" flip cards and the guess game (see
// src/components/home/). Each already draws at random from every APPROVED
// product (homeFeaturesRepo.js); a product added here comes up three times as
// often, even outside that section's own rule, and one switched off here
// never shows in that section.
//
// Each pick can carry its own one-line hook; left empty, the card shows the
// line the app writes from the report (shown here as the placeholder).
import { useEffect, useMemo, useState } from 'react';
import AdminLayout from './AdminLayout';
import ProductImage from '../../components/ProductImage';
import { StatusPill } from './AdminProducts';
import { getScoreColor } from '../../utils/storage';
import { hookLine } from '../../utils/homeHooks';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  adminListHomeFeatures, adminAddHomeFeature, adminUpdateHomeFeature, adminRemoveHomeFeature,
  adminSearchFeatureCandidates, adminSuggestHomeFeatures,
} from '../../services/homeFeaturesRepo';

const KINDS = [
  { id: 'shock', label: 'Shock reel', hint: 'Top of the home screen: 5 at random each time the app opens, from approved products scoring under 45 (Poor or worse). Add well-known products here to see them more often.' },
  { id: 'healthy', label: 'Looks healthy, but…', hint: 'Flip cards: 6 at random each open, from approved products with a health word in the name (Multigrain, Sugar Free, Protein…) scoring under 55. The claim word is what the front of the card shows.' },
  { id: 'guess', label: 'Guess the score', hint: 'Endless game: a random approved product each round, any score. Products added here come up more often.' },
];

function Score({ score }) {
  if (!Number.isFinite(score)) return <span style={{ color: 'var(--label-3)' }}>—</span>;
  const c = getScoreColor(score);
  return <span className="text-[12px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: c.bg, color: c.color }}>{score} · {c.label}</span>;
}

function Candidate({ card, onAdd, adding }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <ProductImage src={card.imageUrl} size={44} expandable={false} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--label-1)' }}>{card.productName}</p>
        <p className="text-[11.5px] truncate" style={{ color: 'var(--label-3)' }}>
          {card.brand || 'no brand'}{card.scanCount ? ` · ${card.scanCount} scans` : ''}{card.claim ? ` · claims “${card.claim}”` : ''}
        </p>
      </div>
      <Score score={card.score} />
      <button disabled={adding} onClick={() => onAdd(card)} className="tap-scale px-3 py-1.5 rounded-[8px] text-[12.5px] font-semibold text-white" style={{ background: 'var(--tint)', opacity: adding ? 0.6 : 1 }}>
        + Add
      </button>
    </div>
  );
}

export default function AdminHomeFeatures() {
  const { t } = useLanguage();
  const [kind, setKind] = useState('shock');
  const [picks, setPicks] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const meta = KINDS.find((k) => k.id === kind);

  const load = async () => {
    setError('');
    try {
      setPicks(await adminListHomeFeatures(kind));
    } catch (err) {
      setError(err.message);
      setPicks([]);
    }
  };
  useEffect(() => { setPicks(null); setSuggestions(null); setResults([]); setQuery(''); load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return undefined; }
    const timer = setTimeout(() => {
      adminSearchFeatureCandidates(query).then(setResults).catch((err) => setError(err.message));
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const taken = useMemo(() => new Set((picks || []).map((p) => p.lookup_key)), [picks]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const add = (card) => run(async () => {
    await adminAddHomeFeature(kind, card);
    setSuggestions((s) => s && s.filter((c) => c.lookupKey !== card.lookupKey));
  });

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    try { setSuggestions(await adminSuggestHomeFeatures(kind, taken)); } catch (err) { setError(err.message); } finally { setLoadingSuggestions(false); }
  };

  const saveField = (pick, field, value) => {
    const clean = value.trim() || null;
    if ((pick[field] || null) === clean) return;
    run(() => adminUpdateHomeFeature(pick.id, { [field]: clean }));
  };

  const liveCount = (picks || []).filter((p) => p.active && p.card && ['live', 'approved'].includes(p.reviewStatus)).length;

  return (
    <AdminLayout>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-1">
        <p className="text-[22px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>Home screen</p>
        <a href="#/" target="_blank" rel="noreferrer" className="text-[13px] font-semibold" style={{ color: 'var(--tint)' }}>See the home screen ↗</a>
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--label-3)' }}>
        Every section already shows random approved products — different on every open and every phone. Products you add here come up 3× more often (even outside the section's rule); untick “Showing” to keep a product out of that section entirely.
      </p>

      <div className="flex gap-1.5 flex-wrap mb-3">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)} className="tap-scale px-3.5 py-1.5 rounded-full text-[13px] font-semibold" style={{ background: kind === k.id ? 'var(--tint)' : 'var(--fill)', color: kind === k.id ? '#fff' : 'var(--label-1)' }}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-[12.5px] mb-4" style={{ color: 'var(--label-2)' }}>{meta.hint}</p>

      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--v-poor)' }}>{error}</p>}

      {/* Current picks */}
      <div className="rounded-[14px] mb-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--separator)' }}>
          <span className="text-[13px] font-bold" style={{ color: 'var(--label-1)' }}>Your picks for this section</span>
          <span className="text-[12px]" style={{ color: 'var(--label-3)' }}>{picks ? `${liveCount} boosted · ${(picks || []).filter((p) => !p.active).length} kept out` : ''}</span>
        </div>
        {picks === null && <p className="px-4 py-4 text-[13px]" style={{ color: 'var(--label-3)' }}>Loading…</p>}
        {picks?.length === 0 && !error && <p className="px-4 py-6 text-[13px] text-center" style={{ color: 'var(--label-3)' }}>No picks — the section shows random approved products on its own. Add products below to boost them.</p>}
        {picks?.map((pick) => {
          const card = pick.card;
          const hidden = !card || !['live', 'approved'].includes(pick.reviewStatus);
          const autoLine = card ? hookLine({ ...card, hook: null }, t) : '';
          return (
            <div key={pick.id} className="px-4 py-3 flex gap-3 items-start" style={{ borderBottom: '1px solid var(--separator)', background: pick.active ? undefined : 'var(--v-poor-bg)' }}>
              <ProductImage src={card?.imageUrl} size={56} expandable={false} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13.5px] font-semibold" style={{ color: 'var(--label-1)' }}>{card?.productName || pick.product_name}</p>
                  <Score score={card?.score} />
                  {pick.reviewStatus && <StatusPill status={pick.reviewStatus} />}
                </div>
                {hidden && (
                  <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--v-poor)' }}>
                    {card ? 'Not live in the app — approve it in Products, or it won’t show.' : 'This product no longer exists.'}
                  </p>
                )}
                <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: kind === 'healthy' ? '140px 1fr' : '1fr' }}>
                  {kind === 'healthy' && (
                    <input
                      defaultValue={pick.claim || ''}
                      placeholder={card?.claim || 'Claim word'}
                      onBlur={(e) => saveField(pick, 'claim', e.target.value)}
                      className="admin-field px-2.5 py-1.5 rounded-[8px] text-[13px]"
                      title="The health word on the front of the card"
                    />
                  )}
                  <input
                    defaultValue={pick.hook || ''}
                    placeholder={autoLine || 'One line for the card'}
                    onBlur={(e) => saveField(pick, 'hook', e.target.value)}
                    maxLength={90}
                    className="admin-field px-2.5 py-1.5 rounded-[8px] text-[13px]"
                    title="Leave empty to use the line shown greyed out"
                  />
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                {/* On: comes up 3x as often. Off: never shows in this section. */}
                <div className="flex rounded-[8px] overflow-hidden text-[12px] font-semibold" style={{ border: '1px solid var(--separator)' }}>
                  {[[true, 'Boost'], [false, 'Keep out']].map(([value, label]) => (
                    <button
                      key={label}
                      disabled={busy || pick.active === value}
                      onClick={() => run(() => adminUpdateHomeFeature(pick.id, { active: value }))}
                      className="px-2.5 py-1"
                      style={pick.active === value
                        ? { background: value ? 'var(--v-good)' : 'var(--v-poor)', color: '#fff' }
                        : { background: 'var(--bg-card)', color: 'var(--label-2)' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <a href={card?.reportId ? `#/p/${card.reportId}` : undefined} target="_blank" rel="noreferrer" className="text-[12px]" style={{ color: 'var(--label-2)' }}>View ↗</a>
                <button disabled={busy} onClick={() => window.confirm(`Remove "${card?.productName || pick.product_name}" from ${meta.label}?`) && run(() => adminRemoveHomeFeature(pick))} className="tap-scale text-[12px] font-semibold" style={{ color: 'var(--v-poor)' }}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div className="rounded-[14px] p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
          <p className="text-[13px] font-bold mb-2" style={{ color: 'var(--label-1)' }}>Find a product</p>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. maggi, digestive, kurkure" className="admin-field w-full px-3 py-2 rounded-[10px] text-[14px] mb-1" />
          <div className="ios-group">
            {results.filter((c) => !taken.has(c.lookupKey)).map((c) => <Candidate key={c.lookupKey} card={c} onAdd={add} adding={busy} />)}
          </div>
          {query.trim().length >= 2 && results.length === 0 && <p className="text-[12.5px] py-2" style={{ color: 'var(--label-3)' }}>No live product matches.</p>}
        </div>

        <div className="rounded-[14px] p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-bold" style={{ color: 'var(--label-1)' }}>Suggestions</p>
            <button onClick={loadSuggestions} disabled={loadingSuggestions} className="tap-scale text-[12.5px] font-semibold" style={{ color: 'var(--tint)' }}>
              {loadingSuggestions ? 'Finding…' : suggestions ? 'Refresh' : 'Suggest products'}
            </button>
          </div>
          <p className="text-[12px] mb-1" style={{ color: 'var(--label-3)' }}>
            {kind === 'shock' && 'Most-scanned products scoring under 45.'}
            {kind === 'healthy' && 'Most-scanned products with a health word in the name, scoring under 55.'}
            {kind === 'guess' && 'Most-scanned products, any score.'}
            {' '}Check the label and score before adding.
          </p>
          <div className="ios-group max-h-[420px] overflow-y-auto">
            {(suggestions || []).filter((c) => !taken.has(c.lookupKey)).map((c) => <Candidate key={c.lookupKey} card={c} onAdd={add} adding={busy} />)}
          </div>
          {suggestions?.length === 0 && <p className="text-[12.5px] py-2" style={{ color: 'var(--label-3)' }}>Nothing to suggest.</p>}
        </div>
      </div>
    </AdminLayout>
  );
}
