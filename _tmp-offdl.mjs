import fs from 'fs';
const OUT = '../off-india-products.json';
const all = [];
let total = null;
for (let page = 1; ; page++) {
  let j = null;
  for (let attempt = 1; attempt <= 4 && !j; attempt++) {
    try {
      const res = await fetch(`https://world.openfoodfacts.org/api/v2/search?countries_tags_en=india&fields=code,product_name,brands,quantity&page_size=1000&page=${page}`, { headers: { 'User-Agent': 'FoodGuardIndia/1.0' } });
      j = await res.json();
    } catch { console.log(`page ${page} attempt ${attempt} failed, waiting 30s`); await new Promise((r) => setTimeout(r, 30000)); }
  }
  if (!j) { console.log('giving up at page', page); break; }
  total ??= j.count;
  all.push(...(j.products || []));
  console.log(`page ${page}: +${(j.products || []).length} (have ${all.length} of ${total})`);
  if (!j.products?.length || all.length >= total) break;
  await new Promise((r) => setTimeout(r, 7000));
}
fs.writeFileSync(OUT, JSON.stringify(all));
console.log('saved', all.length, 'to', OUT);
