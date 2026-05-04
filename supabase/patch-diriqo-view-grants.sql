-- Diriqo runtime repair: explicit grants for application views.
-- Safe to run repeatedly in a clean/new Supabase project.
-- Does not delete data, does not touch auth schema, does not open business data to anon.

grant usage on schema public to authenticated;

do $$
begin
  if to_regclass('public.jobs_with_state') is not null then
    execute 'alter view public.jobs_with_state set (security_invoker = true)';
    execute 'grant select on table public.jobs_with_state to authenticated';
  end if;

  if to_regclass('public.work_shift_payroll_view') is not null then
    execute 'alter view public.work_shift_payroll_view set (security_invoker = true)';
    execute 'grant select on table public.work_shift_payroll_view to authenticated';
  end if;

  if to_regclass('public.job_economics_summary') is not null then
    execute 'alter view public.job_economics_summary set (security_invoker = true)';
    execute 'grant select on table public.job_economics_summary to authenticated';
  end if;

  if to_regclass('public.worker_job_assignment_summary') is not null then
    execute 'alter view public.worker_job_assignment_summary set (security_invoker = true)';
    execute 'grant select on table public.worker_job_assignment_summary to authenticated';
  end if;
end $$;
