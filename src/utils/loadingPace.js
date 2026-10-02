// src/utils/loadingPace.js
//
// Opening a report that's already saved: long enough that the loading ring
// reads as "checked", never so long it feels slow -- the whole thing, from
// tap to the report, fits in OPEN_BUDGET_MS. A short random minimum on the
// loading screen (so an instant fetch isn't an abrupt flash), then the ring
// gets whatever time is left of the budget to sprint to 100%. A report that
// genuinely takes longer to build isn't delayed at all. The budget sits well
// under a second: fetching the report (~400 ms) is inside it, opening the
// report page (~150-200 ms) comes after it.

/** Tap-to-report budget for an already-saved report, in ms. */
export const OPEN_BUDGET_MS = 700;

/** Random minimum loading time in ms: 250-350. */
export function randomLoadDelayMs(random = Math.random) {
  return Math.round(250 + random() * 100);
}

/** What's left of the budget since `startedAt` -- the ring's time to finish. */
export function remainingBudgetMs(startedAt, now = Date.now()) {
  return OPEN_BUDGET_MS - (now - startedAt);
}

/** Resolves once `minMs` have passed since `startedAt` (immediately if they already have). */
export function waitForMinimum(startedAt, minMs) {
  const remaining = minMs - (Date.now() - startedAt);
  return remaining > 0 ? new Promise((resolve) => setTimeout(resolve, remaining)) : Promise.resolve();
}
