-- FoodGuard India -- better product search.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
--
-- The app used to look for the typed text, exactly as typed, inside the
-- product name or brand. So "butter amul" found nothing (word order),
-- "parleg" found nothing (spacing), "magi" found Lay's Magic Masala (typo),
-- and results came back in no particular order ("maggi" -> a tomato sauce
-- first). search_products() instead:
--   - matches every typed word on its own, in any order, ignoring case,
--     apostrophes and hyphens ("haldirams" = "Haldiram's", "parleg" = "Parle-G")
--   - accepts a close spelling of a word ("magi" -> maggi, "kurkre" -> kurkure)
--     using Postgres' trigram matching (pg_trgm)
--   - ranks: whole name > name starting with the words > whole words in the
--     name > brand-only matches, then more-scanned products first
--   - pushes products with a poor name (named just their brand, like "maggi",
--     or no brand and a very short name) below the real ones -- still found,
--     just lower -- and shows the same name + brand only once
-- Only products visible in the app (live / approved) are searched.

create extension if not exists pg_trgm;

-- Lowercase, accents folded, apostrophes dropped, everything else that isn't a letter or
-- digit turned into one space.
create or replace function public.search_norm(t text)
returns text
language sql
immutable
as $$
  -- accents folded first, so "Nestlé" searches as "nestle"
  select trim(regexp_replace(regexp_replace(
    translate(lower(coalesce(t, '')), 'éèêëáàâäíìîïóòôöúùûüñç', 'eeeeaaaaiiiioooouuuunc'),
    '[''’`]', '', 'g'), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Name + brand, plus the name with no spaces at all (so "parleg" and
-- "goodday" match "Parle-G" and "Good Day"), kept as a stored column with a
-- trigram index: building it for every row on every search took 1-10 s.
-- (Checked: the BEFORE-update triggers in lock_public_writes_migration.sql
-- still work with it -- the public scan-count bump went through.) If
-- search_norm() ever changes, drop and re-add this column to rebuild it.
alter table public.product_reports drop column if exists search_text;
alter table public.product_reports
  add column search_text text generated always as (
    public.search_norm(product_name) || ' ' ||
    public.search_norm(report->>'brand') || ' ' ||
    replace(public.search_norm(product_name), ' ', '')
  ) stored;
create index if not exists product_reports_search_text_trgm
  on public.product_reports using gin (search_text gin_trgm_ops);

drop function if exists public.search_products(text, int, int);
create function public.search_products(q text, max_results int default 20, skip int default 0)
returns table (
  lookup_key text,
  product_name text,
  brand text,
  score int,
  verdict text,
  image_url text,
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
  -- The same name + brand saved more than once (scans of one product:
  -- "Parle G", "parle - G", "Parle-g") -- show only the best-ranked one.
  distinct_products as (
    select distinct on (replace(trim(nm), ' ', ''), public.search_norm(brand)) *
    from ranked
    order by replace(trim(nm), ' ', ''), public.search_norm(brand), rank desc
  )
  select lookup_key, product_name, brand, score, verdict, image_url, rank, count(*) over () as total
  from distinct_products
  order by rank desc, product_name
  limit greatest(1, least(max_results, 100))
  offset greatest(0, skip)
$$;

grant execute on function public.search_products(text, int, int) to anon, authenticated;
grant execute on function public.search_norm(text) to anon, authenticated;
