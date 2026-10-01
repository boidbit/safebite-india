// src/pages/SearchResults.jsx
// "See all results" for a search -- the home screen's suggestions only show
// the top 5. Same ranked search (searchProductsPage), 20 at a time.
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchProductsPage, getCachedReport } from '../services/productCache';
import { saveToHistory, getScoreColor } from '../utils/storage';
import ProductImage from '../components/ProductImage';
import { useLanguage } from '../contexts/LanguageContext';

const PAGE = 20;

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
        <p className="text-sm text-slate-400 dark:text-slate-500 mb-4">{t('searchResultsCount', { n: total })}</p>
      ) : <div className="mb-4" />}

      {error && <p className="text-sm text-amber-600 dark:text-amber-400 mb-3">{error}</p>}
      {loading && items.length === 0 && <p className="text-sm text-slate-400 dark:text-slate-500 px-1">{t('genericLoading')}</p>}
      {!loading && items.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 px-1">{t('homeCantFind', { query })}</p>
      )}

      {items.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-800">
          {items.map((item, i) => (
            <button
              key={item.lookupKey}
              onClick={() => open(item)}
              disabled={Boolean(opening)}
              style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}
              className="item-in tap-scale w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center gap-3"
            >
              <ProductImage src={item.imageUrl} size={44} />
              <span className="min-w-0 flex-1">
                {item.brand && (
                  <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest truncate">{item.brand}</span>
                )}
                <span className="block text-sm text-slate-700 dark:text-slate-200 truncate">{item.productName}</span>
              </span>
              {opening === item.lookupKey ? (
                <span className="flex-shrink-0 text-xs text-slate-400">{t('genericLoading')}</span>
              ) : typeof item.score === 'number' && (
                <span className="flex-shrink-0 text-xs font-bold rounded-full px-2 py-0.5" style={{ background: getScoreColor(item.score).bg, color: getScoreColor(item.score).color }}>
                  {item.score}/100
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {items.length > 0 && items.length < total && (
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
