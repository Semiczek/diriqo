alter table public.work_shifts
add column if not exists job_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_shifts_job_id_fkey'
  ) then
    alter table public.work_shifts
    add constraint work_shifts_job_id_fkey
    foreign key (job_id)
    references public.jobs (id)
    on delete set null;
  end if;
end $$;

create index if not exists work_shifts_job_id_idx
on public.work_shifts (job_id);
