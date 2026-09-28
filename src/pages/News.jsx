// src/pages/News.jsx
// "Stay up to date" -- official regulator links (static, never breaks),
// plus cached India food-news headlines and real nutrition/food-safety
// research (both populated by scripts/fetch-news.js on a schedule, read
// here from news_items rather than ever calling PubMed or a news API
// directly from the browser).
import { useEffect, useState } from 'react';
import { getNewsItems } from '../services/newsRepo';
import { clusterNewsItems } from '../services/newsCluster';
import NewsCard from '../components/NewsCard';
import NewsClusterCard from '../components/NewsClusterCard';
import { useLanguage } from '../contexts/LanguageContext';

const OFFICIAL_SOURCES = [
  { label: 'FSSAI', url: 'https://fssai.gov.in' },
  { label: 'EFSA', url: 'https://www.efsa.europa.eu' },
];

function EmptySection({ children }) {
  return (
    <p className="text-sm text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
      {children}
    </p>
  );
}

// Same story, multiple publishers -- collapses to one card with a source
// count instead of one near-identical card per outlet (see newsCluster.js).
function NewsSection({ items }) {
  return clusterNewsItems(items).map((entry) =>
    entry.isCluster ? (
      <NewsClusterCard key={entry.key} items={entry.items} />
    ) : (
      <NewsCard key={entry.item.id} item={entry.item} />
    ),
  );
}

export default function News() {
  const { t } = useLanguage();
  const [research, setResearch] = useState([]);
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getNewsItems('research', 20), getNewsItems('news', 20)]).then(([r, n]) => {
      setResearch(r);
      setNews(n);
      setLoading(false);
    });
  }, []);

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-1">{t('newsTitle')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('newsSubtitle')}</p>
      </div>

      {/* Compact -- these are navigation links to each regulator's own
          site, not stories, so they shouldn't cost a full card each. */}
      <div className="mb-6 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{t('newsOfficialSources')}</span>
        {OFFICIAL_SOURCES.map((s) => (
          <a
            key={s.url}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="tap-scale text-xs font-semibold text-green-600 dark:text-green-400"
          >
            {s.label} ↗
          </a>
        ))}
      </div>

      <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">{t('newsIndiaFoodNews')}</h2>
      <div className="mb-6">
        {loading ? (
          <EmptySection>{t('genericLoading')}</EmptySection>
        ) : news.length === 0 ? (
          <EmptySection>{t('newsComingSoon')}</EmptySection>
        ) : (
          <NewsSection items={news} />
        )}
      </div>

      <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">{t('newsLatestResearch')}</h2>
      <div>
        {loading ? (
          <EmptySection>{t('genericLoading')}</EmptySection>
        ) : research.length === 0 ? (
          <EmptySection>{t('newsNothingYet')}</EmptySection>
        ) : (
          <NewsSection items={research} />
        )}
      </div>
    </div>
  );
}
