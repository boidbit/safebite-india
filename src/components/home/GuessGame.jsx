// src/components/home/GuessGame.jsx
//
// "Guess the score": three products a day from the admin's pool. Slide to
// guess, lock it, and the real score's ring fills next to yours -- confetti
// for a bullseye, a shake when it's way off. Teaches how the score reads
// without a single line of explanation, and the daily set plus a streak is
// a reason to come back tomorrow.
//
// Kept on this phone only (localStorage): today's answers, the streak, the
// last day finished. Nothing is sent anywhere.
import { useMemo, useState } from 'react';
import ScoreCircle from '../ScoreCircle';
import ProductImage from '../ProductImage';
import { getScoreColor } from '../../utils/storage';
import { judgeGuess, dailySlice } from '../../utils/homeHooks';
import { PUBLIC_APP_URL, whatsappShareUrl } from '../../utils/share';
import { useLanguage } from '../../contexts/LanguageContext';

const ROUNDS = 3;
const STORE_KEY = 'foodguard-guess-game';

// Local calendar day, so "today" turns over at the person's own midnight.
const dayNumber = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);

function loadState() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}; } catch { return {}; }
}
function saveState(state) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
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

export default function GuessGame({ pool, onOpen }) {
  const { t } = useLanguage();
  const today = dayNumber();
  const rounds = useMemo(() => dailySlice(pool, ROUNDS, today), [pool, today]);
  const [store, setStore] = useState(() => {
    const s = loadState();
    return s.day === today ? s : { ...s, day: today, answers: [] };
  });
  const [round, setRound] = useState(() => Math.min(store.answers?.length || 0, rounds.length));
  const [guess, setGuess] = useState(50);
  const [locked, setLocked] = useState(false);
  const [replay, setReplay] = useState(false);

  if (!rounds.length) return null;
  const answers = store.answers || [];
  const finished = round >= rounds.length;
  const item = rounds[Math.min(round, rounds.length - 1)];
  const answer = locked ? judgeGuess(guess, item.score) : null;
  const guessColors = getScoreColor(guess);
  const closeCount = answers.filter((a) => Math.abs(a.guess - a.actual) <= 15).length;

  const lock = () => {
    setLocked(true);
    if (replay) return;
    const nextAnswers = [...answers, { key: item.lookupKey, guess, actual: item.score }];
    let next = { ...store, answers: nextAnswers };
    if (nextAnswers.length >= rounds.length && store.lastDone !== today) {
      const streak = store.lastDone === today - 1 ? (store.streak || 0) + 1 : 1;
      next = { ...next, lastDone: today, streak, best: Math.max(store.best || 0, streak) };
    }
    setStore(next);
    saveState(next);
  };

  const nextRound = () => {
    setLocked(false);
    setGuess(50);
    setRound((r) => r + 1);
  };

  const share = async () => {
    const text = t('guessShareText', { correct: closeCount, total: rounds.length, link: PUBLIC_APP_URL });
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch { /* cancelled -- fall through to WhatsApp */ }
    }
    window.open(whatsappShareUrl(text), '_blank', 'noopener');
  };

  return (
    <div className="mb-6 rounded-[22px] p-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-[17px] font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">🎯 {t('guessTitle')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('guessSubtitle')}</p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {!finished && <span className="text-[11px] font-bold text-slate-400">{t('guessRound', { n: round + 1, total: rounds.length })}</span>}
          {store.streak > 1 && store.lastDone >= today - 1 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--v-poor-bg)', color: 'var(--v-poor)' }}>
              {t('guessStreak', { days: store.streak })}
            </span>
          )}
        </div>
      </div>

      {finished ? (
        <div className="text-center py-2">
          <div className="flex justify-center gap-2 mb-3">
            {answers.map((a) => {
              const level = judgeGuess(a.guess, a.actual).level;
              return <span key={a.key} className="text-2xl">{level === 'bullseye' ? '🎯' : level === 'close' ? '✅' : level === 'off' ? '🤏' : '😮'}</span>;
            })}
          </div>
          <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{t('guessDone', { correct: closeCount, total: rounds.length })}</p>
          <p className="text-xs text-slate-400 mt-1">{t('guessComeBack')}</p>
          <div className="flex gap-2 mt-4">
            <button onClick={share} className="tap-scale flex-1 py-2.5 rounded-xl bg-green-600 text-white text-[13px] font-bold">
              {t('guessShare')} 💬
            </button>
            <button
              onClick={() => { setReplay(true); setRound(0); setLocked(false); setGuess(50); }}
              className="tap-scale px-4 py-2.5 rounded-xl text-[13px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
            >
              {t('guessPlayAgain')}
            </button>
          </div>
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
                  {round + 1 >= rounds.length ? t('guessFinish') : `${t('guessNext')} →`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
