// src/components/home/ShockReel.jsx
//
// The top of the home screen: well-known products an admin picked (Admin >
// Home screen), shown one at a time like stories. Each one is "read" first
// -- a laser line runs down the pack while the ring waits on "?" -- then the
// score ring fills, the verdict lands and the hook line rises in. The
// question the reel leaves behind is the point: "and what does MINE score?",
// which the Scan button right under it answers.
//
// Tap the right side for the next product, the left for the previous one,
// swipe either way, or press and hold to pause. Advances on its own
// otherwise, and stops while the page is in the background.
import { useEffect, useRef, useState } from 'react';
import ScoreCircle from '../ScoreCircle';
import ProductImage from '../ProductImage';
import { getScoreColor } from '../../utils/storage';
import { hookLine } from '../../utils/homeHooks';
import { useLanguage } from '../../contexts/LanguageContext';

const SLIDE_MS = 7000;
const SCAN_MS = 1150; // laser pass before the score shows
const TICK_MS = 50;

export default function ShockReel({ items, onOpen, onScan }) {
  const { t, language } = useLanguage();
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const touchStart = useRef(null);
  const count = items.length;
  const item = items[Math.min(index, count - 1)];

  const go = (step) => {
    setIndex((i) => (i + step + count) % count);
    setElapsed(0);
  };

  useEffect(() => {
    if (held) return undefined;
    const timer = setInterval(() => {
      if (!document.hidden) setElapsed((e) => Math.min(SLIDE_MS, e + TICK_MS));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [held]);

  // Fetch every pack photo up front, so the laser never reads a blank box.
  useEffect(() => {
    for (const it of items) if (it.imageUrl) new Image().src = it.imageUrl;
  }, [items]);

  // One product just stays revealed; several take turns.
  useEffect(() => {
    if (elapsed < SLIDE_MS || count < 2) return;
    setIndex((i) => (i + 1) % count); // eslint-disable-line react-hooks/set-state-in-effect
    setElapsed(0);
  }, [elapsed, count]);

  if (!item) return null;
  const revealed = elapsed >= SCAN_MS;
  const colors = getScoreColor(item.score);
  const line = hookLine(item, t);

  const onTouchStart = (e) => {
    touchStart.current = e.touches[0].clientX;
    setHeld(true);
  };
  const onTouchEnd = (e) => {
    setHeld(false);
    const start = touchStart.current;
    touchStart.current = null;
    if (start == null || count < 2) return;
    const dx = e.changedTouches[0].clientX - start;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  };

  return (
    <div
      className="reel-card relative mt-3 rounded-[22px] p-3.5 text-white select-none overflow-hidden"
      style={{ '--reel-glow': revealed ? `color-mix(in srgb, ${colors.color} 38%, transparent)` : 'rgba(163, 230, 53, 0.18)' }}
      onMouseDown={() => setHeld(true)}
      onMouseUp={() => setHeld(false)}
      onMouseLeave={() => setHeld(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Story progress: one segment per product. */}
      {count > 1 && (
        <div className="flex gap-1 mb-2.5">
          {items.map((it, i) => (
            <div key={it.lookupKey} className="h-[3px] flex-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.18)' }}>
              <div
                className="h-full rounded-full bg-white"
                style={{
                  width: i < index ? '100%' : i === index ? `${(elapsed / SLIDE_MS) * 100}%` : '0%',
                  transition: i === index && elapsed > 0 ? `width ${TICK_MS}ms linear` : 'none',
                }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Letter-spacing pulls Devanagari's joined letters apart -- English only. */}
      <p className={`font-bold text-lime-300/90 mb-2 ${language === 'hi' ? 'text-[12px]' : 'text-[10.5px] uppercase tracking-[0.14em]'}`}>{t('reelEyebrow')}</p>

      <div key={item.lookupKey} className="flex items-center gap-4">
        {/* The pack, in a viewfinder, with the laser reading it. */}
        <div className="relative flex-shrink-0 ml-1">
          <span className="reel-corner tl" /><span className="reel-corner tr" />
          <span className="reel-corner bl" /><span className="reel-corner br" />
          <div className="relative rounded-2xl overflow-hidden bg-white">
            <ProductImage src={item.imageUrl} size={104} expandable={false} />
            {!revealed && <div className="reel-laser" />}
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col items-center">
          {revealed ? (
            <ScoreCircle score={item.score} size="large" fillMs={1100} />
          ) : (
            <div className="w-[112px] h-[112px] rounded-full flex flex-col items-center justify-center" style={{ border: '9px solid rgba(255,255,255,0.14)' }}>
              <span className="reel-question text-4xl font-extrabold text-lime-300">?</span>
            </div>
          )}
          <div className="h-6 mt-1.5 flex items-center">
            {revealed && elapsed >= SCAN_MS + 1000 ? (
              <span className="reel-pop text-[11px] font-extrabold uppercase tracking-wide px-2.5 py-0.5 rounded-full" style={{ background: colors.color, color: '#0b1d16' }}>
                {colors.label}
              </span>
            ) : !revealed && (
              <span className="text-[11px] text-white/60">{t('reelScanning')}</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 min-h-[58px]">
        <p className="text-[15px] font-bold leading-snug line-clamp-2">{item.productName}</p>
        {revealed && elapsed >= SCAN_MS + 1250 && line && (
          <p className="reel-rise text-[13px] leading-snug mt-1 font-semibold" style={{ color: colors.color }}>{line}</p>
        )}
      </div>

      <div className="relative z-10 flex gap-2 mt-3">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(item); }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="tap-scale flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-white text-slate-900"
        >
          {t('reelSeeWhy')} →
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onScan(); }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="tap-scale flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-lime-400 text-slate-900"
        >
          ▦ {t('reelScanYours')}
        </button>
      </div>

      {/* Tap zones over the top part: left = back, right = forward. */}
      {count > 1 && (
        <>
          <button aria-label={t('reelPrev')} onClick={() => go(-1)} className="absolute left-0 top-0 w-1/3 bottom-16" />
          <button aria-label={t('reelNext')} onClick={() => go(1)} className="absolute right-0 top-0 w-2/3 bottom-16" />
        </>
      )}
    </div>
  );
}
