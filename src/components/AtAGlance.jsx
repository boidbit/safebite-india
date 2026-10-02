// src/components/AtAGlance.jsx
//
// The Overview's one card for "what's in it": a bar split by severity
// (harmful / concerning / processed / fine) with the counts under it, the
// worst ingredients as rows -- category icon, severity dot, tap to open
// that ingredient -- and the report's good points as one green line at
// the foot instead of a half-empty card of their own. Replaces the four
// Breakdown tiles and the two side-by-side "At a glance" lists, which said
// the same thing three ways.
import { categoryIcon } from '../utils/categoryIcon';

const SHOWN = 5;

export default function AtAGlance({ tiers, factors, positives, onOpenIngredient, onOpenAll, t }) {
  const total = tiers.reduce((n, tier) => n + tier.count, 0);
  if (!total) return null;
  const shown = factors.slice(0, SHOWN);
  const more = factors.length - shown.length;

  return (
    <div className="mx-4 rounded-[16px] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
      <div className="px-4 pt-3.5 pb-3">
        {/* Severity bar: one segment per tier, as wide as its share. */}
        <div className="flex h-2.5 rounded-full overflow-hidden gap-[2px]" style={{ background: 'var(--fill)' }} aria-hidden="true">
          {tiers.filter((tier) => tier.count > 0).map((tier) => (
            <div key={tier.key} className="wf-bar" style={{ width: `${(tier.count / total) * 100}%`, background: tier.color, transformOrigin: 'left center' }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {tiers.filter((tier) => tier.count > 0).map((tier) => (
            <span key={tier.key} className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--label-2)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: tier.color }} />
              <span className="font-bold tabular-nums" style={{ color: tier.color }}>{tier.count}</span> {tier.label.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {shown.length > 0 && (
        <div style={{ borderTop: '1px solid var(--separator)' }}>
          <p className="px-4 pt-3 pb-1 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--label-3)' }}>{t('watchOutFor')}</p>
          <div className="ios-group">
            {shown.map(({ ingredient, tier }) => (
              <button
                key={`${ingredient.name}-${tier.key}`}
                onClick={() => onOpenIngredient(ingredient)}
                className="tap-scale w-full flex items-center gap-3 px-4 py-2.5 text-left"
              >
                <span className="w-8 h-8 rounded-[9px] flex items-center justify-center text-[15px] flex-shrink-0" style={{ background: tier.bg }} aria-hidden="true">
                  {categoryIcon(ingredient.category)}
                </span>
                <span className="flex-1 min-w-0 text-[14px] font-medium truncate" style={{ color: 'var(--label-1)' }}>{ingredient.name}</span>
                <span className="flex-shrink-0 inline-flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: tier.color }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: tier.color }} />
                  {tier.label}
                </span>
                <span className="text-[15px] flex-shrink-0" style={{ color: 'var(--label-3)' }} aria-hidden="true">›</span>
              </button>
            ))}
          </div>
          {more > 0 && (
            <button onClick={onOpenAll} className="tap-scale w-full px-4 py-2.5 text-[13px] font-semibold text-center" style={{ color: 'var(--tint)', borderTop: '1px solid var(--separator)' }}>
              {t('glanceMore', { count: more })} →
            </button>
          )}
        </div>
      )}

      {positives?.length > 0 && (
        <div className="px-4 py-2.5 flex flex-wrap gap-x-3 gap-y-1" style={{ background: 'var(--v-good-bg)' }}>
          {positives.map((p) => (
            <span key={p} className="text-[12.5px] font-semibold" style={{ color: 'var(--v-very-healthy)' }}>✓ {p}</span>
          ))}
        </div>
      )}
    </div>
  );
}
