insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'company-assets',
  'company-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.company_asset_storage_company_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, storage
as $$
declare
  first_folder text;
begin
  first_folder := (storage.foldername(object_name))[1];

  if first_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return first_folder::uuid;
  end if;

  return null;
end;
$$;

drop policy if exists company_assets_storage_select on storage.objects;
create policy company_assets_storage_select
on storage.objects
for select
to public
using (
  bucket_id = 'company-assets'
);

drop policy if exists company_assets_storage_write_admins on storage.objects;
create policy company_assets_storage_write_admins
on storage.objects
for all
to authenticated
using (
  bucket_id = 'company-assets'
  and public.has_company_role(
    public.company_asset_storage_company_id(name),
    array['super_admin', 'company_admin']
  )
)
with check (
  bucket_id = 'company-assets'
  and public.has_company_role(
    public.company_asset_storage_company_id(name),
    array['super_admin', 'company_admin']
  )
);
