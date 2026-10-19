// src/components/ClaimCheckCard.jsx
//
// "Label claim check": the claims in a product's name ("Sugar Free") set
// against the nutrition table and ingredient list we saved for it
// (services/claimCheck.js). Facts and figures only -- never "misleading" or
// "false": a mismatch can also be a mistake in the saved data, so the card says
// so and offers a way to report it.
const CLAIM_LABEL = {
  sugarFree: 'claimSugarFree', noAddedSugar: 'claimNoAddedSugar', unsweetened: 'claimUnsweetened', lowSugar: 'claimLowSugar',
  saltFree: 'claimSaltFree', noAddedSalt: 'claimNoAddedSalt', lowSodium: 'claimLowSodium',
  highFibre: 'claimHighFibre', sourceOfFibre: 'claimSourceFibre',
};
const NUTRIENT_LABEL = { sugars: 'claimNutSugars', addedSugars: 'claimNutAddedSugars', sodium: 'claimNutSodium', fibre: 'claimNutFibre' };
const VERDICT = {
  match: { key: 'claimVerdictMatch', color: 'var(--v-good)', icon: '✓' },
  mismatch: { key: 'claimVerdictMismatch', color: 'var(--v-moderate)', icon: '!' },
  unknown: { key: 'claimVerdictUnknown', color: 'var(--label-3)', icon: '?' },
};

const round = (n) => Math.round(n * 100) / 100;

/** One line of evidence, or null for a check that has nothing to say. */
function evidenceLine(check, t, basis) {
  switch (check.kind) {
    case 'figure':
      return t('claimEvFigure', { nutrient: t(NUTRIENT_LABEL[check.nutrient]), value: round(check.value), unit: check.unit, basis });
    case 'noFigure':
      return t('claimEvNoFigure', { nutrient: t(NUTRIENT_LABEL[check.nutrient]).toLowerCase() });
    case 'noIngredients':
      return t('claimEvNoIngredients');
    case 'natural':
      return t('claimEvNatural', { value: round(check.value), basis });
    case 'ingredients':
      if (check.state === 'bad') return t(check.what === 'sweetener' ? 'claimEvSweetener' : 'claimEvIngFound', { names: check.names.join(', ') });
      return t(check.what === 'salt' ? 'claimEvIngNoneSalt' : 'claimEvIngNoneSugar');
    default:
      return null;
  }
}

function limitLine(claim, label, t, basis) {
  const { limit } = claim;
  if (limit.cmp === 'notAdded') return t(limit.what === 'salt' ? 'claimLimitNotAddedSalt' : 'claimLimitNotAddedSugar', { claim: label });
  return t(limit.cmp === 'atLeast' ? 'claimLimitAtLeast' : 'claimLimitAtMost', { claim: label, value: limit.value, unit: limit.unit, basis });
}

/**
 * @param {{ claims: Array, t: Function, unit: 'g'|'ml', onReport?: Function }} props
 */
export default function ClaimCheckCard({ claims, t, unit = 'g', onReport }) {
  return (
    <div>
      <p className="px-4 pt-3.5 text-[12.5px]" style={{ color: 'var(--label-3)' }}>{t('claimCheckIntro')}</p>
      {claims.map((claim) => {
        const label = t(CLAIM_LABEL[claim.id]);
        const verdict = VERDICT[claim.verdict];
        // What decided it first: the failed checks, then the passed ones; at most three lines.
        const order = { bad: 0, ok: 1, info: 2, unknown: 3 };
        const lines = [...claim.checks]
          .sort((a, b) => order[a.state] - order[b.state])
          .map((c) => evidenceLine(c, t, unit))
          .filter(Boolean)
          .slice(0, 3);
        return (
          <div key={claim.id} className="px-4 py-3.5" style={{ borderTop: '1px solid var(--separator)' }}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] font-semibold min-w-0" style={{ color: 'var(--label-1)' }}>
                {label}
                <span className="font-normal text-[12px] ml-1.5" style={{ color: 'var(--label-3)' }}>“{claim.text}”</span>
              </p>
              <span className="flex-shrink-0 text-[12px] font-bold" style={{ color: verdict.color }}>
                {verdict.icon} {t(verdict.key)}
              </span>
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {lines.map((line) => (
                <li key={line} className="text-[13px]" style={{ color: 'var(--label-2)' }}>{line}</li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--label-3)' }}>{limitLine(claim, label, t, unit)}</p>
          </div>
        );
      })}
      <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--separator)' }}>
        <p className="text-[11.5px]" style={{ color: 'var(--label-3)' }}>{t('claimCheckNote')}</p>
        {onReport && (
          <button onClick={onReport} className="tap-scale flex-shrink-0 text-[12.5px] font-semibold" style={{ color: 'var(--tint)' }}>
            {t('claimCheckReport')}
          </button>
        )}
      </div>
    </div>
  );
}
