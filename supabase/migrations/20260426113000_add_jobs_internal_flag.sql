alter table public.jobs
add column if not exists is_internal boolean not null default false;

create index if not exists idx_jobs_company_internal
on public.jobs(company_id, is_internal);
