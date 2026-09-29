-- FoodGuard India -- reading barcodes for already-scraped Blinkit products.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
--
-- scripts/backfill-blinkit-barcodes.js revisits each Blinkit product we
-- already have, reads its barcode off the gallery photos (ZXing, no AI) and
-- saves it as a PENDING barcode link. This table is its progress -- one row
-- per category plus a '__run__' row with the run's status -- which the
-- admin panel's "Barcode backfill" page shows live.

create table if not exists public.barcode_backfill_progress (
  category text primary key,           -- a sitemap category, or '__run__'
  sitemap_url text,
  total_urls integer,                  -- our products found in this category's sitemap
  next_index integer not null default 0,
  pages_checked integer not null default 0,
  matched integer not null default 0,  -- pages that turned out to be one of our products
  barcodes_found integer not null default 0,
  exhausted boolean not null default false,
  status text,                         -- '__run__' only: running | finished | stopped
  last_product text,                   -- '__run__' only
  started_at timestamptz,              -- '__run__' only
  updated_at timestamptz not null default now()
);

alter table public.barcode_backfill_progress enable row level security;

-- Progress counters only, written by the script with the public key.
drop policy if exists "Anyone can read backfill progress" on public.barcode_backfill_progress;
create policy "Anyone can read backfill progress"
  on public.barcode_backfill_progress for select using (true);
drop policy if exists "Anyone can write backfill progress" on public.barcode_backfill_progress;
create policy "Anyone can write backfill progress"
  on public.barcode_backfill_progress for insert with check (true);
drop policy if exists "Anyone can update backfill progress" on public.barcode_backfill_progress;
create policy "Anyone can update backfill progress"
  on public.barcode_backfill_progress for update using (true);

-- The product's brand on a barcode link, so the admin "safe to approve"
-- check can compare a barcode's company code (its first 7 digits) with the
-- same brand's other barcodes.
alter table public.barcode_links add column if not exists brand text;
