// src/components/NewsCard.jsx
// One news/research item card -- shared between the News page and the
// Result page's "Related reading" section, so both look and behave
// identically rather than maintaining two near-copies.
import { useLanguage } from '../contexts/LanguageContext';

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Visually distinguishes third-party media coverage from peer-reviewed
// research -- readers should immediately know which kind of source
// they're looking at, not have to infer it from the wording alone.
export function TypeBadge({ type }) {
  const { t } = useLanguage();
  const isResearch = type === 'research';
  return (
    <span
      className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 mb-1.5"
      style={
        isResearch
          ? { background: 'var(--v-moderate-bg)', color: 'var(--v-moderate)' }
          : { background: 'var(--tint-bg)', color: 'var(--tint)' }
      }
    >
      {isResearch ? t('newsCardResearch') : t('newsCardNews')}
    </span>
  );
}

export default function NewsCard({ item }) {
  const { t } = useLanguage();
  const isResearch = item.type === 'research';
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="tap-scale block bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 mb-2.5"
    >
      {item.type && <TypeBadge type={item.type} />}
      {item.summary ? (
        <>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug mb-1">{item.summary}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug mb-1.5 line-clamp-1">{item.title}</p>
        </>
      ) : (
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-snug mb-1">{item.title}</p>
      )}
      <p className="text-xs text-slate-400 dark:text-slate-500">
        {[item.source, formatDate(item.published_at)].filter(Boolean).join(' · ')}
        {item.summary && ` · ${isResearch ? t('newsReadStudy') : t('newsReadOriginal')}`}
      </p>
    </a>
  );
}
