// src/services/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

// Works both in the browser (Vite injects import.meta.env at build time)
// and in Node -- the Netlify scheduled function reuses this same client,
// where env vars come from process.env instead.
const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Node scripts only (never the website/APK -- no VITE_ prefix, so Vite never
// bundles it). The public key can't rewrite live products or ingredients
// (supabase/lock_public_writes_migration.sql); maintenance scripts that
// need to (recompute-scores.js, the fix-* scripts) use this key when it's
// set in .env.
const SERVICE_ROLE_KEY = typeof window === 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined;

// If these aren't set yet, the app should keep working without a shared
// cache (falls back to "always call the AI") rather than crashing.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, SERVICE_ROLE_KEY ? { auth: { persistSession: false } } : undefined)
  : null;
