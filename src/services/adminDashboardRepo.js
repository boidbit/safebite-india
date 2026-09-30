// src/services/adminDashboardRepo.js
//
// The counts behind the admin dashboard and the Inbox badges: what's
// waiting for an admin, read straight from the tables each list reads.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';

const headCount = (table, build) => {
  const q = build(supabase.from(table).select('*', { count: 'exact', head: true }));
  return q.then((r) => (r.error ? null : r.count || 0));
};

/** Open flags, open data issues ("Manual review"), waiting submissions. */
export async function adminInboxCounts() {
  if (!isSupabaseConfigured) return { flags: 0, dataIssues: 0, submissions: 0 };
  const [flags, dataIssues, submissions] = await Promise.all([
    headCount('product_flags', (q) => q.eq('status', 'open')),
    headCount('product_data_issues', (q) => q.eq('status', 'open')),
    headCount('product_submissions', (q) => q.eq('status', 'pending')),
  ]);
  return { flags, dataIssues, submissions };
}

/** Barcodes waiting in Barcode matches, and the backfill's run row. */
export async function adminBarcodeSummary() {
  if (!isSupabaseConfigured) return { waiting: 0, backfill: null };
  const [waiting, backfill] = await Promise.all([
    headCount('barcode_links', (q) => q.eq('status', 'pending')),
    supabase.from('barcode_backfill_progress').select('status, updated_at').eq('category', '__run__').maybeSingle().then((r) => r.data || null, () => null),
  ]);
  return { waiting, backfill };
}

/** When the Blinkit scraper last saved a product. */
export async function adminLastScrapeAt() {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.from('blinkit_products').select('scraped_at').order('scraped_at', { ascending: false }).limit(1);
  return data?.[0]?.scraped_at || null;
}
