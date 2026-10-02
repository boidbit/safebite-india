// src/services/homeFeaturesRepo.js
//
// The products behind the home screen's hook sections -- the shock reel,
// "Looks healthy, but…" and the guess game. Each is drawn at random, every
// time the app opens and differently on every phone, from the products an
// admin has APPROVED (reviewed, so a brand's score on the home screen is one
// someone checked) plus the admin's own picks for that section
// (supabase/home_features_schema.sql), which come up more often; a pick
// switched off keeps that product out of the section. A pick only says
// WHICH product -- name, photo and score are always read live.
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { VISIBLE_REVIEW_STATUSES } from './productCache.js';
import { logActivity } from './adminActivityRepo.js';
import { detectClaim, sectionCandidates, weightedSample } from '../utils/homeHooks.js';

const REEL_COUNT = 5;
const HEALTHY_COUNT = 6;

// Just the fields a card shows. The whole report (photo inlined, every
// ingredient explained) runs to 100 KB+ a product.
const CARD_FIELDS =
  'lookup_key, product_name, brand:report->>brand, imageUrl:report->>imageUrl, score:report->overallScore, '
  + 'verdict:report->>verdict, flags:report->flags, habit:report->dailyHabitCheck, isInfantFormula:report->>isInfantFormula';

function toCard(row, pick) {
  return {
    id: pick?.id,
    reportId: row.id,
    lookupKey: row.lookup_key,
    productName: row.product_name,
    brand: row.brand || null,
    imageUrl: row.imageUrl || null,
    score: typeof row.score === 'number' ? row.score : Number(row.score),
    verdict: row.verdict || null,
    flags: Array.isArray(row.flags) ? row.flags : [],
    habit: row.habit || null,
    hook: pick?.hook || null,
    claim: pick?.claim || detectClaim(row.product_name),
  };
}

async function cardsFor(keys, visibleOnly) {
  if (!keys.length) return new Map();
  let query = supabase.from('product_reports').select(`id, ${CARD_FIELDS}, review_status`).in('lookup_key', keys);
  if (visibleOnly) query = query.in('review_status', VISIBLE_REVIEW_STATUSES);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return new Map((data || []).map((row) => [row.lookup_key, row]));
}

// The approved pool: every approved product with a photo -- key, name and
// score only (~130 KB for ~900 products). Reading it opens every report on
// the server (~3 s), so a phone keeps it for a few hours and refreshes it in
// the background once it's older than that.
const POOL_KEY = 'foodguard-home-pool';
const POOL_MAX_AGE_MS = 6 * 60 * 60 * 1000;

async function fetchApprovedPool() {
  const pool = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('product_reports')
      .select('lookup_key, product_name, score:report->overallScore, infant:report->>isInfantFormula')
      .eq('review_status', 'approved')
      .not('report->>imageUrl', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      if (r.product_name && typeof r.score === 'number' && r.infant !== 'true') {
        pool.push({ lookupKey: r.lookup_key, productName: r.product_name, score: r.score });
      }
    }
    if (!data || data.length < 1000) break;
  }
  try { localStorage.setItem(POOL_KEY, JSON.stringify({ at: Date.now(), pool })); } catch { /* private mode / full */ }
  return pool;
}

async function approvedPool() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(POOL_KEY) || 'null'); } catch { /* none */ }
  if (cached?.pool?.length) {
    if (Date.now() - cached.at > POOL_MAX_AGE_MS) fetchApprovedPool().catch(() => {}); // refresh for next time
    return cached.pool;
  }
  return fetchApprovedPool();
}

/** Every pick, on or off -- an off pick keeps its product out of the section. */
async function allPicks() {
  const { data, error } = await supabase.from('home_features').select('kind, lookup_key, hook, claim, active');
  return error ? [] : data || [];
}

/**
 * For the app, drawn fresh on every call: { shock, healthy } as ready cards
 * (5 and 6 of them; none shared), and `guess` -- the game's weighted
 * candidates, whose cards GuessGame loads one round at a time via
 * getHomeCard. A product that turns out hidden or has no score is dropped.
 */
export async function getHomeFeatures() {
  const empty = { shock: [], healthy: [], guess: [] };
  if (!isSupabaseConfigured) return empty;
  const [pool, picks] = await Promise.all([approvedPool().catch(() => []), allPicks()]);

  const reel = weightedSample(sectionCandidates(pool, picks, 'shock'), REEL_COUNT);
  const inReel = new Set(reel.map((c) => c.lookupKey));
  const healthy = weightedSample(sectionCandidates(pool, picks, 'healthy').filter((c) => !inReel.has(c.lookupKey)), HEALTHY_COUNT);

  const rows = await cardsFor([...reel, ...healthy].map((c) => c.lookupKey), true).catch(() => new Map());
  const cards = (list) => list
    .map((c) => {
      const row = rows.get(c.lookupKey);
      if (!row || row.isInfantFormula === 'true') return null;
      const card = toCard(row, c);
      return Number.isFinite(card.score) ? card : null;
    })
    .filter(Boolean);

  return { shock: cards(reel), healthy: cards(healthy), guess: sectionCandidates(pool, picks, 'guess') };
}

/** One product's card, live -- the guess game's next round. Null if it's hidden now. */
export async function getHomeCard(candidate) {
  const row = (await cardsFor([candidate.lookupKey], true)).get(candidate.lookupKey);
  if (!row || row.isInfantFormula === 'true') return null;
  const card = toCard(row, candidate);
  return Number.isFinite(card.score) ? card : null;
}

// ---- Admin ----------------------------------------------------------------

function requireSupabase() {
  if (!isSupabaseConfigured) throw new Error('Supabase isn’t configured.');
}

const MISSING_TABLE = /home_features|relation .* does not exist|schema cache/i;

/** Every pick of one kind, with its product's live card and review status. */
export async function adminListHomeFeatures(kind) {
  requireSupabase();
  const { data: picks, error } = await supabase
    .from('home_features')
    .select('*')
    .eq('kind', kind)
    .order('position', { ascending: true });
  if (error) {
    if (MISSING_TABLE.test(error.message)) throw new Error('The home_features table doesn’t exist yet — run supabase/home_features_schema.sql in the Supabase SQL Editor first.');
    throw new Error(error.message);
  }
  const rows = await cardsFor([...new Set((picks || []).map((p) => p.lookup_key))], false);
  return (picks || []).map((pick) => {
    const row = rows.get(pick.lookup_key);
    return { ...pick, card: row ? toCard(row, pick) : null, reviewStatus: row?.review_status || null };
  });
}

export async function adminAddHomeFeature(kind, product) {
  requireSupabase();
  const { data: last } = await supabase.from('home_features').select('position').eq('kind', kind).order('position', { ascending: false }).limit(1);
  const { error } = await supabase.from('home_features').insert({
    kind,
    lookup_key: product.lookupKey,
    product_name: product.productName,
    claim: kind === 'healthy' ? detectClaim(product.productName) : null,
    position: (last?.[0]?.position ?? -1) + 1,
  });
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Already in this list.' : error.message);
  logActivity({ action: 'home_feature_add', targetType: 'home_feature', productName: product.productName, details: { kind, lookupKey: product.lookupKey } });
}

export async function adminUpdateHomeFeature(id, patch) {
  requireSupabase();
  const { error } = await supabase.from('home_features').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function adminRemoveHomeFeature(pick) {
  requireSupabase();
  const { error } = await supabase.from('home_features').delete().eq('id', pick.id);
  if (error) throw new Error(error.message);
  logActivity({ action: 'home_feature_remove', targetType: 'home_feature', productName: pick.product_name, details: { kind: pick.kind, lookupKey: pick.lookup_key } });
}

/** Live products whose name matches -- to add one by hand. */
export async function adminSearchFeatureCandidates(query) {
  requireSupabase();
  const q = query.trim().replace(/[,()%_\\]/g, ' ');
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from('product_reports')
    .select('id')
    .in('review_status', VISIBLE_REVIEW_STATUSES)
    .ilike('product_name', `%${q}%`)
    .limit(30);
  if (error) throw new Error(error.message);
  return cardsByIds((data || []).map((r) => r.id));
}

async function cardsByIds(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('product_reports').select(`id, scan_count, ${CARD_FIELDS}`).in('id', ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data || []).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r) => r && r.isInfantFormula !== 'true')
    .map((r) => ({ ...toCard(r), scanCount: r.scan_count || 0 }))
    .filter((c) => Number.isFinite(c.score));
}

/**
 * Starting points for each list -- the admin still decides. Shock: the
 * most-scanned products scoring under 50 (well known, and a surprise).
 * Healthy: names that sell health ("Multigrain", "Digestive"…) scoring
 * under 55. Guess: the most-scanned products of any score.
 */
export async function adminSuggestHomeFeatures(kind, exclude = new Set()) {
  requireSupabase();
  // Ids first, sorted on a plain column -- sorting while reading report
  // fields makes Postgres open every report and times out.
  const { data, error } = await supabase
    .from('product_reports')
    .select('id')
    .in('review_status', VISIBLE_REVIEW_STATUSES)
    .order('scan_count', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(kind === 'healthy' ? 600 : 200);
  if (error) throw new Error(error.message);
  const ids = (data || []).map((r) => r.id);
  const cards = [];
  for (let i = 0; i < ids.length; i += 150) cards.push(...await cardsByIds(ids.slice(i, i + 150)));
  const fresh = cards.filter((c) => !exclude.has(c.lookupKey));
  if (kind === 'shock') return fresh.filter((c) => c.score < 45).slice(0, 24);
  if (kind === 'healthy') return fresh.filter((c) => c.score < 55 && detectClaim(c.productName)).slice(0, 24);
  return fresh.slice(0, 24);
}
