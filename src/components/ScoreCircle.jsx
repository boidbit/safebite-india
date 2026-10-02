// src/components/ScoreCircle.jsx
// The score ring. Colour comes from the shared verdict scale, so the ring
// says the same thing as the verdict word next to it.
//
// The number counts up and the ring fills from empty on mount instead of
// just appearing at its final value -- the score is the single moment
// this app exists to deliver, worth a real reveal. Because the colour
// comes from getScoreColor(liveValue) rather than the final score, the
// ring naturally passes through the same red -> amber -> green bands as
// it climbs, with no separate colour-interpolation logic needed. Skips
// straight to the final state under prefers-reduced-motion.
import { useEffect, useRef, useState } from 'react';
import { getScoreColor } from '../utils/storage';

const ANIMATION_MS = 1000;

export default function ScoreCircle({ score, size = 'large', showLabel = false, burstTarget = false, startDelayMs = 0, fillMs = ANIMATION_MS }) {
  const clamped = Math.max(0, Math.min(100, score));
  const finalColors = getScoreColor(clamped);

  // Only the big result ring counts up -- small rings in lists (History,
  // cards) show their score straight away, or every row would be
  // counting at once as the list appears.
  const prefersReducedMotion = size === 'small' ||
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const [liveValue, setLiveValue] = useState(prefersReducedMotion ? clamped : 0);
  const frameRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion) {
      setLiveValue(clamped);
      return;
    }
    // startDelayMs holds the ring empty while ResultBurst's sparks fly in
    // and assemble it, then it fills.
    let start = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / fillMs);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      setLiveValue(eased * clamped);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    const kickoff = setTimeout(() => {
      start = performance.now();
      frameRef.current = requestAnimationFrame(tick);
    }, startDelayMs);
    return () => {
      clearTimeout(kickoff);
      cancelAnimationFrame(frameRef.current);
    };
  }, [clamped]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveColors = getScoreColor(liveValue);
  // 'medium' (88px) counts up like 'large', for cards too narrow for 112px.
  const svgSize = size === 'xl' ? 144 : size === 'large' ? 112 : size === 'medium' ? 88 : 64;
  const strokeWidth = size === 'xl' ? 11 : size === 'large' ? 9 : size === 'medium' ? 8 : 6;
  const radius = svgSize / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (liveValue / 100) * circumference;

  return (
    <div className="flex flex-col items-center flex-shrink-0">
      <div
        className="relative"
        style={{ width: svgSize, height: svgSize }}
        {...(burstTarget ? { 'data-burst-target': true, 'data-burst-radius': radius } : {})}
      >
        <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`} className="rotate-[-90deg]">
          <circle
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={radius}
            fill="none"
            stroke="var(--fill)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={radius}
            fill="none"
            stroke={liveColors.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`${size === 'xl' ? 'text-5xl' : size === 'large' ? 'text-4xl' : size === 'medium' ? 'text-3xl' : 'text-xl'} font-bold leading-none tracking-tight tabular-nums`}
            style={{ color: liveColors.color }}
          >
            {Math.round(liveValue)}
          </span>
          {(size === 'large' || size === 'xl' || size === 'medium') && (
            <span className={`${size === 'medium' ? 'text-[10px] mt-0.5' : 'text-xs mt-1'}`} style={{ color: 'var(--label-2)' }}>
              out of 100
            </span>
          )}
        </div>
      </div>

      {showLabel && (
        <span
          className="mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: finalColors.bg, color: finalColors.color }}
        >
          {finalColors.label}
        </span>
      )}
    </div>
  );
}
