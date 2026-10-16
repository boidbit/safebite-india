-- FoodGuard India -- Storage bucket for product photos.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query).
--
-- Until now a product's photo was stored INSIDE its report as a base64 data: URL
-- (25-315 KB), so every read of the report downloaded the photo from the
-- database. Photos now live in this public bucket and the report holds a short
-- URL; the browser loads the file from the CDN.
--
-- Anyone can read (the photos are shown to every visitor). Only a signed-in
-- admin can add or replace a photo from the admin panel; the migration script
-- uses the service_role key, which bypasses these policies.

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

create policy "Anyone can read product-photos"
  on storage.objects for select
  using (bucket_id = 'product-photos');

create policy "Admins can upload to product-photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-photos');

create policy "Admins can replace product-photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-photos');
