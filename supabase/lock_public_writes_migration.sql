-- FoodGuard India -- stop the public (anon) key from rewriting published data.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
--
-- The website and the APK carry the public key, and the update policies on
-- product_reports and ingredients allow anyone to update any row. So anyone
-- could copy the key and change a live product's score, or set an
-- ingredient's penalty to 0 (which changes every product that contains it).
--
-- After this:
--   product_reports, public key:
--     - new product: still saved, always 'pending' (review_status trigger)
--     - a 'pending' / 'rejected' product: can still be re-saved (a re-scan,
--       "Refresh", a re-scrape) -- it isn't shown in the app anyway
--     - a 'live' / 'approved' product: nothing changes except the scan
--       counter, and that only goes up by 1 at a time
--   ingredients, public key:
--     - new ingredient (researched by the app): still saved
--     - an existing ingredient: nothing changes except lookup_count, +1 at a time
--   product_nutrition: only a signed-in admin can delete.
--
-- A signed-in admin (the admin panel) and the service_role key (maintenance
-- scripts run from your own computer) can still change everything.

create or replace function public.guard_public_report_writes()
returns trigger
language plpgsql
as $$
declare
  next_count integer;
begin
  if coalesce(auth.role(), 'anon') in ('authenticated', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.scan_count := 1;
    return new;
  end if;

  next_count := least(greatest(new.scan_count, old.scan_count), old.scan_count + 1);
  if old.review_status in ('live', 'approved') then
    new := old;
    if next_count > old.scan_count then
      new.updated_at := now();
    end if;
  end if;
  new.scan_count := next_count;
  return new;
end;
$$;

drop trigger if exists product_reports_guard_public_writes on public.product_reports;
create trigger product_reports_guard_public_writes
  before insert or update on public.product_reports
  for each row execute function public.guard_public_report_writes();

create or replace function public.guard_public_ingredient_writes()
returns trigger
language plpgsql
as $$
declare
  next_count integer;
begin
  if coalesce(auth.role(), 'anon') in ('authenticated', 'service_role') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.lookup_count := 0;
    return new;
  end if;

  next_count := least(greatest(new.lookup_count, old.lookup_count), old.lookup_count + 1);
  new := old;
  new.lookup_count := next_count;
  return new;
end;
$$;

drop trigger if exists ingredients_guard_public_writes on public.ingredients;
create trigger ingredients_guard_public_writes
  before insert or update on public.ingredients
  for each row execute function public.guard_public_ingredient_writes();

drop policy if exists "Anyone can delete nutrition data" on public.product_nutrition;
drop policy if exists "Admins can delete nutrition data" on public.product_nutrition;
create policy "Admins can delete nutrition data"
  on public.product_nutrition for delete
  to authenticated
  using (true);
