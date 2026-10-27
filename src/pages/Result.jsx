// src/pages/Result.jsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { getHistoryById, updateHistoryProductName, refreshHistoryEntry, saveToHistory, getScoreColor, getIngredientSeverity } from '../utils/storage';
import { getCachedReport, getSaferAlternatives, getSimilarProducts, saveReport, getReportIdByLookupKey, CATEGORY_POOL_SIZE } from '../services/productCache';
import { buildProductShareText, productShareUrl } from '../utils/share';
import ShareSheet from '../components/ShareSheet';
import SugarJourney from '../components/body/SugarJourney';
import SugarFilm from '../components/body/SugarFilm';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import { renderShareCardImage } from '../utils/shareCard';
import headerIcon from '../assets/header-icon.png';
import { analyzeText } from '../services/analyzeText';
import { lookupBarcode } from '../services/openFoodFacts';
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
import ClaimCheckCard from '../components/ClaimCheckCard';
import { checkClaims } from '../services/claimCheck';
import { nutritionIssues } from '../services/dataHealth';
import { nutritionRemark } from '../utils/nutritionRemarks';
import { buildTrafficLight } from '../services/trafficLight';
import { swapSavings } from '../services/swapSavings';
import StoryCards from '../components/StoryCards';
import { keyReasons } from '../utils/reportReasons';

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
// The whole category pool (productCache.js CATEGORY_POOL_SIZE, 30 top scorers, fetched
// once per category and kept for 10 minutes): a pool bigger than the 3 shown lets a
// personal ranking reorder real candidates, and the 'swap and save' pick
// (swapSavings.js) needs more than the top few -- like-for-like swaps are rare there.
const ALTERNATIVES_POOL_SIZE = CATEGORY_POOL_SIZE;

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

// One reason under the score ("High salt", "Palmolein", "Low sugar"), in the
// colour of what it says, so the first screen reads at a glance.
const REASON_LOOK = {
  bad: { color: 'var(--v-very-poor)', bg: 'var(--v-very-poor-bg)', mark: '▲' },
  warn: { color: 'var(--v-poor)', bg: 'var(--v-poor-bg)', mark: '!' },
  good: { color: 'var(--v-good)', bg: 'var(--v-good-bg)', mark: '✓' },
};

function ReasonChip({ tone, children }) {
  const look = REASON_LOOK[tone];
  return (
    <span className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full text-[12.5px] font-semibold" style={{ background: look.bg, color: look.color }}>
      <span className="text-[10px]" aria-hidden="true">{look.mark}</span>
      <span className="truncate">{children}</span>
    </span>
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
  // One scroll, no tabs: the full ingredient list, the nutrition table and the
  // story each open on a tap.
  const [showAllIngredients, setShowAllIngredients] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameSuggested, setNameSuggested] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [alternatives, setAlternatives] = useState([]);
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
  // The "what happens in your body" story open, with this product's numbers.
  const [bodyStory, setBodyStory] = useState(null);
  const [film, setFilm] = useState(null);
  // "What this adds up to": week/month/year tiles and the rest on a tap.
  const [addsOpen, setAddsOpen] = useState(false);
  // "Refresh analysis" re-runs the AI on the label -- an admin tool, so only
  // shown to a signed-in admin session (the admin panel's own login).
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setIsAdmin(Boolean(data?.session))).catch(() => {});
  }, []);

  // The mini bar (product + score) shows once the score card has scrolled
  // up under the app's sticky header.
  const scoreEndRef = useRef(null);
  const [showMiniBar, setShowMiniBar] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = scoreEndRef.current;
    if (!el) return undefined;
    const h = document.querySelector('header')?.offsetHeight || 0;
    setHeaderHeight(h);
    const observer = new IntersectionObserver(([entry]) => {
      setShowMiniBar(!entry.isIntersecting && entry.boundingClientRect.top < h);
    }, { rootMargin: `-${h}px 0px 0px 0px` });
    observer.observe(el);
    return () => observer.disconnect();
  }, [result]);

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
  // Claims in the name ("Sugar Free") checked against the saved nutrition table
  // and ingredient list -- plain arithmetic on what the report already holds.
  const claimUnit = result.foodType === 'beverage' || result.realNutrientsServingUnit === 'ml' ? 'ml' : 'g';
  // Nutrition figures that can't all be right ("saturated fat more than total
  // fat"): the traffic lights, claim check and adds-up card are paused and a note
  // says why. Worked out from the report every time, never stored -- once the
  // figures are corrected the note and the pause go away on their own.
  const nutritionReview = result.nutrientsPer100 ? nutritionIssues({
    n: result.nutrientsPer100,
    ingredientsText: result.ingredientsText || (result.ingredients || []).map((i) => i.name).join(', '),
  }) : [];
  const nutritionPaused = nutritionReview.length > 0;
  const claimChecks = checkClaims({
    productName: result.productName,
    brand: result.brand,
    nutrientsPer100: result.nutrientsPer100,
    ingredients: result.ingredients,
    isDrink: claimUnit === 'ml',
    isInfantFormula: result.isInfantFormula,
  });
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
  // Nothing to compare when this product's own figures are under review: "80 g less
  // saturated fat" would be worked out from the very number that's wrong.
  const savingsByKey = Object.fromEntries(alternatives.map((item) => [item.lookupKey, nutritionPaused ? [] : swapSavings(result, item)]));
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
  const trafficLight = nutritionPaused ? null : buildTrafficLight(result);
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

  // The quick health check (dailyHabitCheck): one serving's share of a
  // day's limit as a bar -- or, for a limit set as a share of energy, the
  // amount and WHO's guidance -- with the link to the full breakdown.
  const habitRow = habitDisplay && (
    <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--fill)' }}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[13px] font-semibold capitalize" style={{ color: 'var(--label-1)' }}>
          ⚡ {t('quickHealthCheck')} · {habitDisplay.nutrientLabel}
        </span>
        <span className="text-[13.5px] font-bold tabular-nums" style={{ color: habitDisplay.isEnergyRelative ? 'var(--label-1)' : habitDisplay.percent >= 50 ? 'var(--v-poor)' : 'var(--v-moderate)' }}>
          {habitDisplay.isEnergyRelative ? `${habitDisplay.displayAmount}${habitDisplay.unit}` : `${habitDisplay.percent}%`}
        </span>
      </div>
      {!habitDisplay.isEnergyRelative && (
        <div className="h-2 rounded-full overflow-hidden mb-1.5" style={{ background: 'var(--bg-card)' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, habitDisplay.percent)}%`, background: habitDisplay.percent >= 50 ? 'var(--v-poor)' : 'var(--v-moderate)' }} />
        </div>
      )}
      <p className="text-[12px] leading-snug" style={{ color: 'var(--label-2)' }}>
        {habitDisplay.isEnergyRelative
          ? habitDisplay.whoGuidance
          : t('habitBarCaption', { percent: habitDisplay.percent, nutrient: habitDisplay.nutrientLabel, servingText: habitDisplay.servingText })}
      </p>
      <button onClick={() => setShowHabitModal(true)} className="tap-scale text-[12.5px] font-semibold mt-1.5" style={{ color: 'var(--tint)' }}>
        {t('habitSeeMore')} →
      </button>
    </div>
  );

  // The reasons under the score, from the traffic lights and the flagged
  // ingredients (reportReasons.js). None for infant formula, which has no score.
  const reasons = result.isInfantFormula ? [] : keyReasons(trafficLight, mainFactors, { ingredientCount: ingredients.length });
  const reasonText = (r) => (r.key === 'ingredient' ? r.name : t(`reason_${r.key}`));
  // Opens the full ingredient list and brings it into view.
  const openAllIngredients = () => {
    setFilter('all');
    setShowAllIngredients(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById('ingredient-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  };

  return (
    <div className="page-in max-w-[560px] mx-auto pb-24" style={{ background: 'var(--bg-grouped)' }}>
      {burst && <ResultBurst id={id} score={score} handoff={burst.handoff} onDone={() => setBurst(null)} />}

      {/* Header, compact: back, the pack, then brand · pack size over the
          name -- one row instead of a back row, a centred photo and a chip.
          The pack size (not a "Packaged Food" label every product here would
          share) tells two sizes of one product apart. */}
      <div className="flex items-start gap-3 pl-2 pr-4 pt-3 pb-4">
        <button
          onClick={() => navigate('/')}
          aria-label={t('backToScan')}
          className="tap-scale flex-shrink-0 w-9 h-9 mt-0.5 rounded-full flex items-center justify-center"
          style={{ color: 'var(--tint)' }}
        >
          <svg viewBox="0 0 12 20" fill="none" className="w-3 h-5" aria-hidden="true">
            <path d="M10 2L2 10l8 8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {result.imageUrl && (
          <div className="flex-shrink-0 rounded-[16px] p-1.5" style={{ background: 'var(--bg-card)', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}>
            <ProductImage src={result.imageUrl} size={80} />
          </div>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          {!editingName && (result.brand || result.packSize?.trim()) && (
            <p className="text-[12.5px] font-semibold mb-0.5 truncate" style={{ color: 'var(--label-2)' }}>
              {result.brand ? result.brand.toUpperCase() : ''}
              {result.brand && result.packSize?.trim() ? ' · ' : ''}
              {result.packSize?.trim() ? `📦 ${result.packSize.trim()}` : ''}
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
                className="flex-1 min-w-0 text-[19px] font-bold tracking-tight bg-transparent border-b-2 focus:outline-none"
                style={{ color: 'var(--label-1)', borderColor: 'var(--tint)' }}
              />
              <button onClick={saveName} className="text-[16px]" style={{ color: 'var(--tint)' }} aria-label="Save name">{t('done')}</button>
            </div>
          ) : (
            <h1 className="text-[19px] leading-[1.25] font-bold tracking-tight" style={{ color: 'var(--label-1)' }}>
              <span className="break-words">{result.productName || 'Unknown Product'}</span>
              <button
                onClick={startEditingName}
                className="tap-scale inline-flex align-middle ml-1.5 w-6 h-6 -mt-0.5 rounded-full items-center justify-center"
                style={{ color: 'var(--label-3)' }}
                aria-label={t('edit')}
                title={t('edit')}
              >
                <svg viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" />
                </svg>
              </button>
            </h1>
          )}

          {nameSuggested && !editingName && (
            <p className="text-[12px] mt-1" style={{ color: 'var(--label-3)' }}>{t('nameSuggestedNote')}</p>
          )}
          {result.productName === 'Unknown Product' && !editingName && (
            <p className="text-[12.5px] mt-1" style={{ color: 'var(--v-poor)' }}>{t('unknownProductHint')}</p>
          )}
        </div>
      </div>

      {/* Once the score card has scrolled away: a slim bar under the app
          header with the product and its score, so a long report never
          loses which product it's about. */}
      {showMiniBar && (
        <div className="fixed left-0 right-0 z-30 page-in" style={{ top: headerHeight }}>
          <div className="max-w-[560px] mx-auto px-4 py-2 flex items-center gap-2.5" style={{ background: 'var(--bg-grouped)', borderBottom: '1px solid var(--separator)' }}>
            {result.imageUrl && <ProductImage src={result.imageUrl} size={28} />}
            <p className="flex-1 min-w-0 text-[14px] font-semibold truncate" style={{ color: 'var(--label-1)' }}>{result.productName}</p>
            {!result.isInfantFormula && (
              <span className="flex-shrink-0 text-[12.5px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: scoreColors.bg, color: scoreColors.color }}>
                {score} · {verdictLabel}
              </span>
            )}
          </div>
        </div>
      )}

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
            {ingredients.length === 0 ? (
              <p className="text-[15px] mt-0.5" style={{ color: 'var(--label-2)' }}>{t('noIngredientsAnalyzed')}</p>
            ) : (
              <p className="flex items-center gap-1.5 flex-wrap mt-1">
                <span className="text-[13.5px] font-semibold" style={{ color: 'var(--label-2)' }}>🍽️ {t('shouldIEatIt')}</span>
                <span className="text-[15px] font-bold" style={{ color: scoreColors.color }}>{eatAnswer}</span>
              </p>
            )}
            {/* Signed-in admins only, and web only -- not in the Android app. */}
            {result.ingredientsText && isAdmin && !isNativeApp() && (
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

        {/* Why this score, in a few words: what's high, what's flagged and one
            good thing -- before any of the detail further down. */}
        {reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {reasons.map((r) => (
              <ReasonChip key={`${r.key}-${r.name || ''}`} tone={r.tone}>{reasonText(r)}</ReasonChip>
            ))}
          </div>
        )}

        {/* The plain-English recommendation, right under the reasons it rests on. */}
        {displayRecommendation && (
          <p className="text-[13.5px] leading-relaxed mt-3" style={{ color: 'var(--label-1)' }}>
            {displayRecommendation}
          </p>
        )}

        {/* "Why 51?" shares a row with the share button; how the score is
            worked out is linked at the foot of the page. */}
        {ingredients.length > 0 && (
          <div className="flex items-center justify-between gap-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--separator)' }}>
            <button
              onClick={() => setShowScoreModal(true)}
              className="tap-scale text-[13.5px] font-semibold"
              style={{ color: 'var(--tint)' }}
            >
              {t('whyScoreLink', { score })}
            </button>

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

      <div ref={scoreEndRef} aria-hidden="true" />

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

      {/* In short: the two-line summary of what the product is. */}
      {displaySummary && (
        <>
          <SectionHeader>{t('sectionInShort')}</SectionHeader>
          <Group>
            <div className="px-4 py-3.5">
              <div className="min-w-0">
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

      {/* Real nutrition-panel numbers (Open Food Facts / Blinkit only,
          never estimated -- see report.realNutrients in analyzeText.js).
          Plain reference values, distinct from "Quick health check"
          right below it, which turns the SAME numbers into an "if you
          ate this every day" projection -- this section is just what the
          label actually says. */}
      {displayNutrients && (
        <>
          <SectionHeader>{t('sectionNutrition')}</SectionHeader>
          <Group>
            <div className="px-4 py-3.5">
              {/* The traffic lights are per 100g (their own heading, above
                  them); the numbers below are per serving when a real one is
                  known -- so each part says its own basis, split by a rule. */}
              {nutritionPaused && (
                <div className="mb-3 rounded-[12px] px-3.5 py-3" style={{ background: 'var(--fill)', borderLeft: '3px solid var(--v-moderate)' }}>
                  <p className="text-[13.5px] font-semibold" style={{ color: 'var(--label-1)' }}>⚠️ {t('nutritionReviewTitle')}</p>
                  <p className="text-[12.5px] mt-1" style={{ color: 'var(--label-2)' }}>{t('nutritionReviewIntro')}</p>
                  <ul className="mt-1.5 space-y-0.5 list-disc pl-4">
                    {nutritionReview.slice(0, 4).map((issue) => (
                      <li key={`${issue.kind}-${issue.nutrient || ''}`} className="text-[12.5px]" style={{ color: 'var(--label-1)' }}>{nutritionRemark(issue, t, claimUnit)}</li>
                    ))}
                  </ul>
                  <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--label-3)' }}>{t('nutritionReviewOutro')}</p>
                </div>
              )}
              {trafficLight && (
                <NutritionTrafficLight
                  light={trafficLight}
                  t={t}
                  servingGrams={result.realNutrientsServingGrams}
                  servingUnit={result.realNutrientsServingUnit || 'g'}
                />
              )}
              <div className={`flex items-center justify-between gap-3 mb-3${trafficLight ? ' pt-3' : ''}`} style={trafficLight ? { borderTop: '1px solid var(--separator)' } : undefined}>
                {/* With traffic lights above, the full table is a tap away;
                    without them it is all there is, so it shows. */}
                {!trafficLight || tableOpen ? (
                  <p className={trafficLight ? 'text-[12px] font-semibold' : 'text-[12px]'} style={{ color: trafficLight ? 'var(--label-2)' : 'var(--label-3)' }}>
                    {result.realNutrientsServingGrams
                      ? t('nutritionPerServing', { grams: result.realNutrientsServingGrams, unit: result.realNutrientsServingUnit || 'g' })
                      : t('nutritionPer100g')}
                  </p>
                ) : (
                  <button onClick={() => setTableOpen(true)} className="tap-scale text-[13px] font-semibold" style={{ color: 'var(--tint)' }}>
                    {t('nutritionFullTable')} ›
                  </button>
                )}
                {/* Only offered when there's real calorie data to log against
                    -- see canLogIntake in intakeLog.js. No estimation path. */}
                {/* Not while the figures are under review: they'd go into the person's intake log. */}
                {canLogIntake(result) && !nutritionPaused && (
                  <button
                    onClick={() => setShowLogModal(true)}
                    className="tap-scale flex-shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold"
                    style={{ background: 'var(--tint-bg)', color: 'var(--tint)' }}
                  >
                    ＋ Log what I had
                  </button>
                )}
              </div>
              {(!trafficLight || tableOpen) && (
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
              )}
              {trafficLight && tableOpen && (
                <button onClick={() => setTableOpen(false)} className="tap-scale text-[13px] font-semibold mt-3" style={{ color: 'var(--tint)' }}>
                  {t('nutritionHideTable')}
                </button>
              )}
            </div>
            {/* "What this adds up to": the spoons in one serving, the year at the
                chosen frequency and the quick health check, under the label's
                own numbers. Pure quantity from the label, never a claim about
                anyone's body. */}
            {!nutritionPaused && (nutrientProjection || habitDisplay) && (
              <div style={{ borderTop: '1px solid var(--separator)' }}>
                <p className="px-4 pt-3.5 text-[13px] font-semibold" style={{ color: 'var(--label-2)' }}>🥄 {t('addsUpTitle')}</p>
                {nutrientProjection ? (
                  <NutrientAddsUp
                    projection={nutrientProjection}
                    t={t}
                    onShowAlternatives={!result.isInfantFormula && rankedAlternatives.length > 0 ? scrollToAlternatives : null}
                    showDetails={addsOpen}
                    onToggleDetails={() => setAddsOpen((open) => !open)}
                    habitRow={habitRow}
                    onOpenBodyStory={setBodyStory}
                    onOpenFilm={setFilm}
                  />
                ) : (
                  <div className="px-4 py-3.5">{habitRow}</div>
                )}
              </div>
            )}
          </Group>
        </>
      )}

      {!nutritionPaused && claimChecks.length > 0 && (
        <>
          <SectionHeader>🔎 {t('claimCheckTitle')}</SectionHeader>
          <Group>
            <ClaimCheckCard claims={claimChecks} t={t} unit={claimUnit} onReport={openFlagModal} />
          </Group>
        </>
      )}

      {/* Ingredients, in one card: how they split by tier, the ones that pulled
          the score down (each opens for the why), the good things -- and the
          full list with the Label X-Ray a tap away. */}
      {ingredients.length > 0 && (
        <>
          <SectionHeader>{t('tabIngredients', { count: ingredients.length })}</SectionHeader>
          <Group>
            <div className="flex flex-wrap gap-1.5 px-4 pt-3.5 pb-3">
              {tiers.filter((tier) => tier.count > 0).map((tier) => (
                <span key={tier.key} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12.5px] font-semibold" style={{ background: tier.bg, color: tier.color }}>
                  <span aria-hidden="true">{tier.icon}</span> {tier.count} {tier.label}
                </span>
              ))}
            </div>
            {/* Not for infant formula: "what pulled the score down" framing
                doesn't apply once no score is shown. */}
            {!result.isInfantFormula && mainFactors.length > 0 && (
              <div style={{ borderTop: '1px solid var(--separator)' }}>
                <p className="px-4 pt-3 pb-1 text-[13px] font-semibold" style={{ color: 'var(--label-2)' }}>{t('watchOutFor')}</p>
                {mainFactors.slice(0, MAIN_FACTORS_LIMIT).map(({ ingredient, tier }) => (
                  <IngredientCard key={`flagged-${ingredients.indexOf(ingredient)}`} ingredient={ingredient} severityLabel={tier.label} />
                ))}
                {mainFactors.length > MAIN_FACTORS_LIMIT && (
                  <p className="px-4 pb-3 text-[12.5px]" style={{ color: 'var(--label-3)' }}>
                    {t('moreFlaggedInList', { count: mainFactors.length - MAIN_FACTORS_LIMIT })}
                  </p>
                )}
              </div>
            )}
            {!result.isInfantFormula && displayPositives?.length > 0 && (
              <div className="px-4 py-3" style={{ borderTop: '1px solid var(--separator)' }}>
                <p className="text-[13px] font-semibold mb-1.5" style={{ color: 'var(--label-2)' }}>{t('goodThings')}</p>
                <ul className="space-y-1">
                  {displayPositives.map((item, i) => (
                    <li key={i} className="flex gap-2 text-[13.5px] leading-snug" style={{ color: 'var(--label-1)' }}>
                      <span aria-hidden="true" style={{ color: 'var(--v-good)' }}>✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              onClick={() => (showAllIngredients ? setShowAllIngredients(false) : openAllIngredients())}
              className="tap-scale w-full px-4 py-3 text-left text-[14px] font-semibold"
              style={{ color: 'var(--tint)', borderTop: '1px solid var(--separator)' }}
            >
              {showAllIngredients ? t('hideAllIngredients') : `${ingredients.length === 1 ? t('seeOneIngredient') : t('seeAllIngredients', { count: ingredients.length })} ›`}
            </button>
          </Group>

          {showAllIngredients && (
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
        </>
      )}

      {/* Safer alternatives (low score) or Similar products (everything else),
          after the reasons for this product's score -- only when the catalog has
          something in the same category. Same category-keyword match
          Category.jsx browses by: a real, already-verified product, never
          something a model guessed at. Skipped for infant formula: a "safer"
          swap would rank regulated infant-nutrition products against each other. */}
      {!result.isInfantFormula && rankedAlternatives.length > 0 && (
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


      {/* Story -- history/legacy, why it's used, controversy, myth vs fact.
          Only when the AI had something genuine and specific to say (see
          geminiService.js's "story" rules). A teaser line here; the swipeable
          cards (StoryCards.jsx) open on a tap. */}
      {displayStory && (
        <>
          <SectionHeader>📖 {t('tabStory')}</SectionHeader>
          {storyOpen ? (
            <StoryCards story={displayStory} t={t} />
          ) : (
            <Group>
              <button onClick={() => setStoryOpen(true)} className="tap-scale w-full text-left px-4 py-3.5">
                <span className="block text-[15px] leading-relaxed line-clamp-2" style={{ color: 'var(--label-1)' }}>
                  {displayStory.headline || displayStory.history || displayStory.whyItsUsed || displayStory.controversy || displayStory.mythVsFact?.[0]?.myth}
                </span>
                <span className="block text-[13px] font-semibold mt-1" style={{ color: 'var(--tint)' }}>{t('storyRead')} ›</span>
              </button>
            </Group>
          )}
        </>
      )}

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
        <Link to="/about#how-score-works" className="inline-block text-[13px] font-semibold mb-3" style={{ color: 'var(--tint)' }}>
          {t('howCalculated')}
        </Link>
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
      {bodyStory?.key === 'sugar' && (
        <SugarJourney
          teaspoons={bodyStory.teaspoons}
          grams={bodyStory.grams}
          servingGrams={bodyStory.servingGrams}
          unit={bodyStory.unit}
          perWeek={bodyStory.perWeek}
          onClose={() => setBodyStory(null)}
          t={t}
        />
      )}
      {film && (
        <SugarFilm
          productName={result.productName}
          grams={film.grams}
          servingGrams={film.servingGrams}
          unit={film.unit}
          perWeek={film.perWeek}
          onClose={() => setFilm(null)}
          t={t}
        />
      )}

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
                            {categoryIcon(ing.category, ing.name)}
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
