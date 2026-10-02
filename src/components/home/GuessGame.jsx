// src/components/home/GuessGame.jsx
//
// "Guess the score", always on the home screen and never "done": slide to
// guess, lock it, the real score's ring fills next to yours -- confetti for
// a bullseye, a shake when it's way off -- then the next product, drawn at
// random from every approved product (admin picks come up more often). The
// next one loads while you play this one, so Next is instant. Teaches how the
// score reads without a line of explanation.
//
// Kept on this phone only (localStorage): how many played, how many landed
// within 15, the current and best run of those, and the last products seen
// so they don't come straight back. Nothing is sent anywhere.
import { useEffect, useMemo, useRef, useState } from 'react';
import ScoreCircle from '../ScoreCircle';
import ProductImage from '../ProductImage';
import { getScoreColor } from '../../utils/storage';
import { judgeGuess, weightedSample } from '../../utils/homeHooks';
import { getHomeCard } from '../../services/homeFeaturesRepo';
import { PUBLIC_APP_URL, whatsappShareUrl } from '../../utils/share';
import { useLanguage } from '../../contexts/LanguageContext';

const STORE_KEY = 'foodguard-guess-stats';
const RECENT_LIMIT = 40;
const CLOSE = 15;

function loadStats() {
  try { return { played: 0, close: 0, run: 0, best: 0, recent: [], ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { played: 0, close: 0, run: 0, best: 0, recent: [] }; }
}
function saveStats(stats) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(stats)); } catch { /* private mode */ }
}

const FACES = [[25, '🤢'], [45, '😬'], [65, '😐'], [85, '🙂'], [101, '🤩']];
const faceFor = (n) => FACES.find(([max]) => n < max)[1];

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 22 }, (_, i) => {
    const angle = (i / 22) * Math.PI * 2;
    const dist = 90 + (i % 5) * 22;
    return {
      dx: `${Math.cos(angle) * dist}px`,
      dy: `${Math.sin(angle) * dist - 30}px`,
      rot: `${(i % 2 ? 1 : -1) * (180 + i * 25)}deg`,
      color: ['#22c55e', '#a3e635', '#facc15', '#38bdf8', '#f472b6'][i % 5],
      delay: `${(i % 4) * 40}ms`,
    };
  }), []);
  return pieces.map((p, i) => (
    <span
      key={i}
      className="guess-confetti w-2 h-3 rounded-sm"
      style={{ background: p.color, '--dx': p.dx, '--dy': p.dy, '--rot': p.rot, animationDelay: p.delay }}
    />
  ));
}

export default function GuessGame({ candidates, onOpen }) {
  const { t } = useLanguage();
  const [stats, setStats] = useState(loadStats);
  const [item, setItem] = useState(null);
  const [guess, setGuess] = useState(50);
  const [locked, setLocked] = useState(false);
  const upcoming = useRef(null); // the next round's card, loading in the background
  const seen = useRef(new Set(stats.recent));

  // A random candidate not seen lately (all seen: start over), as a live card.
  const draw = async () => {
    for (let tries = 0; tries < 4; tries++) {
      let fresh = candidates.filter((c) => !seen.current.has(c.lookupKey));
      if (!fresh.length) { seen.current.clear(); fresh = candidates; }
      const [pick] = weightedSample(fresh, 1);
      if (!pick) return null;
      seen.current.add(pick.lookupKey);
      const card = await getHomeCard(pick).catch(() => null);
      if (card) {
        if (card.imageUrl) new Image().src = card.imageUrl;
        return card;
      }
    }
    return null;
  };

  useEffect(() => {
    let cancelled = false;
    draw().then((card) => {
      if (cancelled) return;
      setItem(card);
      upcoming.current = draw();
    });
    return () => { cancelled = true; };
  }, [candidates]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!candidates.length) return null;
  const answer = locked && item ? judgeGuess(guess, item.score) : null;
  const guessColors = getScoreColor(guess);

  const lock = () => {
    setLocked(true);
    const { diff } = judgeGuess(guess, item.score);
    const close = diff <= CLOSE;
    const run = close ? stats.run + 1 : 0;
    const next = {
      played: stats.played + 1,
      close: stats.close + (close ? 1 : 0),
      run,
      best: Math.max(stats.best, run),
      recent: [...seen.current].slice(-RECENT_LIMIT),
    };
    setStats(next);
    saveStats(next);
  };

  const nextRound = async () => {
    const card = await (upcoming.current || draw());
    setLocked(false);
    setGuess(50);
    setItem(card);
    upcoming.current = draw();
  };

  const share = async () => {
    const text = t('guessShareText', { correct: stats.close, total: stats.played, link: PUBLIC_APP_URL });
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch { /* cancelled -- fall through to WhatsApp */ }
    }
    window.open(whatsappShareUrl(text), '_blank', 'noopener');
  };

  return (
    <div className="mb-6 rounded-[22px] p-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-[17px] font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">🎯 {t('guessTitle')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('guessSubtitle')}</p>
        </div>
        {stats.played > 0 && (
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--v-good-bg)', color: 'var(--v-very-healthy)' }}>
              {t('guessTally', { close: stats.close, played: stats.played })}
            </span>
            {stats.run > 1 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--v-poor-bg)', color: 'var(--v-poor)' }}>
                {t('guessRun', { n: stats.run })}
              </span>
            )}
          </div>
        )}
      </div>

      {!item ? (
        <div>
          <div className="flex items-center gap-3"><div className="shimmer w-[72px] h-[72px] rounded-2xl" /><div className="shimmer h-4 flex-1 rounded-full" /></div>
          <div className="shimmer h-[150px] rounded-2xl mt-4" />
        </div>
      ) : (
        <div key={item.lookupKey} className={`page-in ${answer?.level === 'way' ? 'guess-shake' : ''}`}>
          <div className="flex items-center gap-3">
            <ProductImage src={item.imageUrl} size={72} expandable={false} />
            <p className="flex-1 min-w-0 text-[14px] font-bold text-slate-800 dark:text-slate-100 leading-snug line-clamp-3">{item.productName}</p>
          </div>

          {!locked ? (
            <>
              <div className="flex items-end justify-center gap-2 mt-4 mb-2">
                <span className="guess-face text-4xl" aria-hidden="true">{faceFor(guess)}</span>
                <span className="text-5xl font-extrabold tabular-nums leading-none" style={{ color: guessColors.color }}>{guess}</span>
                <span className="text-sm font-semibold text-slate-400 mb-1">/100</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={guess}
                onChange={(e) => setGuess(Number(e.target.value))}
                aria-label={t('guessSubtitle')}
                className="guess-range"
                style={{ '--guess-color': guessColors.color }}
              />
              <div className="flex justify-between text-[10.5px] font-semibold text-slate-400 mt-1.5">
                <span>{t('guessSliderLow')}</span><span>{t('guessSliderHigh')}</span>
              </div>
              <button onClick={lock} className="tap-scale w-full mt-4 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[14px] font-bold">
                {t('guessLock')} 🔒
              </button>
            </>
          ) : (
            <>
              <div className="relative flex items-end justify-around mt-4">
                {answer.level === 'bullseye' && <Confetti />}
                <div className="flex flex-col items-center">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">{t('guessYou')}</span>
                  <span className="w-[112px] h-[112px] rounded-full flex items-center justify-center text-4xl font-extrabold tabular-nums" style={{ background: guessColors.bg, color: guessColors.color, border: `9px solid ${guessColors.bg}` }}>
                    {guess}
                  </span>
                </div>
                <span className="text-xl text-slate-300 self-center mt-5">→</span>
                <div className="flex flex-col items-center">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">{t('guessReal')}</span>
                  <ScoreCircle score={item.score} size="large" fillMs={1100} />
                </div>
              </div>
              <p className="reel-rise text-center text-[14px] font-bold text-slate-800 dark:text-slate-100 mt-3" style={{ animationDelay: '1.1s' }}>
                {answer.level === 'bullseye' || answer.level === 'close'
                  ? t(`guess_${answer.level}`, { diff: answer.diff })
                  : t(`guess_${answer.level}_${answer.higher ? 'higher' : 'lower'}`, { diff: answer.diff })}
              </p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => onOpen(item)}
                  className="tap-scale flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  {t('guessWhy', { score: item.score })} →
                </button>
                <button onClick={nextRound} className="tap-scale flex-1 py-2.5 rounded-xl bg-green-600 text-white text-[13px] font-bold">
                  {t('guessNext')} →
                </button>
              </div>
              {stats.played >= 3 && (
                <button onClick={share} className="tap-scale w-full mt-2 py-2 text-[12.5px] font-semibold" style={{ color: 'var(--tint)' }}>
                  💬 {t('guessShare')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
