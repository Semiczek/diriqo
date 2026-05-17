create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.user_onboarding_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid null references public.profiles(id) on delete set null,
  company_id uuid null references public.companies(id) on delete cascade,
  onboarding_completed boolean not null default false,
  onboarding_mode text null,
  completed_tutorials jsonb not null default '[]'::jsonb,
  dismissed_help_pages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_state_mode_check') then
    alter table public.user_onboarding_state
      add constraint user_onboarding_state_mode_check
      check (onboarding_mode is null or onboarding_mode in ('skipped', 'quick', 'detailed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_state_completed_tutorials_array') then
    alter table public.user_onboarding_state
      add constraint user_onboarding_state_completed_tutorials_array
      check (jsonb_typeof(completed_tutorials) = 'array');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'user_onboarding_state_dismissed_help_pages_array') then
    alter table public.user_onboarding_state
      add constraint user_onboarding_state_dismissed_help_pages_array
      check (jsonb_typeof(dismissed_help_pages) = 'array');
  end if;
end $$;

create unique index if not exists user_onboarding_state_user_company_uidx
  on public.user_onboarding_state(user_id, coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists user_onboarding_state_user_id_idx
  on public.user_onboarding_state(user_id);

create index if not exists user_onboarding_state_company_id_idx
  on public.user_onboarding_state(company_id);

drop trigger if exists user_onboarding_state_set_updated_at on public.user_onboarding_state;
create trigger user_onboarding_state_set_updated_at
before update on public.user_onboarding_state
for each row execute function public.set_updated_at();

alter table public.user_onboarding_state enable row level security;

grant select, insert, update, delete on public.user_onboarding_state to authenticated;

drop policy if exists user_onboarding_state_select_own on public.user_onboarding_state;
create policy user_onboarding_state_select_own
on public.user_onboarding_state
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists user_onboarding_state_insert_own on public.user_onboarding_state;
create policy user_onboarding_state_insert_own
on public.user_onboarding_state
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists user_onboarding_state_update_own on public.user_onboarding_state;
create policy user_onboarding_state_update_own
on public.user_onboarding_state
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists user_onboarding_state_delete_own on public.user_onboarding_state;
create policy user_onboarding_state_delete_own
on public.user_onboarding_state
for delete
to authenticated
using (user_id = auth.uid());

notify pgrst, 'reload schema';
