// src/pages/SearchResults.jsx
// "See all results" for a search -- the home screen's suggestions only show
// the top 5. Same ranked search (searchProductsPage), 40 rows at a time, folded
// into one card per product with a chip per pack size (productFamilies.js).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchProductsPage, getCachedReport } from '../services/productCache';
import { groupIntoFamilies } from '../services/productFamilies';
import { saveToHistory, getScoreColor } from '../utils/storage';
import ProductImage from '../components/ProductImage';
import { useLanguage } from '../contexts/LanguageContext';

const PAGE = 40;

function ScorePill({ score }) {
  if (typeof score !== 'number') return null;
  const c = getScoreColor(score);
  return (
    <span className="flex-shrink-0 text-xs font-bold rounded-full px-2 py-0.5" style={{ background: c.bg, color: c.color }}>
      {score}/100
    </span>
  );
}

export default function SearchResults() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const query = (params.get('q') || '').trim();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setItems([]);
    searchProductsPage(query, { limit: PAGE }).then((r) => {
      if (!alive) return;
      setItems(r.items);
      setTotal(r.total);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [query]);

  const loadMore = async () => {
    setLoading(true);
    const r = await searchProductsPage(query, { limit: PAGE, offset: items.length });
    setItems((prev) => [...prev, ...r.items]);
    setTotal(r.total);
    setLoading(false);
  };

  const open = async (item) => {
    setError('');
    setOpening(item.lookupKey);
    try {
      const cached = await getCachedReport(item.lookupKey);
      if (!cached) throw new Error(t('homeErrLoadFailed'));
      cached.lookupKey = item.lookupKey;
      navigate(`/result/${saveToHistory(cached, 'search')}`);
    } catch (err) {
      setError(err.message || t('genericErrorRetry'));
      setOpening(null);
    }
  };

  const families = useMemo(() => groupIntoFamilies(items), [items]);
  const hasMore = items.length < total;

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
      <button
        onClick={() => navigate(-1)}
        className="tap-scale inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 mb-4 transition-colors"
      >
        ← {t('genericBack')}
      </button>
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('searchResultsTitle', { query })}</h1>
      {!loading || items.length ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 mb-4">{t('searchResultsCount', { n: `${families.length}${hasMore ? '+' : ''}` })}</p>
      ) : <div className="mb-4" />}

      {error && <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">{error}</p>}
      {loading && items.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500 px-1">{t('genericLoading')}</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 px-1">{t('homeCantFind', { query })}</p>
      )}

      {families.length > 0 && (
        <div className="space-y-2.5">
          {families.map(({ leader, members }, i) => {
            const single = members.length === 1;
            const pack = single ? members[0].pack : null;
            return (
              <div
                key={leader.lookupKey}
                style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}
                className="item-in border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-800"
              >
                <button
                  onClick={() => open(leader)}
                  disabled={Boolean(opening)}
                  className="tap-scale w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-3"
                >
                  <ProductImage src={leader.imageUrl} size={single ? 44 : 56} />
                  <span className="min-w-0 flex-1">
                    {leader.brand && (
                      <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest truncate">{leader.brand}</span>
                    )}
                    <span className="block text-sm text-slate-700 dark:text-slate-200 truncate">{leader.productName}</span>
                    {single && pack && <span className="block text-[11px] text-slate-400 dark:text-slate-500">{pack.label}</span>}
                    {!single && (
                      <span className="block text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{t('searchPackSizes', { n: members.length })}</span>
                    )}
                  </span>
                  {opening === leader.lookupKey ? (
                    <span className="flex-shrink-0 text-xs text-slate-400">{t('genericLoading')}</span>
                  ) : <ScorePill score={leader.score} />}
                </button>

                {!single && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-0.5">
                    {members.map(({ item, pack: p }) => {
                      const c = typeof item.score === 'number' ? getScoreColor(item.score) : null;
                      return (
                        <button
                          key={item.lookupKey}
                          onClick={() => open(item)}
                          disabled={Boolean(opening)}
                          className="tap-scale rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 px-2.5 py-1.5 text-center min-w-[64px]"
                        >
                          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {opening === item.lookupKey ? '…' : (p ? p.label : t('searchStandardPack'))}
                          </span>
                          {c && <span className="block text-[11px] font-bold" style={{ color: c.color }}>{item.score}/100</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && items.length > 0 && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="tap-scale w-full mt-3 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200"
        >
          {loading ? t('genericLoading') : t('searchShowMore')}
        </button>
      )}
    </div>
  );
}
