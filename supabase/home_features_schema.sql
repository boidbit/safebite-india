-- FoodGuard India -- the products an admin picks for the home screen's
-- hook sections (Admin > Home features):
--   shock    -- the "Did you know?" reel at the top: a well-known product,
--               its score revealed with the ring animation
--   healthy  -- "Looks healthy, but…": flip cards for products whose name
--               sells health (multigrain, digestive, protein…) but score low
--   guess    -- "Guess the score": the mini game's pool
-- Picked by hand, not chosen automatically: these name real brands in the
-- most visible place in the app, so only a product someone has checked
-- belongs here. Nothing about a product or its score lives here -- only
-- which product, where, in what order, and an optional hook line.
--
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).

create table if not exists public.home_features (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('shock', 'healthy', 'guess')),
  lookup_key text not null,          -- product_reports.lookup_key
  product_name text,                 -- for the admin list; the app reads the live name
  hook text,                         -- optional line shown on the card, e.g. "Ek packet = aadhe din ka namak"
  claim text,                        -- 'healthy' only: the word the pack sells with, e.g. "Multigrain"
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, lookup_key)
);

create index if not exists home_features_kind_idx on public.home_features (kind, active, position);

-- Everyone can read the picks (the app shows them); only a signed-in admin
-- session can add, change or remove one.
alter table public.home_features enable row level security;

drop policy if exists "Anyone can read home features" on public.home_features;
create policy "Anyone can read home features"
  on public.home_features for select
  using (true);

drop policy if exists "Admins can add home features" on public.home_features;
create policy "Admins can add home features"
  on public.home_features for insert
  to authenticated
  with check (true);

drop policy if exists "Admins can change home features" on public.home_features;
create policy "Admins can change home features"
  on public.home_features for update
  to authenticated
  using (true);

drop policy if exists "Admins can remove home features" on public.home_features;
create policy "Admins can remove home features"
  on public.home_features for delete
  to authenticated
  using (true);
