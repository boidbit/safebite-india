// src/components/NutrientAddsUp.jsx
//
// "If you have this regularly, what does it add up to?" -- for sugar,
// salt and fat, each in a household measure of the same substance
// (teaspoons of sugar / of salt / of oil). The product's own label
// figures, multiplied out; never a claim about what happens to anyone's
// body (see nutrientProjection.js / sugarProjection.js for why).
//
// Several concerns on one product (instant noodles: salty AND fatty) get
// ONE card with a tab each, opening on the most concerning -- not three
// stacked cards shouting at once. The frequency toggle is shared, and
// the action line adds up what cutting down saves across all of them:
// a warning with no clear action tends to be tuned out, not acted on.
import { useEffect, useState } from 'react';
import { accumulate } from '../services/nutrientProjection';
import DrinkGlass from './DrinkGlass';

const FREQUENCIES = [
  { perWeek: 7, key: 'sugarFreqDaily' },
  { perWeek: 3, key: 'sugarFreq3' },
  { perWeek: 1, key: 'sugarFreq1' },
];

const SERVING_TEXT_KEY = {
  label: 'sugarPerServing',
  pack: 'sugarPerPack',
  standard: 'sugarPerTypicalServing',
};

// Per nutrient: colour, tab label/icon, and how its yearly "pack" reads.
const LOOK = {
  sugar: { color: '#ec4899', rgb: '236, 72, 153', icon: '🍬', tabKey: 'addsTabSugar', packLabel: '1kg', whoKey: 'sugarWhoNote' },
  salt: { color: '#3b82f6', rgb: '59, 130, 246', icon: '🧂', tabKey: 'addsTabSalt', packLabel: '1kg', whoKey: 'addsSaltWhoNote' },
  fat: { color: '#f59e0b', rgb: '245, 158, 11', icon: '🫗', tabKey: 'addsTabFat', packLabel: '1L', whoKey: 'addsFatWhoNote' },
};

const MAX_SPOONS = 12;
const MAX_PACKETS = 15;
const round1 = (n) => Math.round(n * 10) / 10;

// Counts up from 0 whenever the target changes, so switching frequency
// visibly "piles up" again. Instant under prefers-reduced-motion.
function useCountUp(target, ms = 800) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setValue(target); return undefined; }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function PeriodTile({ label, unitLabel, spoons, grams, color }) {
  const shown = useCountUp(spoons);
  return (
    <div className="flex-1 rounded-xl px-2 py-2.5 text-center" style={{ background: 'var(--fill)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--label-3)' }}>{label}</p>
      <p className="text-[22px] font-extrabold leading-tight tabular-nums mt-0.5" style={{ color }}>{shown}</p>
      <p className="text-[10.5px] font-semibold" style={{ color: 'var(--label-3)' }}>{unitLabel}</p>
      <p className="text-[11.5px] tabular-nums mt-0.5" style={{ color: 'var(--label-2)' }}>
        {grams >= 1000 ? `${round1(grams / 1000)} kg` : `${grams} g`}
      </p>
    </div>
  );
}

// Yearly amount in the unit people buy it in: kg of sugar/salt, litres of oil.
const yearAmount = (key, year) => (key === 'fat' ? year.packs : round1(year.grams / 1000));

// "One serving has ≈ N teaspoons of ..." -- the per-serving line, per nutrient.
function ServingDetail({ item, t, color, serving }) {
  if (item.key === 'salt') {
    // Salt's WHO limit is a flat 5g, so "% of the day's limit" is fair to
    // say here (and only here -- sugar/fat limits are a share of energy).
    const pct = item.percentOfDailyLimit;
    return (
      <>
        <div className="mt-1.5 mb-1.5 h-3 rounded-full overflow-hidden" style={{ background: 'var(--fill)' }} aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: color, transition: 'width 600ms ease-out' }} />
        </div>
        <p className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>
          {t('addsSaltTeaspoons', { tsp: item.teaspoonsPerServing, grams: item.gramsPerServing })}
        </p>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--label-2)' }}>{t('addsSaltPercent', { percent: pct })}</p>
      </>
    );
  }
  // A drink's sugar as the layer it would make in the glass -- more
  // telling for a drink than a row of spoons (see DrinkGlass.jsx).
  if (item.key === 'sugar' && serving.unit === 'ml') {
    return (
      <div className="flex items-center gap-3.5 mt-2 mb-1">
        <DrinkGlass servingMl={serving.grams} teaspoons={item.teaspoonsPerServing} color={color} />
        <div className="min-w-0">
          <p className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>
            {t('sugarTeaspoons', { tsp: item.teaspoonsPerServing, kind: t(item.isAddedSugar ? 'sugarKindAdded' : 'sugarKindPlain'), grams: item.gramsPerServing })}
          </p>
          <p className="text-[12.5px] leading-snug mt-1" style={{ color: 'var(--label-2)' }}>
            {t('glassSugarShare', { ml: Math.round(item.teaspoonsPerServing * 5), total: serving.grams })}
          </p>
        </div>
      </div>
    );
  }
  const spoonCount = Math.max(1, Math.round(item.teaspoonsPerServing));
  const spoonsShown = Math.min(spoonCount, MAX_SPOONS);
  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5 mt-1 mb-1" aria-hidden="true">
        {Array.from({ length: spoonsShown }).map((_, i) => (
          <span key={i} className="item-in text-[22px] leading-none" style={{ animationDelay: `${i * 70}ms` }}>🥄</span>
        ))}
        {spoonCount > MAX_SPOONS && (
          <span className="text-[13px] font-bold ml-1" style={{ color }}>+{spoonCount - MAX_SPOONS}</span>
        )}
      </div>
      {item.key === 'sugar' ? (
        <p className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>
          {t('sugarTeaspoons', { tsp: item.teaspoonsPerServing, kind: t(item.isAddedSugar ? 'sugarKindAdded' : 'sugarKindPlain'), grams: item.gramsPerServing })}
        </p>
      ) : (
        <>
          <p className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>
            {t('addsFatTeaspoons', { tsp: item.teaspoonsPerServing, grams: item.gramsPerServing })}
          </p>
          {item.saturatedGramsPerServing != null && (
            <p className="text-[13px] mt-0.5" style={{ color: 'var(--label-2)' }}>{t('addsFatSaturated', { grams: item.saturatedGramsPerServing })}</p>
          )}
        </>
      )}
    </>
  );
}

// The year at the chosen frequency, as one big line: "3.6 kg of sugar a
// year" -- kg of sugar/salt, litres of oil; grams when it's under 0.1.
function YearHeadline({ item, yearly, color, t }) {
  const amount = yearAmount(item.key, yearly);
  const small = amount < 0.1;
  return (
    <p className="mt-3 flex items-baseline flex-wrap gap-x-1.5" style={{ color: 'var(--label-1)' }}>
      <span className="text-[26px] font-extrabold leading-none tabular-nums" style={{ color }}>
        {small ? Math.round(yearly.grams) : amount}
      </span>
      <span className="text-[15px] font-bold">
        {t(`${small ? 'addsYearUnitSmall' : 'addsYearUnit'}_${item.key}`)}
      </span>
      <span className="text-[12.5px]" style={{ color: 'var(--label-3)' }}>{t('addsAtThisRate')}</span>
    </p>
  );
}

// `habitRow` (the quick health check, from Result.jsx) sits in the always-
// visible part; `showDetails` opens the week/month/year tiles, the yearly
// packets, the cut-down tip and the notes.
export default function NutrientAddsUp({ projection, t, onShowAlternatives, showDetails = true, onToggleDetails, habitRow }) {
  const { serving, items } = projection;
  const [perWeek, setPerWeek] = useState(7);
  const [activeKey, setActiveKey] = useState(items[0].key);
  const item = items.find((i) => i.key === activeKey) || items[0];
  const look = LOOK[item.key];

  const totals = accumulate(item.key, item.gramsPerServing, perWeek);
  const yearly = totals.year;
  // Packets only from one whole pack up -- "0.8 litres = 1 x the 1-litre
  // pack" would round a smaller amount up into a bigger picture.
  const packets = yearly.packs >= 1 ? Math.round(yearly.packs) : 0;
  const packetsShown = Math.min(packets, MAX_PACKETS);
  const amount = yearAmount(item.key, yearly);

  // The action, stated as numbers for EVERY concern at once: going from
  // daily to once a week.
  const savings = items
    .map((i) => ({ key: i.key, saved: round1(yearAmount(i.key, accumulate(i.key, i.gramsPerServing, 7).year) - yearAmount(i.key, accumulate(i.key, i.gramsPerServing, 1).year)) }))
    .filter((s) => s.saved >= 0.1)
    .map((s) => t(`addsSaved_${s.key}`, { amount: s.saved }));
  const savingsText = savings.length > 1
    ? `${savings.slice(0, -1).join(', ')} ${t('addsAnd')} ${savings[savings.length - 1]}`
    : savings[0];

  return (
    <div className="px-4 py-3.5">
      {/* One tab per concern, most concerning first -- each shows its
          per-serving teaspoons so all of them are visible at a glance */}
      {items.length > 1 && (
        <div className="flex gap-1.5 mb-3" role="tablist">
          {items.map((i) => {
            const active = i.key === item.key;
            const l = LOOK[i.key];
            return (
              <button
                key={i.key}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveKey(i.key)}
                className="tap-scale flex-1 min-w-0 px-2 py-1.5 rounded-xl text-left"
                style={{
                  background: active ? `rgba(${l.rgb}, 0.12)` : 'var(--fill)',
                  border: `1.5px solid ${active ? l.color : 'transparent'}`,
                }}
              >
                <span className="block text-[12.5px] font-bold truncate" style={{ color: active ? l.color : 'var(--label-1)' }}>
                  {l.icon} {t(l.tabKey)}
                </span>
                <span className="block text-[11px] tabular-nums truncate" style={{ color: 'var(--label-3)' }}>
                  {t('addsTabTsp', { tsp: i.teaspoonsPerServing })}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Where the serving came from is always stated -- an estimate is
          never presented as if the label said it (see servingResolver.js) */}
      <p className="text-[13px] flex items-center flex-wrap gap-1.5" style={{ color: 'var(--label-2)' }}>
        <span>{t(SERVING_TEXT_KEY[serving.source] || 'sugarPerServing', { grams: serving.grams, unit: serving.unit })}</span>
        {serving.source === 'standard' && (
          <span
            className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{ background: 'var(--v-moderate-bg)', color: 'var(--v-moderate)' }}
          >
            {t('sugarEstimateTag')}
          </span>
        )}
      </p>
      <div key={item.key}>
        <ServingDetail item={item} t={t} color={look.color} serving={serving} />
      </div>

      <YearHeadline item={item} yearly={yearly} color={look.color} t={t} />

      {/* Frequency toggle -- shared by every tab; the realistic "how often" is the user's call */}
      <div className="flex gap-1.5 mt-3">
        {FREQUENCIES.map((f) => {
          const active = perWeek === f.perWeek;
          return (
            <button
              key={f.perWeek}
              onClick={() => setPerWeek(f.perWeek)}
              className="tap-scale flex-1 px-2 py-1.5 rounded-full text-[12px] font-semibold"
              style={{ background: active ? look.color : 'var(--fill)', color: active ? '#fff' : 'var(--label-2)' }}
            >
              {t(f.key)}
            </button>
          );
        })}
      </div>

      {habitRow && <div className="mt-3.5">{habitRow}</div>}

      {onToggleDetails && (
        <button
          onClick={onToggleDetails}
          aria-expanded={showDetails}
          className="tap-scale w-full mt-3 flex items-center justify-center gap-1 text-[13px] font-semibold"
          style={{ color: 'var(--tint)' }}
        >
          {showDetails ? t('addsHide') : t('addsShowMore')}
          <svg viewBox="0 0 12 8" className={`w-3 h-2 transition-transform ${showDetails ? 'rotate-180' : ''}`} fill="none" aria-hidden="true">
            <path d="M1 1.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {showDetails && (
      <div className="page-in">
      {/* What it adds up to */}
      <div className="flex gap-2 mt-3.5">
        <PeriodTile color={look.color} unitLabel={t('sugarTspShort')} label={t('sugarWeek')} {...totals.week} />
        <PeriodTile color={look.color} unitLabel={t('sugarTspShort')} label={t('sugarMonth')} {...totals.month} />
        <PeriodTile color={look.color} unitLabel={t('sugarTspShort')} label={t('sugarYear')} {...totals.year} />
      </div>

      {/* A year, in the household pack every kitchen knows */}
      <div className="mt-3.5">
        {packets >= 1 && (
          <div className="flex flex-wrap gap-1.5 mb-2" aria-hidden="true" key={`${item.key}-${perWeek}`}>
            {Array.from({ length: packetsShown }).map((_, i) => (
              <span
                key={i}
                className="item-in inline-flex items-center justify-center rounded-[6px] text-[9.5px] font-bold"
                style={{
                  width: 30, height: 38,
                  background: `rgba(${look.rgb}, 0.12)`,
                  border: `1px solid rgba(${look.rgb}, 0.4)`,
                  color: look.color,
                  animationDelay: `${i * 60}ms`,
                }}
              >
                {look.packLabel}
              </span>
            ))}
            {packets > MAX_PACKETS && (
              <span className="self-center text-[13px] font-bold" style={{ color: look.color }}>+{packets - MAX_PACKETS}</span>
            )}
          </div>
        )}
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--label-2)' }}>
          {packets >= 1
            ? t(`addsYearPackets_${item.key}`, { amount, packets })
            : t(`addsYearSmall_${item.key}`, { grams: yearly.grams })}
        </p>
      </div>

      {/* The action -- a warning with nothing to do about it gets tuned out */}
      {perWeek === 7 && savingsText && (
        <div className="mt-3 rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: 'var(--v-good-bg)' }}>
          <span className="text-[14px] flex-shrink-0" aria-hidden="true">💡</span>
          <p className="text-[13px] leading-snug" style={{ color: 'var(--label-1)' }}>
            {t('addsSwapFrequency', { savings: savingsText })}
          </p>
        </div>
      )}
      {onShowAlternatives && (
        <button onClick={onShowAlternatives} className="tap-scale text-[13px] font-semibold mt-2.5" style={{ color: 'var(--tint)' }}>
          {t('sugarCompareOptions')} ↓
        </button>
      )}

      <p className="text-[11.5px] leading-relaxed mt-3" style={{ color: 'var(--label-3)' }}>
        {serving.source === 'standard' && `${t('sugarEstimateNote', { grams: serving.grams, unit: serving.unit })} `}
        {t(look.whoKey)} {t('sugarDisclaimer')}
      </p>
      </div>
      )}
    </div>
  );
}
