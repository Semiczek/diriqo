-- Diriqo company settings MVP.
-- Safe additive migration for existing demo databases.

create extension if not exists pgcrypto;

alter table public.companies add column if not exists web text;
alter table public.companies add column if not exists currency text not null default 'CZK';
alter table public.companies add column if not exists locale text not null default 'cs-CZ';
alter table public.companies add column if not exists timezone text not null default 'Europe/Prague';
alter table public.companies add column if not exists ico text;
alter table public.companies add column if not exists dic text;
alter table public.companies add column if not exists address text;
alter table public.companies add column if not exists email text;
alter table public.companies add column if not exists phone text;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  require_job_check boolean not null default true,
  allow_multi_day_jobs boolean not null default true,
  require_before_after_photos boolean not null default false,
  require_checklist_completion boolean not null default false,
  require_work_time_tracking boolean not null default true,
  default_job_status_after_worker_done text not null default 'waiting_check',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_settings_worker_done_status_check
    check (default_job_status_after_worker_done in ('waiting_check', 'done'))
);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'company_settings_set_updated_at'
      and tgrelid = 'public.company_settings'::regclass
  ) then
    create trigger company_settings_set_updated_at
      before update on public.company_settings
      for each row execute function public.set_updated_at();
  end if;
end $$;

create table if not exists public.company_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_payroll_settings add column if not exists default_worker_type text not null default 'employee';
alter table public.company_payroll_settings add column if not exists default_pay_type text not null default 'monthly';
alter table public.company_payroll_settings add column if not exists payday_day integer;
alter table public.company_payroll_settings add column if not exists payday_weekday integer;
alter table public.company_payroll_settings add column if not exists advances_enabled boolean not null default true;
alter table public.company_payroll_settings add column if not exists advance_limit_type text not null default 'monthly_amount';
alter table public.company_payroll_settings add column if not exists advance_limit_amount numeric(12,2);
alter table public.company_payroll_settings add column if not exists advance_limit_percent numeric(5,2);
alter table public.company_payroll_settings add column if not exists advance_frequency text not null default 'monthly';
alter table public.company_payroll_settings add column if not exists default_hourly_rate numeric(12,2);
alter table public.company_payroll_settings add column if not exists default_contractor_cost_mode text not null default 'hourly';

-- Compatibility with the older payroll patch used during demo bootstrap.
alter table public.company_payroll_settings add column if not exists payroll_type text;
alter table public.company_payroll_settings add column if not exists payroll_day_of_month integer;
alter table public.company_payroll_settings add column if not exists payroll_weekday integer;
alter table public.company_payroll_settings add column if not exists payroll_anchor_date date;
alter table public.company_payroll_settings add column if not exists allow_advances boolean;

update public.company_payroll_settings
set
  default_pay_type = coalesce(
    nullif(default_pay_type, ''),
    case when payroll_type = 'shift' then 'after_shift' else payroll_type end,
    'monthly'
  ),
  payday_day = coalesce(payday_day, payroll_day_of_month),
  payday_weekday = coalesce(payday_weekday, payroll_weekday),
  advances_enabled = coalesce(advances_enabled, allow_advances, true)
where true;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_payroll_settings_default_worker_type_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_default_worker_type_check
      check (default_worker_type in ('employee', 'contractor'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_payroll_settings_default_pay_type_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_default_pay_type_check
      check (default_pay_type in ('after_shift', 'weekly', 'biweekly', 'monthly'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_payroll_settings_advance_limit_type_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_advance_limit_type_check
      check (advance_limit_type in ('monthly_amount', 'percent_of_earned'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_payroll_settings_advance_frequency_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_advance_frequency_check
      check (advance_frequency in ('per_shift', 'weekly', 'biweekly', 'monthly'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_payroll_settings_default_contractor_cost_mode_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_default_contractor_cost_mode_check
      check (default_contractor_cost_mode in ('hourly', 'fixed_per_job', 'invoice'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_payroll_settings_payday_day_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_payday_day_check
      check (payday_day is null or payday_day between 1 and 31);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_payroll_settings_payday_weekday_check'
  ) then
    alter table public.company_payroll_settings
      add constraint company_payroll_settings_payday_weekday_check
      check (payday_weekday is null or payday_weekday between 1 and 7);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'company_payroll_settings_set_updated_at'
      and tgrelid = 'public.company_payroll_settings'::regclass
  ) then
    create trigger company_payroll_settings_set_updated_at
      before update on public.company_payroll_settings
      for each row execute function public.set_updated_at();
  end if;
end $$;

create table if not exists public.worker_payment_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  worker_type text not null default 'employee',
  pay_type_override text null,
  payday_day_override integer null,
  payday_weekday_override integer null,
  hourly_rate numeric(12,2) null,
  fixed_rate_per_job numeric(12,2) null,
  advances_enabled_override boolean null,
  advance_limit_amount_override numeric(12,2) null,
  contractor_company_name text null,
  contractor_registration_no text null,
  contractor_vat_no text null,
  contractor_invoice_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_payment_settings_company_profile_unique unique(company_id, profile_id),
  constraint worker_payment_settings_worker_type_check check (worker_type in ('employee', 'contractor')),
  constraint worker_payment_settings_pay_type_override_check
    check (pay_type_override is null or pay_type_override in ('after_shift', 'weekly', 'biweekly', 'monthly')),
  constraint worker_payment_settings_payday_day_check
    check (payday_day_override is null or payday_day_override between 1 and 31),
  constraint worker_payment_settings_payday_weekday_check
    check (payday_weekday_override is null or payday_weekday_override between 1 and 7)
);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'worker_payment_settings_set_updated_at'
      and tgrelid = 'public.worker_payment_settings'::regclass
  ) then
    create trigger worker_payment_settings_set_updated_at
      before update on public.worker_payment_settings
      for each row execute function public.set_updated_at();
  end if;
end $$;

create table if not exists public.company_billing_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  billing_enabled boolean not null default false,
  default_invoice_due_days integer not null default 14,
  default_vat_rate numeric(5,2) not null default 21.00,
  is_vat_payer boolean not null default false,
  invoice_prefix text default 'FV',
  next_invoice_number integer not null default 1,
  bank_account text null,
  iban text null,
  swift text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_billing_settings_due_days_check check (default_invoice_due_days between 0 and 365),
  constraint company_billing_settings_vat_rate_check check (default_vat_rate between 0 and 100),
  constraint company_billing_settings_next_number_check check (next_invoice_number >= 1)
);

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'company_billing_settings_set_updated_at'
      and tgrelid = 'public.company_billing_settings'::regclass
  ) then
    create trigger company_billing_settings_set_updated_at
      before update on public.company_billing_settings
      for each row execute function public.set_updated_at();
  end if;
end $$;

create table if not exists public.company_modules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_modules_company_module_unique unique(company_id, module_key)
);

alter table public.company_modules add column if not exists updated_at timestamptz not null default now();
update public.company_modules set module_key = 'finance' where module_key = 'economics';
update public.company_modules set module_key = 'public_leads' where module_key = 'leads';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_modules_module_key_valid_v2'
  ) then
    alter table public.company_modules
      add constraint company_modules_module_key_valid_v2
      check (module_key in (
        'dashboard',
        'jobs',
        'customers',
        'workers',
        'shifts',
        'finance',
        'calendar',
        'absences',
        'advance_requests',
        'quotes',
        'invoices',
        'kalkulace',
        'photos',
        'customer_portal',
        'public_leads',
        'email',
        'payroll'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'company_modules_set_updated_at'
      and tgrelid = 'public.company_modules'::regclass
  ) then
    create trigger company_modules_set_updated_at
      before update on public.company_modules
      for each row execute function public.set_updated_at();
  end if;
end $$;

create table if not exists public.job_cost_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  cost_type text not null,
  description text null,
  amount numeric(12,2) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.job_cost_items add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.job_cost_items add column if not exists job_id uuid references public.jobs(id) on delete cascade;
alter table public.job_cost_items add column if not exists cost_type text;
alter table public.job_cost_items add column if not exists description text;
alter table public.job_cost_items add column if not exists amount numeric(12,2) not null default 0;
alter table public.job_cost_items add column if not exists created_by uuid references public.profiles(id);
alter table public.job_cost_items add column if not exists created_at timestamptz not null default now();

-- Existing Diriqo demo also uses title/type/quantity/unit columns for richer cost UI.
alter table public.job_cost_items add column if not exists title text;
alter table public.job_cost_items add column if not exists type text;
alter table public.job_cost_items add column if not exists quantity numeric(12,2) not null default 1;
alter table public.job_cost_items add column if not exists unit text;
alter table public.job_cost_items add column if not exists unit_price numeric(12,2) not null default 0;
alter table public.job_cost_items add column if not exists total_price numeric(12,2) not null default 0;
alter table public.job_cost_items add column if not exists note text;

update public.job_cost_items
set
  cost_type = coalesce(cost_type, type, 'other'),
  description = coalesce(description, title),
  total_price = case
    when coalesce(total_price, 0) = 0 and coalesce(amount, 0) <> 0 then amount
    when coalesce(total_price, 0) = 0 then coalesce(quantity, 1) * coalesce(unit_price, 0)
    else total_price
  end,
  amount = case
    when coalesce(amount, 0) = 0 and coalesce(total_price, 0) <> 0 then total_price
    else amount
  end
where true;

create index if not exists company_settings_company_id_idx on public.company_settings(company_id);
create index if not exists company_payroll_settings_company_id_idx on public.company_payroll_settings(company_id);
create index if not exists worker_payment_settings_company_profile_idx on public.worker_payment_settings(company_id, profile_id);
create index if not exists company_billing_settings_company_id_idx on public.company_billing_settings(company_id);
create index if not exists company_modules_company_id_idx on public.company_modules(company_id);
create index if not exists job_cost_items_company_job_idx on public.job_cost_items(company_id, job_id);

insert into public.company_settings (company_id)
select id from public.companies
on conflict (company_id) do nothing;

insert into public.company_payroll_settings (company_id)
select id from public.companies
on conflict (company_id) do nothing;

insert into public.company_billing_settings (company_id)
select id from public.companies
on conflict (company_id) do nothing;

insert into public.worker_payment_settings (company_id, profile_id, worker_type, hourly_rate)
select cm.company_id, cm.profile_id, coalesce(nullif(p.worker_type, ''), 'employee'), p.hourly_rate
from public.company_members cm
join public.profiles p on p.id = cm.profile_id
where cm.company_id is not null and cm.profile_id is not null
on conflict (company_id, profile_id) do nothing;

insert into public.company_modules (company_id, module_key, is_enabled)
select c.id, module_key, true
from public.companies c
cross join (
  values
    ('jobs'),
    ('workers'),
    ('shifts'),
    ('finance'),
    ('calendar'),
    ('quotes'),
    ('invoices'),
    ('photos'),
    ('customer_portal'),
    ('public_leads'),
    ('email'),
    ('payroll')
) as modules(module_key)
on conflict (company_id, module_key) do nothing;

alter table public.company_settings enable row level security;
alter table public.company_payroll_settings enable row level security;
alter table public.worker_payment_settings enable row level security;
alter table public.company_billing_settings enable row level security;
alter table public.company_modules enable row level security;
alter table public.job_cost_items enable row level security;

grant select, insert, update, delete on public.company_settings to authenticated;
grant select, insert, update, delete on public.company_payroll_settings to authenticated;
grant select, insert, update, delete on public.worker_payment_settings to authenticated;
grant select, insert, update, delete on public.company_billing_settings to authenticated;
grant select, insert, update, delete on public.company_modules to authenticated;
grant select, insert, update, delete on public.job_cost_items to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_settings' and policyname = 'company_settings_members_select') then
    create policy company_settings_members_select on public.company_settings
      for select to authenticated
      using (public.is_company_member(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_settings' and policyname = 'company_settings_admin_write') then
    create policy company_settings_admin_write on public.company_settings
      for all to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
      with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_payroll_settings' and policyname = 'company_payroll_settings_admin_read') then
    create policy company_payroll_settings_admin_read on public.company_payroll_settings
      for select to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_payroll_settings' and policyname = 'company_payroll_settings_admin_write') then
    create policy company_payroll_settings_admin_write on public.company_payroll_settings
      for all to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
      with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'worker_payment_settings' and policyname = 'worker_payment_settings_admin_or_self_select') then
    create policy worker_payment_settings_admin_or_self_select on public.worker_payment_settings
      for select to authenticated
      using (
        public.has_company_role(company_id, array['super_admin', 'company_admin'])
        or profile_id = public.current_profile_id()
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'worker_payment_settings' and policyname = 'worker_payment_settings_admin_write') then
    create policy worker_payment_settings_admin_write on public.worker_payment_settings
      for all to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
      with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_billing_settings' and policyname = 'company_billing_settings_admin_read') then
    create policy company_billing_settings_admin_read on public.company_billing_settings
      for select to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_billing_settings' and policyname = 'company_billing_settings_admin_write') then
    create policy company_billing_settings_admin_write on public.company_billing_settings
      for all to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
      with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_modules' and policyname = 'company_modules_members_select') then
    create policy company_modules_members_select on public.company_modules
      for select to authenticated
      using (public.is_company_member(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_modules' and policyname = 'company_modules_admin_write') then
    create policy company_modules_admin_write on public.company_modules
      for all to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
      with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_cost_items' and policyname = 'job_cost_items_members_select') then
    create policy job_cost_items_members_select on public.job_cost_items
      for select to authenticated
      using (public.is_company_member(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_cost_items' and policyname = 'job_cost_items_admin_write') then
    create policy job_cost_items_admin_write on public.job_cost_items
      for all to authenticated
      using (public.has_company_role(company_id, array['super_admin', 'company_admin']))
      with check (public.has_company_role(company_id, array['super_admin', 'company_admin']));
  end if;
end $$;

notify pgrst, 'reload schema';
