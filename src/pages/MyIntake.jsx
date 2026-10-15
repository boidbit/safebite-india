// src/pages/MyIntake.jsx
//
// A packaged-food consumption log -- see intakeLog.js for the three hard
// rules this follows: never estimate, this is a LOG of what was told to
// the app (not a diagnosis of what happened in the body), and never show
// a personalised %-of-target without a real basis for it. One shared
// device log, not per Family profile.
//
// The WHO references used below aren't all the same KIND of number:
//   - Sodium's WHO limit (2,000mg) is a flat figure for any adult,
//     independent of how much they eat that day -- a %-of-limit bar is a
//     fair, literal statement (see dailyHabitCheck.js's NUTRIENT_LIMITS).
//   - Added sugar/saturated fat/trans fat's WHO guidance is instead a
//     PERCENTAGE OF ENERGY INTAKE -- shown as plain guidance text, never a
//     personalised %, since this app never collects a personal calorie
//     target (see ENERGY_RELATIVE_GUIDANCE below).
//   - Fat is a special case: WHO's ≤30%-of-energy guidance can be checked
//     WITHOUT any personal target, because we already know the energy of
//     what was logged (fatKcal / loggedKcal is pure arithmetic on data we
//     have, not an assumption). The copy is deliberately explicit that
//     this is "of today's LOGGED foods", not "of your whole day" -- those
//     are different claims, and only the first one is honest here.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEntriesForDay, getTotalsForDay, getLoggedDays, removeLogEntry } from '../services/intakeLog';
import { NUTRIENT_LIMITS } from '../services/dailyHabitCheck';
import { getCachedReport } from '../services/productCache';
import { saveToHistory } from '../utils/storage';
import ProductImage from '../components/ProductImage';

// Added sugar's own WHO guidance is folded directly into the Sugar card's
// copy below (it shares that card with total sugar) -- these two are the
// energy-relative nutrients that still need their own standalone card.
const ENERGY_RELATIVE_GUIDANCE = {
  saturatedFatG: { icon: '🧈', label: 'Saturated fat', text: 'WHO recommends limiting saturated fat to less than 10% of total energy intake.' },
  transFatG: { icon: '🍟', label: 'Trans fat', text: 'WHO recommends limiting trans fat to less than 1% of total energy intake.' },
};

// WHO's whole-diet reference for total fat -- used only as a comparison
// point against what was actually logged today, never phrased as "you
// exceeded your limit" (see the file header).
const WHO_FAT_ENERGY_SHARE = 30;

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(date, today) {
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function DaySwitcher({ selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [today, ...getLoggedDays().filter((d) => d.getTime() !== today.getTime())];

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="tap-scale flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[13px] font-semibold text-slate-700 dark:text-slate-200"
      >
        📅 {dayLabel(selected, today)} <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden z-10">
          {days.map((d) => (
            <button
              key={d.toDateString()}
              onClick={() => { onSelect(d); setOpen(false); }}
              className={`tap-scale w-full text-left px-3.5 py-2.5 text-[13px] ${d.toDateString() === selected.toDateString() ? 'font-bold text-green-700 dark:text-green-400' : 'text-slate-700 dark:text-slate-200'}`}
            >
              {dayLabel(d, today)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryMenu({ entry, onView, onRemove }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Options"
        className="tap-scale w-8 h-8 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg overflow-hidden z-10">
          <button
            onClick={() => { setOpen(false); onView(entry); }}
            disabled={!entry.lookupKey}
            className="tap-scale w-full text-left px-3.5 py-2.5 text-[13px] text-slate-700 dark:text-slate-200 disabled:opacity-40"
          >
            View product
          </button>
          <button
            onClick={() => { setOpen(false); onRemove(entry); }}
            className="tap-scale w-full text-left px-3.5 py-2.5 text-[13px] text-red-600 dark:text-red-400 border-t border-slate-100 dark:border-slate-700"
          >
            Remove from intake
          </button>
        </div>
      )}
    </div>
  );
}

// A single ring split into coloured arc segments by each macro's share of
// logged CALORIES (not grams -- 1g of fat is 9kcal, 1g of protein/carbs is
// 4kcal, so a gram-based split would misrepresent where the energy
// actually came from). Segments are drawn in on mount for the "this page
// has some life to it" ask -- same stroke-dasharray technique as
// ScoreCircle.jsx, just multiple arcs sharing one ring instead of one.
function MacroRing({ segments, size = 128, stroke = 16 }) {
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 flex-shrink-0">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={stroke} />
      {segments.map((seg) => {
        const len = circumference * seg.fraction;
        const dashoffset = -cumulative;
        cumulative += len;
        return (
          <circle
            key={seg.key}
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={stroke}
            strokeDasharray={grown ? `${len} ${circumference - len}` : `0 ${circumference}`}
            strokeDashoffset={dashoffset}
            strokeLinecap={segments.length > 1 ? 'butt' : 'round'}
            style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        );
      })}
    </svg>
  );
}

const MACRO_COLORS = { proteinG: '#ffffff', carbohydrateG: '#bef264', totalFatG: '#fde047' };
// Deliberately muted/desaturated relative to the three vivid macro colours
// above -- reads as "unknown", not as a fourth nutrient of its own.
const UNAVAILABLE_COLOR = 'rgba(15, 23, 42, 0.32)';
const MACRO_KCAL_PER_G = { proteinG: 4, carbohydrateG: 4, totalFatG: 9 };
const MACRO_LABEL = { proteinG: 'Protein', carbohydrateG: 'Carbs', totalFatG: 'Fat' };

export default function MyIntake() {
  const navigate = useNavigate();
  const [selectedDay, setSelectedDay] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [entries, setEntries] = useState(() => getEntriesForDay(selectedDay));
  const [totals, setTotals] = useState(() => getTotalsForDay(selectedDay).totals);
  const [showLearnMore, setShowLearnMore] = useState(false);
  const [showMacroGapInfo, setShowMacroGapInfo] = useState(false);

  useEffect(() => {
    setEntries(getEntriesForDay(selectedDay));
    setTotals(getTotalsForDay(selectedDay).totals);
  }, [selectedDay]);

  const isToday = selectedDay.toDateString() === new Date().toDateString();

  const refresh = () => {
    setEntries(getEntriesForDay(selectedDay));
    setTotals(getTotalsForDay(selectedDay).totals);
  };

  const handleRemove = (entry) => {
    removeLogEntry(entry.id);
    refresh();
  };

  const openProduct = async (entry) => {
    if (!entry.lookupKey) return;
    const cached = await getCachedReport(entry.lookupKey);
    if (!cached) return;
    cached.lookupKey = entry.lookupKey;
    const historyId = saveToHistory(cached, 'search');
    navigate(`/result/${historyId}`);
  };

  // The ring's own math -- calorie share per macro, never a personal
  // target. Only built when at least one macro is actually known.
  //
  // A real bug found from a live screenshot: this used to divide each
  // macro's kcal by the SUM OF THE MACROS (protein+carbs+fat via 4/4/9
  // kcal-per-gram), not by the real logged total shown in the ring's own
  // centre -- so the ring silently explained a smaller, different number
  // (e.g. 560kcal) than the 714kcal sitting right inside it. That mismatch
  // is real and expected: getTotalsForDay (intakeLog.js) sums calories and
  // each macro independently, only from entries that HAVE that field, so a
  // day where some logged foods carried a calorie figure but no full
  // protein/carb/fat breakdown (common -- most of this catalog has
  // calories, a minority has the full split) genuinely can't have all its
  // calories assigned to a macro. The fix isn't to force them to match --
  // every segment's fraction is of the TRUE logged total, and calories
  // that aren't accounted for by a known macro get their own explicit
  // "Macro data unavailable" segment below, rather than an unlabelled gap.
  const macroKcal = {};
  let macroKcalTotal = 0;
  for (const key of ['proteinG', 'carbohydrateG', 'totalFatG']) {
    if (typeof totals[key] === 'number') {
      const kcal = totals[key] * MACRO_KCAL_PER_G[key];
      macroKcal[key] = kcal;
      macroKcalTotal += kcal;
    }
  }
  // Normally the label's own stated energy (what's shown in the ring's
  // centre); falls back to the macro sum on the rare chance macros are
  // known but calories genuinely aren't, and is never let the macros
  // themselves overflow past a full ring if they add up to slightly more
  // than the stated total.
  const ringDenominator = Math.max(totals.caloriesKcal || 0, macroKcalTotal);
  // Rounding noise (a fraction of a kcal) shouldn't earn its own segment --
  // only a gap big enough to actually mean "a logged food had no macro
  // breakdown" gets called out.
  const unavailableKcal = ringDenominator - macroKcalTotal;
  const hasUnavailableGap = unavailableKcal > 0.5;
  const ringSegments = ringDenominator > 0
    ? [
        ...Object.entries(macroKcal).map(([key, kcal]) => ({ key, fraction: kcal / ringDenominator, color: MACRO_COLORS[key] })),
        ...(hasUnavailableGap ? [{ key: 'unavailable', fraction: unavailableKcal / ringDenominator, color: UNAVAILABLE_COLOR }] : []),
      ]
    : [];
  const fatEnergyPct = ringDenominator > 0 && typeof macroKcal.totalFatG === 'number'
    ? Math.round((macroKcal.totalFatG / ringDenominator) * 100)
    : null;

  const sodiumLimit = NUTRIENT_LIMITS.find((l) => l.key === 'sodiumMg');
  const sodiumAmount = totals.sodiumMg;
  const sodiumPct = typeof sodiumAmount === 'number' ? Math.min(100, Math.round((sodiumAmount / sodiumLimit.limit) * 100)) : null;

  const totalSugar = totals.totalSugarG;
  const addedSugar = totals.addedSugarG;
  // Only worth a nested bar when they genuinely differ -- when they're
  // equal (the common case: no separate "added sugar" was ever known, so
  // it just fell back to the total) a second bar would just repeat the
  // first number under a different name.
  const showSugarBreakdown = typeof totalSugar === 'number' && typeof addedSugar === 'number' && addedSugar < totalSugar;

  const satFatRow = typeof totals.saturatedFatG === 'number' ? { key: 'saturatedFatG', amount: totals.saturatedFatG, ...ENERGY_RELATIVE_GUIDANCE.saturatedFatG } : null;
  const transFatRow = typeof totals.transFatG === 'number' ? { key: 'transFatG', amount: totals.transFatG, ...ENERGY_RELATIVE_GUIDANCE.transFatG } : null;

  const hasStandoutSection = sodiumPct !== null || fatEnergyPct !== null || typeof totalSugar === 'number' || satFatRow || transFatRow;

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-8 pb-24">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">My Intake</h1>
        <DaySwitcher selected={selectedDay} onSelect={setSelectedDay} />
      </div>
      <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
        Based on packaged foods you've logged {isToday ? 'today' : 'on ' + selectedDay.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.
      </p>

      {entries.length === 0 ? (
        <div className="text-center py-14">
          <div className="text-5xl mb-3">🍽️</div>
          <p className="text-slate-600 dark:text-slate-300 font-semibold mb-1">
            {isToday ? 'Nothing logged yet today' : 'Nothing logged this day'}
          </p>
          {isToday && (
            <p className="text-slate-400 dark:text-slate-500 text-sm mb-6 max-w-xs mx-auto">
              Open a product's report and tap "＋ Log what I had" to start.
            </p>
          )}
          <button
            onClick={() => navigate('/')}
            className="tap-scale bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
          >
            🔍 Find a product
          </button>
        </div>
      ) : (
        <>
          {/* Hero: the same flowing green gradient the Home hero uses, so
              this reads as a first-class FoodGuard screen, not a plain
              nutrition-label table. The ring is a calorie SPLIT (protein/
              carbs/fat), not a target -- see the file header. */}
          <div className="hero-animated relative rounded-[28px] p-5 pb-6 mb-4 overflow-hidden">
            <p className="relative text-[11px] font-bold text-white/75 uppercase tracking-wide mb-4">
              {isToday ? "Today's logged total" : 'Logged total'}
            </p>
            <div className="relative flex items-center gap-5">
              {ringSegments.length > 0 ? (
                <div className="relative flex-shrink-0" style={{ width: 128, height: 128 }}>
                  <MacroRing segments={ringSegments} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[28px] font-extrabold text-white leading-none tabular-nums">{Math.round(totals.caloriesKcal)}</span>
                    <span className="text-[10.5px] font-semibold text-white/75 mt-0.5">kcal</span>
                  </div>
                </div>
              ) : (
                typeof totals.caloriesKcal === 'number' && (
                  <div>
                    <span className="text-[40px] font-extrabold text-white leading-none tabular-nums">{Math.round(totals.caloriesKcal)}</span>
                    <span className="text-[15px] font-semibold text-white/75 ml-1.5">kcal</span>
                  </div>
                )
              )}
              {ringSegments.length > 0 && (
                <div className="flex-1 min-w-0 space-y-2">
                  {ringSegments.map((seg) => {
                    const isUnavailable = seg.key === 'unavailable';
                    return (
                      <div key={seg.key} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: isUnavailable ? 'rgba(255,255,255,0.4)' : seg.color }} />
                        <span className={`text-[13px] flex-1 min-w-0 truncate ${isUnavailable ? 'font-medium text-white/70' : 'font-semibold text-white'}`}>
                          {isUnavailable ? 'Data unavailable' : MACRO_LABEL[seg.key]}
                        </span>
                        {!isUnavailable && (
                          <span className="text-[13px] font-bold text-white tabular-nums">{Math.round(totals[seg.key] * 10) / 10}g</span>
                        )}
                        <span className={`text-[11px] tabular-nums w-9 text-right ${isUnavailable ? 'text-white/60' : 'text-white/70'}`}>{Math.round(seg.fraction * 100)}%</span>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-white/45 pt-0.5">Shares are of total logged calories</p>
                </div>
              )}
            </div>
            {typeof totalSugar === 'number' && (
              <p className="relative text-[12px] text-white/80 mt-4 pt-3 border-t border-white/15">
                Plus <span className="font-bold text-white">{Math.round(totalSugar * 10) / 10}g</span> total sugar (sugar's calories are already counted within carbs above).
              </p>
            )}
            {/* The short version is the "Macro data unavailable" segment +
                legend row above -- that alone tells the story without
                needing a user to understand how the log is built. This is
                just the longer why, one tap away, for anyone curious. */}
            {hasUnavailableGap && (
              <div className={`relative ${typeof totalSugar === 'number' ? 'mt-2' : 'mt-4 pt-3 border-t border-white/15'}`}>
                <button onClick={() => setShowMacroGapInfo((v) => !v)} className="tap-scale text-[11px] font-semibold text-white/55 flex items-center gap-1">
                  <span>ⓘ</span> {showMacroGapInfo ? 'Show less' : 'Why is some macro data unavailable?'}
                </button>
                {showMacroGapInfo && (
                  <p className="text-[11px] text-white/65 leading-relaxed mt-1.5">
                    {Math.round(unavailableKcal)} kcal from today's logged foods couldn't be assigned to protein, carbs or fat because their label didn't give a full breakdown -- those calories still count in the {Math.round(totals.caloriesKcal)} kcal total above, just not in a slice.
                  </p>
                )}
              </div>
            )}
          </div>

          {hasStandoutSection && (
            <>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2 px-0.5">What stands out</p>
              <div className="space-y-2.5 mb-4">
                {sodiumPct !== null && (
                  <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[14px]" style={{ background: 'rgba(239, 68, 68, 0.12)' }}>🧂</span>
                        Sodium
                      </span>
                      <span className="text-[13px] font-bold" style={{ color: sodiumPct >= 100 ? '#dc2626' : sodiumPct >= 70 ? '#d97706' : '#16a34a' }}>{sodiumPct}%</span>
                    </div>
                    <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100 mb-1.5">{Math.round(sodiumAmount * 10) / 10}mg</p>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-1.5">
                      <div
                        className={`h-full rounded-full ${sodiumPct >= 100 ? 'bg-red-500' : sodiumPct >= 70 ? 'bg-amber-500' : 'bg-green-500'}`}
                        style={{ width: `${sodiumPct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">{sodiumPct}% of WHO's adult sodium limit ({sodiumLimit.limit.toLocaleString('en-IN')}mg/day).</p>
                  </div>
                )}

                {fatEnergyPct !== null && (
                  <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[14px]" style={{ background: 'rgba(250, 204, 21, 0.18)' }}>🥑</span>
                        Fat
                      </span>
                      <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{fatEnergyPct}%</span>
                    </div>
                    <p className="text-[15px] font-bold text-slate-800 dark:text-slate-100 mb-1.5">{Math.round(totals.totalFatG * 10) / 10}g</p>
                    {/* Comparison bar: how much of TODAY'S LOGGED energy came
                        from fat, with WHO's whole-diet reference marked as a
                        tick -- deliberately not framed as "you're over your
                        limit", since this is 1 day of packaged foods, not a
                        full diet. */}
                    <div className="relative h-1.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-1.5">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.min(100, fatEnergyPct)}%` }} />
                      <div className="absolute top-0 bottom-0 w-[2px] bg-slate-500 dark:bg-slate-300" style={{ left: `${WHO_FAT_ENERGY_SHARE}%` }} title="WHO whole-day reference" />
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                      Fat made up {fatEnergyPct}% of the calories in <strong className="text-slate-500 dark:text-slate-400">today's logged foods</strong> (marker: WHO's ≤{WHO_FAT_ENERGY_SHARE}% reference for a whole day's diet — not the same comparison, but a useful reference point).
                    </p>
                  </div>
                )}

                {typeof totalSugar === 'number' && (
                  <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[14px]" style={{ background: 'rgba(244, 114, 182, 0.15)' }}>🍬</span>
                        Sugar
                      </span>
                      <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{Math.round(totalSugar * 10) / 10}g total</span>
                    </div>
                    {showSugarBreakdown ? (
                      <>
                        <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-1.5 flex">
                          <div className="h-full bg-pink-400" style={{ width: `${Math.min(100, (addedSugar / totalSugar) * 100)}%` }} />
                        </div>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                          <strong className="text-slate-600 dark:text-slate-300">{Math.round(addedSugar * 10) / 10}g</strong> of the {Math.round(totalSugar * 10) / 10}g total is reported as <strong className="text-slate-600 dark:text-slate-300">added sugar</strong> — the rest is naturally occurring.
                          {' '}WHO's &lt;10%-of-energy guidance is specifically about "free sugars" (added sugars, plus sugars in honey, syrups and fruit juice) — a related but not always identical figure to added sugar as reported here.
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                        WHO recommends keeping free sugars (added sugars, plus sugars in honey, syrups and fruit juice) under 10% of total energy intake — the products logged today don't separately break out how much of this sugar is added vs. naturally occurring.
                      </p>
                    )}
                  </div>
                )}

                {[satFatRow, transFatRow].filter(Boolean).map((row) => (
                  <div key={row.key} className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-[14px]" style={{ background: 'rgba(234, 179, 8, 0.15)' }}>{row.icon}</span>
                        {row.label}
                      </span>
                      <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{Math.round(row.amount * 10) / 10}g</span>
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">{row.text}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="rounded-2xl p-3.5 mb-4 flex items-start gap-2.5" style={{ background: 'rgba(34, 197, 94, 0.08)' }}>
            <span className="text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5">ⓘ</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-green-800 dark:text-green-300 leading-relaxed">
                {showLearnMore
                  ? "This is a log of what you told FoodGuard you had — not a measurement of what your body actually absorbed, and not a target or goal."
                  : 'Logged intake, not actual absorption or a personal target.'}
              </p>
              <button onClick={() => setShowLearnMore((v) => !v)} className="tap-scale text-[11.5px] font-semibold text-green-700 dark:text-green-400 mt-1">
                {showLearnMore ? 'Show less' : 'Learn more ›'}
              </button>
            </div>
          </div>

          <div className="flex items-baseline gap-2 mb-2 px-0.5">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{isToday ? 'Logged today' : 'Logged'}</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">{entries.length} food{entries.length === 1 ? '' : 's'}</p>
          </div>
          <div className="space-y-2.5 mb-4">
            {entries.map((entry, i) => (
              <div
                key={entry.id}
                style={{ animationDelay: `${Math.min(i * 40, 240)}ms` }}
                className="item-in bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-3"
              >
                <button onClick={() => openProduct(entry)} className="tap-scale flex-shrink-0" disabled={!entry.lookupKey}>
                  <ProductImage src={entry.imageUrl} size={48} expandable={false} />
                </button>
                <button onClick={() => openProduct(entry)} className="flex-1 min-w-0 text-left" disabled={!entry.lookupKey}>
                  <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100 truncate">{entry.productName}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {entry.amount}{entry.unit} consumed
                    {typeof entry.nutrients.caloriesKcal === 'number' && ` · ${Math.round(entry.nutrients.caloriesKcal)} kcal`}
                    {' · '}{formatTime(entry.loggedAt)}
                  </p>
                </button>
                <EntryMenu entry={entry} onView={openProduct} onRemove={handleRemove} />
              </div>
            ))}
          </div>

          {isToday && (
            <button
              onClick={() => navigate('/')}
              className="tap-scale w-full py-3.5 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-bold text-[15px] transition-colors"
            >
              ＋ Log another food
            </button>
          )}
        </>
      )}
    </div>
  );
}
