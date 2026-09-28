// src/services/aiProxy.js
//
// How the website and the Android app reach Gemini and Cloudflare: through
// the ai-proxy Supabase Edge Function (supabase/functions/ai-proxy), which
// holds the API keys as server secrets. The keys used to be built into the
// JavaScript every visitor downloads -- anyone could copy and use them.
//
// Node scripts (scraper, report generation) run on our own machines, so
// they keep calling the APIs directly with the keys from .env -- see
// geminiService.js / translateService.js.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';

/** True in the browser/app, where there are no keys and every AI call goes through the function. */
export const isAiProxyAvailable = typeof window !== 'undefined' && isSupabaseConfigured;

/**
 * @param {{ kind: 'gemini', model: string, body: object } | { kind: 'translate', texts: string[] }} payload
 * @returns {Promise<{ ok: true, data: any } | { ok: false, status?: number, data?: any, message: string }>}
 */
export async function callAiProxy(payload) {
  // A signed-in admin's session goes along automatically -- the function
  // only allows the photo clean-up models for that.
  const { data, error } = await supabase.functions.invoke('ai-proxy', { body: payload });
  if (!error) return { ok: true, data };
  let detail = null;
  try {
    detail = await error.context?.json();
  } catch {
    // no JSON body (network error, function not deployed)
  }
  return {
    ok: false,
    status: error.context?.status,
    data: detail,
    message: detail?.error?.message || detail?.errors?.[0]?.message || error.message || 'AI request failed',
  };
}
