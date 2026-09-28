// src/pages/CompareManage.jsx
//
// Step 1 of Compare: search the catalog (not just your own history --
// searchCachedProducts covers every already-scored product) and build
// a list of 2-4 to compare. Deliberately a separate screen from the
// comparison result itself (Compare.jsx) -- building the list and
// reading the result are two different tasks, and this one needs its
// own search UI, which the result screen has no reason to carry.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchCachedProducts, getCachedReport } from '../services/productCache';
import ProductImage from '../components/ProductImage';
import { useLanguage } from '../contexts/LanguageContext';

const MAX_COMPARE = 4;
const MIN_COMPARE = 2;

export default function CompareManage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [selected, setSelected] = useState([]); // full report objects, up to MAX_COMPARE
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingKey, setAddingKey] = useState(null);
  const [error, setError] = useState('');

  // Same 350ms debounce + cancel-guard Home.jsx's own search uses.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await searchCachedProducts(q, { limit: 8 }).catch(() => []);
      if (cancelled) return;
      const selectedKeys = new Set(selected.map((s) => s.lookupKey));
      setResults(found.filter((r) => !selectedKeys.has(r.lookupKey)));
      setSearching(false);
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, selected]);

  const addProduct = async (lookupKey) => {
    setError('');
    setAddingKey(lookupKey);
    try {
      const full = await getCachedReport(lookupKey);
      if (!full) { setError(t('compareManageErrLoad')); return; }
      setSelected((prev) => (prev.some((p) => p.lookupKey === lookupKey) ? prev : [...prev, { ...full, lookupKey }].slice(0, MAX_COMPARE)));
      setQuery('');
      setResults([]);
      setShowSearch(false);
    } finally {
      setAddingKey(null);
    }
  };

  const removeProduct = (lookupKey) => setSelected((prev) => prev.filter((p) => p.lookupKey !== lookupKey));

  const goToResult = () => navigate('/compare/result', { state: { products: selected } });

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => navigate(-1)} className="tap-scale inline-flex items-center gap-1.5 text-[15px]" style={{ color: 'var(--tint)' }}>
            ←
          </button>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--label-1)' }}>{t('compareManageTitle')}</h1>
        </div>
        {selected.length > 0 && (
          <button onClick={() => setSelected([])} className="tap-scale text-xs text-red-400 hover:text-red-600 font-medium mt-2">
            {t('compareManageClearAll')}
          </button>
        )}
      </div>

      <p className="text-sm mt-2 mb-5" style={{ color: 'var(--label-3)' }}>
        {t(selected.length === 1 ? 'compareManageAdded' : 'compareManageAddedPlural', { count: selected.length, max: MAX_COMPARE })}
      </p>

      <div className="space-y-2.5">
        {selected.map((p) => (
          <div key={p.lookupKey} className="rounded-[14px] p-2.5 flex items-center gap-3" style={{ background: 'var(--bg-card)' }}>
            <ProductImage src={p.imageUrl} size={56} expandable={false} />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold leading-tight truncate" style={{ color: 'var(--label-1)' }}>{p.productName}</p>
              {p.brand && <p className="text-[12px] mt-0.5" style={{ color: 'var(--label-3)' }}>{p.brand}</p>}
            </div>
            <button
              onClick={() => removeProduct(p.lookupKey)}
              aria-label={t('ariaRemove')}
              className="tap-scale w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--fill)', color: 'var(--label-2)' }}
            >
              ×
            </button>
          </div>
        ))}

        {selected.length < MAX_COMPARE && (
          <div>
            {!showSearch ? (
              <button
                onClick={() => setShowSearch(true)}
                className="tap-scale w-full py-4 rounded-[14px] text-[13.5px] font-semibold flex items-center justify-center gap-2"
                style={{ border: '2px dashed var(--separator)', color: 'var(--tint)' }}
              >
                <span className="text-[18px] leading-none">+</span>
                {t('compareManageAddAnother')}
                <span style={{ color: 'var(--label-3)', fontWeight: 500 }}>{t('compareManageUpTo', { max: MAX_COMPARE })}</span>
              </button>
            ) : (
              <div className="rounded-[14px] p-3" style={{ background: 'var(--bg-card)' }}>
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('compareManageSearchPlaceholder')}
                    className="admin-field flex-1 px-3 py-2.5 rounded-[10px] text-[14px]"
                  />
                  <button
                    onClick={() => { setShowSearch(false); setQuery(''); setResults([]); }}
                    className="tap-scale text-[13px] font-semibold flex-shrink-0"
                    style={{ color: 'var(--label-3)' }}
                  >
                    {t('compareManageCancel')}
                  </button>
                </div>

                {searching && <p className="text-[12px] mt-2" style={{ color: 'var(--label-3)' }}>{t('compareManageSearching')}</p>}

                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <p className="text-[12px] mt-2" style={{ color: 'var(--label-3)' }}>{t('compareManageNoResults')}</p>
                )}

                {results.length > 0 && (
                  <div className="mt-2.5 space-y-1.5 max-h-[280px] overflow-y-auto">
                    {results.map((r) => (
                      <button
                        key={r.lookupKey}
                        onClick={() => addProduct(r.lookupKey)}
                        disabled={addingKey === r.lookupKey}
                        className="tap-scale w-full flex items-center gap-2.5 p-2 rounded-[10px] text-left"
                        style={{ background: 'var(--fill)', opacity: addingKey === r.lookupKey ? 0.6 : 1 }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--label-1)' }}>{r.productName}</p>
                          {r.brand && <p className="text-[11px]" style={{ color: 'var(--label-3)' }}>{r.brand}</p>}
                        </div>
                        <span className="text-[12px] font-bold flex-shrink-0" style={{ color: 'var(--tint)' }}>
                          {addingKey === r.lookupKey ? '…' : t('compareManageAdd')}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-[12.5px] mt-3 p-2.5 rounded-[10px]" style={{ background: 'var(--v-poor-bg)', color: 'var(--v-poor)' }}>{error}</p>
      )}

      <button
        onClick={goToResult}
        disabled={selected.length < MIN_COMPARE}
        className="tap-scale w-full mt-6 py-3.5 rounded-2xl text-[15px] font-semibold text-white shadow-lg transition-opacity"
        style={{ background: '#16a34a', opacity: selected.length < MIN_COMPARE ? 0.5 : 1 }}
      >
        ⚖️ {selected.length < MIN_COMPARE ? t('compareManageAtLeast', { min: MIN_COMPARE }) : t('compareManageTitle')}
      </button>

      <div className="mt-4 rounded-[14px] p-3.5 flex items-start gap-2.5" style={{ background: 'var(--tint-bg)' }}>
        <span className="text-[16px] leading-none flex-shrink-0">💡</span>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--label-2)' }}>
          <span className="font-semibold">{t('compareManageTipLabel')}</span> {t('compareManageTip')}
        </p>
      </div>
    </div>
  );
}
