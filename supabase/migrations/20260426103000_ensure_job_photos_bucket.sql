insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'job-photos',
  'job-photos',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.job_photo_storage_job_id(object_name text)
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

drop policy if exists job_photos_storage_select on storage.objects;
create policy job_photos_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-photos'
  and (
    public.is_company_admin(public.job_company_id(public.job_photo_storage_job_id(name)))
    or public.is_worker_assigned_to_job(public.job_photo_storage_job_id(name))
  )
);

drop policy if exists job_photos_storage_write on storage.objects;
create policy job_photos_storage_write
on storage.objects
for all
to authenticated
using (
  bucket_id = 'job-photos'
  and (
    public.is_company_admin(public.job_company_id(public.job_photo_storage_job_id(name)))
    or public.is_worker_assigned_to_job(public.job_photo_storage_job_id(name))
  )
)
with check (
  bucket_id = 'job-photos'
  and (
    public.is_company_admin(public.job_company_id(public.job_photo_storage_job_id(name)))
    or public.is_worker_assigned_to_job(public.job_photo_storage_job_id(name))
  )
);
