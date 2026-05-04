alter table public.jobs
add column if not exists parent_job_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_parent_job_id_fkey'
  ) then
    alter table public.jobs
    add constraint jobs_parent_job_id_fkey
    foreign key (parent_job_id)
    references public.jobs(id)
    on delete set null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_parent_job_id_not_self'
  ) then
    alter table public.jobs
    add constraint jobs_parent_job_id_not_self
    check (parent_job_id is null or parent_job_id <> id);
  end if;
end
$$;

create index if not exists idx_jobs_parent_job_id
on public.jobs(parent_job_id);
