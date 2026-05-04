-- Diriqo payroll + contractor compatibility patch.
-- Safe for existing databases: no data deletion, no table drops.

create extension if not exists pgcrypto;

create table if not exists public.company_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payroll_type text not null default 'monthly',
  payroll_day_of_month integer null,
  payroll_weekday integer null,
  payroll_anchor_date date null,
  allow_advances boolean not null default true,
  advance_limit_amount numeric(12, 2) null,
  advance_frequency text null default 'monthly',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id)
);

alter table public.profiles add column if not exists worker_type text not null default 'employee';
alter table public.profiles add column if not exists use_custom_payroll boolean not null default false;
alter table public.profiles add column if not exists custom_payroll_type text null;
alter table public.profiles add column if not exists custom_payroll_day_of_month integer null;
alter table public.profiles add column if not exists custom_payroll_weekday integer null;
alter table public.profiles add column if not exists custom_payroll_anchor_date date null;
alter table public.profiles add column if not exists allow_advances_override boolean null;
alter table public.profiles add column if not exists advance_limit_amount_override numeric(12, 2) null;
alter table public.profiles add column if not exists contractor_billing_type text null;
alter table public.profiles add column if not exists contractor_default_rate numeric(12, 2) null;

alter table public.job_assignments add column if not exists worker_type_snapshot text null;
alter table public.job_assignments add column if not exists assignment_billing_type text null;
alter table public.job_assignments add column if not exists external_amount numeric(12, 2) null;

update public.profiles
set worker_type = 'employee'
where worker_type is null or btrim(worker_type) = '';

insert into public.company_payroll_settings (
  company_id,
  payroll_type,
  payroll_day_of_month,
  allow_advances,
  advance_frequency
)
select
  c.id,
  'monthly',
  18,
  true,
  'monthly'
from public.companies c
on conflict (company_id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_payroll_settings_payroll_type_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_payroll_type_check
      check (payroll_type in ('shift', 'weekly', 'biweekly', 'monthly'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'company_payroll_settings_advance_frequency_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_advance_frequency_check
      check (advance_frequency is null or advance_frequency in ('anytime', 'weekly', 'monthly'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_worker_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_worker_type_check
      check (worker_type in ('employee', 'contractor'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_custom_payroll_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_custom_payroll_type_check
      check (custom_payroll_type is null or custom_payroll_type in ('shift', 'weekly', 'biweekly', 'monthly'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_contractor_billing_type_check'
  ) then
    alter table public.profiles
      add constraint profiles_contractor_billing_type_check
      check (contractor_billing_type is null or contractor_billing_type in ('hourly', 'fixed', 'invoice'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'job_assignments_worker_type_snapshot_check'
  ) then
    alter table public.job_assignments
      add constraint job_assignments_worker_type_snapshot_check
      check (worker_type_snapshot is null or worker_type_snapshot in ('employee', 'contractor'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'job_assignments_assignment_billing_type_check'
  ) then
    alter table public.job_assignments
      add constraint job_assignments_assignment_billing_type_check
      check (assignment_billing_type is null or assignment_billing_type in ('hourly', 'fixed', 'invoice'));
  end if;
end $$;

create index if not exists company_payroll_settings_company_idx
  on public.company_payroll_settings(company_id);

create index if not exists profiles_worker_type_idx
  on public.profiles(worker_type);

create index if not exists job_assignments_worker_type_idx
  on public.job_assignments(worker_type_snapshot);

alter table public.company_payroll_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_payroll_settings'
      and policyname = 'company_payroll_settings_select_member'
  ) then
    create policy company_payroll_settings_select_member
      on public.company_payroll_settings
      for select
      to authenticated
      using (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'company_payroll_settings'
      and policyname = 'company_payroll_settings_admin_write'
  ) then
    create policy company_payroll_settings_admin_write
      on public.company_payroll_settings
      for all
      to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin', 'manager']))
      with check (public.has_company_role(company_id, array['super_admin', 'company_admin', 'manager']));
  end if;
end $$;

grant select, insert, update, delete on table public.company_payroll_settings to authenticated;
