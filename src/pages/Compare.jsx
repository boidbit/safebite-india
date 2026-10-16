// src/pages/Compare.jsx
//
// "Which of these fits me better" -- not just "is this one okay". Reads
// the 2-4 products picked on CompareManage.jsx (passed via router state,
// already full buildReport() output -- no extra fetch needed) and lays
// score/nutrients/additives/processing side by side, plus deterministic
// a verdict that opens the page, and "who is better at what" (compareProducts.js
// -- never an AI call, never phrased as "buy X"). Scores within a few points
// are called close, not a win.
import { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { getScoreColor, saveToHistory } from '../utils/storage';
import { useFamily } from '../contexts/FamilyContext';
import { buildComparisonRows, buildVerdict, buildScoreboard, scoreFitLabels, personalFitLabels } from '../services/compareProducts';
import ProductImage from '../components/ProductImage';
import { PUBLIC_APP_URL, whatsappShareUrl } from '../utils/share';

function ScoreCell({ score, relativeLabel }) {
  if (typeof score !== 'number') {
    return <span className="text-[13px]" style={{ color: 'var(--label-3)' }}>—</span>;
  }
  const colors = getScoreColor(score);
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className="text-[13px] font-bold px-2 py-0.5 rounded-full" style={{ background: colors.bg, color: colors.color }}>
        {score}
      </span>
      {relativeLabel && <span className="text-[9.5px] font-semibold" style={{ color: 'var(--label-3)' }}>{relativeLabel}</span>}
    </span>
  );
}

// A value that leads its row: green and ticked (only where the lead is real --
// see buildScoreboard).
function Lead({ win, children }) {
  if (!win) return <>{children}</>;
  return (
    <span className="inline-flex items-center gap-0.5 font-bold px-1.5 py-0.5 rounded-[8px]" style={{ background: 'var(--v-good-bg)', color: 'var(--v-good)' }}>
      {children}<span className="text-[10px]" aria-label="better">✓</span>
    </span>
  );
}

// The answer, before any numbers: who comes out ahead (or that it's too
// close to call), by how much, and what the leader is best at.
function VerdictCard({ verdict, rows, onOpen }) {
  const clear = verdict.kind === 'clear';
  const leaders = rows.filter((r) => verdict.leaders.includes(r.lookupKey));
  const single = leaders.length === 1 && (verdict.kind === 'clear' || verdict.kind === 'edge') ? leaders[0] : null;
  const accent = clear ? 'var(--v-good)' : 'var(--tint)';
  return (
    <div className="rounded-[20px] p-4 mb-4" style={{ background: clear ? 'var(--v-good-bg)' : 'var(--tint-bg)' }}>
      <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: accent }}>
        {clear ? '🏆' : verdict.kind === 'close' ? '⚖️' : '👍'} {verdict.who}
      </p>
      <div className="flex items-center gap-3">
        {verdict.kind !== 'close' && (
          <div className="flex -space-x-3 flex-shrink-0">
            {leaders.slice(0, 2).map((r) => <ProductImage key={r.lookupKey} src={r.imageUrl} size={56} expandable={false} />)}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[18px] font-bold leading-snug" style={{ color: 'var(--label-1)' }}>{verdict.headline}</p>
          <p className="text-[13px] mt-0.5 leading-relaxed" style={{ color: 'var(--label-2)' }}>{verdict.sub}</p>
        </div>
      </div>
      {verdict.why && <p className="text-[13px] font-semibold mt-2.5" style={{ color: 'var(--label-1)' }}>{verdict.why}</p>}
      {verdict.note && <p className="text-[13px] mt-2.5 leading-relaxed" style={{ color: 'var(--label-1)' }}>{verdict.note}</p>}
      {single && (
        <button onClick={() => onOpen(single)} className="tap-scale mt-3 w-full py-2.5 rounded-[12px] text-[14px] font-semibold text-white" style={{ background: accent }}>
          See {single.productName.length > 28 ? 'its' : single.productName + '’s'} full report →
        </button>
      )}
    </div>
  );
}

const NUTRIENT_ROWS = [
  { key: 'energyKcal', label: 'Energy (kcal)', decimals: 0, unit: '' },
  { key: 'proteinG', label: 'Protein (g)', decimals: 1, unit: 'g' },
  { key: 'totalCarbG', label: 'Total Carbs (g)', decimals: 1, unit: 'g' },
  { key: 'sugarG', label: 'Total Sugars (g)', decimals: 1, unit: 'g' },
  { key: 'totalFatG', label: 'Total Fat (g)', decimals: 1, unit: 'g' },
  { key: 'saturatedFatG', label: 'Saturated Fat (g)', decimals: 1, unit: 'g' },
  { key: 'sodiumMg', label: 'Sodium (mg)', decimals: 0, unit: 'mg' },
];

export default function Compare() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profiles, activeProfileId, setActiveProfile } = useFamily();
  const [selectedProfileId, setSelectedProfileId] = useState(activeProfileId);
  const activeProfile = profiles.find((p) => p.id === selectedProfileId) || null;

  // Switching here also updates the app-wide active profile, same as
  // Result.jsx's own switcher -- one "who am I checking for" setting,
  // not a separate one just for this screen.
  const selectProfile = (profileId) => {
    setSelectedProfileId(profileId);
    setActiveProfile(profileId);
  };

  const products = location.state?.products || [];

  // Opens the full result for one compared product -- same "save a
  // fresh history entry, then navigate" pattern Category.jsx's own
  // openResult already uses, so this behaves like every other "open a
  // product from a list" flow in the app rather than inventing a new one.
  const openProduct = (product) => {
    const historyId = saveToHistory(product, 'search');
    navigate(`/result/${historyId}`);
  };

  // The scores as numbers only -- no "winner" in the message; the person
  // receiving it opens the app to see why. Native share sheet where there is
  // one, WhatsApp otherwise.
  const shareComparison = async () => {
    const lines = products
      .filter((p) => typeof p.overallScore === 'number')
      .map((p) => `• ${p.productName} — ${p.overallScore}/100`);
    const text = `Compared on FoodGuard India:\n${lines.join('\n')}\n\nCheck any packaged food: ${PUBLIC_APP_URL}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'FoodGuard India comparison', text });
        return;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return; // the person closed the share sheet
    }
    window.open(whatsappShareUrl(text), '_blank', 'noopener');
  };

  if (products.length < 2) {
    return (
      <div className="page-in max-w-2xl mx-auto px-4 py-16 pb-24 text-center">
        <div className="text-6xl mb-4">⚖️</div>
        <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-2">Nothing selected to compare</h2>
        <p className="text-slate-400 dark:text-slate-500 text-sm mb-6">Search and add 2-4 products to compare them side by side.</p>
        <button
          onClick={() => navigate('/compare')}
          className="tap-scale bg-green-600 hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
        >
          Add products to compare
        </button>
      </div>
    );
  }

  // Infant formula is a specially regulated infant-nutrition category --
  // comparing it against general food (or even another infant formula)
  // on the same score-based criteria would imply a "which is
  // healthier" judgment this category deliberately doesn't make (see
  // Result.jsx's isInfantFormula branch for the same reasoning). Blocks
  // the WHOLE comparison rather than just hiding the score rows, since
  // the nutrient table itself invites exactly that judgment.
  if (products.some((p) => p.isInfantFormula)) {
    return (
      <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
        <button
          onClick={() => navigate('/compare')}
          className="tap-scale inline-flex items-center gap-1.5 text-[15px] mb-3"
          style={{ color: 'var(--tint)' }}
        >
          ← Compare Products
        </button>
        <div className="rounded-[20px] p-5 text-center" style={{ background: 'var(--bg-card)' }}>
          <div className="text-5xl mb-3">🍼</div>
          <p className="text-[18px] font-bold mb-1" style={{ color: 'var(--label-1)' }}>Not directly comparable</p>
          <p className="text-[13.5px] leading-relaxed mb-4" style={{ color: 'var(--label-2)' }}>
            Infant formula is a specialized infant-nutrition product and shouldn't be compared using the same general-food criteria.
          </p>
          <div className="flex flex-col gap-2">
            {products.map((p, i) => (
              <button
                key={p.lookupKey || i}
                onClick={() => openProduct(p)}
                className="tap-scale flex items-center gap-3 p-2.5 rounded-[12px] text-left"
                style={{ background: 'var(--fill)' }}
              >
                <ProductImage src={p.imageUrl} size={44} expandable={false} />
                <span className="text-[13.5px] font-semibold flex-1 min-w-0 truncate" style={{ color: 'var(--label-1)' }}>
                  {p.productName}
                </span>
                {p.isInfantFormula && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'var(--v-moderate-bg)', color: 'var(--v-moderate)' }}
                  >
                    Infant Formula
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const rows = buildComparisonRows(products, activeProfile);
  const verdict = buildVerdict(rows, activeProfile);
  const { rowWinners, entries } = buildScoreboard(rows);
  // A row where fewer than two products have a number says nothing about
  // the comparison -- left out rather than shown as a line of dashes.
  const shownNutrients = NUTRIENT_ROWS.filter((m) => rows.filter((r) => typeof r[m.key] === 'number').length >= 2);
  const isWin = (key, r) => Boolean(rowWinners[key]?.has(r.lookupKey));
  const scoreLabels = scoreFitLabels(rows);
  const personalLabels = personalFitLabels(rows);
  const colTemplate = `104px repeat(${rows.length}, 1fr)`;

  return (
    <div className="page-in max-w-2xl mx-auto px-4 py-6 pb-24">
      <button
        onClick={() => navigate('/compare')}
        className="tap-scale inline-flex items-center gap-1.5 text-[15px] mb-3"
        style={{ color: 'var(--tint)' }}
      >
        ← Compare Products
      </button>

      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--label-1)' }}>Comparison Result</h1>
      <p className="text-sm mb-4" style={{ color: 'var(--label-3)' }}>{rows.length} products, side by side.</p>

      {/* Who this personalized comparison is for -- switching here also
          updates the app's own active profile, so it stays in sync with
          the Result page's own switcher instead of drifting separately. */}
      {profiles.length > 0 && (
        <div className="mb-5">
          <p className="text-[12.5px] font-semibold mb-2" style={{ color: 'var(--label-2)' }}>Compare for</p>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            <button
              onClick={() => selectProfile(null)}
              className="tap-scale flex-shrink-0 px-3 py-2 rounded-full text-[13px] font-semibold"
              style={{ background: !activeProfile ? 'var(--tint)' : 'var(--fill)', color: !activeProfile ? '#fff' : 'var(--label-1)' }}
            >
              General
            </button>
            {profiles.map((p) => {
              const active = p.id === selectedProfileId;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProfile(active ? null : p.id)}
                  className="tap-scale flex-shrink-0 flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-full text-[13px] font-semibold"
                  style={{ background: active ? 'var(--tint)' : 'var(--fill)', color: active ? '#fff' : 'var(--label-1)' }}
                >
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[13px] flex-shrink-0"
                    style={{ background: active ? 'rgba(255,255,255,0.25)' : 'var(--bg-card)' }}
                  >
                    {p.avatarEmoji}
                  </span>
                  {p.nickname}
                </button>
              );
            })}
            <Link
              to="/family"
              className="tap-scale flex-shrink-0 flex items-center px-3 py-2 rounded-full text-[13px] font-semibold"
              style={{ background: 'var(--fill)', color: 'var(--tint)' }}
            >
              + Add
            </Link>
          </div>
        </div>
      )}

      {verdict && <VerdictCard verdict={verdict} rows={rows} onOpen={(r) => openProduct(products[rows.indexOf(r)])} />}

      <div className="rounded-[16px] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
        {/* Product header -- image + name + brand, tap to open the full result. */}
        <div className="grid gap-2 p-3" style={{ gridTemplateColumns: colTemplate }}>
          <div />
          {rows.map((r, i) => (
            <button key={r.lookupKey} onClick={() => openProduct(products[i])} className="tap-scale text-center">
              <ProductImage src={r.imageUrl} size={56} expandable={false} />
              <p className="text-[10.5px] font-semibold mt-1 leading-tight line-clamp-2" style={{ color: 'var(--label-1)' }}>
                {r.productName}
              </p>
              {r.brand && <p className="text-[9.5px] mt-0.5" style={{ color: 'var(--label-3)' }}>{r.brand}</p>}
            </button>
          ))}
        </div>

        <div className="h-px" style={{ background: 'var(--separator)' }} />

        {/* Score row (+ personal score row when a profile is active). */}
        <div className="grid gap-2 px-3 py-2.5 items-center">
          <div className="grid gap-2" style={{ gridTemplateColumns: colTemplate }}>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--label-2)' }}>Score</span>
            {rows.map((r) => (
              <span key={r.lookupKey} className="text-center">
                <ScoreCell score={r.overallScore} relativeLabel={scoreLabels[r.lookupKey]} />
              </span>
            ))}
          </div>
        </div>

        {activeProfile && (
          <div className="grid gap-2 px-3 py-2.5 items-center" style={{ gridTemplateColumns: colTemplate, background: 'var(--fill)' }}>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--label-2)' }}>Personal Fit · {activeProfile.nickname}</span>
            {rows.map((r) => (
              <span key={r.lookupKey} className="text-center">
                <ScoreCell score={r.personalScore} relativeLabel={personalLabels[r.lookupKey]} />
              </span>
            ))}
          </div>
        )}

        <p className="text-[10.5px] font-bold uppercase tracking-wide px-3 pt-3 pb-1" style={{ color: 'var(--label-3)', borderTop: '1px solid var(--separator)' }}>
          Key Nutrients (per 100g)
        </p>

        {shownNutrients.map((metric) => (
          <div key={metric.key} className="grid gap-2 px-3 py-2 items-center" style={{ gridTemplateColumns: colTemplate }}>
            <span className="text-[12px] font-semibold" style={{ color: 'var(--label-2)' }}>{metric.label}</span>
            {rows.map((r) => {
              const value = r[metric.key];
              return (
                <span key={r.lookupKey} className="text-center text-[13px]" style={{ color: 'var(--label-1)' }}>
                  {typeof value === 'number' ? <Lead win={isWin(metric.key, r)}>{Number(value.toFixed(metric.decimals))}</Lead> : <span style={{ color: 'var(--label-3)' }}>—</span>}
                </span>
              );
            })}
          </div>
        ))}

        <div className="grid gap-2 px-3 py-2.5 items-center" style={{ gridTemplateColumns: colTemplate, borderTop: '1px solid var(--separator)' }}>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--label-2)' }}>Additives</span>
          {rows.map((r) => (
            <span key={r.lookupKey} className="text-center text-[13px] font-semibold" style={{ color: 'var(--label-1)' }}><Lead win={isWin('additives', r)}>{r.additivesLabel}</Lead></span>
          ))}
        </div>

        <div className="grid gap-2 px-3 py-2.5 items-center" style={{ gridTemplateColumns: colTemplate, borderTop: '1px solid var(--separator)' }}>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--label-2)' }}>Processing</span>
          {rows.map((r) => (
            <span key={r.lookupKey} className="text-center text-[13px] font-semibold" style={{ color: 'var(--label-1)' }}>{r.processing ? <Lead win={isWin('processing', r)}>{r.processing}</Lead> : '—'}</span>
          ))}
        </div>
      </div>

      {/* Who is better at what: each product with what it really leads
          (a gap of at least 20%, or 2+ additives) -- facts from the table
          above, never a recommendation. A product that leads nothing says so. */}
      {entries.some((e) => e.wins.length > 0) && (
        <div className="mt-4">
          <p className="text-[12.5px] font-semibold mb-2" style={{ color: 'var(--label-2)' }}>Who’s better at what</p>
          <div className="rounded-[16px] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
            {entries.map(({ row: r, wins }, i) => (
              <div key={r.lookupKey} className="px-3 py-3" style={i ? { borderTop: '1px solid var(--separator)' } : undefined}>
                <div className="flex items-center gap-2.5 mb-1.5">
                  <ProductImage src={r.imageUrl} size={32} expandable={false} />
                  <p className="text-[13.5px] font-bold flex-1 min-w-0 truncate" style={{ color: 'var(--label-1)' }}>{r.productName}</p>
                </div>
                {wins.length > 0 ? (
                  <ul className="space-y-1">
                    {wins.map((w) => (
                      <li key={w.label} className="flex items-baseline gap-2 text-[13px]">
                        <span style={{ color: 'var(--v-good)' }}>✓</span>
                        <span className="font-semibold" style={{ color: 'var(--label-1)' }}>{w.label}</span>
                        <span className="text-[12px]" style={{ color: 'var(--label-3)' }}>{w.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[12.5px]" style={{ color: 'var(--label-3)' }}>No clear lead on any measure.</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--label-3)' }}>Nutrients per 100g. Small differences (under 20%) aren’t counted.</p>
        </div>
      )}

      {/* What to do next: open any compared product's full report, start a
          new comparison, or send this one on. Up to 4 products, so the
          reports are a list of rows (not side-by-side buttons). */}
      <div className="mt-5">
        <p className="text-[12.5px] font-semibold mb-2" style={{ color: 'var(--label-2)' }}>See a full report</p>
        <div className="rounded-[16px] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
          {rows.map((r, i) => (
            <button
              key={r.lookupKey}
              onClick={() => openProduct(products[i])}
              className="tap-scale w-full flex items-center gap-3 px-3 py-2.5 text-left"
              style={i ? { borderTop: '1px solid var(--separator)' } : undefined}
            >
              <ProductImage src={r.imageUrl} size={44} expandable={false} />
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-semibold truncate" style={{ color: 'var(--label-1)' }}>{r.productName}</span>
                {r.brand && <span className="block text-[11px] truncate" style={{ color: 'var(--label-3)' }}>{r.brand}</span>}
              </span>
              <ScoreCell score={r.overallScore} />
              <span className="text-[18px] leading-none" style={{ color: 'var(--label-3)' }} aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => navigate('/compare')}
          className="tap-scale flex-1 py-3 rounded-[12px] text-[14px] font-semibold"
          style={{ background: 'var(--fill)', color: 'var(--label-1)' }}
        >
          ⚖️ Compare others
        </button>
        <button
          onClick={shareComparison}
          className="tap-scale flex-1 py-3 rounded-[12px] text-[14px] font-semibold text-white"
          style={{ background: 'var(--tint)' }}
        >
          Share
        </button>
      </div>

      <p className="text-[11px] mt-4 text-center" style={{ color: 'var(--label-3)' }}>
        "—" means that product's label/scan didn't have a real number for this.
      </p>
    </div>
  );
}
