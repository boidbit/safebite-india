// src/components/body/SugarJourney.jsx
//
// "What sugar does in your body" as one continuous animation -- a single
// take, the camera travelling through a body: the teaspoons going in at the
// mouth, sugar breaking down into glucose in the stomach, glucose spreading
// through the blood, the pancreas releasing insulin, glucose going into
// cells, plaque turning sugar into acid on a tooth, then back out to the
// whole body against WHO's 25 g a day.
//
// Dynamic: how much sugar is shown follows the period and frequency picked
// (one serving / a week / a month / a year; every day / 3x / once a week) --
// a year of it every day rains hundreds of spoons, with the count ticking
// up, a stomachful of sugar and a bloodstream full of glucose.
//
// Every subtitle after the first is a word-for-word quote (Hindi translated,
// marked as such) from MedlinePlus (U.S. National Library of Medicine) or
// WHO, linked; the first and last are this product's own label numbers.
// The picture only ever shows what the subtitle says.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { accumulate, MEASURES } from '../../services/nutrientProjection';

const SOURCES = {
  carbs: { name: 'MedlinePlus (U.S. National Library of Medicine): Carbohydrates', url: 'https://medlineplus.gov/ency/article/002469.htm' },
  insulin: { name: 'MedlinePlus (U.S. National Library of Medicine): Insulin in Blood', url: 'https://medlineplus.gov/lab-tests/insulin-in-blood/' },
  caries: { name: 'WHO: Sugars and dental caries', url: 'https://www.who.int/news-room/fact-sheets/detail/sugars-and-dental-caries' },
  guideline: { name: 'WHO: Guideline on sugars intake (2015)', url: 'https://www.who.int/news/item/04-03-2015-who-calls-on-countries-to-reduce-sugars-intake-among-adults-and-children' },
};

// The take, in seconds, and where the camera is (viewBox x, y, w, h -- all
// the same 0.9 aspect, so moving between them never letterboxes).
const PHASES = [
  { key: 'intake', start: 0, end: 4.5, cam: [0, -150, 300, 333], captionKey: null, source: null },
  { key: 'stomach', start: 4.5, end: 8.5, cam: [88, 186, 160, 178], captionKey: 'bsSugar2', source: SOURCES.carbs },
  { key: 'blood', start: 8.5, end: 12, cam: [10, 150, 280, 311], captionKey: 'bjBlood', source: SOURCES.insulin },
  { key: 'insulin', start: 12, end: 15, cam: [90, 248, 130, 144], captionKey: 'bjInsulin', source: SOURCES.insulin },
  { key: 'cells', start: 15, end: 18.5, cam: [118, 418, 120, 133], captionKey: 'bsSugar4', source: SOURCES.insulin },
  { key: 'teeth', start: 18.5, end: 22, cam: [124, 66, 52, 58], captionKey: 'bsSugar5', source: SOURCES.caries },
  { key: 'limit', start: 22, end: 27, cam: [-120, -12, 540, 600], captionKey: 'bsSugar6', source: SOURCES.guideline },
];
const TOTAL = PHASES[PHASES.length - 1].end;
const MOVE = 1.1; // seconds the camera takes to travel between shots

const SUGAR = '#ec4899';
const GLUCOSE = '#f59e0b';
const BLOOD = '#ef4444';
const INSULIN = '#6366f1';
const CELL = '#22c55e';
const MOUTH = [150, 92];

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const lerp = (a, b, k) => a + (b - a) * k;
// A stable pseudo-random number per index, so particles don't jump between renders.
const rnd = (i, salt = 1) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function phaseAt(t) {
  return PHASES.find((p) => t < p.end) || PHASES[PHASES.length - 1];
}

function cameraAt(t) {
  const i = PHASES.indexOf(phaseAt(t));
  const p = PHASES[i];
  const prev = PHASES[Math.max(0, i - 1)];
  const k = i === 0 ? 1 : ease(clamp01((t - p.start) / MOVE));
  return p.cam.map((v, j) => lerp(prev.cam[j], v, k));
}

// The blood vessel loop through the body, as points; positions along it by fraction.
const VESSEL = [[165, 300], [150, 215], [110, 185], [70, 230], [52, 320], [58, 390], [90, 360], [115, 330], [150, 350], [178, 390], [186, 470], [190, 560], [172, 525], [165, 440], [160, 380], [165, 300]];
const SEGMENTS = VESSEL.slice(1).map((p, i) => Math.hypot(p[0] - VESSEL[i][0], p[1] - VESSEL[i][1]));
const VESSEL_LENGTH = SEGMENTS.reduce((a, b) => a + b, 0);
function alongVessel(f) {
  let d = (((f % 1) + 1) % 1) * VESSEL_LENGTH;
  for (let i = 0; i < SEGMENTS.length; i++) {
    if (d <= SEGMENTS[i]) {
      const k = d / SEGMENTS[i];
      return [lerp(VESSEL[i][0], VESSEL[i + 1][0], k), lerp(VESSEL[i][1], VESSEL[i + 1][1], k)];
    }
    d -= SEGMENTS[i];
  }
  return VESSEL[0];
}
const VESSEL_PATH = `M${VESSEL.map((p) => p.join(' ')).join(' L')}`;
const CELLS = [[176, 470], [184, 497], [170, 522], [190, 535]];

const formatGrams = (g) => (g >= 1000 ? `${Math.round(g / 100) / 10} kg` : `${Math.round(g)} g`);
const DAYS = { serving: 1, week: 7, month: 30, year: 364 };

function Spoon({ x, y, rot, opacity }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`} opacity={opacity}>
      <rect x="5" y="-1.2" width="13" height="2.4" rx="1.2" fill="var(--label-3)" />
      <ellipse cx="0" cy="0" rx="6.5" ry="4.2" fill="var(--bg-card)" stroke="var(--label-3)" strokeWidth="0.8" />
      <path d="M-5 -0.5 q5 -6 10 0 z" fill={SUGAR} />
    </g>
  );
}

function Body({ stomachGlow, glucoseInBlood }) {
  return (
    <g>
      {/* outline */}
      <g fill="var(--fill)" stroke="var(--label-3)" strokeWidth="1.2">
        <path d="M75 150 Q45 200 40 300 Q38 360 50 400 L62 398 Q60 330 70 280 Q80 220 95 190 Z" />
        <path d="M225 150 Q255 200 260 300 Q262 360 250 400 L238 398 Q240 330 230 280 Q220 220 205 190 Z" />
        <path d="M100 385 L95 580 L135 580 L149 400 Z" />
        <path d="M200 385 L205 580 L165 580 L151 400 Z" />
        <path d="M95 130 Q150 120 205 130 L225 150 Q235 260 215 330 L205 390 L95 390 L85 330 Q65 260 75 150 Z" />
        <rect x="138" y="104" width="24" height="30" rx="6" />
        <circle cx="150" cy="70" r="42" />
      </g>
      {/* mouth, gullet */}
      <path d="M138 90 q12 8 24 0" fill="none" stroke="var(--label-2)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M150 112 L150 236" stroke={SUGAR} strokeOpacity="0.25" strokeWidth="5" strokeLinecap="round" />
      {/* blood vessels */}
      <path d={VESSEL_PATH} fill="none" stroke={BLOOD} strokeOpacity={0.22 + 0.25 * glucoseInBlood} strokeWidth="6" strokeLinejoin="round" />
      {/* stomach, pancreas */}
      <path d="M150 235 Q197 224 202 262 Q206 302 166 306 Q140 306 145 286 Q160 270 150 235 Z" fill={SUGAR} fillOpacity={0.1 + 0.2 * stomachGlow} stroke={SUGAR} strokeOpacity="0.6" strokeWidth="1.4" />
      <path d="M118 302 Q150 288 188 300 Q172 314 124 312 Z" fill={INSULIN} fillOpacity="0.18" stroke={INSULIN} strokeOpacity="0.6" strokeWidth="1.2" />
    </g>
  );
}

export default function SugarJourney({ teaspoons, grams, servingGrams, unit, perWeek: startPerWeek = 7, onClose, t }) {
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [period, setPeriod] = useState('year');
  const [perWeek, setPerWeek] = useState(startPerWeek);
  const [time, setTime] = useState(still ? TOTAL : 0);
  const [playing, setPlaying] = useState(!still);
  const last = useRef(null);

  // This period's sugar: one serving, or the week/month/year at the frequency picked.
  // Small totals keep their half-spoons (2.5, not a rounded-down 2).
  const amount = useMemo(() => {
    if (period === 'serving') return { spoons: teaspoons, grams };
    const total = accumulate('sugar', grams, perWeek)[period];
    const spoons = total.spoons >= 10 ? total.spoons : Math.round((total.grams / MEASURES.sugar.gramsPerSpoon) * 10) / 10;
    return { spoons, grams: total.grams };
  }, [period, perWeek, teaspoons, grams]);
  const limitGrams = 25 * DAYS[period];
  const share = Math.round((amount.grams / limitGrams) * 100);

  // How many things to draw: a picture of the amount, not one sprite per spoon.
  const spoonSprites = Math.max(1, Math.min(48, Math.round(amount.spoons)));
  const crystals = Math.max(4, Math.min(30, Math.round(4 + 6 * Math.log10(amount.spoons + 1))));
  const dots = Math.min(64, crystals * 2);

  const restart = () => { setTime(0); setPlaying(true); last.current = null; };
  // A new period or frequency is a new take, from the top.
  const choosePeriod = (p) => { setPeriod(p); if (!still) restart(); };
  const chooseFreq = (f) => { setPerWeek(f); if (!still) restart(); };

  // The clock: one frame at a time while playing.
  useEffect(() => {
    if (!playing) return undefined;
    let raf;
    const tick = (now) => {
      if (last.current != null) {
        const dt = Math.min(0.1, (now - last.current) / 1000);
        setTime((x) => Math.min(TOTAL, x + dt));
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); last.current = null; };
  }, [playing]);

  // The end of the take stops the clock.
  useEffect(() => {
    if (time >= TOTAL && playing) setPlaying(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [time, playing]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  const phase = phaseAt(time);
  const cam = cameraAt(time);
  const tIn = (key) => {
    const p = PHASES.find((x) => x.key === key);
    return clamp01((time - p.start) / (p.end - p.start));
  };
  const reached = (key) => time >= PHASES.find((x) => x.key === key).start;

  // A name on the thing the subtitle is talking about, the same size on
  // screen however close the camera is.
  const labelSize = (11 * cam[2]) / 358;
  const labelIn = (key) => {
    const p = PHASES.find((x) => x.key === key);
    return phase.key === key ? clamp01((time - p.start - MOVE * 0.6) / 0.4) : 0;
  };
  const label = (text, x, y, color, opacity, anchor = 'start') => opacity > 0 && (
    <text x={x} y={y} fontSize={labelSize} fontWeight="700" fill={color} textAnchor={anchor} opacity={opacity}
      stroke="var(--bg-grouped)" strokeWidth={labelSize * 0.28} paintOrder="stroke" strokeLinejoin="round">{text}</text>
  );

  // --- intake: spoons fall into the mouth, the count ticks up ---
  const intake = tIn('intake');
  const counted = amount.spoons * ease(clamp01(intake / 0.9));
  const spoonCount = (n) => (amount.spoons < 10 ? Math.round(n * 10) / 10 : Math.round(n)).toLocaleString();
  const spoonEls = Array.from({ length: spoonSprites }, (_, i) => {
    const startAt = (i / spoonSprites) * 0.75;
    const k = clamp01((intake - startAt) / 0.25);
    if (k <= 0 || k >= 1) return null;
    const x0 = 70 + rnd(i) * 160;
    const y0 = -150 + rnd(i, 2) * 60;
    const e = k * k;
    return <Spoon key={i} x={lerp(x0, MOUTH[0], e)} y={lerp(y0, MOUTH[1], e)} rot={lerp(-40 + rnd(i, 3) * 80, 0, e)} opacity={k > 0.85 ? (1 - k) / 0.15 : 1} />;
  });

  // --- stomach: crystals slide down the gullet (the camera following them),
  // pile up, then break down into glucose ---
  const stomach = tIn('stomach');
  const pile = clamp01(stomach / 0.55);
  const breakdown = clamp01((stomach - 0.55) / 0.4);
  const crystalEls = reached('stomach') && breakdown < 1 && Array.from({ length: crystals }, (_, i) => {
    const k = clamp01((stomach - (i / crystals) * 0.25) / 0.3);
    if (k <= 0) return null;
    const cx = 160 + rnd(i, 4) * 32;
    const cy = 262 + rnd(i, 5) * 30;
    // first two-thirds of the trip down the gullet, the rest into the pile
    const down = ease(clamp01(k / 0.65));
    const settle = ease(clamp01((k - 0.65) / 0.35));
    const x = lerp(MOUTH[0], cx, settle);
    const y = lerp(lerp(MOUTH[1] + 8, 238, down), cy, settle);
    const s = 4.5 * (1 - breakdown);
    return <rect key={i} x={x - s / 2} y={y - s / 2} width={s} height={s} rx="0.8" fill={SUGAR} transform={`rotate(${rnd(i, 6) * 90 * settle} ${x} ${y})`} />;
  });

  // --- glucose: born in the stomach, then carried round the vessels ---
  const blood = tIn('blood');
  const spread = reached('blood') ? clamp01(blood / 0.5) : 0;
  const flowTime = Math.max(0, time - PHASES[2].start);
  const intoCells = tIn('cells');
  const glucoseEls = reached('stomach') && breakdown > 0 && Array.from({ length: dots }, (_, i) => {
    const home = [160 + rnd(i, 7) * 32, 262 + rnd(i, 8) * 30];
    let [x, y] = home;
    if (spread > 0) {
      const p = alongVessel(rnd(i, 9) + flowTime * 0.05);
      x = lerp(home[0], p[0], spread);
      y = lerp(home[1], p[1], spread);
    }
    // the cells' share heads into them once insulin has opened the way
    const target = i % 3 === 0 ? CELLS[i % CELLS.length] : null;
    let opacity = clamp01(breakdown * 1.4);
    if (target && intoCells > 0) {
      const k = ease(clamp01((intoCells - (i % 5) * 0.08) / 0.5));
      x = lerp(x, target[0], k);
      y = lerp(y, target[1], k);
      opacity *= 1 - clamp01((k - 0.8) / 0.2);
    }
    return <circle key={i} cx={x} cy={y} r="2.6" fill={GLUCOSE} opacity={opacity} />;
  });

  // --- insulin: keys leave the pancreas into the blood beside it, then ride
  // down to the cells and wait at their edge ---
  const insulin = tIn('insulin');
  const keyEls = reached('insulin') && CELLS.map((cell, i) => {
    const k = clamp01((insulin - i * 0.1) / 0.5);
    if (k <= 0) return null;
    const start = [132 + i * 13, 304];
    const yy = 318 + i * 14;
    const inBlood = [164 - (yy - 300) / 16 + Math.sin(time * 3 + i) * 1.2, yy];
    const atCell = [cell[0] - 11, cell[1] - 8];
    const ride = ease(clamp01((intoCells - i * 0.06) / 0.4));
    const out = ease(k);
    const x = lerp(lerp(start[0], inBlood[0], out), atCell[0], ride);
    const y = lerp(lerp(start[1], inBlood[1], out), atCell[1], ride);
    return (
      <g key={i} transform={`translate(${x} ${y})`} opacity={Math.min(1, k * 2)}>
        <circle r="2.6" fill="none" stroke={INSULIN} strokeWidth="1.3" />
        <path d="M2.6 0 h5 m-2 0 v2 m-2 -2 v1.6" stroke={INSULIN} strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </g>
    );
  });

  // --- cells light up as glucose arrives ---
  const cellGlow = clamp01((intoCells - 0.35) / 0.5);
  const cellEls = CELLS.map(([x, y], i) => (
    <g key={i}>
      <circle cx={x} cy={y} r="9" fill={CELL} fillOpacity={0.15 + 0.1 * cellGlow} stroke={CELL} strokeWidth="1.2" />
      <circle cx={x} cy={y} r="9" fill={GLUCOSE} fillOpacity={0.35 * cellGlow} />
      {cellGlow > 0.3 && <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9" opacity={cellGlow}>⚡</text>}
    </g>
  ));

  // --- teeth: plaque turns sugar into acid ---
  const teeth = tIn('teeth');
  const showTooth = reached('teeth') && phase.key !== 'limit';
  const toothEls = showTooth && (
    <g transform="translate(150 94)">
      <path d="M-9 -9 q9 -5 18 0 q3 6 -1 14 q-2 10 -4 12 q-2 1 -3 -3 q-1 -6 -2 -6 q-1 0 -2 6 q-1 4 -3 3 q-2 -2 -4 -12 q-4 -8 1 -14z" fill="#fff" stroke="var(--label-3)" strokeWidth="0.6" />
      <path d="M-6 -6 q6 -3 12 0 q1 4 -0.5 7 q-5.5 1.5 -11 0 q-1.5 -3 -0.5 -7z" fill="#d4a95f" fillOpacity={0.45 * clamp01((teeth - 0.4) / 0.5)} />
      {[[-3, -4], [2, -5], [4, -1]].map(([x, y], i) => (
        <circle key={i} cx={x + Math.sin(time * 6 + i) * 0.4} cy={y} r="1.5" fill={CELL} />
      ))}
      {Array.from({ length: 6 }, (_, i) => {
        const k = clamp01((teeth - i * 0.1) / 0.35);
        if (k <= 0 || k >= 1) return null;
        const from = [-22 + rnd(i, 10) * 44, -24 + rnd(i, 11) * 6];
        return <rect key={i} x={lerp(from[0], -1, k) - 1} y={lerp(from[1], -4, k) - 1} width="2" height="2" rx="0.4" fill={SUGAR} />;
      })}
      {teeth > 0.5 && [0, 1].map((i) => {
        const k = ((time * 0.8 + i * 0.5) % 1);
        return <path key={i} d={`M${-2 + i * 4} ${3 + k * 8} q0.8 1.4 0 2.2 q-0.8 -0.8 0 -2.2z`} fill="#84cc16" opacity={1 - k} />;
      })}
    </g>
  );

  const periodWord = t(`bjPeriod_${period}`);
  const freqWord = t({ 7: 'sugarFreqDaily', 3: 'sugarFreq3', 1: 'sugarFreq1' }[perWeek]);
  const captionVars = phase.key === 'intake'
    ? (period === 'serving'
      ? { text: t('bjIntakeServing', { serving: servingGrams, unit, tsp: Math.round(teaspoons * 10) / 10, amount: formatGrams(grams) }) }
      : { text: t('bjIntakePeriod', { freq: freqWord.toLowerCase(), period: periodWord, tsp: amount.spoons.toLocaleString(), amount: formatGrams(amount.grams) }) })
    : null;
  const caption = phase.key === 'intake' ? captionVars.text : t(phase.captionKey);

  return createPortal(
    <div className="fixed inset-0 z-[999] bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="relative w-full sm:max-w-[440px] max-h-[96vh] overflow-y-auto rounded-t-[24px] sm:rounded-[22px] px-4 pt-3.5 pb-5"
        style={{ background: 'var(--bg-card)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('bsTitleSugar')}
      >
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <p className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>{t('bsTitleSugar')}</p>
          <button onClick={onClose} aria-label={t('ariaClose')} className="tap-scale w-8 h-8 rounded-full flex items-center justify-center text-lg flex-shrink-0" style={{ background: 'var(--fill)', color: 'var(--label-2)' }}>×</button>
        </div>

        {/* How much: the period, and how often */}
        <div className="flex gap-1 p-1 rounded-xl mb-1.5" style={{ background: 'var(--fill)' }}>
          {['serving', 'week', 'month', 'year'].map((p) => (
            <button key={p} onClick={() => choosePeriod(p)} className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold" style={{ background: period === p ? 'var(--bg-card)' : 'transparent', color: period === p ? 'var(--label-1)' : 'var(--label-2)' }}>
              {t(`bjTab_${p}`)}
            </button>
          ))}
        </div>
        {period !== 'serving' && (
          <div className="flex gap-1.5 mb-2">
            {[7, 3, 1].map((f) => (
              <button key={f} onClick={() => chooseFreq(f)} className="flex-1 py-1 rounded-full text-[11.5px] font-semibold" style={{ background: perWeek === f ? SUGAR : 'var(--fill)', color: perWeek === f ? '#fff' : 'var(--label-2)' }}>
                {t({ 7: 'sugarFreqDaily', 3: 'sugarFreq3', 1: 'sugarFreq1' }[f])}
              </button>
            ))}
          </div>
        )}

        {/* The take */}
        <div className="relative rounded-[18px] overflow-hidden" style={{ background: 'var(--bg-grouped)' }} onClick={() => (time >= TOTAL ? restart() : setPlaying((p) => !p))}>
          <svg viewBox={cam.map((v) => v.toFixed(2)).join(' ')} className="w-full block" style={{ aspectRatio: '0.9' }} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <Body stomachGlow={pile * (1 - breakdown * 0.5)} glucoseInBlood={spread} />
            {cellEls}
            {crystalEls}
            {glucoseEls}
            {keyEls}
            {spoonEls}
            {toothEls}
            {label(t('bjLbl_stomach'), 210, 238, 'var(--label-2)', labelIn('stomach'))}
            {label(t('bjLbl_sugar'), 210, 262, SUGAR, labelIn('stomach') * (1 - clamp01((breakdown - 0.3) / 0.2)))}
            {label(t('bjLbl_glucose'), 210, 262, GLUCOSE, labelIn('stomach') * clamp01((breakdown - 0.3) / 0.2))}
            {label(t('bjLbl_pancreas'), 115, 305, INSULIN, labelIn('insulin'), 'end')}
            {label(t('bjLbl_insulin'), 172, 346, INSULIN, labelIn('insulin') * clamp01(insulin / 0.4))}
            {label(t('bjLbl_cells'), 198, 466, CELL, labelIn('cells'))}
            {label(t('bjLbl_plaque'), 150, 78, '#a16207', labelIn('teeth'), 'middle')}
            {label(t('bjLbl_acid'), 155, 112, '#65a30d', labelIn('teeth') * clamp01((teeth - 0.5) / 0.2))}
          </svg>

          {/* Overlays */}
          <div className="absolute top-2.5 left-2.5 px-2.5 py-1.5 rounded-xl text-[12px] font-bold tabular-nums" style={{ background: 'var(--bg-card)', color: SUGAR }}>
            🥄 ×{spoonCount(phase.key === 'intake' ? counted : amount.spoons)}
            <span className="block text-[11px] font-semibold" style={{ color: 'var(--label-2)' }}>{formatGrams(amount.grams)}</span>
          </div>
          {reached('blood') && phase.key !== 'limit' && (
            <div className="absolute top-2.5 right-2.5 w-[74px] px-2 py-1.5 rounded-xl text-[10px] font-semibold text-center" style={{ background: 'var(--bg-card)', color: GLUCOSE }}>
              <div className="h-12 w-3 mx-auto rounded-full overflow-hidden flex items-end mb-1" style={{ background: 'var(--fill)' }}>
                <div className="w-full rounded-full" style={{ height: `${20 + 70 * ease(clamp01(blood / 0.7))}%`, background: GLUCOSE }} />
              </div>
              {t('bsLblBloodGlucose')} ↑
            </div>
          )}
          {phase.key === 'limit' && (
            <div className="absolute inset-x-3 bottom-3 rounded-2xl p-3 page-in" style={{ background: 'var(--bg-card)' }}>
              <div className="flex justify-between text-[12px] font-semibold mb-1" style={{ color: 'var(--label-2)' }}>
                <span>{t('bjLimitThis', { period: periodWord })}</span>
                <span style={{ color: SUGAR }}>{formatGrams(amount.grams)}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden mb-1.5" style={{ background: 'var(--fill)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, share) * ease(tIn('limit'))}%`, background: SUGAR }} />
              </div>
              <div className="flex justify-between text-[11.5px]" style={{ color: 'var(--label-3)' }}>
                <span>{t('bjLimitWho', { period: period === 'serving' ? t('bjPeriod_day') : periodWord, amount: formatGrams(limitGrams) })}</span>
                <span className="font-bold" style={{ color: share >= 100 ? BLOOD : SUGAR }}>{share}%</span>
              </div>
            </div>
          )}
          {!playing && time < TOTAL && (
            <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <span className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl" style={{ background: 'rgba(0,0,0,0.45)' }}>▶</span>
            </div>
          )}
        </div>

        {/* Timeline: one stretch per shot; tap to jump there */}
        <div className="flex gap-1 mt-2.5">
          {PHASES.map((p) => {
            const k = clamp01((time - p.start) / (p.end - p.start));
            return (
              <button key={p.key} onClick={() => { setTime(p.start); setPlaying(true); }} aria-label={t(`bjChapter_${p.key}`)} className="h-1.5 rounded-full overflow-hidden" style={{ flex: p.end - p.start, background: 'var(--fill)' }}>
                <span className="block h-full rounded-full" style={{ width: `${k * 100}%`, background: 'var(--label-1)' }} />
              </button>
            );
          })}
        </div>

        {/* Subtitle */}
        <div key={phase.key + period + perWeek} className="reel-rise mt-3 min-h-[118px]">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--label-3)' }}>{t(`bjChapter_${phase.key}`)}</p>
          <p className="text-[14.5px] leading-relaxed mt-1" style={{ color: 'var(--label-1)' }}>{caption}</p>
          <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--label-3)' }}>
            {phase.source ? (
              <>{t('bsSource')} <a href={phase.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-2" style={{ color: 'var(--label-2)' }}>{phase.source.name} ↗</a></>
            ) : t('bsFromLabel')}
          </p>
        </div>

        <div className="flex gap-2 mt-2">
          <button onClick={() => (time >= TOTAL ? restart() : setPlaying((p) => !p))} className="tap-scale flex-1 py-2.5 rounded-xl text-[13.5px] font-bold" style={{ background: 'var(--fill)', color: 'var(--label-1)' }}>
            {time >= TOTAL ? `↺ ${t('bsReplay')}` : playing ? `❚❚ ${t('bjPause')}` : `▶ ${t('bjPlay')}`}
          </button>
          <button onClick={onClose} className="tap-scale flex-1 py-2.5 rounded-xl text-[13.5px] font-bold text-white" style={{ background: 'var(--tint)' }}>
            {t('bsDone')}
          </button>
        </div>
        <p className="text-[11px] text-center mt-3 leading-snug" style={{ color: 'var(--label-3)' }}>{t('bsDisclaimer')}</p>
      </div>
    </div>,
    document.body,
  );
}
