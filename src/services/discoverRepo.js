// src/services/discoverRepo.js
//
// The Discover tab's rankings and swaps. They're built once per website
// deploy (scripts/build-site.js writes /rankings.json from the approved
// catalog) and read from there, not queried live: sorting the catalog by
// score in Supabase runs past the public key's statement timeout, and a
// static file costs no egress however often the tab is opened. Same
// tables as foodguards.space/rankings/.
import { PUBLIC_APP_URL } from '../utils/share.js';

export const RANKINGS_URL = new URL('/rankings.json', PUBLIC_APP_URL).href;

const isProduct = (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.score === 'number';

/**
 * Keeps only well-formed entries, so a half-written or older file shows
 * what it can instead of breaking the screen.
 * @returns {{ categories: Array<{ id, label, total, items }>, swaps: Array<{ category, from, to }> }}
 */
export function parseDiscover(json) {
  const categories = (Array.isArray(json?.categories) ? json.categories : [])
    .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.items))
    .map((c) => ({ id: c.id, label: c.label || c.id, total: c.total || c.items.length, items: c.items.filter(isProduct) }))
    .filter((c) => c.items.length > 0);
  const swaps = (Array.isArray(json?.swaps) ? json.swaps : [])
    .filter((s) => s && isProduct(s.from) && isProduct(s.to) && s.to.score > s.from.score);
  return { categories, swaps };
}

// One fetch per app session; Back into the tab doesn't refetch.
let cached = null;

export async function getDiscover() {
  if (cached) return cached;
  const res = await fetch(RANKINGS_URL);
  if (!res.ok) throw new Error(`rankings ${res.status}`);
  cached = parseDiscover(await res.json());
  return cached;
}
