// src/services/adminActivityRepo.js
//
// Best-effort activity log -- see supabase/admin_activity_log_schema.sql.
// Never throws: a missing log row (table not created yet, or a
// transient write failure) must never block the real action it was
// recording, same philosophy as productCache.js's own cache writes.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { chunk } from '../utils/chunk.js';

export async function logActivity({ action, targetType, targetId, productName, details }) {
  if (!isSupabaseConfigured) return;
  try {
    const { data } = await supabase.auth.getUser();
    await supabase.from('admin_activity_log').insert({
      actor_email: data?.user?.email || null,
      action,
      target_type: targetType,
      target_id: targetId != null ? String(targetId) : null,
      product_name: productName || null,
      details: details || null,
    });
  } catch {
    // The log table may not exist yet (admin_activity_log_schema.sql
    // not run), or the write failed transiently -- either way, the
    // action it was recording already happened and must not be undone.
  }
}

/** Same as logActivity, for many rows at once (a bulk approve) -- one insert per 500 rows. */
export async function logActivities(entries) {
  if (!isSupabaseConfigured || entries.length === 0) return;
  try {
    const { data } = await supabase.auth.getUser();
    const actor = data?.user?.email || null;
    for (const rows of chunk(entries, 500)) {
      await supabase.from('admin_activity_log').insert(rows.map((e) => ({
        actor_email: actor,
        action: e.action,
        target_type: e.targetType,
        target_id: e.targetId != null ? String(e.targetId) : null,
        product_name: e.productName || null,
        details: e.details || null,
      })));
    }
  } catch {
    // Best-effort, like logActivity: the action already happened.
  }
}

export async function adminListActivity({ limit = 60 } = {}) {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('admin_activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Every logged change for one product, oldest first -- the "History" page (see AdminProductHistory.jsx). */
export async function adminListActivityForProduct(targetId) {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('admin_activity_log')
    .select('*')
    .eq('target_type', 'product')
    .eq('target_id', String(targetId))
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}
