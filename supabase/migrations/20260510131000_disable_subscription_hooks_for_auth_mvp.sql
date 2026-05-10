drop trigger if exists companies_create_trial_subscription on public.companies;
drop trigger if exists company_members_enforce_worker_limit on public.company_members;
drop trigger if exists company_members_enforce_limit on public.company_members;

drop function if exists public.create_company_trial_subscription();
drop function if exists public.enforce_company_worker_limit();
drop function if exists public.enforce_company_member_limit();

notify pgrst, 'reload schema';
