// src/components/LoadingScreen.jsx
//
// One universal loading screen for every report -- whether it's fetched
// instantly or built from scratch, the person sees the same thing and
// never has to know how the report is being produced. A glowing ring
// fills as the steps tick off; the celebration when the report opens
// lives on the Result page (ResultBurst).
import { useEffect, useRef, useState } from 'react';

const STEPS = [
  { icon: '📷', label: 'Reading the label' },
  { icon: '🇮🇳', label: 'Checking FSSAI regulations' },
  { icon: '🇪🇺', label: 'Comparing with EU/EFSA standards' },
  { icon: '⚠️', label: 'Flagging concerning additives' },
  { icon: '📊', label: 'Calculating your health score' },
  { icon: '📝', label: 'Preparing your report' },
];

// Progress creeps toward 92% on its own, then the screen is replaced the
// moment the report is actually ready.
const MAX_SIMULATED_PROGRESS = 92;
const STEP_DURATION_MS = 900;

const RING_SIZE = 116;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// `finishing` (see useLoaderFinish) makes the ring sprint to 100% and tick
// every step; `onFinished` fires once it has landed there, so the page can
// hand the ring over to the score ring.
export default function LoadingScreen({ finishing = false, onFinished }) {
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const finishingRef = useRef(false);
  finishingRef.current = finishing;

  useEffect(() => {
    const progressTimer = setInterval(() => {
      setProgress((p) => {
        // A quick sprint: from where a saved report usually is (~5%) to
        // 100% in about 250 ms, inside loadingPace's open budget.
        if (finishingRef.current) return Math.min(100, p + 25);
        return p < MAX_SIMULATED_PROGRESS ? p + 1 : p;
      });
    }, (STEP_DURATION_MS * STEPS.length) / MAX_SIMULATED_PROGRESS);

    const stepTimer = setInterval(() => {
      setStepIndex((i) => (finishingRef.current ? STEPS.length : i < STEPS.length - 1 ? i + 1 : i));
    }, STEP_DURATION_MS);

    return () => {
      clearInterval(progressTimer);
      clearInterval(stepTimer);
    };
  }, []);

  // Landed on 100%: hold a beat so it reads as "complete", then hand over.
  useEffect(() => {
    if (!finishing || progress < 100) return undefined;
    const t = setTimeout(() => onFinished?.(), 100);
    return () => clearTimeout(t);
  }, [finishing, progress, onFinished]);

  const offset = RING_CIRCUMFERENCE * (1 - progress / 100);

  return (
    <div className="flex flex-col items-center justify-center py-14 px-4">
      {/* Progress ring: soft pulsing glow behind, a dot orbiting the
          edge, the arc filling with the real progress. */}
      <div
        className={`relative mb-6 ${finishing && progress >= 100 ? 'loader-complete' : ''}`}
        style={{ width: RING_SIZE, height: RING_SIZE }}
        data-loader-ring
      >
        <div className="loader-glow absolute inset-2 rounded-full" aria-hidden="true" />
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="relative -rotate-90">
          <defs>
            <linearGradient id="loader-ring-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#4ade80" />
              <stop offset="100%" stopColor="#16a34a" />
            </linearGradient>
          </defs>
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="var(--fill)" strokeWidth={RING_STROKE} />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="url(#loader-ring-gradient)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.25s ease-out' }}
          />
        </svg>
        <div className="loader-orbit absolute inset-0" aria-hidden="true">
          <span className="absolute left-1/2 top-0 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-lime-300 shadow-[0_0_10px_2px_rgba(163,230,53,0.7)]" />
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[26px] font-bold leading-none tabular-nums text-slate-800 dark:text-slate-100">{progress}</span>
          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mt-0.5">percent</span>
        </div>
      </div>

      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1 text-center">Preparing your report</h2>
      <p className="text-slate-500 dark:text-slate-400 text-sm text-center mb-6">Hang tight — this only takes a moment</p>

      {/* Step checklist */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 max-w-sm w-full space-y-2.5">
        {STEPS.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <div
              key={i}
              className={`text-sm flex items-center gap-2.5 transition-opacity duration-300 ${
                done || active ? 'opacity-100' : 'opacity-40'
              }`}
            >
              <span className="flex-shrink-0 w-5 text-center">
                {done ? (
                  <span key="done" className="loader-tick inline-block text-green-600 dark:text-green-400">✓</span>
                ) : active ? (
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                ) : (
                  <span>{step.icon}</span>
                )}
              </span>
              <span className={done ? 'text-slate-400 dark:text-slate-500' : active ? 'text-slate-800 dark:text-slate-100 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
