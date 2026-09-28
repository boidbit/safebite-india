// src/components/NewsClusterCard.jsx
// One story, multiple publishers -- collapses same-event coverage (e.g.
// 7 outlets all reporting FSSAI's action against one company on one day)
// into a single card with a source count, instead of one near-identical
// card per outlet. See newsCluster.js for the grouping itself.
import { useState } from 'react';
import { TypeBadge } from './NewsCard';
import { useLanguage } from '../contexts/LanguageContext';

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function NewsClusterCard({ items }) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const lead = items[0]; // newest-first order is preserved by clusterNewsItems

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-2.5">
      <TypeBadge type={lead.type} />
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug mb-1">
        {lead.summary || lead.title}
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">
        {t('newsClusterUpdated', { date: formatDate(lead.published_at), count: items.length })}
      </p>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="tap-scale text-xs font-semibold text-green-600 dark:text-green-400"
      >
        {expanded ? t('newsClusterHide') : t('newsClusterShowAll', { count: items.length })}
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-1.5">
          {items.map((item) => (
            <a
              key={item.id}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="tap-scale block bg-slate-50 dark:bg-slate-900/50 rounded-xl px-3 py-2"
            >
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug line-clamp-1">{item.title}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                {[item.source, formatDate(item.published_at)].filter(Boolean).join(' · ')} · {t('newsRead')}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
