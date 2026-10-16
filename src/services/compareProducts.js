// src/services/compareProducts.js
//
// Pure logic -- no AI, no network. Turns 2-4 already-scored products
// (buildReport()'s output) into a side-by-side comparison table plus
// deterministic "what differs" bullets and a closing summary, so
// FoodGuard can answer "which of these fits me better", not just "is
// this one okay" one product at a time.

import { getNutrientsPer100 } from './nutrientBasis.js';
import { calculatePersonalAssessment, AVOID_PRIORITIES } from './personalAssessment.js';
import { getIngredientSeverity } from '../utils/storage.js';

// The same "is this additive-heavy" signal personalAssessment.js's
// fewerAdditives priority already uses (a real INS/E code is the one
// thing an additive can be identified by with total confidence).
function additivesCount(ingredients) {
  return (ingredients || []).filter((i) => i.insCode).length;
}

// Own judgment call, not an authoritative figure (same caveat every
// other threshold in personalAssessment.js carries) -- turns the raw
// count into the same plain-language buckets the reference design
// uses ("None"/"Few"/"Some"/"Several") instead of a bare number, since
// "3" reads very differently next to "0" than it does next to "8".
function additivesLabel(count) {
  if (count === 0) return 'None';
  if (count === 1) return 'Few';
  if (count <= 3) return 'Some';
  return 'Several';
}

// "How processed is this" -- the fraction of ingredients that AREN'T
// "Fine" on the exact same severity scale already shown on the
// Ingredients tab (getIngredientSeverity: Harmful/Concerning/Highly
// processed/Fine). Deliberately the broad "not Fine" definition, not
// just the narrow "Highly processed" tier alone -- checked against 79
// real noodle products first: most of what makes a product like Maggi
// read as heavily processed is ingredients tagged Concerning (flavour
// enhancers, certain oils), not the separate safe-but-penalized
// "Highly processed" bucket, so counting only that tier flatly showed
// "Low" for every real instant-noodle product tested, which defeats
// the point of the row. The fraction thresholds are this file's own
// judgment call (documented, not authoritative) -- calibrated so the
// same real sample split into a real spread (Low/Medium/High all
// populated) rather than everything landing in one bucket.
function processingLabel(ingredients) {
  const list = ingredients || [];
  if (list.length === 0) return null;
  const notFineCount = list.filter((i) => getIngredientSeverity(i).label !== 'Fine').length;
  const fraction = notFineCount / list.length;
  if (fraction >= 0.4) return 'High';
  if (fraction >= 0.15) return 'Medium';
  return 'Low';
}
const PROCESSING_RANK = { Low: 0, Medium: 1, High: 2 };

function numberOrNull(v) {
  return typeof v === 'number' ? v : null;
}

/**
 * One row per product -- everything the comparison table AND
 * describeDifferences() below both need, computed once. `activeProfile`
 * is optional; when given, each row also carries a personalScore and
 * the specific priorities this product tripped, same as the Result
 * page's own personal layer (calculatePersonalAssessment).
 *
 * @param {object[]} products - buildReport() outputs.
 * @param {object|null} activeProfile - a Family profile, or null.
 */
export function buildComparisonRows(products, activeProfile = null) {
  return (products || []).map((p) => {
    // Per 100 g/ml for every product -- comparing one product's per-serving
    // numbers with another's per-100 is exactly the apples-to-oranges the
    // canonical basis (nutrientBasis.js) exists to prevent.
    const real = getNutrientsPer100(p) || {};
    // Prefer "added sugar" (what the daily-habit check itself watches)
    // but fall back to total sugar -- most text/photo scans only ever
    // have the latter, and "no sugar data" would otherwise hide a real,
    // known number just because it wasn't broken out on this label.
    const sugarG = typeof real.addedSugarG === 'number' ? real.addedSugarG
      : typeof real.totalSugarG === 'number' ? real.totalSugarG
      : null;
    const assessment = activeProfile ? calculatePersonalAssessment(p, activeProfile) : null;
    const additives = additivesCount(p.ingredients);

    return {
      lookupKey: p.lookupKey || null,
      productName: p.productName || 'Unknown Product',
      brand: p.brand || null,
      imageUrl: p.imageUrl || null,
      isInfantFormula: p.isInfantFormula === true,
      overallScore: numberOrNull(p.overallScore),
      personalScore: assessment ? assessment.personalScore : null,
      matchedConcerns: assessment ? assessment.matchedConcerns.map((c) => c.priorityKey) : [],
      // "caloriesKcal", not "energyKcal" -- matches the field name
      // personalAssessment.js's lowerCalories check, openFoodFacts.js
      // and blinkitProductsRepo.js all actually write into realNutrients
      // (confirmed by reading each). Getting this wrong here meant the
      // Energy row silently showed "--" for every real product, since
      // nothing was ever stored under the key this file was reading.
      energyKcal: numberOrNull(real.caloriesKcal),
      proteinG: numberOrNull(real.proteinG),
      totalCarbG: numberOrNull(real.carbohydrateG),
      sugarG,
      totalFatG: numberOrNull(real.totalFatG),
      saturatedFatG: numberOrNull(real.saturatedFatG),
      sodiumMg: numberOrNull(real.sodiumMg),
      additives,
      additivesLabel: additivesLabel(additives),
      processing: processingLabel(p.ingredients),
    };
  });
}

/**
 * "Better"/"Lower"/"Moderate" (or the personal-score variant with " fit"
 * appended) for each product -- RELATIVE to the other products in THIS
 * comparison, not the absolute score tier. A 3-way comparison where
 * everyone scores "Moderate" on the app's own absolute scale should
 * still show who's relatively better or worse of the ones actually
 * being compared, same as the ranking already used to pick a "top
 * scorer" elsewhere in this file. Returns {} with fewer than 2 real
 * scores on `scoreKey` to compare.
 */
// Scores this close are the same product for practical purposes (53 vs 52
// is rounding, not a recommendation): within this many points nothing is
// called better or lower.
export const CLOSE_GAP = 5;

function relativeLabels(rows, scoreKey, labels) {
  const withScores = (rows || []).filter((r) => typeof r[scoreKey] === 'number');
  if (withScores.length < 2) return {};

  const best = Math.max(...withScores.map((r) => r[scoreKey]));
  const worst = Math.min(...withScores.map((r) => r[scoreKey]));
  const out = {};
  for (const r of withScores) {
    if (best - worst < CLOSE_GAP) out[r.lookupKey] = labels.similar;
    // Everything within CLOSE_GAP of the top shares "Better" (90, 89, 88 vs 40).
    else if (best - r[scoreKey] < CLOSE_GAP) out[r.lookupKey] = labels.better;
    else if (r[scoreKey] - worst < CLOSE_GAP) out[r.lookupKey] = labels.lower;
    else out[r.lookupKey] = labels.moderate;
  }
  return out;
}

/** Relative standing on the universal score, within this comparison only -- "Better" / "Moderate" / "Lower". */
export function scoreFitLabels(rows) {
  return relativeLabels(rows, 'overallScore', { better: 'Better', moderate: 'Moderate', lower: 'Lower', similar: 'Similar' });
}

/** Relative standing on the personal score, within this comparison only -- "Better fit" / "Moderate fit" / "Lower fit". */
export function personalFitLabels(rows) {
  return relativeLabels(rows, 'personalScore', { better: 'Better fit', moderate: 'Moderate fit', lower: 'Lower fit', similar: 'Similar fit' });
}

// How much of a real gap between the best- and worst-scoring product on
// one metric is worth naming -- a 3% sodium difference isn't a reason
// to prefer one product over another, it's noise from two different
// labels' rounding. 20% is a real, describable difference without being
// so strict that two genuinely similar products never get a bullet.
const MIN_RELATIVE_DIFFERENCE = 0.2;

// priorityKey ties each metric to the matching entry in
// personalAssessment.js's PRIORITIES -- used below to keep a metric the
// profile never asked to watch out of that SAME profile's "why is this
// the better fit" reasoning, even when the top-ranked product happens
// to also win on it.
const NUMERIC_METRICS = [
  { key: 'sugarG', unit: 'g', decimals: 1, lowerIsBetter: true, lowerLabel: 'lower sugar', higherLabel: 'more sugar', priorityKey: 'lowerSugar' },
  { key: 'sodiumMg', unit: 'mg', decimals: 0, lowerIsBetter: true, lowerLabel: 'lower sodium', higherLabel: 'more sodium', priorityKey: 'lowerSodium' },
  { key: 'saturatedFatG', unit: 'g', decimals: 1, lowerIsBetter: true, lowerLabel: 'less saturated fat', higherLabel: 'more saturated fat', priorityKey: 'lowerSatFat' },
  { key: 'energyKcal', unit: ' kcal', decimals: 0, lowerIsBetter: true, lowerLabel: 'fewer calories', higherLabel: 'more calories', priorityKey: 'lowerCalories' },
  { key: 'proteinG', unit: 'g', decimals: 1, lowerIsBetter: false, lowerLabel: 'less protein', higherLabel: 'more protein', priorityKey: 'higherProtein' },
];

const CONCERN_ENGLISH_LABEL = {
  lowerSugar: 'added sugar',
  lowerSodium: 'sodium',
  lowerSatFat: 'saturated fat',
  lessProcessed: 'processed ingredients',
  fewerAdditives: 'additive-related concerns',
  lowerCalories: 'calories',
};

function formatValue(v, metric) {
  const rounded = Number(v.toFixed(metric.decimals));
  return `${rounded}${metric.unit}`;
}

/**
 * The closing summary line, with a real product-picked-for-a-reason
 * conditional -- but its LABEL and its REASONING differ once a profile
 * is active, per a real bug a live test surfaced: with no profile,
 * "Our take" explains the universal score using ANY metric the winner
 * happens to win on. With a profile, that label becomes "For {name}"
 * and the reasoning is restricted to metrics the profile actually
 * SELECTED (and specifically the AVOID-type ones -- lowerSugar/
 * lowerSodium/lowerSatFat/lowerCalories -- since those are the only
 * ones that move personalScore at all; higherProtein/moreWholeFood are
 * informational-only by calculatePersonalAssessment's own design and
 * are deliberately not cited here as a numeric "why"). Three shapes:
 *   - every selected metric with real data favours the top pick: "X
 *     has the higher Personal Fit... mainly because it has A and B."
 *   - some favour the top pick, some favour the other: names both
 *     sides rather than overclaiming a clean win ("perform differently
 *     across {name}'s priorities...").
 *   - no selected metric had real data on both sides: falls back to
 *     whichever AVOID-type concern only the lower-scoring product
 *     tripped (same signal the bullets list already uses).
 */
function buildPersonalTake(rows, activeProfile) {
  const withPersonal = rows.filter((r) => typeof r.personalScore === 'number');
  if (withPersonal.length < 2) return null;

  const best = withPersonal.reduce((a, b) => (b.personalScore > a.personalScore ? b : a));
  const worst = withPersonal.reduce((a, b) => (b.personalScore < a.personalScore ? b : a));
  if (best.personalScore === worst.personalScore) {
    return `${activeProfile.nickname}'s selected priorities don't clearly favour one of these -- the table above is worth a closer look.`;
  }

  const selectedAvoidMetrics = NUMERIC_METRICS.filter(
    (m) => AVOID_PRIORITIES.has(m.priorityKey) && (activeProfile.priorities || []).includes(m.priorityKey)
  );

  const bestWins = [];
  const worstWins = [];
  for (const metric of selectedAvoidMetrics) {
    if (typeof best[metric.key] !== 'number' || typeof worst[metric.key] !== 'number') continue;
    if (best[metric.key] === worst[metric.key]) continue;
    const bestIsBetter = metric.lowerIsBetter ? best[metric.key] < worst[metric.key] : best[metric.key] > worst[metric.key];
    (bestIsBetter ? bestWins : worstWins).push(metric.lowerIsBetter ? metric.lowerLabel : metric.higherLabel);
  }

  const joinLabels = (labels) => (labels.length <= 1 ? labels[0] || '' : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`);

  if (bestWins.length > 0 && worstWins.length === 0) {
    return `${best.productName} has the higher Personal Fit for ${activeProfile.nickname}, mainly because it has ${joinLabels(bestWins)}.`;
  }

  if (bestWins.length > 0 && worstWins.length > 0) {
    return `The products perform differently across ${activeProfile.nickname}'s priorities: ${best.productName} has ${joinLabels(bestWins)}, while ${worst.productName} has ${joinLabels(worstWins)}.`;
  }

  // No selected AVOID-type metric had real data on both sides -- fall
  // back to whichever concern only the lower-scoring product tripped,
  // the same signal the "For {name}" bullet already uses.
  const bestConcerns = new Set(best.matchedConcerns);
  const worstOnlyConcerns = worst.matchedConcerns.filter((c) => !bestConcerns.has(c));
  const reason = worstOnlyConcerns.length > 0
    ? `due to fewer flagged ${CONCERN_ENGLISH_LABEL[worstOnlyConcerns[0]] || 'concerns'}`
    : "based on your priorities";
  return `${best.productName} has the higher Personal Fit for ${activeProfile.nickname} ${reason}.`;
}

/**
 * describeDifferences -- everything the "What differs?" callout and the
 * closing take line need, built from the same real numbers already on
 * each row. Never an AI call, so it can never invent a difference the
 * labels don't support, and never phrases anything as a command ("buy
 * X") -- every line either states a measured fact or a conditional
 * ("if choosing among these...").
 *
 * @returns {{ bullets: string[], take: { label: string, text: string }|null }}
 */
export function describeDifferences(rows, activeProfile = null) {
  const list = rows || [];
  const bullets = [];
  const winningMetrics = []; // tracks what favoured the top-scoring product, for ourTake

  const scoreOf = (r) => (typeof r.personalScore === 'number' ? r.personalScore : r.overallScore);
  const scored = list.filter((r) => typeof scoreOf(r) === 'number');
  const topProduct = scored.length >= 2
    ? [...scored].sort((a, b) => scoreOf(b) - scoreOf(a))[0]
    : null;

  if (list.length >= 2) {
    for (const metric of NUMERIC_METRICS) {
      const withData = list.filter((r) => typeof r[metric.key] === 'number');
      if (withData.length < 2) continue;

      const sorted = [...withData].sort((a, b) =>
        metric.lowerIsBetter ? a[metric.key] - b[metric.key] : b[metric.key] - a[metric.key]
      );
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      if (best[metric.key] === worst[metric.key]) continue;

      const base = Math.max(Math.abs(best[metric.key]), Math.abs(worst[metric.key]), 1);
      const relativeDifference = Math.abs(best[metric.key] - worst[metric.key]) / base;
      if (relativeDifference < MIN_RELATIVE_DIFFERENCE) continue;

      bullets.push(
        `${best.productName} has ${metric.lowerIsBetter ? metric.lowerLabel : metric.higherLabel} ` +
        `(${formatValue(best[metric.key], metric)} vs ${formatValue(worst[metric.key], metric)}) than ${worst.productName}.`
      );
      if (topProduct && best.lookupKey === topProduct.lookupKey) {
        // A metric the profile never selected must never explain why
        // that SAME profile's top pick is the top pick, even when the
        // top-ranked product also happens to win on it (real bug found
        // via live testing: a profile with only "fewer additives" and
        // "prioritize protein" selected got "largely due to lower sugar
        // and lower sodium" in its own explanation -- neither was ever
        // asked for). No active profile means general score reasoning,
        // which has no priorities to restrict to.
        const relevantToProfile = !activeProfile || (activeProfile.priorities || []).includes(metric.priorityKey);
        if (relevantToProfile) winningMetrics.push(metric.lowerIsBetter ? metric.lowerLabel : metric.higherLabel);
      }
    }

    const withProcessing = list.filter((r) => r.processing);
    if (withProcessing.length >= 2) {
      const sorted = [...withProcessing].sort((a, b) => PROCESSING_RANK[b.processing] - PROCESSING_RANK[a.processing]);
      const mostProcessed = sorted[0];
      const leastProcessed = sorted[sorted.length - 1];
      if (PROCESSING_RANK[mostProcessed.processing] > PROCESSING_RANK[leastProcessed.processing]) {
        bullets.push(`${mostProcessed.productName} has the highest processing level among the ${withProcessing.length}.`);
      }
    }
  }

  if (activeProfile) {
    const withPersonal = list.filter((r) => typeof r.personalScore === 'number');
    if (withPersonal.length >= 2) {
      const best = withPersonal.reduce((a, b) => (b.personalScore > a.personalScore ? b : a));
      const worst = withPersonal.reduce((a, b) => (b.personalScore < a.personalScore ? b : a));
      if (best.personalScore > worst.personalScore) {
        const bestConcerns = new Set(best.matchedConcerns);
        const worstOnlyConcerns = worst.matchedConcerns.filter((c) => !bestConcerns.has(c));
        const reason = worstOnlyConcerns.length > 0
          ? `due to fewer flagged ${CONCERN_ENGLISH_LABEL[worstOnlyConcerns[0]] || 'concerns'}`
          : "based on your priorities";
        bullets.push(`For ${activeProfile.nickname}, ${best.productName} is a better fit ${reason}.`);
      }
    }
  }

  let take = null;
  if (activeProfile) {
    const text = buildPersonalTake(list, activeProfile);
    if (text) take = { label: `For ${activeProfile.nickname}`, text };
  } else if (scored.length >= 2) {
    const worstScore = Math.min(...scored.map(scoreOf));
    const text = scoreOf(topProduct) === worstScore
      ? "These are close enough in score that no single product clearly stands out -- the table above is worth a closer look for what matters most to you."
      : `If choosing among these, ${topProduct.productName} has the highest score${winningMetrics.length > 0 ? `, largely due to ${winningMetrics.slice(0, 2).join(' and ')}` : ''}.`;
    take = { label: 'Our take', text };
  }

  return { bullets, take };
}

// ---------------------------------------------------------------------
// What the comparison page leads with: one answer, then who is better at
// what. Same measured facts as describeDifferences, arranged as a verdict
// instead of a list -- still never phrased as "buy X".
// ---------------------------------------------------------------------

// Rows where "better" has a direction (carbs have none: neither more nor
// less is better by itself).
const TABLE_DIRECTION = { energyKcal: 'low', proteinG: 'high', sugarG: 'low', totalFatG: 'low', saturatedFatG: 'low', sodiumMg: 'low' };
const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// The best value on one numeric row, when the gap to the worst is real
// (the same 20% bar as the bullets) and at least two products have data.
function realLead(rows, key, lowerIsBetter) {
  const withData = rows.filter((r) => typeof r[key] === 'number');
  if (withData.length < 2) return null;
  const values = withData.map((r) => r[key]);
  const best = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  const worst = lowerIsBetter ? Math.max(...values) : Math.min(...values);
  if (best === worst) return null;
  if (Math.abs(best - worst) / Math.max(Math.abs(best), Math.abs(worst), 1) < MIN_RELATIVE_DIFFERENCE) return null;
  return { best, worst, winners: withData.filter((r) => r[key] === best), withData };
}

/**
 * Who is better at what.
 * @returns {{ rowWinners: Record<string, Set<string>>, entries: Array<{ row: object, wins: Array<{ label: string, text: string }> }> }}
 *   rowWinners: per table row ('proteinG', 'additives', 'processing', ...), the
 *   lookupKeys that lead it -- only where the lead is real.
 *   entries: one per product, in table order, with what it leads (may be empty).
 */
export function buildScoreboard(rows) {
  const list = rows || [];
  const rowWinners = {};
  const wins = new Map(list.map((r) => [r.lookupKey, []]));
  const addWin = (r, label, text) => wins.get(r.lookupKey).push({ label, text });
  const two = list.length === 2;

  // Numeric rows. Only the priority metrics (sugar, sodium, saturated fat,
  // calories, protein) are named in the scoreboard; fat joins the table marks.
  for (const [key, direction] of Object.entries(TABLE_DIRECTION)) {
    const lead = realLead(list, key, direction === 'low');
    if (!lead) continue;
    rowWinners[key] = new Set(lead.winners.map((r) => r.lookupKey));
    const metric = NUMERIC_METRICS.find((m) => m.key === key);
    if (!metric) continue;
    const others = lead.withData.filter((r) => r[key] !== lead.best).map((r) => r[key]);
    const lo = Math.min(...others);
    const hi = Math.max(...others);
    const range = lo === hi ? formatValue(lo, metric) : `${formatValue(lo, metric)}–${formatValue(hi, metric)}`;
    const against = two ? `vs ${formatValue(lead.worst, metric)}` : `others ${range}`;
    for (const w of lead.winners) addWin(w, capitalize(metric.lowerIsBetter ? metric.lowerLabel : metric.higherLabel), `${formatValue(lead.best, metric)} · ${against}`);
  }

  // Additives: fewer by at least 2 is a real difference (0 vs 1 is not).
  const counts = list.map((r) => r.additives);
  if (list.length >= 2 && Math.max(...counts) - Math.min(...counts) >= 2) {
    const fewest = Math.min(...counts);
    const winners = list.filter((r) => r.additives === fewest);
    rowWinners.additives = new Set(winners.map((r) => r.lookupKey));
    for (const w of winners) addWin(w, 'Fewer additives', `${fewest} vs up to ${Math.max(...counts)}`);
  }

  // Processing: the lowest level, when levels differ.
  const withProcessing = list.filter((r) => r.processing);
  if (withProcessing.length >= 2) {
    const ranks = withProcessing.map((r) => PROCESSING_RANK[r.processing]);
    if (Math.max(...ranks) > Math.min(...ranks)) {
      const winners = withProcessing.filter((r) => PROCESSING_RANK[r.processing] === Math.min(...ranks));
      const highest = withProcessing.find((r) => PROCESSING_RANK[r.processing] === Math.max(...ranks)).processing;
      rowWinners.processing = new Set(winners.map((r) => r.lookupKey));
      for (const w of winners) addWin(w, 'Less processed', `${w.processing} vs ${highest}`);
    }
  }

  return { rowWinners, entries: list.map((r) => ({ row: r, wins: wins.get(r.lookupKey) })) };
}

const joinNames = (rows) => (rows.length <= 2
  ? rows.map((r) => r.productName).join(' and ')
  : `${rows.slice(0, -1).map((r) => r.productName).join(', ')} and ${rows[rows.length - 1].productName}`);

/**
 * The one-line answer the comparison opens with. Ranks on the personal score
 * when a profile is active, otherwise the general score, and says so plainly
 * when the lead is thin or shared instead of crowning a product on a point.
 * @returns {null | { kind: 'clear'|'edge'|'tie'|'close', who: string, headline: string, sub: string, why: string, note: string, leaders: string[] }}
 */
export function buildVerdict(rows, activeProfile = null) {
  const list = rows || [];
  const personal = Boolean(activeProfile) && list.filter((r) => typeof r.personalScore === 'number').length >= 2;
  const key = personal ? 'personalScore' : 'overallScore';
  const scored = list.filter((r) => typeof r[key] === 'number');
  if (scored.length < 2) return null;

  const max = Math.max(...scored.map((r) => r[key]));
  const min = Math.min(...scored.map((r) => r[key]));
  const leaders = scored.filter((r) => r[key] === max);
  const second = Math.max(...scored.filter((r) => r[key] !== max).map((r) => r[key]), -Infinity);
  const ordered = [...scored].sort((a, b) => b[key] - a[key]).map((r) => r[key]);
  const scoresText = ordered.length === 2 ? `${ordered[0]} vs ${ordered[1]}` : ordered.join(' · ');
  const who = personal ? `For ${activeProfile.nickname}` : 'Our verdict';
  const points = (n) => `${n} point${n === 1 ? '' : 's'}`;

  let kind;
  let headline;
  let sub;
  if (max - min < CLOSE_GAP) {
    kind = 'close';
    headline = max === min ? 'They score the same' : 'Too close to call';
    sub = `${scoresText} — ${max === min ? 'no difference' : `within ${points(max - min)}`}. Each is better at different things, below.`;
  } else if (leaders.length > 1) {
    kind = 'tie';
    headline = `${joinNames(leaders)} lead together`;
    sub = `Both score ${max}, ahead of the rest (${scoresText}).`;
  } else if (max - second < CLOSE_GAP) {
    kind = 'edge';
    headline = `${leaders[0].productName} edges ahead`;
    sub = `${scoresText} — only ${points(max - second)} apart, so check what matters to you below.`;
  } else {
    kind = 'clear';
    headline = `${leaders[0].productName} comes out ahead`;
    sub = `${scoresText} — ${points(max - second)} higher.`;
  }

  // Why: for a clear lead, what the leader is best at; for a profile, the
  // personal reasoning already worked out for it.
  let why = '';
  let note = '';
  if (personal) {
    note = buildPersonalTake(list, activeProfile) || '';
  } else if (kind === 'clear' || kind === 'edge') {
    const entry = buildScoreboard(list).entries.find((e) => e.row.lookupKey === leaders[0].lookupKey);
    if (entry && entry.wins.length) why = `Best at: ${entry.wins.slice(0, 3).map((w) => w.label.toLowerCase()).join(', ')}.`;
  }
  return { kind, who, headline, sub, why, note, leaders: leaders.map((r) => r.lookupKey) };
}
