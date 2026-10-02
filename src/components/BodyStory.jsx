// src/components/BodyStory.jsx
//
// A short, story-style explainer of what a nutrient does in the body --
// scenes play one after another (about 7 s each), tap the right side for the
// next, the left for the previous, press and hold to pause. Each scene: a
// picture, a heading, the caption (a sourced quote) and its source, linked.
// The content lives in components/body/*Story.js; this only plays it.
//
// Off for prefers-reduced-motion: no auto-advance, the pictures still.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const SCENE_MS = 7000;
const TICK_MS = 50;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function BodyStory({ title, scenes, onClose, t }) {
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [held, setHeld] = useState(false);
  const [still] = useState(reducedMotion);
  const last = index === scenes.length - 1;
  const scene = scenes[index];

  useEffect(() => {
    if (held || still) return undefined;
    const timer = setInterval(() => setElapsed((e) => Math.min(SCENE_MS, e + TICK_MS)), TICK_MS);
    return () => clearInterval(timer);
  }, [held, still]);

  useEffect(() => {
    if (elapsed < SCENE_MS || last) return;
    setIndex((i) => i + 1); // eslint-disable-line react-hooks/set-state-in-effect
    setElapsed(0);
  }, [elapsed, last]);

  // Esc closes; the page behind doesn't scroll while it's open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  const go = (step) => {
    setIndex((i) => Math.max(0, Math.min(scenes.length - 1, i + step)));
    setElapsed(0);
  };
  const { Scene } = scene;
  const heading = t(scene.headKey);

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-black/60 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="relative w-full sm:max-w-[440px] max-h-[94vh] overflow-y-auto rounded-t-[24px] sm:rounded-[22px] px-4 pt-4 pb-6"
        style={{ background: 'var(--bg-card)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        {/* Progress, one segment per scene */}
        <div className="flex gap-1 mb-3">
          {scenes.map((s, i) => (
            <div key={s.key} className="h-[3px] flex-1 rounded-full overflow-hidden" style={{ background: 'var(--fill)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  background: 'var(--label-1)',
                  width: i < index ? '100%' : i === index ? (still || last ? '100%' : `${(elapsed / SCENE_MS) * 100}%`) : '0%',
                  transition: i === index && elapsed > 0 ? `width ${TICK_MS}ms linear` : 'none',
                }}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-[13px] font-semibold" style={{ color: 'var(--label-2)' }}>{title}</p>
          <button onClick={onClose} aria-label={t('ariaClose')} className="tap-scale w-8 h-8 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ background: 'var(--fill)', color: 'var(--label-2)' }}>×</button>
        </div>

        {/* The picture -- tap zones on it move between scenes; holding pauses. */}
        <div
          className="relative rounded-[18px] px-2 py-3 select-none"
          style={{ background: 'var(--bg-grouped)' }}
          onPointerDown={() => setHeld(true)}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
        >
          <div key={scene.key} className="page-in">
            <Scene {...(scene.props || {})} label={heading} t={t} />
          </div>
          <button aria-label={t('reelPrev')} onClick={() => go(-1)} className="absolute left-0 top-0 bottom-0 w-1/3" />
          <button aria-label={t('reelNext')} onClick={() => go(1)} className="absolute right-0 top-0 bottom-0 w-2/3" />
        </div>

        <div key={`text-${scene.key}`} className="reel-rise mt-4 min-h-[148px]">
          <p className="text-[18px] font-extrabold tracking-tight" style={{ color: 'var(--label-1)' }}>{heading}</p>
          <p className="text-[14.5px] leading-relaxed mt-1.5" style={{ color: 'var(--label-1)' }}>{t(scene.captionKey, scene.vars)}</p>
          <p className="text-[11.5px] mt-2" style={{ color: 'var(--label-3)' }}>
            {scene.source ? (
              <>
                {t('bsSource')}{' '}
                <a href={scene.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2" style={{ color: 'var(--label-2)' }}>
                  {scene.source.name} ↗
                </a>
              </>
            ) : t('bsFromLabel')}
          </p>
        </div>

        <div className="flex gap-2 mt-3">
          {last ? (
            <>
              <button onClick={() => { setIndex(0); setElapsed(0); }} className="tap-scale flex-1 py-2.5 rounded-xl text-[13.5px] font-bold" style={{ background: 'var(--fill)', color: 'var(--label-1)' }}>
                ↺ {t('bsReplay')}
              </button>
              <button onClick={onClose} className="tap-scale flex-1 py-2.5 rounded-xl text-[13.5px] font-bold text-white" style={{ background: 'var(--tint)' }}>
                {t('bsDone')}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => go(-1)} disabled={index === 0} className="tap-scale flex-1 py-2.5 rounded-xl text-[13.5px] font-bold" style={{ background: 'var(--fill)', color: 'var(--label-1)', opacity: index === 0 ? 0.4 : 1 }}>
                ← {t('bsBack')}
              </button>
              <button onClick={() => go(1)} className="tap-scale flex-1 py-2.5 rounded-xl text-[13.5px] font-bold text-white" style={{ background: 'var(--tint)' }}>
                {t('bsNext')} →
              </button>
            </>
          )}
        </div>
        <p className="text-[11px] text-center mt-3 leading-snug" style={{ color: 'var(--label-3)' }}>{t('bsDisclaimer')}</p>
      </div>
    </div>,
    document.body,
  );
}
