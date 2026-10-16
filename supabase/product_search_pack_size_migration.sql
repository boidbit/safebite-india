-- FoodGuard India -- search also returns each product's pack size.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
--
-- Search results are grouped by product ("Mountain Dew" once, with a chip per
-- pack size: 250 ml, 400 ml, 1.25 L ...). The grouping needs each row's saved
-- pack size, so search_products() now returns it as pack_size. Nothing else
-- about the search changes (same matching, same ranking). Safe to run while the
-- app is live; the app works without it too, reading the size from the name.

drop function if exists public.search_products(text, int, int);
create function public.search_products(q text, max_results int default 20, skip int default 0)
returns table (
  lookup_key text,
  product_name text,
  brand text,
  score int,
  verdict text,
  image_url text,
  pack_size text,
  rank real,
  total bigint
)
language sql
stable
as $$
  with input as (
    select public.search_norm(q) as nq
  ),
  -- One-letter words ("g" in "parle g") match too much on their own; the
  -- no-spaces phrase below still uses them.
  words as (
    select w from input, unnest(string_to_array(nq, ' ')) as w where length(w) >= 2
  ),
  hits as (
    select
      r.lookup_key,
      r.product_name,
      r.report->>'brand' as brand,
      -- a score that isn't a plain number mustn't break the whole search
      case when jsonb_typeof(r.report->'overallScore') = 'number' then round((r.report->>'overallScore')::numeric)::int end as score,
      r.report->>'verdict' as verdict,
      r.report->>'imageUrl' as image_url,
      r.report->>'packSize' as pack_size,
      ' ' || public.search_norm(r.product_name) || ' ' as nm,
      r.search_text,
      r.scan_count,
      r.review_status,
      i.nq
    from public.product_reports r, input i
    where r.review_status in ('live', 'approved')
      and r.product_name is not null
      and exists (select 1 from words)
      -- every word must be in the name/brand, or close to a word there
      and not exists (
        select 1 from words
        where not (r.search_text like '%' || w || '%' or w <% r.search_text)
      )
  ),
  ranked as (
    select
      h.*,
      (
          (case when h.nm = ' ' || h.nq || ' ' then 4 else 0 end)                       -- the whole name
        + (case when h.nm like ' ' || h.nq || ' %' then 2 else 0 end)                   -- name starts with it
        + (case when replace(h.search_text, ' ', '') like '%' || replace(h.nq, ' ', '') || '%' then 1.5 else 0 end) -- the phrase, spaces aside
        + (select count(*) from words where h.nm like '% ' || w || ' %') * 1.0          -- whole words in the name
        + (select count(*) from words where h.nm like '%' || w || '%') * 0.5            -- in the name at all (not brand-only)
        + word_similarity(h.nq, h.search_text)                                          -- closeness
        + least(1.0, ln(1 + coalesce(h.scan_count, 0)) / ln(30))                        -- popularity
        + (case when h.review_status = 'approved' then 0.2 else 0 end)
        -- poor name -- just the brand ("maggi", brand Maggi), or no brand and
        -- a very short name: outweighs the whole-name bonus, so it sorts below
        -- "Maggi Masala Noodles"
        - (case when trim(h.nm) = public.search_norm(h.brand)
                  or length(trim(h.nm)) < 4
                  or (coalesce(h.brand, '') = '' and (length(h.product_name) < 12 or array_length(string_to_array(trim(h.nm), ' '), 1) <= 2))
                then 5 else 0 end)
      )::real as rank
    from hits h
  ),
  -- The same name + brand + pack size saved more than once (scans of one
  -- product: "Parle G", "parle - G", "Parle-g") -- show only the best-ranked
  -- one. The pack size is part of the key so "Mountain Dew 250 ml" and
  -- "Mountain Dew 400 ml" both stay (they become chips on one card).
  distinct_products as (
    select distinct on (replace(trim(nm), ' ', ''), public.search_norm(brand), coalesce(pack_size, '')) *
    from ranked
    order by replace(trim(nm), ' ', ''), public.search_norm(brand), coalesce(pack_size, ''), rank desc
  )
  select lookup_key, product_name, brand, score, verdict, image_url, pack_size, rank, count(*) over () as total
  from distinct_products
  order by rank desc, product_name
  limit greatest(1, least(max_results, 100))
  offset greatest(0, skip)
$$;

grant execute on function public.search_products(text, int, int) to anon, authenticated;
grant execute on function public.search_norm(text) to anon, authenticated;
