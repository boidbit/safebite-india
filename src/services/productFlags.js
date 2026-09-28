// src/services/productFlags.js
//
// "Report an issue" on a product's report -- see
// supabase/product_flags_schema.sql for the table and why it exists.
//
// No AI, no scoring, no read path the app depends on: this is purely a
// write-and-forget record of someone saying "this result looks wrong",
// kept so a real complaint can be investigated later instead of being
// remembered as a vague "that one chips product scored too high".

import { supabase, isSupabaseConfigured } from './supabaseClient.js';

// The failure modes actually seen in practice, rather than a generic
// "what's wrong?" free-text box -- a category makes flags groupable
// (e.g. "every score_too_high flag this week") in a way prose doesn't.
// `other` is deliberately kept so a real problem that doesn't fit is
// still reportable instead of being forced into the closest wrong box.
export const FLAG_REASONS = [
  { key: 'score_too_high', label: 'Score looks too high' },
  { key: 'score_too_low', label: 'Score looks too low' },
  { key: 'wrong_ingredients', label: 'Ingredients are wrong or missing' },
  { key: 'wrong_product', label: 'This is the wrong product' },
  { key: 'other', label: 'Something else' },
];

// Not one of FLAG_REASONS (those are what the "Report an issue" sheet
// offers): a user renaming a product on the Result page used to rename
// it in the shared catalog for EVERYONE, straight from the public key --
// including after an admin had reviewed it. Now the new name only
// changes on that person's own device, and reaches the admin as this
// kind of flag, with the suggested name in `remarks`.
export const NAME_SUGGESTION_REASON = 'name_suggestion';

/** Sends a user's rename to the admin as a suggestion. Best-effort, like the rename itself. */
export async function submitNameSuggestion({ report, suggestedName }) {
  if (!isSupabaseConfigured || !report?.lookupKey || !suggestedName?.trim()) return { ok: false };
  const { error } = await supabase.from('product_flags').insert({
    lookup_key: report.lookupKey,
    product_name: report.productName || null,
    reason: NAME_SUGGESTION_REASON,
    remarks: suggestedName.trim(),
    score_at_flag: typeof report.overallScore === 'number' ? report.overallScore : null,
    verdict_at_flag: report.verdict || null,
    report_snapshot: report,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Records one report. Returns { ok: true } or { ok: false, error } --
 * never swallows a failure into a fake success, since the whole value
 * of this feature is the person trusting that what they reported was
 * actually written down.
 *
 * @param {object} report - the report as currently displayed; stored as
 *   an as-seen snapshot so the flag stays meaningful after the product
 *   is re-analyzed (see the schema file's note on report_snapshot).
 */
export async function submitProductFlag({ report, reason, remarks }) {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Reporting is unavailable right now.' };
  }
  if (!reason) {
    return { ok: false, error: 'Please pick what looks wrong.' };
  }

  const { error } = await supabase.from('product_flags').insert({
    lookup_key: report?.lookupKey || null,
    product_name: report?.productName || null,
    reason,
    remarks: remarks?.trim() || null,
    score_at_flag: typeof report?.overallScore === 'number' ? report.overallScore : null,
    verdict_at_flag: report?.verdict || null,
    report_snapshot: report || null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
