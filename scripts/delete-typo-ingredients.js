// scripts/delete-typo-ingredients.js
//
// Deletes the junk / typo rows from the `ingredients` table -- ONLY the rows
// listed in ../ingredients-typo-to-delete.csv (id + name), nothing else. A row
// is deleted only if its id AND name still match the CSV. The full rows were
// saved to ../ingredients-typo-backup.json first.
//
//   node --env-file=.env scripts/delete-typo-ingredients.js            (dry run: only counts)
//   node --env-file=.env scripts/delete-typo-ingredients.js --apply    (really deletes)
import fs from 'fs';
import { supabase } from '../src/services/supabaseClient.js';

const apply = process.argv.includes('--apply');
if (apply && !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY in .env.'); process.exit(1); }

const s = fs.readFileSync('../ingredients-typo-to-delete.csv', 'utf8').replace(/^\uFEFF/, '');
const list = []; let cur = [], f = '', q = false;
for (let k = 0; k < s.length; k++) {
  const c = s[k];
  if (q) { if (c === '"') { if (s[k + 1] === '"') { f += '"'; k++; } else q = false; } else f += c; }
  else if (c === '"') q = true;
  else if (c === ',') { cur.push(f); f = ''; }
  else if (c === '\n') { cur.push(f.replace(/\r$/, '')); list.push(cur); cur = []; f = ''; }
  else f += c;
}
if (f || cur.length) { cur.push(f.trim()); list.push(cur); } // last line has no trailing newline
list.shift();
const wanted = new Map(list.filter((r) => r[0]).map((r) => [r[0], r[1]]));
console.log(`${wanted.size} rows in the delete list`);

let matched = 0, deleted = 0;
const ids = [...wanted.keys()];
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const { data, error } = await supabase.from('ingredients').select('id, canonical_name').in('id', chunk);
  if (error) { console.error(error.message); process.exit(1); }
  const ok = data.filter((r) => r.canonical_name === wanted.get(String(r.id))).map((r) => r.id);
  matched += ok.length;
  if (apply && ok.length) {
    const { error: e2, count } = await supabase.from('ingredients').delete({ count: 'exact' }).in('id', ok);
    if (e2) { console.error('delete failed:', e2.message); process.exit(1); }
    deleted += count ?? ok.length;
  }
}
console.log(`${matched} still match the list (id + name)`);
console.log(apply ? `deleted ${deleted}` : 'dry run -- nothing deleted. Add --apply to delete.');
