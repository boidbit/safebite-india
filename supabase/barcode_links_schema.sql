-- FoodGuard India -- linking a scanned barcode to a product we already have.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
--
-- Blinkit product pages carry no barcode, so thousands of catalog products
-- can't be found by scanning. When a scanned barcode isn't in the catalog,
-- the app lets the person find the product by name or a front-of-pack
-- photo and tap the right one. That tap is recorded here as a PENDING link;
-- once an admin approves it (Admin > Barcode matches), scanning that
-- barcode opens the linked product directly.
--
-- The product row itself is never changed: its lookup_key stays as it is
-- (a Blinkit product keeps its blinkit: key, which the scraper relies on).

create table if not exists public.barcode_links (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  lookup_key text not null,          -- product_reports.lookup_key it points at
  product_name text,
  device_id text not null,           -- a random id kept on the person's device; counts independent confirmations
  source text,                       -- 'name_search' | 'photo' | 'off_name'
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (barcode, lookup_key, device_id)
);

create index if not exists barcode_links_barcode_idx on public.barcode_links (barcode, status);
create index if not exists barcode_links_status_idx on public.barcode_links (status, created_at);

alter table public.barcode_links enable row level security;

drop policy if exists "Anyone can read barcode links" on public.barcode_links;
create policy "Anyone can read barcode links"
  on public.barcode_links for select
  using (true);

-- The app can only ever add a PENDING link -- never approve one.
drop policy if exists "Anyone can suggest a barcode link" on public.barcode_links;
create policy "Anyone can suggest a barcode link"
  on public.barcode_links for insert
  with check (status = 'pending' and reviewed_at is null);

-- Approving, rejecting and deleting are for a signed-in admin only.
drop policy if exists "Admins can review barcode links" on public.barcode_links;
create policy "Admins can review barcode links"
  on public.barcode_links for update
  to authenticated
  using (true);

drop policy if exists "Admins can delete barcode links" on public.barcode_links;
create policy "Admins can delete barcode links"
  on public.barcode_links for delete
  to authenticated
  using (true);
