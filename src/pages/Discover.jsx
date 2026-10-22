// src/pages/Discover.jsx
// The Discover tab (it replaced Updates): the best-scoring packs on each
// shelf, one easy swap per shelf, and what the big words on the front of
// a pack usually mean -- a reason to open the app between scans that
// still helps pick the next product. Rankings and swaps come from the
// website's build (services/discoverRepo.js); a product opens through
// the shared-link route, which saves it to History like search does.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDiscover } from '../services/discoverRepo';
import { getScoreColor } from '../utils/storage';
import { CATEGORIES } from '../data/categories';
import ProductImage from '../components/ProductImage';
import { useLanguage } from '../contexts/LanguageContext';

const CLAIMS = [
  ['claimNoMaidaTitle', 'claimNoMaidaBody'],
  ['claimMultigrainTitle', 'claimMultigrainBody'],
  ['claimNoAddedSugarTitle', 'claimNoAddedSugarBody'],
  ['claimBakedTitle', 'claimBakedBody'],
];

const TOP = 10;

function ScorePill({ score }) {
  const c = getScoreColor(score);
  return (
    <span className="flex-shrink-0 min-w-[40px] text-center text-[13px] font-bold tabular-nums px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.color }}>
      {score}
    </span>
  );
}

function SectionTitle({ title, note }) {
  return (
    <div className="px-1 mb-2.5">
      <h2 className="text-[18px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>{title}</h2>
      {note && <p className="text-[13px] mt-0.5" style={{ color: 'var(--label-2)' }}>{note}</p>}
    </div>
  );
}

export default function Discover() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getDiscover()
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = () => { setFailed(false); setAttempt((n) => n + 1); };
  const open = (item) => navigate(`/p/${encodeURIComponent(item.id)}`);
  const categoryLabel = (id, fallback) => {
    const c = CATEGORIES.find((x) => x.id === id);
    if (!c) return fallback || id;
    return language === 'hi' && c.labelHi ? c.labelHi : c.label;
  };

  const categories = data?.categories || [];
  const current = categories.find((c) => c.id === picked) || categories[0];

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
      <div className="mb-6 px-1">
        <h1 className="text-[26px] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>{t('discoverTitle')}</h1>
        <p className="text-[14px] mt-1" style={{ color: 'var(--label-2)' }}>{t('discoverSubtitle')}</p>
      </div>

      {/* Best on the shelf */}
      <section className="mb-8">
        <SectionTitle title={t('discoverRankings')} />
        {failed ? (
          <div className="rounded-[18px] p-4" style={{ background: 'var(--bg-card)' }}>
            <p className="text-[14px]" style={{ color: 'var(--label-2)' }}>{t('discoverUnavailable')}</p>
            <button onClick={retry} className="tap-scale mt-2 text-[14px] font-semibold min-h-[44px]" style={{ color: 'var(--tint)' }}>
              {t('discoverRetry')}
            </button>
          </div>
        ) : !data ? (
          <div className="rounded-[18px] p-4 text-[14px]" style={{ background: 'var(--bg-card)', color: 'var(--label-2)' }}>{t('genericLoading')}</div>
        ) : current ? (
          <>
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4" style={{ scrollbarWidth: 'none' }}>
              {categories.map((c) => {
                const active = c.id === current.id;
                const image = CATEGORIES.find((x) => x.id === c.id)?.image;
                return (
                  <button
                    key={c.id}
                    onClick={() => setPicked(c.id)}
                    aria-pressed={active}
                    className="tap-scale flex-shrink-0 flex items-center gap-1.5 h-10 pl-1.5 pr-3.5 rounded-full text-[13.5px] font-semibold"
                    style={{ background: active ? 'var(--tint)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--label-1)' }}
                  >
                    {image && <img src={image} alt="" className="w-7 h-7 rounded-full object-cover" />}
                    {categoryLabel(c.id, c.label)}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 rounded-[18px] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
              {current.items.slice(0, TOP).map((item, i) => (
                <button
                  key={item.id}
                  onClick={() => open(item)}
                  className="tap-scale w-full flex items-center gap-3 px-4 py-2.5 text-left"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--separator)' }}
                >
                  <span className="w-5 text-[15px] font-bold tabular-nums flex-shrink-0" style={{ color: 'var(--label-2)' }}>{i + 1}</span>
                  <ProductImage src={item.imageUrl} size={44} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14.5px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--label-1)' }}>{item.name}</span>
                    {item.brand && <span className="block text-[12.5px] truncate" style={{ color: 'var(--label-2)' }}>{item.brand}</span>}
                  </span>
                  <ScorePill score={item.score} />
                </button>
              ))}
              <Link
                to={`/category/${current.id}`}
                className="tap-scale flex items-center min-h-[48px] px-4 text-[14px] font-semibold"
                style={{ borderTop: '1px solid var(--separator)', color: 'var(--tint)' }}
              >
                {t('discoverSeeAllCategory', { count: current.total })}
              </Link>
            </div>
          </>
        ) : (
          <div className="rounded-[18px] p-4 text-[14px]" style={{ background: 'var(--bg-card)', color: 'var(--label-2)' }}>{t('discoverUnavailable')}</div>
        )}
      </section>

      {/* Easy swaps -- only when the build found real pairs. */}
      {data?.swaps?.length > 0 && (
        <section className="mb-8">
          <SectionTitle title={t('discoverSwaps')} note={t('discoverSwapsNote')} />
          <div className="space-y-2.5">
            {data.swaps.map((s) => (
              <div key={`${s.category}:${s.from.id}`} className="rounded-[18px] p-1.5" style={{ background: 'var(--bg-card)' }}>
                <p className="px-2.5 pt-1.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--label-2)' }}>{categoryLabel(s.category)}</p>
                {[['discoverInsteadOf', s.from], ['discoverTry', s.to]].map(([label, item]) => (
                  <button key={label} onClick={() => open(item)} className="tap-scale w-full flex items-center gap-3 px-2.5 py-2 text-left rounded-[14px]">
                    <ProductImage src={item.imageUrl} size={40} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12px] font-semibold" style={{ color: 'var(--label-2)' }}>{t(label)}</span>
                      <span className="block text-[14px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--label-1)' }}>{item.name}</span>
                    </span>
                    <ScorePill score={item.score} />
                  </button>
                ))}
                <p className="px-2.5 pb-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--v-very-healthy)' }}>{t('discoverPoints', { n: s.to.score - s.from.score })}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Claims decoded -- fixed, hand-written text; no data needed. */}
      <section>
        <SectionTitle title={t('discoverClaims')} note={t('discoverClaimsNote')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {CLAIMS.map(([title, body]) => (
            <div key={title} className="rounded-[18px] p-4" style={{ background: 'var(--bg-card)' }}>
              <p className="text-[16px] font-bold" style={{ color: 'var(--label-1)' }}>{t(title)}</p>
              <p className="text-[13.5px] leading-relaxed mt-1" style={{ color: 'var(--label-2)' }}>{t(body)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
