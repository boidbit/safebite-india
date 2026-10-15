// src/services/junkIssues.js
//
// A report that still carries typo / OCR-junk ingredients after the automatic
// fixes (typoIngredient.js: junk scored as nothing, "typo for 'X'" corrected)
// goes to the admin's manual review: one row in product_data_issues (the Data
// Issues page), with the junk names, so someone can check the label photo and
// fix the list in the edit form.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { isJunkIngredient } from './typoIngredient.js';

// Every junk issue's reason starts with this -- how an open one is found again.
export const JUNK_ISSUE_PREFIX = 'Typo / unreadable ingredients';

/** The issue text for a report, or null when its ingredient list is clean. */
export function junkIssueReason(report) {
  const junk = (report?.ingredients || []).filter(isJunkIngredient).map((i) => i.name);
  if (!junk.length) return null;
  return `${JUNK_ISSUE_PREFIX} on the label: ${junk.map((n) => `"${n}"`).join(', ')}. They score nothing for now. Check the label photo, fix or remove them in the edit form, then Recalculate score.`;
}

/**
 * Opens a junk issue for this product unless one is already open. Never throws:
 * a missed review row must not break saving a report.
 * @returns {Promise<boolean>} true when a new issue was opened
 */
export async function recordJunkIssue({ lookupKey, productName, source, report }) {
  const reason = junkIssueReason(report);
  if (!reason || !lookupKey || !isSupabaseConfigured) return false;
  try {
    const { data } = await supabase.from('product_data_issues').select('id')
      .eq('lookup_key', lookupKey).eq('status', 'open').like('reason', `${JUNK_ISSUE_PREFIX}%`).limit(1);
    if (data?.length) return false;
    const { error } = await supabase.from('product_data_issues').insert({
      lookup_key: lookupKey,
      product_name: productName || null,
      source: source || null,
      reason,
      score_at_detection: report.overallScore ?? null,
      verdict_at_detection: report.verdict ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}
