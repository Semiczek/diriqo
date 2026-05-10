create table if not exists public.company_onboarding (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade unique,
  company_profile_completed boolean not null default false,
  first_customer_created boolean not null default false,
  first_worker_created boolean not null default false,
  first_job_created boolean not null default false,
  dismissed_at timestamptz null,
  completed_at timestamptz null,
  last_opened_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists company_onboarding_company_completed_idx
  on public.company_onboarding(company_id, completed_at);

create or replace function public.ensure_company_onboarding_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_onboarding (company_id)
  values (new.id)
  on conflict (company_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_companies_ensure_onboarding on public.companies;
create trigger trg_companies_ensure_onboarding
after insert on public.companies
for each row execute function public.ensure_company_onboarding_row();

drop trigger if exists trg_company_onboarding_set_updated_at on public.company_onboarding;
create trigger trg_company_onboarding_set_updated_at
before update on public.company_onboarding
for each row execute function public.set_updated_at();

insert into public.company_onboarding (company_id)
select c.id
from public.companies c
on conflict (company_id) do nothing;

alter table public.company_onboarding enable row level security;

drop policy if exists company_onboarding_select_admin on public.company_onboarding;
create policy company_onboarding_select_admin
on public.company_onboarding
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists company_onboarding_insert_admin on public.company_onboarding;
create policy company_onboarding_insert_admin
on public.company_onboarding
for insert
to authenticated
with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists company_onboarding_update_admin on public.company_onboarding;
create policy company_onboarding_update_admin
on public.company_onboarding
for update
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));

grant select, insert, update on public.company_onboarding to authenticated;
grant execute on function public.ensure_company_onboarding_row() to authenticated;
