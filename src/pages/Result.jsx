// src/pages/Result.jsx
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { getHistoryById, updateHistoryProductName, refreshHistoryEntry, saveToHistory, getScoreColor, getIngredientSeverity } from '../utils/storage';
import { getCachedReport, getSaferAlternatives, getSimilarProducts, saveReport, getReportIdByLookupKey } from '../services/productCache';
import { buildProductShareText, productShareUrl } from '../utils/share';
import ShareSheet from '../components/ShareSheet';
import { renderShareCardImage } from '../utils/shareCard';
import headerIcon from '../assets/header-icon.png';
import { analyzeText } from '../services/analyzeText';
import { lookupBarcode } from '../services/openFoodFacts';
import { getRelatedNews } from '../services/newsRepo';
import { submitProductFlag, submitNameSuggestion, FLAG_REASONS } from '../services/productFlags';
import { categoryIcon } from '../utils/categoryIcon';
import { useLanguage } from '../contexts/LanguageContext';
import { useFamily } from '../contexts/FamilyContext';
import {
  calculatePersonalAssessment,
  getPersonalEatAnswerKey,
} from '../services/personalAssessment';
import { getAllergenWarnings, ALLERGEN_CATEGORY_LABEL_KEY } from '../services/allergenCenter';
import ScoreCircle from '../components/ScoreCircle';
import IngredientCard from '../components/IngredientCard';
import ProductImage from '../components/ProductImage';
import ProductStripCard from '../components/ProductStripCard';
import NewsCard from '../components/NewsCard';
import { toServing } from '../services/nutrientBasis';
import ResultBurst, { shouldBurst, arriveMs, celebrationProfile } from '../components/ResultBurst';
import { peekHandoff } from '../utils/reportHandoff';
import LogPortionModal from '../components/LogPortionModal';
import { canLogIntake } from '../services/intakeLog';
import { ENERGY_RELATIVE_LIMIT_KEYS } from '../services/dailyHabitCheck';
import { buildNutrientProjections } from '../services/nutrientProjection';
import NutrientAddsUp from '../components/NutrientAddsUp';
import { isNativeApp } from '../services/notifications';
import LabelXray from '../components/LabelXray';
import NutritionTrafficLight from '../components/NutritionTrafficLight';
import { buildTrafficLight } from '../services/trafficLight';
import { swapSavings } from '../services/swapSavings';
import StoryCards from '../components/StoryCards';

// Maps a dailyHabitCheck.js nutrientKey to the matching i18n string keys
// (see src/i18n/strings.js) for its display name and its three
// short/medium/long-term explanations.
const HABIT_KEY_PREFIX = {
  sodiumMg: 'habitSodium',
  addedSugarG: 'habitAddedSugarG',
  saturatedFatG: 'habitSaturatedFatG',
  transFatG: 'habitTransFatG',
};
const HABIT_NUTRIENT_LABEL_KEY = {
  sodiumMg: 'nutrientSodiumMg',
  addedSugarG: 'nutrientAddedSugarG',
  saturatedFatG: 'nutrientSaturatedFatG',
  transFatG: 'nutrientTransFatG',
};
// See ENERGY_RELATIVE_LIMIT_KEYS in dailyHabitCheck.js -- the WHO
// guidance string shown instead of a personalised "% of your limit" for
// the three nutrients whose real WHO limit is a % of energy intake, not
// a flat number.
const HABIT_WHO_GUIDANCE_KEY = {
  addedSugarG: 'whoGuidanceAddedSugarG',
  saturatedFatG: 'whoGuidanceSaturatedFatG',
  transFatG: 'whoGuidanceTransFatG',
};

// The plain reference table (real numbers, never estimated -- see
// report.realNutrients in analyzeText.js), as opposed to the "Quick
// health check" section below it, which is a derived "if you ate this
// every day" projection built from the same numbers. Reuses
// HABIT_NUTRIENT_LABEL_KEY's labels for the four nutrients that
// section already names, so this table and that one never disagree on
// what to call the same nutrient.
// Ordered to mirror the panel as it's actually printed on an Indian
// pack -- energy, then protein, then carbohydrate and its sugars, then
// fat and its fractions, then the rest -- so this reads as the same
// table someone is holding, rather than a reordered subset of it. Any
// row whose number we genuinely don't have is dropped at render rather
// than shown as a blank or a zero.
const NUTRITION_TABLE_ROWS = [
  { key: 'caloriesKcal', labelKey: 'nutrientCaloriesKcal', unit: ' kcal' },
  { key: 'proteinG', labelKey: 'nutrientProteinG', unit: 'g' },
  { key: 'carbohydrateG', labelKey: 'nutrientCarbohydrateG', unit: 'g' },
  { key: 'totalSugarG', labelKey: 'nutrientTotalSugarG', unit: 'g' },
  { key: 'addedSugarG', labelKey: HABIT_NUTRIENT_LABEL_KEY.addedSugarG, unit: 'g' },
  { key: 'totalFatG', labelKey: 'nutrientTotalFatG', unit: 'g' },
  { key: 'saturatedFatG', labelKey: HABIT_NUTRIENT_LABEL_KEY.saturatedFatG, unit: 'g' },
  { key: 'transFatG', labelKey: HABIT_NUTRIENT_LABEL_KEY.transFatG, unit: 'g' },
  { key: 'cholesterolMg', labelKey: 'nutrientCholesterolMg', unit: 'mg' },
  { key: 'fibreG', labelKey: 'nutrientFibreG', unit: 'g' },
  { key: 'sodiumMg', labelKey: HABIT_NUTRIENT_LABEL_KEY.sodiumMg, unit: 'mg' },
];

// Ranks the "Why did this score X" modal's factors worst-tier-first,
// then by real penalty within a tier -- "Fine" is deliberately excluded
// entirely (see MAIN_FACTORS_LIMIT below): that question is "why isn't
// this higher", and a fine ingredient never lowered it. "Good things"
// on the main result page already covers what's fine about a product.
const TIER_RANK = { Harmful: 0, Concerning: 1, 'Highly processed': 2 };

const CONFIDENCE_KEY = { high: 'confidenceHigh', medium: 'confidenceMedium', low: 'confidenceLow' };
const EVIDENCE_TYPE_KEY = {
  regulatory: 'evidenceTypeRegulatory',
  scientific_consensus: 'evidenceTypeScientificConsensus',
  limited_evidence: 'evidenceTypeLimitedEvidence',
  heuristic: 'evidenceTypeHeuristic',
};

// "Why did this score X?" only ever showed the CLAIM (reason/health
// effects), never how sure we are of it -- this renders the one-line
// confidence + basis text (geminiService.js's RESEARCH_PROMPT is the
// only thing that sets these). null for anything researched before
// this field existed, so the row just quietly omits the line instead
// of showing "undefined confidence" -- no backfill needed.
function evidenceLineText(ing, t) {
  const confidenceKey = CONFIDENCE_KEY[ing.confidence];
  const evidenceKey = EVIDENCE_TYPE_KEY[ing.evidenceType];
  if (!confidenceKey || !evidenceKey) return null;
  return t('evidenceLine', { confidence: t(confidenceKey), evidenceType: t(evidenceKey) });
}

// Only the first few, worst-first -- everything past this is one tap
// away behind "+N other factors" instead of always on screen. Keeps
// this a quick "why" explainer instead of turning into a second
// Ingredients tab (which already exists for anyone who wants the full
// list).
const MAIN_FACTORS_LIMIT = 4;

// How many alternatives are shown, and how many candidates are fetched
// to choose them from. Ranking by a specific person's priorities can
// only surface a genuinely better-suited product if there are more
// candidates than slots -- with a pool the same size as the row, a
// personal ranking could only reshuffle the same three products the
// general score already picked.
const ALTERNATIVES_SHOWN = 3;
// 60 = everything the category query fetches anyway (productCache.js's
// getCategoryProducts always reads 60 rows), so a bigger pool costs no
// extra query -- and the "swap and save" pick (swapSavings.js) needs it:
// like-for-like swaps are rare among just the top few by score.
const ALTERNATIVES_POOL_SIZE = 60;

// Short, direct answer to "should I eat this?" shown next to the fork
// icon in the score hero -- deliberately a different word than the big
// verdict label above it (e.g. "Moderate" + "Occasionally", not
// "Moderate" twice). Keyed by the same verdict labels as SCORE_TIERS
// in utils/storage.js / VERDICT_TIERS in scoringEngine.js, so it can
// never disagree with the score colour shown right next to it.
const EAT_ANSWER_KEY = {
  Excellent: 'eatAnswerYes',
  Good: 'eatAnswerMostly',
  Moderate: 'eatAnswerOccasionally',
  Poor: 'eatAnswerRarely',
  'Very Poor': 'eatAnswerAvoid',
};

function SectionHeader({ children, action }) {
  return (
    <div className="flex items-end justify-between px-5 pb-1.5 pt-7">
      <span className="text-[13px]" style={{ color: 'var(--label-2)' }}>{children}</span>
      {action}
    </div>
  );
}

function Group({ children, className = '' }) {
  return (
    <div
      className={`ios-group mx-4 rounded-[14px] overflow-hidden ${className}`}
      style={{ background: 'var(--bg-card)' }}
    >
      {children}
    </div>
  );
}

// iOS-style segmented control -- splits the page into two short views
// (Overview / Ingredients) instead of one long scroll, so opening a
// report always lands on a screen that fits without scrolling past a
// long ingredient list first.
function SegmentedControl({ value, onChange, options }) {
  return (
    <div className="mx-4 mt-4 p-1 rounded-[12px] flex gap-1" style={{ background: 'var(--fill)' }}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="tap-scale flex-1 py-2 rounded-[9px] text-[14px] font-semibold transition-colors"
            style={{
              background: active ? 'var(--bg-card)' : 'transparent',
              color: active ? 'var(--label-1)' : 'var(--label-2)',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// A compact card for "Watch out for" / "Good things" -- sized to sit
// side by side so both read in one glance instead of two separate
// full-width scrolls.
function ListCard({ title, dotColor, items }) {
  return (
    <div className="rounded-[14px] p-3.5" style={{ background: 'var(--bg-card)' }}>
      <p className="flex items-center gap-1.5 text-[14px] font-semibold mb-2.5" style={{ color: 'var(--label-1)' }}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dotColor }} />
        {title}
      </p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-[13px] leading-snug pl-3 relative" style={{ color: 'var(--label-1)' }}>
            <span className="absolute left-0 top-[7px] w-1 h-1 rounded-full" style={{ background: 'var(--label-3)' }} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Result() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, language } = useLanguage();
  const { profiles, activeProfileId, setActiveProfile } = useFamily();
  const [selectedProfileId, setSelectedProfileId] = useState(activeProfileId);
  const [result, setResult] = useState(null);
  // null, or { handoff } -- handoff is where the loading ring was, if we came from one.
  const [burst, setBurst] = useState(null);
  // Delay (ms) before the verdict word slides in -- set once per report so it survives the burst ending.
  const [verdictReveal, setVerdictReveal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('overview');
  const [editingName, setEditingName] = useState(false);
  const [nameSuggested, setNameSuggested] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [alternatives, setAlternatives] = useState([]);
  const [relatedNews, setRelatedNews] = useState([]);
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [showScoreModal, setShowScoreModal] = useState(false);
  const [showAllFactors, setShowAllFactors] = useState(false);
  const [expandedBreakdownRows, setExpandedBreakdownRows] = useState(() => new Set());
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showLabelOrderInfo, setShowLabelOrderInfo] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [flagRemarks, setFlagRemarks] = useState('');
  const [flagState, setFlagState] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'error'
  const [flagError, setFlagError] = useState('');
  const [shareReportId, setShareReportId] = useState(null);
  const [shareImageBlob, setShareImageBlob] = useState(null);
  const [showShare, setShowShare] = useState(false);
  // "What this adds up to" opens on one line; week/month/year on a tap.
  const [addsOpen, setAddsOpen] = useState(false);

  useEffect(() => {
    const data = getHistoryById(id);
    if (!data) {
      navigate('/');
      return;
    }
    setResult(data);
    // Celebrate a freshly opened report once; not when re-opening from History.
    const celebrate = !location.state?.quiet && shouldBurst(id);
    const handoff = celebrate ? peekHandoff() : null;
    setBurst(celebrate ? { handoff } : null);
    setVerdictReveal(celebrate ? arriveMs(Boolean(handoff)) + celebrationProfile(data.overallScore || 0).fillMs - 200 : 0);
  }, [id, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolved up front, not when the share button is tapped -- a link
  // opened after an await is no longer a direct tap as far as a mobile
  // browser is concerned, and gets silently blocked as a popup.
  useEffect(() => {
    if (!result?.lookupKey) {
      setShareReportId(null);
      return;
    }
    let cancelled = false;
    getReportIdByLookupKey(result.lookupKey).then((reportId) => {
      if (!cancelled) setShareReportId(reportId);
    });
    return () => { cancelled = true; };
  }, [result?.lookupKey]);

  // Same reason as shareReportId above -- ready before the icon is
  // tapped, not after, so navigator.share() still runs inside the
  // click's own "direct user gesture" window instead of losing it to
  // an await and getting silently blocked. Uses result.flags directly
  // rather than the Hindi-aware displayFlags below (computed after the
  // early return, so not reachable from a hook up here) -- the card is
  // pixels, not translated text, and always renders in English
  // regardless of the app's own language while Hindi is off.
  useEffect(() => {
    if (!result) {
      setShareImageBlob(null);
      return;
    }
    const score = result.overallScore || 0;
    const verdictLabel = getScoreColor(score).label;
    const eatAnswerLabel = t(EAT_ANSWER_KEY[verdictLabel] || 'eatAnswerOccasionally');
    let cancelled = false;
    renderShareCardImage({
      productName: result.productName,
      score,
      verdictLabel,
      eatAnswerLabel,
      flags: result.flags || [],
      logoUrl: headerIcon,
    }).then((blob) => {
      if (!cancelled) setShareImageBlob(blob);
    });
    return () => { cancelled = true; };
  }, [result, t]);

  // A low score gets "Safer alternatives" (better-scoring only, a real
  // health nudge); everything else gets "Similar products" (any score,
  // plain discovery) -- so the Result page always has something to
  // keep browsing to instead of dead-ending after a good score.
  useEffect(() => {
    // Never rendered for infant formula (see the render guard below) --
    // skip the fetch itself too, not just the display.
    if (!result || result.isInfantFormula) {
      setAlternatives([]);
      return;
    }
    let cancelled = false;
    const fetchAlternatives = (result.overallScore || 0) < 65 ? getSaferAlternatives : getSimilarProducts;
    fetchAlternatives({ productName: result.productName, lookupKey: result.lookupKey, limit: ALTERNATIVES_POOL_SIZE }).then((alts) => {
      if (!cancelled) setAlternatives(alts);
    });
    return () => { cancelled = true; };
  }, [result?.lookupKey, result?.productName, result?.overallScore]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyed off the product's brand and its flagged ingredients specifically
  // (not the full list) -- an article title is far more likely to be
  // about a specific concerning substance than an everyday bulk one.
  const flaggedIngredientKey = (result?.ingredients || [])
    .filter((i) => i.status === 'harmful' || i.status === 'concerning')
    .map((i) => i.name)
    .join(',');

  useEffect(() => {
    if (!result) {
      setRelatedNews([]);
      return;
    }
    let cancelled = false;
    getRelatedNews({ brand: result.brand, flaggedIngredientNames: flaggedIngredientKey ? flaggedIngredientKey.split(',') : [] }).then((items) => {
      if (!cancelled) setRelatedNews(items);
    });
    return () => { cancelled = true; };
  }, [result?.brand, flaggedIngredientKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAlternative = async (item) => {
    const cached = await getCachedReport(item.lookupKey);
    if (!cached) return;
    cached.lookupKey = item.lookupKey;
    const historyId = saveToHistory(cached, 'search');
    navigate(`/result/${historyId}`);
  };

  const startEditingName = () => {
    setNameInput(result.productName === 'Unknown Product' ? '' : result.productName || '');
    setEditingName(true);
  };

  const saveName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setEditingName(false);
      return;
    }
    // Renames it on this device only. The shared catalog name is the
    // admin's to change -- this used to overwrite it for everyone, from
    // the public key, even after review -- so the new name goes to the
    // admin as a suggestion instead (see productFlags.js).
    if (result.lookupKey && trimmed !== (result.productName || '').trim()) {
      submitNameSuggestion({ report: result, suggestedName: trimmed }).then((r) => { if (r.ok) setNameSuggested(true); }, () => {});
    }
    setResult((prev) => ({ ...prev, productName: trimmed }));
    updateHistoryProductName(result.id, trimmed);
    setEditingName(false);
  };

  // Wipes this product's cached report and re-runs the full analysis
  // pipeline from scratch, so a scoring/parser fix (or a mistaken result)
  // shows up immediately instead of waiting on the stale cached report.
  const handleRefresh = async () => {
    if (!result.ingredientsText || refreshing) return;

    setRefreshing(true);
    setRefreshError('');
    try {
      // The cached report never stored the original nutrition-panel
      // numbers (they weren't collected before dailyHabitCheck.js
      // existed, and still aren't for text/photo-sourced scans) -- a
      // barcode-sourced product can re-fetch them fresh from Open Food
      // Facts here so refreshing an old scan can pick up a "daily habit"
      // section it never had, not just a rescored ingredient list.
      let nutrientsInfo = null;
      if (result.lookupKey?.startsWith('barcode:')) {
        const barcode = result.lookupKey.slice('barcode:'.length);
        const found = await lookupBarcode(barcode).catch(() => null);
        nutrientsInfo = found?.nutrientsInfo || null;
      }

      const analysis = await analyzeText(result.ingredientsText, result.productName, result.brand, null, result.imageUrl, nutrientsInfo);
      const fresh = analysis.report;
      fresh.ingredientsText = result.ingredientsText;
      fresh.lookupKey = result.lookupKey;

      // saveReport upserts on lookup_key, so this overwrites the row in
      // place. It used to delete first -- under admin review that re-created
      // the row as 'pending' and took an approved product out of the app
      // for everyone the moment anyone tapped Refresh.
      if (result.lookupKey && !analysis.isIngredientOnly) {
        await saveReport({
          lookupKey: result.lookupKey,
          source: result.inputType || 'text',
          productName: result.productName,
          ingredientsText: result.ingredientsText,
          report: fresh,
        });
      }

      refreshHistoryEntry(result.id, fresh);
      setResult((prev) => ({ ...prev, ...fresh }));
    } catch (err) {
      setRefreshError(err.message || 'Could not refresh this report. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  if (!result) return null;

  // Shown per serving when the pack states one, else per 100 g/ml (the
  // heading below says which). Built from the canonical per-100 figures
  // when the report has them, so the label can never disagree with the
  // numbers; older reports fall back to what they stored.
  const displayNutrients = result.nutrientsPer100
    ? toServing(result.nutrientsPer100, result.realNutrientsServingGrams)
    : result.realNutrients;

  const score = result.overallScore || 0;
  const scoreColors = getScoreColor(score);
  // Always derived from the score, never read back from the stored
  // report. Every cached report carries the verdict wording that was
  // current when it was written, so trusting it would leave thousands
  // of products still saying "Very Healthy" until each one happened to
  // be re-analyzed -- and would let the word disagree with the number
  // printed right beside it. The score is the single source of truth;
  // the label is just how it reads.
  const verdictLabel = scoreColors.label;
  const eatAnswer = t(EAT_ANSWER_KEY[verdictLabel] || 'eatAnswerOccasionally');
  const ingredients = result.ingredients || [];

  // Personal FoodGuard -- a second, derived layer on top of the same
  // already-computed report. `activeProfile` falls back to null (not
  // the family's default) if the remembered id points at a profile
  // that's since been deleted elsewhere.
  const activeProfile = profiles.find((p) => p.id === selectedProfileId) || null;
  // A plain const, not useMemo -- this is a cheap synchronous pass over
  // an already-resolved ingredient list (same cost class as `tiers`/
  // `mainFactors` below, neither of which are memoized either), and a
  // hook call here would run after the early return above on some
  // renders, violating the Rules of Hooks.
  const personalAssessment = activeProfile ? calculatePersonalAssessment(result, activeProfile) : null;
  // Checked against EVERY family profile with an allergy set, not just
  // whoever's currently active -- a hard safety constraint, unlike
  // Personal FoodGuard above (see services/allergenCenter.js).
  const allergenWarnings = getAllergenWarnings(result, profiles);
  const openFlagModal = () => {
    setFlagReason('');
    setFlagRemarks('');
    setFlagState('idle');
    setFlagError('');
    setShowFlagModal(true);
  };

  const sendFlag = async () => {
    setFlagState('sending');
    const { ok, error } = await submitProductFlag({ report: result, reason: flagReason, remarks: flagRemarks });
    if (ok) {
      setFlagState('sent');
    } else {
      // Never closes the sheet on failure -- losing what someone just
      // typed and telling them nothing went wrong would be worse than
      // the failure itself.
      setFlagState('error');
      setFlagError(error || 'Could not send that report.');
    }
  };

  const selectProfile = (profileId) => {
    setSelectedProfileId(profileId);
    setActiveProfile(profileId);
  };

  // Alternatives, ranked for whoever's being checked for. Without a
  // profile this is just the general-score order the catalog already
  // returned. With one, each candidate is re-scored against that
  // person's priorities and the row is rebuilt from the top of THAT
  // order -- but the card now shows BOTH numbers ("71 / 68") instead of
  // replacing the general score with the personal one, since losing the
  // general score entirely made it impossible to tell how much a
  // priority actually cost a given alternative.
  const rankedAlternatives = activeProfile
    ? alternatives
        .map((item) => ({
          item,
          personalScore: calculatePersonalAssessment(
            { overallScore: item.score, ingredients: item.ingredients, realNutrients: item.realNutrients },
            activeProfile
          ).personalScore,
        }))
        .sort((a, b) => b.personalScore - a.personalScore)
        .slice(0, ALTERNATIVES_SHOWN)
        .map(({ item, personalScore }) => ({ ...item, personalScore }))
    : alternatives.slice(0, ALTERNATIVES_SHOWN);

  // "Swap and save": per 100g, what each alternative has less of than
  // this product (swapSavings.js). The spelled-out best swap is the
  // first-ranked alternative that also scores higher -- a lower-scoring
  // "similar product" is never suggested as a swap.
  const savingsByKey = Object.fromEntries(alternatives.map((item) => [item.lookupKey, swapSavings(result, item)]));
  // From the WHOLE pool (already sorted best-first), not just the three
  // cards shown -- the best like-for-like swap is often further down.
  const bestSwapItem = (result.overallScore || 0) < 65
    ? alternatives.find((item) => item.score > (result.overallScore || 0) && savingsByKey[item.lookupKey].length > 0)
    : null;
  const bestSwap = bestSwapItem && (() => {
    const parts = savingsByKey[bestSwapItem.lookupKey].map((sv) => t(`swapLess_${sv.key}`, { tsp: sv.teaspoons, grams: sv.grams }));
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${t('addsAnd')} ${parts[parts.length - 1]}` : parts[0];
    return { item: bestSwapItem, list, unit: result.foodType === 'beverage' || result.realNutrientsServingUnit === 'ml' ? 'ml' : 'g' };
  })();

  // Stats, dots and the filter all read from one severity scale, so the
  // counts can never disagree with the colours shown next to each row.
  const severityOf = (ing) => getIngredientSeverity(ing).label;
  const tiers = [
    { key: 'Harmful', label: t('tierHarmful'), color: 'var(--v-very-poor)', bg: 'var(--v-very-poor-bg)', icon: '⚠' },
    { key: 'Concerning', label: t('tierConcerning'), color: 'var(--v-poor)', bg: 'var(--v-poor-bg)', icon: '!' },
    { key: 'Highly processed', label: t('tierProcessed'), color: 'var(--v-moderate)', bg: 'var(--v-moderate-bg)', icon: '−' },
    { key: 'Fine', label: t('tierFine'), color: 'var(--v-good)', bg: 'var(--v-good-bg)', icon: '✓' },
  ].map((tier) => ({ ...tier, count: ingredients.filter((i) => severityOf(i) === tier.key).length }));

  // Same "not Fine" definition the Ingredients tab's tier chips and the
  // "Why did this score X?" breakdown (mainFactors, below) already use --
  // this used to only count Harmful/Concerning, so a product with e.g. 2
  // concerning + 2 highly-processed ingredients said "2 of 15 raise a
  // flag" up top while the breakdown modal one tap away listed 4. Highly
  // processed ingredients do pull the score down (see mainFactors), so
  // they belong in this count too.
  const flaggedCount = ingredients.filter((i) => severityOf(i) !== 'Fine').length;
  const filteredIngredients = filter === 'all' ? ingredients : ingredients.filter((i) => severityOf(i) === filter);

  // The Ingredients tab's "All" list, worst tier first -- every card
  // shows its own severity pill now (see IngredientCard), so a plain
  // sorted list reads just as clearly as the old grouped sections did,
  // without repeating a header per tier.
  const sortedIngredients = tiers.flatMap((tier) => ingredients.filter((i) => severityOf(i) === tier.key));

  // Label X-Ray tap: show the full list (a filter could be hiding it),
  // then scroll to that ingredient's card and flash it once.
  const jumpToIngredient = (index) => {
    setFilter('all');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById(`ingredient-card-${index}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('xray-flash');
      void el.offsetWidth; // restart the animation on a repeat tap
      el.classList.add('xray-flash');
    }));
  };

  const savedDate = new Date(result.savedAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const reportId = `SB-${(result.id || '').toString().slice(-8).toUpperCase()}`;

  // AI-generated content only, never the product name/brand or ingredient
  // names -- those aren't translated (see translateService.js). Falls
  // back to English per-field whenever a Hindi version isn't there yet
  // (an older cached report that hasn't been refreshed since translation
  // was added, or a translation call that failed), so nothing goes blank.
  const hi = language === 'hi' ? result.hi : null;
  const displaySummary = hi?.summary || result.summary;
  const displayRecommendation = hi?.recommendation || result.recommendation;
  const displayUsefulContext = hi?.usefulContext || result.usefulContext;
  const displayFlags = hi?.flags?.length === result.flags?.length ? hi.flags : result.flags;
  const displayPositives = hi?.positives?.length === result.positives?.length ? hi.positives : result.positives;
  const shareText = buildProductShareText({
    productName: result.productName,
    score,
    verdict: verdictLabel,
    flags: displayFlags || [],
    link: shareReportId ? productShareUrl(shareReportId) : null,
  }, t);
  // The share sheet (ShareSheet.jsx) gets the pre-generated score-card
  // picture (shareImageBlob, made in the effect above) so its buttons can
  // hand it on synchronously from the tap.
  const displayStory = result.story && {
    ...result.story,
    ...(hi?.story || {}),
    mythVsFact:
      hi?.story?.mythVsFact?.length === result.story.mythVsFact?.length
        ? hi.story.mythVsFact
        : result.story.mythVsFact,
  };

  // Rule-based, not AI/translation content (see dailyHabitCheck.js) --
  // resolved once here since it's used in both the compact teaser near
  // the score and the full modal it opens.
  const habitDisplay = result.dailyHabitCheck && (() => {
    const habit = result.dailyHabitCheck;
    const servingText = habit.servingGrams
      ? t('habitServingPack', { grams: habit.servingGrams, unit: habit.servingUnit || 'g' })
      : t('habitServingPer100g');
    const isEnergyRelative = ENERGY_RELATIVE_LIMIT_KEYS.has(habit.nutrientKey);
    return {
      ...habit,
      nutrientLabel: t(HABIT_NUTRIENT_LABEL_KEY[habit.nutrientKey]),
      prefix: HABIT_KEY_PREFIX[habit.nutrientKey],
      servingText,
      displayAmount: habit.unit === 'mg' ? Math.round(habit.amount) : habit.amount,
      isEnergyRelative,
      whoGuidance: isEnergyRelative ? t(HABIT_WHO_GUIDANCE_KEY[habit.nutrientKey]) : null,
    };
  })();

  // Rule-based arithmetic on the label's own sugar/salt/fat figures --
  // null (and nothing shown) unless there's a serving and a genuine story
  // to tell. See nutrientProjection.js / sugarProjection.js for every guardrail.
  const nutrientProjection = result.isInfantFormula ? null : buildNutrientProjections(result);
  // Low/Medium/High tiles for the Nutrition section -- always per 100g/ml.
  const trafficLight = buildTrafficLight(result);
  const scrollToAlternatives = () => document.getElementById('alternatives-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // For the "Why did this score X?" modal -- every ingredient that
  // actually pulled the score down (Harmful/Concerning/Highly processed;
  // "Fine" excluded entirely, see MAIN_FACTORS_LIMIT above), worst tier
  // first and then by real penalty within a tier. Uses the exact same
  // tier definitions as the Breakdown tiles and Ingredients tab -- no
  // separate/invented categorisation.
  const mainFactors = ingredients
    .filter((ing) => severityOf(ing) !== 'Fine')
    .map((ing) => ({ ingredient: ing, tier: tiers.find((t) => t.key === severityOf(ing)) }))
    .sort((a, b) => (TIER_RANK[a.tier.key] - TIER_RANK[b.tier.key]) || ((b.ingredient.penalty || 0) - (a.ingredient.penalty || 0)));

  // "11 of 26 raise a flag": the 11 is a link to them, in the colour of the
  // worst one -- red for harmful, orange for concerning, amber for processed.
  const worstFlagTier = tiers.find((tier) => tier.key !== 'Fine' && tier.count > 0);
  const openFlagged = () => {
    setFilter('all'); // "All" lists worst first, so the flagged ones lead
    setView('ingredients');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById('ingredient-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  };
  const flaggedSentence = (() => {
    const [before, after] = t('someFlagged', { flagged: '\u0001', total: ingredients.length }).split('\u0001');
    return (
      <>
        {before}
        <button onClick={openFlagged} className="tap-scale font-bold underline underline-offset-2" style={{ color: worstFlagTier?.color || 'var(--label-1)' }}>
          {flaggedCount}
        </button>
        {after}
      </>
    );
  })();

  // "What this adds up to", closed: the most concerning nutrient as one
  // line ("≈ 4.3 teaspoons of added sugar in one 57g pack"), the rest named
  // after it. Without a projection, the quick health check's own line.
  const addsSummary = (() => {
    if (nutrientProjection) {
      const { serving, items } = nutrientProjection;
      const [top, ...rest] = items;
      return {
        line: t(`addsOneLine_${top.key}`, {
          tsp: top.teaspoonsPerServing,
          kind: t(top.isAddedSugar ? 'sugarKindAdded' : 'sugarKindPlain'),
          grams: serving.grams,
          unit: serving.unit,
          per: t(serving.source === 'pack' ? 'addsPerPack' : 'addsPerServing'),
        }),
        also: rest.length ? t('addsAlso', { list: rest.map((i) => `${t(`addsTab${i.key[0].toUpperCase()}${i.key.slice(1)}`)} ${t('addsTabTsp', { tsp: i.teaspoonsPerServing })}`).join(' · ') }) : '',
      };
    }
    if (habitDisplay) {
      return {
        line: habitDisplay.isEnergyRelative
          ? t('habitAmountCaption', { amount: habitDisplay.displayAmount, unit: habitDisplay.unit, nutrient: habitDisplay.nutrientLabel, servingText: habitDisplay.servingText })
          : t('habitBarCaption', { percent: habitDisplay.percent, nutrient: habitDisplay.nutrientLabel, servingText: habitDisplay.servingText }),
        also: '',
      };
    }
    return null;
  })();

  return (
    <div className="page-in max-w-[560px] mx-auto pb-24" style={{ background: 'var(--bg-grouped)' }}>
      {burst && <ResultBurst id={id} score={score} handoff={burst.handoff} onDone={() => setBurst(null)} />}

      {/* Nav */}
      <button
        onClick={() => navigate('/')}
        className="tap-scale inline-flex items-center gap-1.5 px-4 pt-3 pb-1 text-[17px]"
        style={{ color: 'var(--tint)' }}
      >
        <svg viewBox="0 0 12 20" fill="none" className="w-3 h-5">
          <path d="M10 2L2 10l8 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t('backToScan')}
      </button>

      {/* Title -- the pack on the left, what it is on the right, so the
          photo doesn't sit alone in the middle of an empty row. */}
      <div className={`px-5 pt-1 pb-5 ${result.imageUrl ? 'flex items-start gap-4' : ''}`}>
        {result.imageUrl && (
          <div className="flex-shrink-0 rounded-[18px] p-2" style={{ background: 'var(--bg-card)', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
            <ProductImage src={result.imageUrl} size={104} />
          </div>
        )}
        <div className={`min-w-0 ${result.imageUrl ? 'flex-1 pt-1' : ''}`}>
          {result.brand && !editingName && (
            <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--label-2)' }}>
              {result.brand.toUpperCase()}
            </p>
          )}

          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                placeholder={t('enterProductName')}
                className={`flex-1 min-w-0 ${result.imageUrl ? 'text-[21px]' : 'text-[26px]'} font-bold tracking-tight bg-transparent border-b-2 focus:outline-none`}
                style={{ color: 'var(--label-1)', borderColor: 'var(--tint)' }}
              />
              <button onClick={saveName} className="text-[17px]" style={{ color: 'var(--tint)' }} aria-label="Save name">{t('done')}</button>
            </div>
          ) : (
            <h1 className={`${result.imageUrl ? 'text-[21px] leading-[1.2]' : 'text-[26px] leading-[1.15]'} font-bold tracking-tight flex items-start gap-2 mb-2`} style={{ color: 'var(--label-1)' }}>
              <span className="min-w-0 break-words">{result.productName || 'Unknown Product'}</span>
              <button
                onClick={startEditingName}
                className={`text-[14px] flex-shrink-0 ${result.imageUrl ? 'mt-1' : 'mt-1.5'}`}
                style={{ color: 'var(--tint)' }}
                aria-label="Edit product name"
              >
                {t('edit')}
              </button>
            </h1>
          )}

          {nameSuggested && !editingName && (
            <p className="text-[12.5px] mb-1.5" style={{ color: 'var(--label-3)' }}>{t('nameSuggestedNote')}</p>
          )}

          {/* The pack size, not a "Packaged Food" label every product here
              would share -- it tells two sizes of one product apart. */}
          {result.productName === 'Unknown Product' && !editingName ? (
            <p className="text-[13px]" style={{ color: 'var(--v-poor)' }}>
              {t('unknownProductHint')}
            </p>
          ) : result.packSize?.trim() && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ background: 'var(--fill)', color: 'var(--label-2)' }}
            >
              📦 {result.packSize.trim()}
            </span>
          )}
        </div>
      </div>

      {/* Allergen Center -- deliberately OUTSIDE the score card below (a
          different card, different colour language, ahead of it in
          reading order) since an allergy warning is a hard safety fact,
          not part of "how healthy is this ingredient list". Checked
          against every family profile with an allergy set regardless of
          who's active (allergenWarnings above), so it can never be
          missed just because a different profile happens to be
          selected right now. */}
      {allergenWarnings.length > 0 && (
        <div className="mx-4 mb-3 rounded-[16px] p-4" style={{ background: 'var(--v-poor-bg)', border: '1.5px solid var(--v-poor)' }}>
          <div className="space-y-2">
            {allergenWarnings.map((w) => {
              const label = w.custom ? w.category : t(ALLERGEN_CATEGORY_LABEL_KEY[w.category]);
              const names = w.profiles.map((p) => p.nickname).join(', ');
              return (
                <div key={w.custom ? `custom:${w.category}` : w.category} className="flex items-start gap-2.5">
                  <span className="text-[16px] leading-none mt-0.5 flex-shrink-0">⚠</span>
                  <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--v-poor)' }}>
                    <span className="font-bold">
                      {t(w.severity === 'contains' ? 'allergenContainsLabel' : 'allergenMayContainLabel', { allergen: label })}
                    </span>
                    {' — '}
                    <span style={{ color: 'var(--label-2)' }}>{t('allergenWarningFor', { names })}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Infant formula is a specially regulated category (FSSAI Infant
          Milk Substitutes Act, Codex Standard for Infant Formula) -- a
          real reported case (Furilac Advance Stage 1) showed a plain
          "78/100 · Good" score, which reads as "healthy for a baby" even
          though it's a general-food scale being applied to a product
          formulated to meet mandated infant-nutrition requirements, not
          judged by "less processed is better". This replaces the ENTIRE
          score hero below with a category explainer + disclaimer instead
          of a numeric score -- deliberately no ScoreCircle, no verdict,
          no "should I eat it?" answer here at all. */}
      {result.isInfantFormula ? (
        <div className="mx-4 rounded-[20px] p-5" style={{ background: 'var(--bg-card)' }}>
          <div className="flex items-center gap-3">
            <span className="text-[32px] leading-none flex-shrink-0">🍼</span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--label-2)' }}>
                {t('infantFormulaSubtitle')}
              </p>
              <p className="text-[19px] font-bold tracking-tight" style={{ color: 'var(--v-moderate)' }}>
                {t('infantFormulaTitle')}
              </p>
            </div>
          </div>
          <p className="text-[13.5px] leading-relaxed mt-3" style={{ color: 'var(--label-1)' }}>
            {t('infantFormulaBody')}
          </p>
          <div className="flex gap-2.5 items-start mt-4 pt-4" style={{ borderTop: '1px solid var(--separator)' }}>
            <span className="text-[16px] leading-none mt-0.5 flex-shrink-0">⚠️</span>
            <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--label-2)' }}>
              {t('infantFormulaDisclaimer')}
            </p>
          </div>
        </div>
      ) : (
      /* Score hero -- the single most important thing on this page, so
          it gets the biggest visual weight: an enlarged score circle,
          then "should I eat it?" answered directly underneath (instead
          of just repeating the verdict as a sentence), and a link into
          the real, ingredient-by-ingredient reason for this exact
          number. */
      <div className="mx-4 rounded-[20px] p-5" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center gap-5">
          <ScoreCircle score={score} size="xl" burstTarget startDelayMs={burst ? arriveMs(Boolean(burst.handoff)) : 0} fillMs={burst ? celebrationProfile(score).fillMs : undefined} />
          <div className="min-w-0">
            <p
              className={`text-[24px] font-bold tracking-tight leading-tight ${verdictReveal ? 'verdict-reveal' : ''}`}
              style={{ color: scoreColors.color, ...(verdictReveal ? { animationDelay: `${verdictReveal}ms` } : null) }}
            >
              {verdictLabel}
            </p>
            <p className="text-[15px] mt-0.5" style={{ color: 'var(--label-2)' }}>
              {ingredients.length === 0
                ? t('noIngredientsAnalyzed')
                : flaggedCount === 0
                  ? t('nothingFlagged', { count: ingredients.length })
                  : flaggedSentence}
            </p>
            {/* Web only -- not in the Android app. */}
            {result.ingredientsText && !isNativeApp() && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="tap-scale block text-[13px] mt-2"
                style={{ color: 'var(--label-3)', opacity: refreshing ? 0.6 : 1 }}
              >
                {refreshing ? t('refreshing') : t('refreshAnalysis')}
              </button>
            )}
            {refreshError && (
              <p className="text-[13px] mt-1" style={{ color: 'var(--v-poor)' }}>{refreshError}</p>
            )}
          </div>
        </div>

        {/* "Should I eat it?" -- the plain-English recommendation,
            reframed as a direct answer instead of a floating sentence.
            Same score-tier colour as the circle above, never a second,
            independent colour scale. */}
        {displayRecommendation && (
          <div className="flex gap-2.5 items-start mt-4 pt-4" style={{ borderTop: '1px solid var(--separator)' }}>
            <span className="text-[18px] leading-none mt-0.5 flex-shrink-0">🍽️</span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5">
                <span className="text-[13.5px] font-semibold" style={{ color: 'var(--label-2)' }}>
                  {t('shouldIEatIt')}
                </span>
                <span className="text-[15px] font-bold" style={{ color: scoreColors.color }}>
                  {eatAnswer}
                </span>
              </p>
              <p className="text-[13.5px] leading-relaxed mt-0.5" style={{ color: 'var(--label-1)' }}>
                {displayRecommendation}
              </p>
            </div>
          </div>
        )}

        {/* Why/how links share this row with the share icon (justify-
            between) rather than the share button owning a full extra
            row of its own below -- it was the same width as the whole
            card just to hold one icon-sized action. */}
        {ingredients.length > 0 && (
          <div className={`flex items-center justify-between gap-3 mt-3 ${displayRecommendation ? 'pl-[27px]' : ''}`}>
            <div className="flex flex-wrap gap-x-3 gap-y-1 min-w-0">
              <button
                onClick={() => setShowScoreModal(true)}
                className="tap-scale text-[13.5px] font-semibold"
                style={{ color: 'var(--tint)' }}
              >
                {t('whyScoreLink', { score })}
              </button>
              <Link to="/about#how-score-works" className="text-[13px]" style={{ color: 'var(--label-3)' }}>
                {t('howCalculated')}
              </Link>
            </div>

            {/* Opens the share sheet: WhatsApp, Instagram, X or the phone's own. */}
            <button
              onClick={() => setShowShare(true)}
              aria-label={t('shareTitle')}
              title={t('shareTitle')}
              className="tap-scale flex-shrink-0 flex items-center gap-1.5 pl-3 pr-3.5 h-9 rounded-full text-[13px] font-semibold text-white"
              style={{ background: 'var(--tint)' }}
            >
              <svg viewBox="0 0 24 24" className="w-[17px] h-[17px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
              </svg>
              {t('shareButton')}
            </button>
          </div>
        )}
      </div>
      )}

      {/* Personal FoodGuard -- the same scanned product, re-evaluated
          against a specific family member's selected priorities. The
          general score/card above never changes; everything below is a
          second, clearly-separated layer on top of it (see
          services/personalAssessment.js). No profiles yet -> a small,
          skippable prompt instead of forcing setup. Skipped entirely for
          infant formula -- FoodGuard determining a personal "fit" for a
          specific baby would be exactly the kind of individualized
          feeding/medical judgment call the disclaimer above says it
          doesn't make. */}
      {!result.isInfantFormula && (
      <>
      {/* No profiles yet: the "make it personal" prompt waits at the bottom
          of the page, after the report itself. */}
      {profiles.length > 0 && (
        <div className="mx-4 mt-3">
          <p className="text-[13px] font-semibold mb-2" style={{ color: 'var(--label-2)' }}>
            {t('familyWhoIsThisFor')}
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {profiles.map((p) => {
              const active = p.id === selectedProfileId;
              const chipAssessment = calculatePersonalAssessment(result, p);
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
                  <span style={{ color: active ? 'rgba(255,255,255,0.85)' : chipAssessment.tier.color }}>
                    {chipAssessment.personalScore}
                  </span>
                </button>
              );
            })}
            <Link
              to="/family"
              className="tap-scale flex-shrink-0 flex items-center px-3 py-2 rounded-full text-[13px] font-semibold"
              style={{ background: 'var(--fill)', color: 'var(--tint)' }}
            >
              {t('personalAddChip')}
            </Link>
          </div>
        </div>
      )}

      {activeProfile && personalAssessment && (
        <div className="mx-4 mt-3 rounded-[20px] p-5" style={{ background: 'var(--bg-card)', border: `1.5px solid ${personalAssessment.tier.color}` }}>
          <div className="flex items-center gap-4">
            <span
              className="w-16 h-16 rounded-full flex flex-col items-center justify-center flex-shrink-0"
              style={{ background: personalAssessment.tier.bg }}
            >
              <span className="text-[22px] font-bold leading-none tabular-nums" style={{ color: personalAssessment.tier.color }}>
                {personalAssessment.personalScore}
              </span>
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: 'var(--label-2)' }}>
                {t('personalScoreTitle', { name: activeProfile.nickname })}
              </p>
              <p className="text-[19px] font-bold tracking-tight" style={{ color: personalAssessment.tier.color }}>
                {personalAssessment.tier.label}
              </p>
            </div>
          </div>

          <div className="flex gap-2.5 items-start mt-4 pt-4" style={{ borderTop: '1px solid var(--separator)' }}>
            <span className="text-[18px] leading-none mt-0.5 flex-shrink-0">🍽️</span>
            <p className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13.5px] font-semibold" style={{ color: 'var(--label-2)' }}>
                {t('shouldXEatIt', { name: activeProfile.nickname })}
              </span>
              <span className="text-[15px] font-bold" style={{ color: personalAssessment.tier.color }}>
                {t(getPersonalEatAnswerKey(personalAssessment.personalScore))}
              </span>
            </p>
          </div>

          {/* Nothing to show means the personal score IS the universal
              score AND there's no informational note either (see
              calculatePersonalAssessment) -- asking "why is it
              different?" when it isn't is confusing, so this whole
              prompt only exists when there's an actual concern or note
              worth surfacing. A concern (avoid-type priority, e.g. too
              much sodium) lowers the score; a note (seek-more-type
              priority, e.g. not a big protein source) never does --
              it's just useful context, not a flaw in the food. */}
          {/* The "why" lives on its own page (pages/PersonalScore.jsx)
              rather than expanding in place: it needs room to show both
              scores side by side and every priority that was checked,
              including the ones that came back clean -- which is most of
              them, most of the time, and is the reassuring half of the
              answer. Always offered, even when nothing matched, since
              "here's what we checked for you" is worth reading too. */}
          <Link
            to={`/result/${id}/personal`}
            className="tap-scale block mt-3 pl-[27px] text-[13px] font-semibold"
            style={{ color: 'var(--tint)' }}
          >
            {t('personalSeeBreakdown')} ›
          </Link>
        </div>
      )}
      </>
      )}

      {/* A plain ingredient score can't say WHY a product exists -- an
          oral rehydration/glucose product scoring "Moderate" as an
          everyday food can still be exactly right for its actual,
          specific purpose. Distinct green "good news" tone (not the
          same tint-blue as the seasoning note below) since this is a
          positive reframe of the score above, not a caveat on it. */}
      {displayUsefulContext && (
        <div className="mx-4 mt-3 rounded-[14px] px-4 py-3.5 flex gap-3 items-start" style={{ background: 'var(--v-good-bg)' }}>
          <span className="text-[18px] leading-none mt-0.5 flex-shrink-0">🎯</span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold mb-0.5" style={{ color: 'var(--v-good)' }}>
              {t('usefulContextTitle')}
            </p>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
              {displayUsefulContext}
            </p>
          </div>
        </div>
      )}

      {/* A masala or seasoning scoring 95 isn't an invitation to eat it
          by the spoonful -- the score describes the product itself, and
          for these that's a pinch at a time inside a larger dish. */}
      {result.isCondimentOrSeasoning && (
        <div className="mx-4 mt-3 rounded-[14px] px-4 py-3 flex gap-3 items-start" style={{ background: 'var(--tint-bg)' }}>
          <span className="text-[16px] leading-none mt-0.5 flex-shrink-0">🥄</span>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
            {t('seasoningNote')}
          </p>
        </div>
      )}

      {/* Newly added and not yet reviewed by an admin -- it isn't listed
          for anyone else yet, but the person who scanned it still gets the
          result (see VISIBLE_REVIEW_STATUSES in productCache.js). */}
      {(result.reviewStatus === 'pending' || result.reviewStatus === 'rejected') && (
        <div className="mx-4 mt-3 rounded-[14px] px-4 py-3 flex items-start gap-2" style={{ background: 'var(--v-moderate-bg)' }}>
          <span className="text-[14px] flex-shrink-0" aria-hidden="true">🕒</span>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
            {t('reviewPendingNote')}
          </p>
        </div>
      )}

      <SegmentedControl
        value={view}
        onChange={setView}
        options={[
          { value: 'overview', label: t('tabOverview') },
          { value: 'ingredients', label: t('tabIngredients', { count: ingredients.length }) },
          ...(result.story ? [{ value: 'story', label: t('tabStory') }] : []),
        ]}
      />

      {/* Breakdown — tapping a tile jumps to the Ingredients tab filtered to that category */}
      {view === 'overview' && ingredients.length > 0 && (
        <>
          <SectionHeader>{t('sectionBreakdown')}</SectionHeader>
          <div className="mx-4 grid grid-cols-4 gap-2">
            {tiers.map((tier) => {
              const active = filter === tier.key;
              return (
                <button
                  key={tier.key}
                  onClick={() => {
                    setFilter(tier.key);
                    setView('ingredients');
                  }}
                  className="tap-scale rounded-[14px] py-3 px-1 text-center transition-colors"
                  style={{
                    background: active ? tier.color : 'var(--bg-card)',
                    color: active ? '#fff' : 'var(--label-1)',
                  }}
                >
                  <span
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-bold mx-auto mb-1.5"
                    style={{ background: active ? 'rgba(255,255,255,0.25)' : tier.bg, color: active ? '#fff' : tier.color }}
                  >
                    {tier.icon}
                  </span>
                  <span className="block text-[20px] font-bold leading-none tracking-tight" style={{ color: active ? '#fff' : tier.color }}>
                    {tier.count}
                  </span>
                  <span className="block text-[11px] mt-1" style={{ color: active ? '#fff' : 'var(--label-2)' }}>
                    {tier.label}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Flags + Positives — side by side when both exist, so "at a
          glance" actually reads as one glance rather than two scrolls.
          Skipped for infant formula -- this is "what pulled the general
          food score up/down" framing, which doesn't apply once that
          score isn't being shown at all. */}
      {view === 'overview' && !result.isInfantFormula && (result.flags?.length > 0 || result.positives?.length > 0) && (
        <>
          <SectionHeader>{t('sectionAtAGlance')}</SectionHeader>
          <div className={`grid gap-2.5 mx-4 ${result.flags?.length > 0 && result.positives?.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {result.flags?.length > 0 && (
              <ListCard title={t('watchOutFor')} dotColor="var(--v-poor)" items={displayFlags} />
            )}
            {result.positives?.length > 0 && (
              <ListCard title={t('goodThings')} dotColor="var(--v-good)" items={displayPositives} />
            )}
          </div>
        </>
      )}

      {/* Real nutrition-panel numbers (Open Food Facts / Blinkit only,
          never estimated -- see report.realNutrients in analyzeText.js).
          Plain reference values, distinct from "Quick health check"
          right below it, which turns the SAME numbers into an "if you
          ate this every day" projection -- this section is just what the
          label actually says. */}
      {view === 'overview' && (displayNutrients) && (
        <>
          <SectionHeader>{t('sectionNutrition')}</SectionHeader>
          <Group>
            <div className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-[12px]" style={{ color: 'var(--label-3)' }}>
                  {result.realNutrientsServingGrams
                    ? t('nutritionPerServing', { grams: result.realNutrientsServingGrams, unit: result.realNutrientsServingUnit || 'g' })
                    : t('nutritionPer100g')}
                </p>
                {/* Only offered when there's real calorie data to log against
                    -- see canLogIntake in intakeLog.js. No estimation path. */}
                {canLogIntake(result) && (
                  <button
                    onClick={() => setShowLogModal(true)}
                    className="tap-scale flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold"
                    style={{ background: 'var(--tint-bg)', color: 'var(--tint)' }}
                  >
                    ＋ Log what I had
                  </button>
                )}
              </div>
              {trafficLight && <NutritionTrafficLight light={trafficLight} t={t} />}
              <div className="grid grid-cols-3 gap-3">
                {NUTRITION_TABLE_ROWS.filter((row) => typeof displayNutrients[row.key] === 'number').map((row) => (
                  <div key={row.key}>
                    <p className="text-[11px] capitalize" style={{ color: 'var(--label-3)' }}>{t(row.labelKey)}</p>
                    <p className="text-[16px] font-bold" style={{ color: 'var(--label-1)' }}>
                      {Math.round(displayNutrients[row.key] * 10) / 10}{row.unit}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Group>
        </>
      )}

      {/* Safer alternatives (low score) or Similar products (everything
          else) -- moved below the point where the user has already seen
          why this product scored what it did (was right under the score
          before), and only when the catalog actually has something in
          the same category to show. No AI call: same category-keyword
          match Category.jsx browses by -- a real, already-verified
          product either way, never something a model guessed at. Keeps
          the Result page from dead-ending after a good score instead of
          only ever nudging away from a bad one. Skipped for infant
          formula -- suggesting a "safer"/"similar" swap implies a
          winner/loser comparison between regulated infant-nutrition
          products, exactly the kind of general-food judgment this
          category is deliberately kept out of. */}
      {/* "What this adds up to" -- one line until tapped ("≈ 4.3 teaspoons
          of added sugar in one 57g pack"); open, the quick health check
          (its share of a day's limit) and the week/month/year picture.
          Pure quantity from the label, never a claim about anyone's body. */}
      {view === 'overview' && addsSummary && (
        <>
          <SectionHeader>🥄 {t('addsUpTitle')}</SectionHeader>
          <Group>
            <button
              onClick={() => setAddsOpen((open) => !open)}
              aria-expanded={addsOpen}
              className="tap-scale w-full flex items-center gap-3 px-4 py-3.5 text-left"
            >
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-bold leading-snug" style={{ color: 'var(--label-1)' }}>{addsSummary.line}</span>
                {addsSummary.also && (
                  <span className="block text-[12.5px] mt-0.5" style={{ color: 'var(--label-2)' }}>{addsSummary.also}</span>
                )}
              </span>
              <span className="flex-shrink-0 flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: 'var(--tint)' }}>
                {addsOpen ? t('addsHide') : t('addsShowMore')}
                <svg viewBox="0 0 12 8" className={`w-3 h-2 transition-transform ${addsOpen ? 'rotate-180' : ''}`} fill="none" aria-hidden="true">
                  <path d="M1 1.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            {addsOpen && (
              <div className="page-in" style={{ borderTop: '1px solid var(--separator)' }}>
                {habitDisplay && (
                  <div className="px-4 pt-3.5 pb-1">
                    <p className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--label-3)' }}>⚡ {t('quickHealthCheck')}</p>
                    {habitDisplay.isEnergyRelative ? (
                      // No personalised %: WHO's real limit for this one is a
                      // share of energy intake, not a flat number -- see
                      // ENERGY_RELATIVE_LIMIT_KEYS.
                      <>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[14px] font-semibold capitalize" style={{ color: 'var(--label-1)' }}>{habitDisplay.nutrientLabel}</span>
                          <span className="text-[14px] font-bold" style={{ color: 'var(--label-1)' }}>{habitDisplay.displayAmount}{habitDisplay.unit}</span>
                        </div>
                        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--label-3)' }}>{habitDisplay.whoGuidance}</p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[14px] font-semibold capitalize" style={{ color: 'var(--label-1)' }}>{habitDisplay.nutrientLabel}</span>
                          <span className="text-[14px] font-bold" style={{ color: habitDisplay.percent >= 50 ? 'var(--v-poor)' : 'var(--v-moderate)' }}>{habitDisplay.percent}%</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--fill)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.min(100, habitDisplay.percent)}%`, background: habitDisplay.percent >= 50 ? 'var(--v-poor)' : 'var(--v-moderate)' }}
                          />
                        </div>
                      </>
                    )}
                    <button onClick={() => setShowHabitModal(true)} className="tap-scale text-[13px] font-semibold mt-2" style={{ color: 'var(--tint)' }}>
                      {t('habitSeeMore')} →
                    </button>
                  </div>
                )}
                {nutrientProjection && (
                  <NutrientAddsUp
                    projection={nutrientProjection}
                    t={t}
                    onShowAlternatives={!result.isInfantFormula && rankedAlternatives.length > 0 ? scrollToAlternatives : null}
                  />
                )}
              </div>
            )}
          </Group>
        </>
      )}

      {/* Summary */}
      {view === 'overview' && displaySummary && (
        <>
          <SectionHeader>{t('sectionSummary')}</SectionHeader>
          <Group>
            <div className="flex gap-3 items-start px-4 py-3.5">
              <span
                className="w-9 h-9 rounded-[10px] flex-shrink-0 flex items-center justify-center text-[16px]"
                style={{ background: 'var(--tint-bg)' }}
              >
                📄
              </span>
              <div className="min-w-0 pt-1">
                <p
                  className={`text-[15px] leading-relaxed ${!summaryExpanded && displaySummary.length > 100 ? 'line-clamp-2' : ''}`}
                  style={{ color: 'var(--label-1)' }}
                >
                  {displaySummary}
                </p>
                {displaySummary.length > 100 && (
                  <button
                    onClick={() => setSummaryExpanded((v) => !v)}
                    className="tap-scale text-[13px] font-semibold mt-1"
                    style={{ color: 'var(--tint)' }}
                  >
                    {summaryExpanded ? t('readLess') : t('readMore')}
                  </button>
                )}
              </div>
            </div>
          </Group>
        </>
      )}

      {view === 'overview' && !result.isInfantFormula && rankedAlternatives.length > 0 && (
        <>
          <div id="alternatives-section" style={{ scrollMarginTop: 72 }} />
          <SectionHeader>
            {activeProfile
              ? t('betterOptionsFor', { name: activeProfile.nickname })
              : (result.overallScore || 0) < 65
                ? t('saferAlternatives')
                : t('similarProducts')}
          </SectionHeader>
          <div className="flex gap-3 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
            {rankedAlternatives.map((item) => (
              <ProductStripCard
                key={item.lookupKey}
                item={item}
                onClick={() => openAlternative(item)}
                savingsText={(savingsByKey[item.lookupKey] || []).slice(0, 2).map((s) => t(`swapChip_${s.key}`, { grams: s.grams })).join(' · ') || null}
              />
            ))}
          </div>
          {/* The one best swap, spelled out -- the first (best-ranked)
              alternative that scores higher AND is meaningfully lower in
              something, per 100g. A concrete "do this instead", not just
              a row of thumbnails. */}
          {bestSwap && (
            <button
              onClick={() => openAlternative(bestSwap.item)}
              className="tap-scale mx-4 mt-3 w-[calc(100%-2rem)] rounded-2xl px-3.5 py-3 flex items-start gap-2.5 text-left"
              style={{ background: 'var(--v-good-bg)' }}
            >
              <span className="text-[16px] flex-shrink-0" aria-hidden="true">🔁</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold leading-snug" style={{ color: 'var(--label-1)' }}>
                  {t('swapTo', { name: bestSwap.item.productName })} ›
                </span>
                <span className="block text-[12.5px] leading-snug mt-0.5" style={{ color: 'var(--label-2)' }}>
                  {t('swapScores', { alt: bestSwap.item.score, current: result.overallScore })}{' '}
                  {t('swapPer100', { unit: bestSwap.unit, list: bestSwap.list })}
                </span>
              </span>
            </button>
          )}
        </>
      )}

      {/* Related reading -- news/research whose title mentions this
          product's brand or one of its flagged ingredients specifically,
          so it only shows up when there's something genuinely on-topic
          to read, not for every product. */}
      {view === 'overview' && relatedNews.length > 0 && (
        <>
          <SectionHeader>{t('sectionRelatedReading')}</SectionHeader>
          <div className="mx-4">
            {relatedNews.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {/* Ingredients */}
      {view === 'ingredients' && (
        <>
          {/* Label X-Ray -- the raw label as printed, each analysed
              ingredient lit up in its severity colour; tap to jump to
              its card. Replaces the old plain "As read from label" text. */}
          {result.ingredientsText && ingredients.length > 0 && (
            <>
              <SectionHeader>🔬 {t('xrayTitle')}</SectionHeader>
              <Group>
                <LabelXray
                  text={result.ingredientsText}
                  ingredients={ingredients}
                  tierOf={(ing) => tiers.find((tier) => tier.key === severityOf(ing))}
                  t={t}
                  onPick={jumpToIngredient}
                />
              </Group>
              <p className="px-5 pt-2 text-[12px] leading-relaxed" style={{ color: 'var(--label-3)' }}>
                {t('compareLabelNote')}
              </p>
            </>
          )}

          {/* Filter chips -- "All" plus every severity tier that actually
              has members, each carrying its own count. Replaces the old
              per-tier header sections: severity is now shown on every
              row's own pill (see IngredientCard), so these chips only
              need to filter, not also explain the grouping below. */}
          <div id="ingredient-list" className="flex gap-2 overflow-x-auto px-4 pt-4 pb-1" style={{ scrollbarWidth: 'none', scrollMarginTop: 76 }}>
            <button
              onClick={() => setFilter('all')}
              className="tap-scale flex-shrink-0 px-3 py-1.5 rounded-full text-[13px] font-semibold"
              style={{
                background: filter === 'all' ? 'var(--label-1)' : 'var(--fill)',
                color: filter === 'all' ? 'var(--bg-card)' : 'var(--label-1)',
              }}
            >
              {t('filterAll')} {ingredients.length}
            </button>
            {tiers.filter((tier) => tier.count > 0).map((tier) => {
              const active = filter === tier.key;
              return (
                <button
                  key={tier.key}
                  onClick={() => setFilter(tier.key)}
                  className="tap-scale flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold"
                  style={{
                    background: active ? tier.color : tier.bg,
                    color: active ? '#fff' : tier.color,
                  }}
                >
                  <span>{tier.icon}</span> {tier.label} {tier.count}
                </button>
              );
            })}
          </div>

          {/* One-time context for why the list is ordered the way it is
              -- FSSAI (like most label laws) requires descending order
              by quantity, so the first few rows are usually also the
              biggest share of the product, not a ranking of concern. */}
          <div className="mx-4 mt-3 rounded-2xl px-3.5 py-2.5 flex items-start gap-2.5" style={{ background: 'var(--fill)' }}>
            <span className="text-[15px] flex-shrink-0" aria-hidden="true">🌿</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--label-2)' }}>
                {showLabelOrderInfo ? t('labelOrderInfoLong') : t('labelOrderInfoShort')}
              </p>
              <button onClick={() => setShowLabelOrderInfo((v) => !v)} className="tap-scale text-[11.5px] font-semibold mt-1" style={{ color: 'var(--tint)' }}>
                {showLabelOrderInfo ? t('showLess') : `${t('learnMore')} ›`}
              </button>
            </div>
          </div>

          {filteredIngredients.length === 0 ? (
            <Group className="mt-3">
              <p className="px-4 py-4 text-[15px] text-center" style={{ color: 'var(--label-2)' }}>
                {t('noneInCategory')}
              </p>
            </Group>
          ) : (
            <Group className="mt-3">
              {(filter === 'all' ? sortedIngredients : filteredIngredients).map((ingredient, i) => (
                <IngredientCard
                  key={i}
                  id={`ingredient-card-${ingredients.indexOf(ingredient)}`}
                  ingredient={ingredient}
                  severityLabel={tiers.find((tier) => tier.key === severityOf(ingredient))?.label}
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                />
              ))}
            </Group>
          )}

        </>
      )}

      {/* Story -- history/legacy, why it's used, controversy, myth vs
          fact. Only ever rendered when the AI had genuine, specific
          things to say (see geminiService.js's "story" rules) -- never
          fabricated filler for an unfamiliar generic product, which is
          also why the tab itself only appears when this exists. */}
      {/* Swipeable cards (StoryCards.jsx) -- same story text, one idea per card. */}
      {view === 'story' && displayStory && <StoryCards story={displayStory} t={t} />}

      {/* Make it personal -- after the report, for someone with no family
          profiles yet (with profiles, the chips sit under the score). */}
      {!result.isInfantFormula && profiles.length === 0 && (
        <div className="mx-4 mt-6 rounded-[14px] px-4 py-3.5 flex items-center gap-3" style={{ background: 'var(--bg-card)' }}>
          <span className="text-[22px] flex-shrink-0">👪</span>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-bold" style={{ color: 'var(--label-1)' }}>
              {t('personalMakeItPersonalTitle')}
            </p>
            <p className="text-[12.5px]" style={{ color: 'var(--label-2)' }}>
              {t('personalMakeItPersonalBody')}
            </p>
          </div>
          <Link to="/family" className="tap-scale text-[13px] font-semibold flex-shrink-0" style={{ color: 'var(--tint)' }}>
            {t('familyCreateProfile')}
          </Link>
        </div>
      )}

      {/* Verification + disclaimer, and the estimated-quantities note with them */}
      <div className="px-5 pt-8 text-center">
        {result.hasEstimatedQuantities && (
          <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--label-3)' }}>
            {t('estimatedQtyNote')}
          </p>
        )}
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--label-3)' }}>
          {t('crossChecked')}
        </p>
        <p className="text-[12px] leading-relaxed mt-2" style={{ color: 'var(--label-3)' }}>
          {t('disclaimer')}
        </p>
        <p className="text-[12px] mt-2" style={{ color: 'var(--label-3)' }}>
          {reportId} · {savedDate}
        </p>
        {/* Deliberately plain and low-key down here rather than a
            prominent button up top: this should be findable when a
            result genuinely looks wrong, without inviting a tap on
            every single report. */}
        <button
          onClick={openFlagModal}
          className="tap-scale text-[12.5px] font-semibold mt-3 underline underline-offset-2"
          style={{ color: 'var(--label-2)' }}
        >
          {t('flagReportIssue')}
        </button>
      </div>

      <div className="px-4 pt-6">
        <button
          onClick={() => navigate('/')}
          className="tap-scale w-full py-3.5 rounded-[14px] text-[17px] font-semibold text-white"
          style={{ background: 'var(--tint)' }}
        >
          {t('scanAnother')}
        </button>
      </div>

      {/* "Why did this score X?" -- a quick explainer, not a second
          Ingredients tab: just the top few things that actually pulled
          the score down (worst tier first), each one tap from more
          detail, plus a one-glance "how scoring works" visual. No
          per-ingredient point values and no mention of the
          harmful/concerning score cap (scoringEngine.js's squeezeToCap)
          -- the scoring system itself is unchanged, this is purely how
          it's explained. "Fine" ingredients are deliberately absent:
          this popup answers "why isn't it higher", not "what's okay". */}
      {showShare && (
        <ShareSheet
          text={shareText}
          link={shareReportId ? productShareUrl(shareReportId) : null}
          imageBlob={shareImageBlob}
          onClose={() => setShowShare(false)}
          t={t}
        />
      )}

      {showScoreModal && (() => {
        const toggleRow = (key) => {
          setExpandedBreakdownRows((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        };

        const STEPS = [
          { icon: '🧪', bg: 'var(--tint-bg)', titleKey: 'scoreModalStep1Title' },
          { icon: '⚙️', bg: 'var(--v-moderate-bg)', titleKey: 'scoreModalStep2Title' },
          { icon: '⭐', bg: 'var(--v-good-bg)', titleKey: 'scoreModalStep3Title' },
        ];

        const visibleFactors = showAllFactors ? mainFactors : mainFactors.slice(0, MAIN_FACTORS_LIMIT);
        const hiddenCount = mainFactors.length - visibleFactors.length;

        return createPortal(
          <div
            className="fixed inset-0 z-[999] bg-black/50 flex items-end sm:items-center justify-center"
            onClick={() => setShowScoreModal(false)}
          >
            <div
              className="relative w-full sm:max-w-[480px] max-h-[85vh] overflow-y-auto rounded-t-[24px] sm:rounded-[20px] p-5"
              style={{ background: 'var(--bg-card)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowScoreModal(false)}
                aria-label="Close"
                className="tap-scale absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-[18px]"
                style={{ background: 'var(--fill)', color: 'var(--label-2)' }}
              >
                ×
              </button>

              <p className="text-[19px] font-bold pr-8 mb-3" style={{ color: 'var(--label-1)' }}>
                {t('scoreBreakdownTitle', { score })}
              </p>

              {/* Score circle + verdict pill on the left, the same AI
                  recommendation already shown in the score hero on the
                  right -- reused, not new text. Answers "what does this
                  score mean?" */}
              <div className="flex items-center gap-4 mb-4">
                <ScoreCircle score={score} size="large" showLabel />
                {displayRecommendation && (
                  <div className="flex-1 min-w-0 rounded-[14px] p-3" style={{ background: scoreColors.bg }}>
                    <p className="text-[12.5px] font-bold mb-0.5" style={{ color: scoreColors.color }}>
                      {t('scoreBreakdownWhatDoesThisMean')}
                    </p>
                    <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
                      {displayRecommendation}
                    </p>
                  </div>
                )}
              </div>

              <p className="text-[15px] font-bold" style={{ color: 'var(--label-1)' }}>
                {t('scoreModalWhatInfluenced')}
              </p>
              <p className="text-[12px] mb-3" style={{ color: 'var(--label-3)' }}>
                {t('scoreModalWhatInfluencedSubtitle')}
              </p>

              {/* A flat, ranked list -- worst tier first -- instead of
                  one big card per tier. Each row carries its own small
                  tier badge, so "Harmful"/"Concerning"/"Highly processed"
                  are still visible without needing a full section per
                  tier. Capped at MAIN_FACTORS_LIMIT with a "+N other
                  factors" reveal so this stays a quick explainer. */}
              {mainFactors.length === 0 ? (
                <div className="rounded-[14px] p-3 mb-4" style={{ background: 'var(--v-good-bg)' }}>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
                    {t('scoreModalNoFactors')}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 mb-2">
                  {visibleFactors.map((factor, i) => {
                    const ing = factor.ingredient;
                    const tier = factor.tier;
                    const rowKey = `main-${i}`;
                    const expanded = expandedBreakdownRows.has(rowKey);
                    const evidenceLine = evidenceLineText(ing, t);
                    const hasDetail = Boolean(ing.reason || ing.healthEffects || evidenceLine);
                    return (
                      <div key={rowKey} className="rounded-[12px] p-2.5" style={{ background: 'var(--fill)' }}>
                        <button
                          onClick={() => hasDetail && toggleRow(rowKey)}
                          className="w-full flex items-center gap-2.5 text-left"
                          disabled={!hasDetail}
                        >
                          <span
                            className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[14px]"
                            style={{ background: tier.bg }}
                          >
                            {categoryIcon(ing.category)}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13.5px] font-semibold truncate" style={{ color: 'var(--label-1)' }}>
                              {ing.name}
                            </span>
                            <span className="flex items-baseline gap-1 min-w-0">
                              <span className="text-[10.5px] font-bold flex-shrink-0" style={{ color: tier.color }}>
                                {tier.label}
                              </span>
                              {ing.reason && (
                                <span className="text-[11.5px] truncate" style={{ color: 'var(--label-2)' }}>
                                  · {ing.reason}
                                </span>
                              )}
                            </span>
                          </span>
                          {hasDetail && (
                            <svg
                              viewBox="0 0 8 13"
                              fill="none"
                              className={`w-2 h-3 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                              style={{ color: 'var(--label-3)' }}
                            >
                              <path d="M1.5 1.5L6.5 6.5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </button>
                        {expanded && (
                          <div className="pl-[42px] mt-1.5 space-y-1.5">
                            {ing.reason && (
                              <div>
                                <p className="text-[10.5px] font-semibold" style={{ color: 'var(--label-3)' }}>{t('scoreModalWhyFlagged')}</p>
                                <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--label-2)' }}>{ing.reason}</p>
                              </div>
                            )}
                            {ing.healthEffects && (
                              <div>
                                <p className="text-[10.5px] font-semibold" style={{ color: 'var(--label-3)' }}>{t('healthEffectsLabel')}</p>
                                <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--label-2)' }}>{ing.healthEffects}</p>
                              </div>
                            )}
                            {evidenceLine && (
                              <div>
                                <p className="text-[10.5px] font-semibold" style={{ color: 'var(--label-3)' }}>{t('evidenceLabel')}</p>
                                <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--label-2)' }}>{evidenceLine}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowAllFactors(true)}
                  className="tap-scale w-full text-center py-2 mb-4 text-[12.5px] font-semibold"
                  style={{ color: 'var(--tint)' }}
                >
                  {t('scoreModalOtherFactors', { count: hiddenCount })}
                </button>
              )}
              {mainFactors.length > 0 && hiddenCount === 0 && <div className="mb-4" />}

              {/* Tiny, generic, truthful mental model -- no numbers, no
                  mention of a cap, just one icon row plus one sentence. */}
              <div className="rounded-[16px] p-3 mb-4" style={{ background: 'var(--fill)' }}>
                <p className="text-[13px] font-bold mb-2 text-center" style={{ color: 'var(--label-1)' }}>
                  {t('scoreModalHowItWorks')}
                </p>
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  {STEPS.map((step, i) => (
                    <div key={step.titleKey} className="flex items-center">
                      <div className="flex flex-col items-center">
                        <span
                          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[14px] mb-1"
                          style={{ background: step.bg }}
                        >
                          {step.icon}
                        </span>
                        <p className="text-[9.5px] font-semibold leading-snug whitespace-nowrap" style={{ color: 'var(--label-2)' }}>
                          {t(step.titleKey)}
                        </p>
                      </div>
                      {i < STEPS.length - 1 && (
                        <span className="text-[13px] flex-shrink-0 px-1 pb-3" style={{ color: 'var(--label-3)' }}>→</span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11.5px] leading-relaxed text-center" style={{ color: 'var(--label-2)' }}>
                  {t('scoreModalHowItWorksIntro')}
                </p>
              </div>

              <button
                onClick={() => setShowScoreModal(false)}
                className="tap-scale w-full py-3 rounded-[12px] text-[15px] font-semibold text-white"
                style={{ background: 'var(--tint)' }}
              >
                {t('gotIt')}
              </button>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Full "if this became a daily habit" breakdown -- opened by the
          "Quick health check" progress bar above, further down the
          page. A modal rather than its own route/URL: this is
          supplementary detail about the product already on screen, not
          content that needs its own deep link. */}
      {/* Report an issue -- what someone saw is captured alongside what
          they typed (see productFlags.js), since the product gets
          re-analyzed the moment anything here is acted on. */}
      {showLogModal && (
        <LogPortionModal
          report={result}
          onClose={() => setShowLogModal(false)}
          onLogged={() => navigate('/my-intake')}
        />
      )}

      {showFlagModal && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-end sm:items-center justify-center"
          onClick={() => setShowFlagModal(false)}
        >
          <div
            className="relative w-full sm:max-w-[480px] max-h-[85vh] overflow-y-auto rounded-t-[24px] sm:rounded-[20px] p-5"
            style={{ background: 'var(--bg-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowFlagModal(false)}
              aria-label="Close"
              className="tap-scale absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-[18px]"
              style={{ background: 'var(--fill)', color: 'var(--label-2)' }}
            >
              ×
            </button>

            {flagState === 'sent' ? (
              <div className="py-4 text-center">
                <p className="text-[34px] leading-none mb-2">✅</p>
                <p className="text-[17px] font-bold mb-1" style={{ color: 'var(--label-1)' }}>
                  {t('flagThanksTitle')}
                </p>
                <p className="text-[14px] leading-relaxed" style={{ color: 'var(--label-2)' }}>
                  {t('flagThanksBody')}
                </p>
                <button
                  onClick={() => setShowFlagModal(false)}
                  className="tap-scale w-full mt-5 py-3 rounded-[14px] text-[16px] font-semibold text-white"
                  style={{ background: 'var(--tint)' }}
                >
                  {t('gotIt')}
                </button>
              </div>
            ) : (
              <>
                <p className="text-[17px] font-bold pr-8 mb-1" style={{ color: 'var(--label-1)' }}>
                  {t('flagTitle')}
                </p>
                <p className="text-[13.5px] leading-relaxed mb-4" style={{ color: 'var(--label-2)' }}>
                  {t('flagSubtitle')}
                </p>

                <div className="space-y-2 mb-4">
                  {FLAG_REASONS.map((r) => {
                    const picked = flagReason === r.key;
                    return (
                      <button
                        key={r.key}
                        onClick={() => setFlagReason(r.key)}
                        className="tap-scale w-full text-left px-3.5 py-3 rounded-[12px] text-[14px] font-semibold flex items-center gap-2.5"
                        style={{
                          background: picked ? 'var(--tint)' : 'var(--fill)',
                          color: picked ? '#fff' : 'var(--label-1)',
                        }}
                      >
                        <span
                          className="w-[18px] h-[18px] rounded-full flex-shrink-0 flex items-center justify-center text-[11px]"
                          style={{
                            border: `2px solid ${picked ? 'rgba(255,255,255,0.9)' : 'var(--label-3)'}`,
                            color: '#fff',
                          }}
                        >
                          {picked ? '✓' : ''}
                        </span>
                        {r.label}
                      </button>
                    );
                  })}
                </div>

                <textarea
                  value={flagRemarks}
                  onChange={(e) => setFlagRemarks(e.target.value)}
                  placeholder={t('flagRemarksPlaceholder')}
                  rows={4}
                  className="w-full rounded-[12px] p-3 text-[14px] leading-relaxed resize-none focus:outline-none"
                  style={{ background: 'var(--fill)', color: 'var(--label-1)' }}
                />

                {flagState === 'error' && (
                  <p className="text-[13px] mt-2" style={{ color: 'var(--v-poor)' }}>
                    {flagError}
                  </p>
                )}

                <button
                  onClick={sendFlag}
                  disabled={!flagReason || flagState === 'sending'}
                  className="tap-scale w-full mt-4 py-3.5 rounded-[14px] text-[16px] font-semibold text-white disabled:opacity-40"
                  style={{ background: 'var(--tint)' }}
                >
                  {flagState === 'sending' ? t('flagSending') : t('flagSubmit')}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {showHabitModal && habitDisplay && createPortal(
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-end sm:items-center justify-center"
          onClick={() => setShowHabitModal(false)}
        >
          <div
            className="relative w-full sm:max-w-[480px] max-h-[85vh] overflow-y-auto rounded-t-[24px] sm:rounded-[20px] p-5"
            style={{ background: 'var(--bg-card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowHabitModal(false)}
              aria-label="Close"
              className="tap-scale absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-[18px]"
              style={{ background: 'var(--fill)', color: 'var(--label-2)' }}
            >
              ×
            </button>

            <p className="text-[17px] font-bold pr-8 mb-3" style={{ color: 'var(--label-1)' }}>
              {t('habitTitle')}
            </p>
            <p className="text-[14px] leading-relaxed mb-3" style={{ color: 'var(--label-2)' }}>
              {t('habitIntro')}
            </p>

            <div className="rounded-[12px] p-3.5 space-y-1 mb-3" style={{ background: 'var(--fill)' }}>
              <p className="text-[12px] font-semibold mb-1" style={{ color: 'var(--label-2)' }}>
                📊 {t('habitMathHeader')}
              </p>
              <p className="text-[14px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
                {t('habitMathLine1', {
                  servingText: habitDisplay.servingText,
                  amount: habitDisplay.displayAmount,
                  unit: habitDisplay.unit,
                  nutrient: habitDisplay.nutrientLabel,
                })}
              </p>
              {habitDisplay.isEnergyRelative ? (
                // No line 3 here on purpose: unlike sodium's flat limit,
                // there's no honest "% of your entire day" figure to give
                // without knowing the person's actual energy intake --
                // see ENERGY_RELATIVE_LIMIT_KEYS.
                <p className="text-[14px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
                  {habitDisplay.whoGuidance}
                </p>
              ) : (
                <>
                  <p className="text-[14px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
                    {t('habitMathLine2', { limit: habitDisplay.limit, unit: habitDisplay.unit })}
                  </p>
                  <p className="text-[14px] font-semibold leading-relaxed pt-1" style={{ color: 'var(--v-poor)' }}>
                    → {t('habitMathLine3', { percent: habitDisplay.percent })}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-3">
              {[
                { icon: '📅', titleKey: 'habitShortTermTitle', textKey: `${habitDisplay.prefix}Short` },
                { icon: '📈', titleKey: 'habitMediumTermTitle', textKey: `${habitDisplay.prefix}Medium` },
                { icon: '❤️', titleKey: 'habitLongTermTitle', textKey: `${habitDisplay.prefix}Long` },
              ].map(({ icon, titleKey, textKey }) => (
                <div key={titleKey}>
                  <p className="text-[13px] font-semibold mb-0.5" style={{ color: 'var(--label-2)' }}>
                    {icon} {t(titleKey)}
                  </p>
                  <p className="text-[14px] leading-relaxed" style={{ color: 'var(--label-1)' }}>
                    {t(textKey)}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-[12px] leading-relaxed italic mt-3" style={{ color: 'var(--label-3)' }}>
              {t('habitDisclaimer')}
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
