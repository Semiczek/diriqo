-- Block J: SaaS first-run onboarding metadata.
-- Data creation is done server-side; this patch only adds safe metadata for trial/demo separation.

alter table public.companies
  add column if not exists plan_key text not null default 'trial',
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists is_demo boolean not null default false,
  add column if not exists support_email text;

update public.companies
set
  plan_key = coalesce(nullif(plan_key, ''), 'trial'),
  trial_started_at = coalesce(trial_started_at, created_at, now()),
  trial_ends_at = coalesce(trial_ends_at, coalesce(created_at, now()) + interval '14 days'),
  support_email = coalesce(support_email, email)
where plan_key = 'trial';

create index if not exists companies_plan_key_idx on public.companies(plan_key);
create index if not exists companies_is_demo_idx on public.companies(is_demo);

create table if not exists public.company_onboarding_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid null references public.profiles(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.company_onboarding_events enable row level security;

create index if not exists company_onboarding_events_company_idx
  on public.company_onboarding_events(company_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_onboarding_events'
      and policyname = 'company_onboarding_events_select_admin'
  ) then
    create policy company_onboarding_events_select_admin
      on public.company_onboarding_events
      for select
      to authenticated
      using (public.is_company_admin(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_onboarding_events'
      and policyname = 'company_onboarding_events_insert_admin'
  ) then
    create policy company_onboarding_events_insert_admin
      on public.company_onboarding_events
      for insert
      to authenticated
      with check (
        public.is_company_admin(company_id)
        and profile_id = public.current_profile_id()
      );
  end if;
end $$;

grant select, insert on table public.company_onboarding_events to authenticated;
