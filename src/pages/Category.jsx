// src/pages/Category.jsx
// A real, URL-backed screen for one category's product list -- used to
// be inline state on Home (tapping a tile swapped what Home rendered in
// place). Now it's its own route, so the Android/browser back button
// and deep links both work correctly.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { browseCategoryProducts, getCachedReport } from '../services/productCache';
import { saveToHistory, getScoreColor } from '../utils/storage';
import { CATEGORIES } from '../data/categories';
import ProductImage from '../components/ProductImage';
import LoadingScreen from '../components/LoadingScreen';
import { randomLoadDelayMs, waitForMinimum } from '../utils/loadingPace';
import { useLoaderFinish } from '../hooks/useLoaderFinish';
import { useLanguage } from '../contexts/LanguageContext';

export default function Category() {
  const { t, language } = useLanguage();
  const SORTS = [
    { id: 'default', label: t('categorySortAll') },
    { id: 'high', label: t('categorySortHigh') },
    { id: 'low', label: t('categorySortLow') },
  ];
  const { id } = useParams();
  const navigate = useNavigate();
  const category = CATEGORIES.find((c) => c.id === id);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('default');
  const [opening, setOpening] = useState(false);
  const { finishing, finishLoader, onFinished, resetFinish } = useLoaderFinish();
  // Tapping a card's photo shows a quick preview (image + rating)
  // instead of jumping straight to the full report -- the full report
  // is still one more tap away (tapping the rest of the card).
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!category) return;
    setLoading(true);
    setSort('default');
    browseCategoryProducts(category.keywords, { limit: 50 }).then((r) => {
      setResults(r);
      setLoading(false);
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortedResults = useMemo(() => {
    if (sort === 'default') return results;
    const withScore = results.filter((r) => typeof r.score === 'number');
    const withoutScore = results.filter((r) => typeof r.score !== 'number');
    withScore.sort((a, b) => (sort === 'high' ? b.score - a.score : a.score - b.score));
    return [...withScore, ...withoutScore];
  }, [results, sort]);

  const openResult = async (item) => {
    setError('');
    const startedAt = Date.now();
    const minMs = randomLoadDelayMs();
    resetFinish();
    setOpening(true);
    const cached = await getCachedReport(item.lookupKey);
    if (!cached) {
      setOpening(false);
      setError(t('categoryErrLoad'));
      return;
    }
    cached.lookupKey = item.lookupKey;
    const historyId = saveToHistory(cached, 'search');
    await waitForMinimum(startedAt, minMs);
    await finishLoader();
    navigate(`/result/${historyId}`);
  };

  if (opening) return <LoadingScreen finishing={finishing} onFinished={onFinished} />;

  if (!category) {
    return (
      <div className="page-in max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-slate-500 dark:text-slate-400">{t('categoryUnknown')}</p>
        <button onClick={() => navigate('/')} className="tap-scale mt-4 text-green-600 dark:text-green-400 font-semibold">
          ← {t('categoryBackToHome')}
        </button>
      </div>
    );
  }

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
      <button
        onClick={() => navigate(-1)}
        className="tap-scale inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 mb-4 transition-colors"
      >
        ← {t('genericBack')}
      </button>

      {/* Full-width banner instead of a small icon + title row -- the
          row was mostly empty space next to a 56px thumbnail. Kept
          short (not a big hero) since it's just a label, and the label
          sits inset from every edge so it never crowds the corners. */}
      <div className="relative rounded-2xl overflow-hidden mb-4" style={{ aspectRatio: '4.5 / 1' }}>
        <img src={category.image} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
        <h1 className="absolute inset-x-4 bottom-2.5 text-lg font-bold text-white truncate">{language === 'hi' && category.labelHi ? category.labelHi : category.label}</h1>
      </div>

      {!loading && results.length > 0 && (
        <div className="flex gap-2 mb-4">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`tap-scale px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                sort === s.id ? 'bg-green-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="text-sm text-slate-400 dark:text-slate-500 px-1">{t('genericLoading')}</p>}

      {!loading && results.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-slate-500 px-1">
          {t('categoryEmpty')}
        </p>
      )}

      {error && (
        <div className="mb-3 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {!loading && sortedResults.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5">
          {sortedResults.map((item, i) => {
            const scoreColors = typeof item.score === 'number' ? getScoreColor(item.score) : null;
            return (
              <button
                key={item.lookupKey}
                onClick={() => openResult(item)}
                style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}
                className="item-in tap-scale bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-2 flex flex-col items-center gap-1.5 text-center hover:shadow-md transition-all"
              >
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreview(item);
                  }}
                  className="tap-scale cursor-zoom-in"
                  role="button"
                  aria-label={t('categoryViewLarger')}
                >
                  <ProductImage src={item.imageUrl} size={90} expandable={false} />
                </div>
                <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 leading-tight line-clamp-2 w-full">
                  {item.productName}
                </span>
                {scoreColors && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: scoreColors.bg, color: scoreColors.color }}
                  >
                    {item.score}/100
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {preview && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/85 flex items-center justify-center p-6"
          onClick={() => setPreview(null)}
        >
          <div className="relative max-w-xs w-full aspect-square rounded-2xl overflow-hidden bg-slate-800" onClick={(e) => e.stopPropagation()}>
            {preview.imageUrl ? (
              <img src={preview.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-5xl">📦</div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 p-4">
              <p className="text-white font-semibold text-sm leading-tight mb-1.5">{preview.productName}</p>
              {typeof preview.score === 'number' && (() => {
                const c = getScoreColor(preview.score);
                return (
                  <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: c.bg, color: c.color }}>
                    {preview.score}/100
                  </span>
                );
              })()}
            </div>
          </div>
          <button
            onClick={() => setPreview(null)}
            aria-label={t('ariaClose')}
            className="tap-scale absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white text-2xl leading-none flex items-center justify-center backdrop-blur-sm"
          >
            ×
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
