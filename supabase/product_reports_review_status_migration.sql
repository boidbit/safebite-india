-- FoodGuard India -- admin review before a product goes live.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
--
-- Every product gets a review_status:
--   pending  -- newly added; NOT shown in search / categories / alternatives /
--               "recently analyzed" / today's picks until an admin approves it.
--               (The person who scanned it still sees their own result.)
--   live     -- was already live before this migration; still shown in the
--               app, but listed in the admin review queue as not yet reviewed.
--   approved -- an admin reviewed and published it.
--   rejected -- an admin reviewed it and kept it out of the app.
--
-- Existing rows become 'live' (not 'pending') on purpose: making all 6,700+
-- existing products 'pending' would empty the live app's search and
-- categories until each one is approved. To hide them too, run:
--   update public.product_reports set review_status = 'pending' where review_status = 'live';

alter table public.product_reports
  add column if not exists review_status text not null default 'live',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid;

-- Existing rows got 'live' above; every row added from now on starts 'pending'.
alter table public.product_reports alter column review_status set default 'pending';

alter table public.product_reports drop constraint if exists product_reports_review_status_check;
alter table public.product_reports
  add constraint product_reports_review_status_check
  check (review_status in ('pending', 'live', 'approved', 'rejected'));

create index if not exists product_reports_review_status_idx on public.product_reports (review_status);

-- Only a signed-in admin can change a review status. The app, the scrapers
-- and report generation all write with the public (anon) key, and the
-- existing update policy lets anyone update a row -- so without this, the
-- "approved" flag could be flipped by anyone holding that key.
-- A new row from the public key is always forced to 'pending'; an update
-- from the public key keeps whatever review status the row already had
-- (so a re-scrape or a user's "Refresh" never unpublishes or publishes it).
create or replace function public.guard_product_review_status()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), 'anon') <> 'authenticated' then
    if tg_op = 'INSERT' then
      new.review_status := 'pending';
      new.reviewed_at := null;
      new.reviewed_by := null;
    else
      new.review_status := old.review_status;
      new.reviewed_at := old.reviewed_at;
      new.reviewed_by := old.reviewed_by;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists product_reports_guard_review_status on public.product_reports;
create trigger product_reports_guard_review_status
  before insert or update on public.product_reports
  for each row execute function public.guard_product_review_status();

-- Deleting a product was open to anyone with the public key (see
-- product_reports_add_delete_policy_migration.sql) -- one script could have
-- wiped the whole catalog. Only the admin panel deletes now (the app's own
-- "Refresh" no longer deletes before re-saving), so restrict it to a
-- signed-in admin session.
drop policy if exists "Anyone can delete cached reports" on public.product_reports;
drop policy if exists "Admins can delete cached reports" on public.product_reports;
create policy "Admins can delete cached reports"
  on public.product_reports for delete
  to authenticated
  using (true);
