// src/pages/PopularSearches.jsx
// "See all" destination for the home screen's popular-searches pill row
// (which only shows the top 8). Tapping a term here goes to Home with
// that search already filled in and running.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPopularSearchTerms } from '../services/productCache';
import { useLanguage } from '../contexts/LanguageContext';

export default function PopularSearches() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPopularSearchTerms(30).then((t) => {
      setTerms(t);
      setLoading(false);
    });
  }, []);

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
      <button
        onClick={() => navigate(-1)}
        className="tap-scale inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 mb-4 transition-colors"
      >
        ← {t('genericBack')}
      </button>
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-5">{t('homePopularSearches')}</h1>

      {loading && <p className="text-sm text-slate-400 dark:text-slate-500 px-1">{t('genericLoading')}</p>}

      {!loading && terms.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-slate-500 px-1">{t('popularSearchesEmpty')}</p>
      )}

      {!loading && terms.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {terms.map((term, i) => (
            <button
              key={term}
              onClick={() => navigate(`/?q=${encodeURIComponent(term)}`)}
              style={{ animationDelay: `${Math.min(i * 20, 300)}ms` }}
              className="item-in tap-scale px-4 py-2 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors"
            >
              {term}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
