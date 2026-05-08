-- Diriqo job-photo storage pipeline hardening.
-- Safe to run repeatedly. Keeps bucket private and scopes object access by:
--   <company_id>/<job_id>/<category>/<timestamp>-<uuid>.<ext>
-- where category is one of before, after, issue, proof.

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do update
set public = false;

alter table public.job_photos
  add column if not exists uploaded_by uuid null references public.profiles(id) on delete set null,
  add column if not exists mime_type text null,
  add column if not exists size_bytes bigint null;

create index if not exists job_photos_company_job_taken_idx
  on public.job_photos(company_id, job_id, taken_at desc);

drop policy if exists job_photos_objects_select_company_member on storage.objects;
drop policy if exists job_photos_objects_insert_company_member on storage.objects;
drop policy if exists job_photos_objects_update_company_admin on storage.objects;
drop policy if exists job_photos_objects_delete_company_admin on storage.objects;
drop policy if exists job_photos_objects_select_scoped on storage.objects;
drop policy if exists job_photos_objects_insert_scoped on storage.objects;
drop policy if exists job_photos_objects_update_admin_scoped on storage.objects;
drop policy if exists job_photos_objects_delete_admin_scoped on storage.objects;

create policy job_photos_objects_select_scoped
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-photos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] in ('before', 'after', 'issue', 'proof')
  and exists (
    select 1
    from public.jobs j
    where j.company_id = ((storage.foldername(name))[1])::uuid
      and j.id = ((storage.foldername(name))[2])::uuid
      and (
        public.is_company_admin(j.company_id)
        or public.is_worker_assigned_to_job(j.id)
      )
  )
);

create policy job_photos_objects_insert_scoped
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-photos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (storage.foldername(name))[3] in ('before', 'after', 'issue', 'proof')
  and exists (
    select 1
    from public.jobs j
    where j.company_id = ((storage.foldername(name))[1])::uuid
      and j.id = ((storage.foldername(name))[2])::uuid
      and (
        public.is_company_admin(j.company_id)
        or public.is_worker_assigned_to_job(j.id)
      )
  )
);

create policy job_photos_objects_update_admin_scoped
on storage.objects
for update
to authenticated
using (
  bucket_id = 'job-photos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.jobs j
    where j.company_id = ((storage.foldername(name))[1])::uuid
      and public.is_company_admin(j.company_id)
  )
)
with check (
  bucket_id = 'job-photos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.jobs j
    where j.company_id = ((storage.foldername(name))[1])::uuid
      and public.is_company_admin(j.company_id)
  )
);

create policy job_photos_objects_delete_admin_scoped
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'job-photos'
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (
    select 1
    from public.jobs j
    where j.company_id = ((storage.foldername(name))[1])::uuid
      and public.is_company_admin(j.company_id)
  )
);
