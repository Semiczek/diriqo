-- Trusted server paths only. Membership, role, company, assignment and paid
-- capability checks run before these clients are created/used. No public-client
-- grants or RLS policies change; service_role remains a server-only credential.
-- Column grants deliberately exclude payroll/rates, customer finance and auth
-- identities. Idempotent: GRANT unions with existing privileges.

grant select (id, company_id, parent_job_id, title, address, start_at, status, created_at)
  on public.jobs to service_role;
grant update (status, work_state) on public.jobs to service_role;

grant select (id, company_id, profile_id, role, is_active)
  on public.company_members to service_role;
grant select (id, full_name) on public.profiles to service_role;

grant select (id, company_id, profile_id, job_id, started_at, ended_at)
  on public.work_shifts to service_role;
grant insert (company_id, profile_id, job_id, shift_date, started_at, status, note)
  on public.work_shifts to service_role;
grant update (ended_at, status) on public.work_shifts to service_role;

grant select (id, company_id, job_id, profile_id, archived_at)
  on public.job_assignments to service_role;
grant update (status, work_started_at, completed_at, work_completed_at)
  on public.job_assignments to service_role;

grant select (id, company_id, job_id, photo_type, file_name, note, taken_at, storage_path, thumb_storage_path)
  on public.job_photos to service_role;
grant insert (id, company_id, job_id, uploaded_by, photo_type, file_name, note, mime_type, size_bytes, taken_at, storage_path, thumb_storage_path)
  on public.job_photos to service_role;

notify pgrst, 'reload schema';
