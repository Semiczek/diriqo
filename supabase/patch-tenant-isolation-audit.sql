-- Diriqo tenant isolation audit patch.
-- Target: existing Diriqo Supabase DB after bootstrap/runtime patches.
-- Safety: additive, idempotent, no data deletion. NOT NULL is applied only after safe backfills.

create extension if not exists pgcrypto;

-- Runtime tables used by the app but missing from the original bootstrap.
create table if not exists public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  require_job_check boolean not null default true,
  allow_multi_day_jobs boolean not null default true,
  require_before_after_photos boolean not null default false,
  require_checklist_completion boolean not null default false,
  require_work_time_tracking boolean not null default true,
  default_job_status_after_worker_done text not null default 'waiting_check',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_payroll_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  payroll_type text null,
  payroll_day_of_month integer null,
  payroll_weekday integer null,
  payroll_anchor_date date null,
  allow_advances boolean not null default true,
  default_worker_type text not null default 'employee',
  default_pay_type text not null default 'monthly',
  payday_day integer null,
  payday_weekday integer null,
  advances_enabled boolean not null default true,
  advance_limit_type text not null default 'monthly_amount',
  advance_limit_amount numeric(12, 2) null,
  advance_limit_percent numeric(5, 2) null,
  advance_frequency text not null default 'monthly',
  default_hourly_rate numeric(12, 2) null,
  default_contractor_cost_mode text not null default 'hourly',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_billing_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  billing_enabled boolean not null default false,
  default_invoice_due_days integer not null default 14,
  default_vat_rate numeric(5, 2) not null default 21,
  is_vat_payer boolean not null default false,
  invoice_prefix text not null default 'FV',
  next_invoice_number integer not null default 1,
  bank_account text null,
  iban text null,
  swift text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.worker_payment_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  worker_type text not null default 'employee',
  pay_type_override text null,
  payday_day_override integer null,
  payday_weekday_override integer null,
  hourly_rate numeric(12, 2) null,
  fixed_rate_per_job numeric(12, 2) null,
  advances_enabled_override boolean null,
  advance_limit_amount_override numeric(12, 2) null,
  contractor_company_name text null,
  contractor_registration_no text null,
  contractor_vat_no text null,
  contractor_invoice_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, profile_id)
);

create table if not exists public.calculation_versions (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references public.calculations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  version_number integer not null,
  title text not null,
  description text null,
  status text not null default 'draft',
  calculation_date date not null default current_date,
  internal_note text null,
  subtotal_cost numeric(12, 2) not null default 0,
  subtotal_price numeric(12, 2) not null default 0,
  margin_amount numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  currency text not null default 'CZK',
  saved_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(calculation_id, version_number)
);

create table if not exists public.calculation_version_items (
  id uuid primary key default gen_random_uuid(),
  calculation_version_id uuid not null references public.calculation_versions(id) on delete cascade,
  sort_order integer not null default 0,
  item_type text null,
  name text not null,
  description text null,
  quantity numeric(12, 2) not null default 1,
  unit text null,
  unit_cost numeric(12, 2) not null default 0,
  unit_price numeric(12, 2) not null default 0,
  vat_rate numeric(5, 2) not null default 21,
  total_cost numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists calculation_versions_company_idx
  on public.calculation_versions(company_id, calculation_id, version_number desc);
create index if not exists calculation_version_items_version_idx
  on public.calculation_version_items(calculation_version_id, sort_order, created_at);
create index if not exists worker_payment_settings_company_profile_idx
  on public.worker_payment_settings(company_id, profile_id);

-- Safe backfills for nullable tenant columns that are derived from parent rows.
update public.job_assignments ja
set company_id = j.company_id
from public.jobs j
where ja.job_id = j.id
  and ja.company_id is null;

update public.job_cost_items jci
set company_id = j.company_id
from public.jobs j
where jci.job_id = j.id
  and jci.company_id is null;

update public.job_checklists jc
set company_id = j.company_id
from public.jobs j
where jc.job_id = j.id
  and jc.company_id is null;

update public.job_checklist_items jci
set company_id = jc.company_id
from public.job_checklists jc
where jci.job_checklist_id = jc.id
  and jci.company_id is null
  and jc.company_id is not null;

update public.calendar_event_assignments cea
set company_id = ce.company_id
from public.calendar_events ce
where coalesce(cea.calendar_event_id, cea.event_id) = ce.id
  and cea.company_id is null;

update public.quote_items qi
set company_id = q.company_id
from public.quotes q
where qi.quote_id = q.id
  and qi.company_id is null;

update public.invoice_items ii
set company_id = i.company_id
from public.invoices i
where ii.invoice_id = i.id
  and ii.company_id is null;

update public.offer_events oe
set company_id = q.company_id
from public.quotes q
where oe.quote_id = q.id
  and oe.company_id is null;

update public.offer_responses ors
set company_id = q.company_id
from public.quotes q
where ors.quote_id = q.id
  and ors.company_id is null;

update public.job_customer_contacts jcc
set company_id = j.company_id
from public.jobs j
where jcc.job_id = j.id
  and jcc.company_id is null;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'company_settings',
    'company_payroll_settings',
    'company_billing_settings',
    'worker_payment_settings',
    'calculation_versions',
    'calculation_version_items',
    'job_customer_contacts',
    'absences'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'company_settings',
    'company_payroll_settings',
    'company_billing_settings',
    'worker_payment_settings',
    'calculation_versions',
    'job_customer_contacts',
    'absences'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = table_name || '_select_company_member'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id))',
        table_name || '_select_company_member',
        table_name
      );
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = table_name || '_admin_write'
    ) then
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id))',
        table_name || '_admin_write',
        table_name
      );
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calculation_version_items'
      and policyname = 'calculation_version_items_select_company_member'
  ) then
    create policy calculation_version_items_select_company_member
    on public.calculation_version_items
    for select
    to authenticated
    using (
      exists (
        select 1
        from public.calculation_versions cv
        where cv.id = calculation_version_items.calculation_version_id
          and public.is_company_member(cv.company_id)
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'calculation_version_items'
      and policyname = 'calculation_version_items_admin_write'
  ) then
    create policy calculation_version_items_admin_write
    on public.calculation_version_items
    for all
    to authenticated
    using (
      exists (
        select 1
        from public.calculation_versions cv
        where cv.id = calculation_version_items.calculation_version_id
          and public.is_company_admin(cv.company_id)
      )
    )
    with check (
      exists (
        select 1
        from public.calculation_versions cv
        where cv.id = calculation_version_items.calculation_version_id
          and public.is_company_admin(cv.company_id)
      )
    );
  end if;
end $$;

-- Apply NOT NULL only where the patch has enough information to backfill safely.
do $$
declare
  table_name text;
  null_count bigint;
begin
  foreach table_name in array array[
    'job_assignments',
    'job_cost_items',
    'job_checklists',
    'job_checklist_items',
    'calendar_event_assignments',
    'quote_items',
    'invoice_items',
    'offer_events',
    'offer_responses',
    'job_customer_contacts'
  ] loop
    execute format('select count(*) from public.%I where company_id is null', table_name) into null_count;
    if null_count = 0 then
      execute format('alter table public.%I alter column company_id set not null', table_name);
    else
      raise notice 'Skipped NOT NULL for %.company_id because % rows are still null.', table_name, null_count;
    end if;
  end loop;
end $$;

-- Exposed views must evaluate under caller RLS.
do $$
begin
  if to_regclass('public.jobs_with_state') is not null then
    execute 'alter view public.jobs_with_state set (security_invoker = true)';
  end if;
  if to_regclass('public.work_shift_payroll_view') is not null then
    execute 'alter view public.work_shift_payroll_view set (security_invoker = true)';
  end if;
  if to_regclass('public.job_economics_summary') is not null then
    execute 'alter view public.job_economics_summary set (security_invoker = true)';
  end if;
  if to_regclass('public.worker_job_assignment_summary') is not null then
    execute 'alter view public.worker_job_assignment_summary set (security_invoker = true)';
  end if;
end $$;

-- Keep broad anon grants from older bootstrap scripts from becoming effective if an RLS gap appears later.
-- Public offer and portal flows use RPC/admin server routes rather than direct anon table access.
revoke all privileges on all tables in schema public from anon;
grant select, insert, update, delete on table public.company_settings to authenticated;
grant select, insert, update, delete on table public.company_payroll_settings to authenticated;
grant select, insert, update, delete on table public.company_billing_settings to authenticated;
grant select, insert, update, delete on table public.worker_payment_settings to authenticated;
grant select, insert, update, delete on table public.calculation_versions to authenticated;
grant select, insert, update, delete on table public.calculation_version_items to authenticated;

-- Private job-photo storage bucket. Object names are expected to start with the job UUID:
--   <job_id>/<file_uuid>.<ext>
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do update
set public = false;

drop policy if exists job_photos_objects_select_company_member on storage.objects;
drop policy if exists job_photos_objects_insert_company_member on storage.objects;
drop policy if exists job_photos_objects_update_company_admin on storage.objects;
drop policy if exists job_photos_objects_delete_company_admin on storage.objects;

create policy job_photos_objects_select_company_member
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-photos'
  and exists (
    select 1
    from public.jobs j
    where j.id = case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null::uuid
      end
      and public.is_company_member(j.company_id)
  )
);

create policy job_photos_objects_insert_company_member
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-photos'
  and exists (
    select 1
    from public.jobs j
    where j.id = case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null::uuid
      end
      and public.is_company_member(j.company_id)
  )
);

create policy job_photos_objects_update_company_admin
on storage.objects
for update
to authenticated
using (
  bucket_id = 'job-photos'
  and exists (
    select 1
    from public.jobs j
    where j.id = case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null::uuid
      end
      and public.is_company_admin(j.company_id)
  )
)
with check (
  bucket_id = 'job-photos'
  and exists (
    select 1
    from public.jobs j
    where j.id = case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null::uuid
      end
      and public.is_company_admin(j.company_id)
  )
);

create policy job_photos_objects_delete_company_admin
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'job-photos'
  and exists (
    select 1
    from public.jobs j
    where j.id = case
        when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null::uuid
      end
      and public.is_company_admin(j.company_id)
  )
);

notify pgrst, 'reload schema';
