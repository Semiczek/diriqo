-- Diriqo runtime schema compatibility patch.
-- Target: clean/demo Supabase DB after supabase/bootstrap-diriqo-schema.sql.
-- Safety: no DROP TABLE, no real data, no auth schema changes.
-- Goal: add columns/views/fallbacks expected by the current Next.js runtime.

create extension if not exists pgcrypto;

-- 1. Core profile/company/customer compatibility
alter table public.companies add column if not exists billing_name text;
alter table public.companies add column if not exists company_number text;
alter table public.companies add column if not exists vat_number text;
alter table public.companies add column if not exists billing_street text;
alter table public.companies add column if not exists billing_city text;
alter table public.companies add column if not exists billing_postal_code text;
alter table public.companies add column if not exists billing_country text default 'CZ';
alter table public.companies add column if not exists bank_account text;
alter table public.companies add column if not exists iban text;
alter table public.companies add column if not exists swift text;
alter table public.companies add column if not exists default_invoice_due_days integer default 14;

update public.companies
set
  billing_name = coalesce(billing_name, name),
  company_number = coalesce(company_number, ico),
  vat_number = coalesce(vat_number, dic),
  billing_country = coalesce(billing_country, 'CZ')
where billing_name is null
   or company_number is null
   or vat_number is null
   or billing_country is null;

alter table public.profiles add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.profiles add column if not exists default_hourly_rate numeric(12, 2) not null default 0;
alter table public.profiles add column if not exists hourly_rate numeric(12, 2) not null default 0;
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists position text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists color text;
alter table public.profiles add column if not exists advance_paid numeric(12, 2) not null default 0;

update public.profiles
set user_id = auth_user_id
where user_id is null
  and auth_user_id is not null;

alter table public.customers add column if not exists contact_name text;
alter table public.customers add column if not exists billing_name text;
alter table public.customers add column if not exists billing_street text;
alter table public.customers add column if not exists billing_city text;
alter table public.customers add column if not exists billing_postal_code text;
alter table public.customers add column if not exists billing_country text default 'CZ';

alter table public.customer_contacts add column if not exists full_name text;
alter table public.customer_contacts add column if not exists note text;
alter table public.customer_contacts add column if not exists updated_at timestamptz not null default now();

update public.customer_contacts
set full_name = coalesce(full_name, name)
where full_name is null;

-- 2. Jobs and worker runtime aliases
alter table public.jobs add column if not exists address text;
alter table public.jobs add column if not exists scheduled_date date;
alter table public.jobs add column if not exists start_at timestamptz;
alter table public.jobs add column if not exists end_at timestamptz;
alter table public.jobs add column if not exists billing_status text;
alter table public.jobs add column if not exists is_internal boolean not null default false;
alter table public.jobs add column if not exists is_paid boolean not null default false;
alter table public.jobs add column if not exists contact_id uuid references public.customer_contacts(id) on delete set null;
alter table public.jobs add column if not exists invoiced_at timestamptz;
alter table public.jobs add column if not exists due_date date;
alter table public.jobs add column if not exists paid_at timestamptz;
alter table public.jobs add column if not exists currency text not null default 'CZK';
alter table public.jobs add column if not exists customer_summary text;

update public.jobs
set
  start_at = coalesce(start_at, scheduled_start),
  end_at = coalesce(end_at, scheduled_end),
  scheduled_start = coalesce(scheduled_start, start_at),
  scheduled_end = coalesce(scheduled_end, end_at),
  scheduled_date = coalesce(scheduled_date, coalesce(start_at, scheduled_start)::date),
  address = coalesce(address, location),
  location = coalesce(location, address),
  billing_status = coalesce(billing_status, billing_state),
  billing_state = coalesce(billing_state, billing_status, 'waiting_for_invoice'),
  customer_summary = coalesce(customer_summary, title)
where true;

alter table public.job_assignments add column if not exists labor_hours numeric(12, 2) not null default 0;
alter table public.job_assignments add column if not exists hourly_rate numeric(12, 2) not null default 0;
alter table public.job_assignments add column if not exists labor_cost numeric(12, 2) not null default 0;
alter table public.job_assignments add column if not exists started_at timestamptz;
alter table public.job_assignments add column if not exists completed_at timestamptz;
alter table public.job_assignments add column if not exists status text not null default 'assigned';
alter table public.job_assignments add column if not exists role_label text default 'worker';
alter table public.job_assignments add column if not exists hours_override numeric(12, 2);
alter table public.job_assignments add column if not exists archived_at timestamptz;
alter table public.job_assignments add column if not exists updated_at timestamptz not null default now();

update public.job_assignments ja
set
  started_at = coalesce(started_at, work_started_at),
  completed_at = coalesce(completed_at, work_completed_at),
  work_started_at = coalesce(work_started_at, started_at),
  work_completed_at = coalesce(work_completed_at, completed_at),
  labor_hours = coalesce(
    nullif(labor_hours, 0),
    case
      when coalesce(work_completed_at, completed_at) is not null
       and coalesce(work_started_at, started_at) is not null
      then round((extract(epoch from (coalesce(work_completed_at, completed_at) - coalesce(work_started_at, started_at))) / 3600.0)::numeric, 2)
      else 0
    end
  ),
  labor_cost = coalesce(nullif(labor_cost, 0), coalesce(nullif(hourly_rate, 0), 0) * coalesce(nullif(labor_hours, 0), 0)),
  status = case
    when coalesce(work_completed_at, completed_at) is not null then 'completed'
    when coalesce(work_started_at, started_at) is not null then 'in_progress'
    else coalesce(status, 'assigned')
  end
where true;

alter table public.work_shifts add column if not exists job_id uuid references public.jobs(id) on delete set null;
alter table public.work_shifts add column if not exists shift_date date;
alter table public.work_shifts add column if not exists hours_override numeric(12, 2);
alter table public.work_shifts add column if not exists job_hours_override numeric(12, 2);
alter table public.work_shifts add column if not exists status text not null default 'planned';
alter table public.work_shifts add column if not exists updated_at timestamptz not null default now();

update public.work_shifts
set shift_date = coalesce(shift_date, started_at::date, created_at::date)
where shift_date is null;

alter table public.work_logs add column if not exists hours numeric(12, 2) not null default 0;
alter table public.work_logs add column if not exists work_date date;
alter table public.work_logs add column if not exists archived_at timestamptz;
alter table public.work_logs add column if not exists updated_at timestamptz not null default now();

update public.work_logs
set
  work_date = coalesce(work_date, started_at::date, created_at::date),
  hours = coalesce(
    nullif(hours, 0),
    case
      when ended_at is not null and started_at is not null
      then round((extract(epoch from (ended_at - started_at)) / 3600.0)::numeric, 2)
      else 0
    end
  )
where true;

alter table public.job_cost_items add column if not exists cost_type text default 'other';
alter table public.job_cost_items add column if not exists title text;
alter table public.job_cost_items add column if not exists quantity numeric(12, 2) not null default 1;
alter table public.job_cost_items add column if not exists unit text;
alter table public.job_cost_items add column if not exists unit_price numeric(12, 2) not null default 0;
alter table public.job_cost_items add column if not exists total_price numeric(12, 2) not null default 0;
alter table public.job_cost_items add column if not exists updated_at timestamptz not null default now();

update public.job_cost_items
set
  title = coalesce(title, name),
  unit_price = case when unit_price = 0 then amount else unit_price end,
  total_price = case when total_price = 0 then coalesce(amount, 0) else total_price end,
  amount = case when amount = 0 then coalesce(total_price, quantity * unit_price, 0) else amount end
where true;

create table if not exists public.job_customer_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  customer_contact_id uuid references public.customer_contacts(id) on delete set null,
  role_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, customer_contact_id)
);

-- 3. Absences and advances
create table if not exists public.absence_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  absence_mode text not null default 'planned',
  absence_type text not null default 'planned',
  start_at timestamptz,
  end_at timestamptz,
  status text not null default 'pending',
  note text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.absences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'planned',
  status text not null default 'pending',
  date_from date,
  date_to date,
  reason text,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.advance_requests add column if not exists requested_amount numeric(12, 2);
alter table public.advance_requests add column if not exists payroll_month date;
alter table public.advance_requests add column if not exists requested_for_month date;
alter table public.advance_requests add column if not exists reason text;
alter table public.advance_requests add column if not exists approved_by uuid references public.profiles(id) on delete set null;
alter table public.advance_requests add column if not exists rejected_at timestamptz;
alter table public.advance_requests add column if not exists reviewed_at timestamptz;
alter table public.advance_requests add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.advance_requests add column if not exists created_at timestamptz not null default now();
alter table public.advance_requests add column if not exists updated_at timestamptz not null default now();

update public.advance_requests
set
  requested_amount = coalesce(requested_amount, amount),
  amount = coalesce(amount, requested_amount),
  reviewed_at = coalesce(reviewed_at, approved_at, rejected_at),
  payroll_month = coalesce(payroll_month, requested_for_month, date_trunc('month', coalesce(paid_at, approved_at, requested_at, created_at))::date)
where true;

alter table public.worker_advances add column if not exists issued_at date;
alter table public.worker_advances add column if not exists advance_request_id uuid references public.advance_requests(id) on delete set null;
alter table public.worker_advances add column if not exists payroll_month date;
alter table public.worker_advances add column if not exists created_at timestamptz not null default now();
alter table public.worker_advances add column if not exists updated_at timestamptz not null default now();

update public.worker_advances
set
  issued_at = coalesce(issued_at, paid_at::date, created_at::date),
  payroll_month = coalesce(payroll_month, date_trunc('month', coalesce(paid_at, created_at))::date)
where true;

create unique index if not exists worker_advances_advance_request_id_uidx
on public.worker_advances(advance_request_id)
where advance_request_id is not null;

alter table public.payroll_items add column if not exists payroll_month text;
alter table public.payroll_items
  alter column payroll_month type text
  using case
    when payroll_month is null then null
    when payroll_month::text ~ '^\d{4}-\d{2}$' then payroll_month::text
    else to_char(payroll_month::date, 'YYYY-MM')
  end;
alter table public.payroll_items add column if not exists item_type text not null default 'bonus';
alter table public.payroll_items add column if not exists updated_at timestamptz not null default now();

update public.payroll_items
set payroll_month = coalesce(payroll_month, to_char(period_month, 'YYYY-MM'))
where payroll_month is null;

-- 4. Calendar compatibility
alter table public.calendar_events add column if not exists start_at timestamptz;
alter table public.calendar_events add column if not exists end_at timestamptz;
alter table public.calendar_events add column if not exists updated_at timestamptz not null default now();

update public.calendar_events
set
  start_at = coalesce(start_at, starts_at),
  end_at = coalesce(end_at, ends_at),
  starts_at = coalesce(starts_at, start_at),
  ends_at = coalesce(ends_at, end_at)
where true;

alter table public.calendar_event_assignments add column if not exists event_id uuid references public.calendar_events(id) on delete cascade;

update public.calendar_event_assignments
set event_id = coalesce(event_id, calendar_event_id)
where event_id is null;

create unique index if not exists calendar_event_assignments_event_profile_uidx
on public.calendar_event_assignments(calendar_event_id, profile_id)
where calendar_event_id is not null;

create unique index if not exists calendar_event_assignments_event_alias_profile_uidx
on public.calendar_event_assignments(event_id, profile_id)
where event_id is not null;

-- 5. Quotes, invoices, and economics
alter table public.quotes add column if not exists quote_number text;
alter table public.quotes add column if not exists quote_date date;
alter table public.quotes add column if not exists valid_until date;
alter table public.quotes add column if not exists subtotal_price numeric(12, 2) not null default 0;
alter table public.quotes add column if not exists total_price numeric(12, 2) not null default 0;
alter table public.quotes add column if not exists currency text not null default 'CZK';
alter table public.quotes add column if not exists sent_at timestamptz;
alter table public.quotes add column if not exists viewed_at timestamptz;
alter table public.quotes add column if not exists accepted_at timestamptz;
alter table public.quotes add column if not exists rejected_at timestamptz;
alter table public.quotes add column if not exists share_token text;
alter table public.quotes add column if not exists source_calculation_id uuid;
alter table public.quotes add column if not exists created_by uuid references public.profiles(id) on delete set null;

update public.quotes
set
  quote_number = coalesce(quote_number, public_id, 'DQ-' || left(id::text, 8)),
  quote_date = coalesce(quote_date, created_at::date),
  valid_until = coalesce(valid_until, created_at::date + 14),
  total_price = case when total_price = 0 then coalesce(total_amount, 0) else total_price end,
  subtotal_price = case when subtotal_price = 0 then coalesce(total_amount, total_price, 0) else subtotal_price end,
  total_amount = case when total_amount = 0 then coalesce(total_price, 0) else total_amount end
where true;

alter table public.quote_items add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.quote_items add column if not exists unit text;
alter table public.quote_items add column if not exists vat_rate numeric(5, 2) not null default 21;
alter table public.quote_items add column if not exists note text;

update public.quote_items qi
set company_id = q.company_id
from public.quotes q
where qi.quote_id = q.id
  and qi.company_id is null;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  invoice_number text,
  number text,
  variable_symbol text,
  status text not null default 'draft',
  issued_at date,
  issue_date date,
  due_at date,
  due_date date,
  taxable_supply_date date,
  total_amount numeric(12, 2) not null default 0,
  total_without_vat numeric(12, 2) not null default 0,
  vat_amount numeric(12, 2) not null default 0,
  total_with_vat numeric(12, 2) not null default 0,
  currency text not null default 'CZK',
  supplier_snapshot jsonb,
  customer_snapshot jsonb,
  pohoda_export_status text not null default 'not_exported',
  pohoda_exported_at timestamptz,
  pohoda_last_error text,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoices add column if not exists job_id uuid references public.jobs(id) on delete set null;
alter table public.invoices add column if not exists invoice_number text;
alter table public.invoices add column if not exists number text;
alter table public.invoices add column if not exists variable_symbol text;
alter table public.invoices add column if not exists issued_at date;
alter table public.invoices add column if not exists issue_date date;
alter table public.invoices add column if not exists due_at date;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists taxable_supply_date date;
alter table public.invoices add column if not exists total_amount numeric(12, 2) not null default 0;
alter table public.invoices add column if not exists total_without_vat numeric(12, 2) not null default 0;
alter table public.invoices add column if not exists vat_amount numeric(12, 2) not null default 0;
alter table public.invoices add column if not exists total_with_vat numeric(12, 2) not null default 0;
alter table public.invoices add column if not exists currency text not null default 'CZK';
alter table public.invoices add column if not exists supplier_snapshot jsonb;
alter table public.invoices add column if not exists customer_snapshot jsonb;
alter table public.invoices add column if not exists pohoda_export_status text not null default 'not_exported';
alter table public.invoices add column if not exists pohoda_exported_at timestamptz;
alter table public.invoices add column if not exists pohoda_last_error text;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists cancelled_at timestamptz;

update public.invoices
set
  issue_date = coalesce(issue_date, issued_at::date, created_at::date),
  issued_at = coalesce(issued_at, issue_date::timestamptz, created_at),
  due_date = coalesce(due_date, due_at, issue_date + 14),
  due_at = coalesce(due_at, due_date, issue_date + 14),
  number = coalesce(number, invoice_number),
  invoice_number = coalesce(invoice_number, number),
  total_with_vat = case when total_with_vat = 0 then coalesce(total_amount, 0) else total_with_vat end,
  total_amount = case when total_amount = 0 then coalesce(total_with_vat, 0) else total_amount end
where true;

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  name text,
  item_name text,
  description text,
  quantity numeric(12, 2) not null default 1,
  unit text,
  unit_price numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  total_without_vat numeric(12, 2) not null default 0,
  vat_rate numeric(5, 2) not null default 21,
  vat_amount numeric(12, 2) not null default 0,
  total_with_vat numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoice_items add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.invoice_items add column if not exists name text;
alter table public.invoice_items add column if not exists item_name text;
alter table public.invoice_items add column if not exists description text;
alter table public.invoice_items add column if not exists quantity numeric(12, 2) not null default 1;
alter table public.invoice_items add column if not exists unit text;
alter table public.invoice_items add column if not exists unit_price numeric(12, 2) not null default 0;
alter table public.invoice_items add column if not exists total_price numeric(12, 2) not null default 0;
alter table public.invoice_items add column if not exists total_without_vat numeric(12, 2) not null default 0;
alter table public.invoice_items add column if not exists vat_rate numeric(5, 2) not null default 21;
alter table public.invoice_items add column if not exists vat_amount numeric(12, 2) not null default 0;
alter table public.invoice_items add column if not exists total_with_vat numeric(12, 2) not null default 0;
alter table public.invoice_items add column if not exists sort_order integer not null default 0;
alter table public.invoice_items add column if not exists updated_at timestamptz not null default now();

update public.invoice_items ii
set
  company_id = coalesce(ii.company_id, i.company_id),
  item_name = coalesce(ii.item_name, ii.name),
  name = coalesce(ii.name, ii.item_name),
  total_without_vat = case when ii.total_without_vat = 0 then coalesce(ii.total_price, ii.quantity * ii.unit_price, 0) else ii.total_without_vat end,
  total_price = case when ii.total_price = 0 then coalesce(ii.total_without_vat, ii.quantity * ii.unit_price, 0) else ii.total_price end,
  total_with_vat = case when ii.total_with_vat = 0 then coalesce(ii.total_price, ii.total_without_vat, ii.quantity * ii.unit_price, 0) else ii.total_with_vat end
from public.invoices i
where ii.invoice_id = i.id;

create table if not exists public.invoice_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(invoice_id, job_id)
);

-- 6. Leads/customer portal/mail compatibility columns used by API/portal pages
alter table public.leads add column if not exists name text;
alter table public.leads add column if not exists company_name text;
alter table public.leads add column if not exists email text;
alter table public.leads add column if not exists phone text;
alter table public.leads add column if not exists subject text;
alter table public.leads add column if not exists location_text text;
alter table public.leads add column if not exists customer_note text;
alter table public.leads add column if not exists preferred_month text;
alter table public.leads add column if not exists closed_at timestamptz;
alter table public.leads add column if not exists updated_at timestamptz not null default now();

update public.leads
set
  name = coalesce(name, customer_name),
  company_name = coalesce(company_name, customer_company),
  email = coalesce(email, customer_email),
  phone = coalesce(phone, customer_phone),
  subject = coalesce(subject, service_slug)
where true;

alter table public.customer_portal_users add column if not exists full_name text;
alter table public.customer_portal_users add column if not exists updated_at timestamptz not null default now();

-- 7. Runtime views
-- PostgreSQL cannot change existing view column order/names with CREATE OR REPLACE.
-- Drop only views, never tables/data, then recreate them with runtime-compatible columns.
drop view if exists public.worker_job_assignment_summary;
drop view if exists public.job_economics_summary;
drop view if exists public.work_shift_payroll_view;
drop view if exists public.jobs_with_state;

create or replace view public.jobs_with_state
with (security_invoker = true) as
with assignment_stats as (
  select
    ja.job_id,
    count(*)::integer as assigned_total,
    count(*) filter (where coalesce(ja.work_started_at, ja.started_at) is not null)::integer as started_total,
    count(*) filter (where coalesce(ja.work_completed_at, ja.completed_at) is not null)::integer as completed_total,
    count(*) filter (
      where coalesce(ja.work_started_at, ja.started_at) is not null
        and coalesce(ja.work_completed_at, ja.completed_at) is null
    )::integer as active_workers,
    coalesce(sum(coalesce(ja.labor_cost, ja.labor_hours * nullif(ja.hourly_rate, 0), 0)), 0)::numeric(12, 2) as assignment_labor_cost
  from public.job_assignments ja
  where ja.archived_at is null
  group by ja.job_id
),
log_labor as (
  select
    wl.job_id,
    coalesce(sum(
      coalesce(nullif(wl.hours, 0), extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0, 0)
      * coalesce(nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)
    ), 0)::numeric(12, 2) as labor_cost
  from public.work_logs wl
  left join public.profiles p on p.id = wl.profile_id
  where wl.job_id is not null
    and wl.archived_at is null
  group by wl.job_id
),
other_costs as (
  select
    jci.job_id,
    coalesce(sum(coalesce(nullif(jci.total_price, 0), jci.amount, 0)), 0)::numeric(12, 2) as other_costs
  from public.job_cost_items jci
  group by jci.job_id
)
select
  j.*,
  case
    when coalesce(j.start_at, j.scheduled_start) is not null
     and coalesce(j.start_at, j.scheduled_start) > now()
      then 'future'
    when coalesce(j.start_at, j.scheduled_start) is not null
     and coalesce(j.end_at, j.scheduled_end) is not null
     and now() between coalesce(j.start_at, j.scheduled_start) and coalesce(j.end_at, j.scheduled_end)
      then 'active'
    when coalesce(j.end_at, j.scheduled_end) is not null
     and coalesce(j.end_at, j.scheduled_end) < now()
      then 'finished'
    else 'unknown'
  end::text as time_state,
  coalesce(j.work_state, case when j.status = 'done' then 'done' when j.status = 'in_progress' then 'in_progress' else 'not_started' end)::text as work_state_resolved,
  coalesce(j.billing_state, j.billing_status, case when j.is_paid then 'paid' else 'waiting_for_invoice' end)::text as billing_state_resolved,
  coalesce(ll.labor_cost, ast.assignment_labor_cost, 0)::numeric(12, 2) as labor_cost,
  coalesce(oc.other_costs, 0)::numeric(12, 2) as other_costs,
  (coalesce(j.price, 0) - coalesce(ll.labor_cost, ast.assignment_labor_cost, 0) - coalesce(oc.other_costs, 0))::numeric(12, 2) as profit,
  coalesce(ast.assigned_total, 0)::integer as assigned_total,
  coalesce(ast.started_total, 0)::integer as started_total,
  coalesce(ast.completed_total, 0)::integer as completed_total,
  coalesce(ast.active_workers, 0)::integer as active_workers
from public.jobs j
left join assignment_stats ast on ast.job_id = j.id
left join log_labor ll on ll.job_id = j.id
left join other_costs oc on oc.job_id = j.id;

create or replace view public.work_shift_payroll_view
with (security_invoker = true) as
select
  ws.company_id,
  ws.profile_id,
  ws.id as shift_id,
  ws.started_at,
  ws.ended_at,
  coalesce(
    ws.hours_override,
    case
      when ws.started_at is not null and ws.ended_at is not null
      then round((extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0)::numeric, 2)
      else 0
    end
  )::numeric(12, 2) as hours,
  coalesce(nullif(ws.hourly_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)::numeric(12, 2) as hourly_rate,
  (
    coalesce(
      ws.hours_override,
      case
        when ws.started_at is not null and ws.ended_at is not null
        then extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0
        else 0
      end
    ) * coalesce(nullif(ws.hourly_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)
  )::numeric(12, 2) as total_pay
from public.work_shifts ws
left join public.profiles p on p.id = ws.profile_id;

create or replace view public.job_economics_summary
with (security_invoker = true) as
select
  j.id as job_id,
  j.company_id,
  coalesce(j.price, 0)::numeric(12, 2) as revenue_total,
  coalesce(sum(coalesce(nullif(wl.hours, 0), extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0, 0)), 0)::numeric(12, 2) as labor_hours_total,
  coalesce(jws.labor_cost, 0)::numeric(12, 2) as labor_cost_total,
  coalesce(jws.other_costs, 0)::numeric(12, 2) as other_cost_total,
  (coalesce(jws.labor_cost, 0) + coalesce(jws.other_costs, 0))::numeric(12, 2) as total_cost_total,
  coalesce(jws.profit, coalesce(j.price, 0) - coalesce(jws.labor_cost, 0) - coalesce(jws.other_costs, 0))::numeric(12, 2) as profit_total,
  case
    when coalesce(j.price, 0) = 0 then null
    else round(((coalesce(j.price, 0) - coalesce(jws.labor_cost, 0) - coalesce(jws.other_costs, 0)) / coalesce(j.price, 0) * 100)::numeric, 2)
  end as margin_percent
from public.jobs j
left join public.jobs_with_state jws on jws.id = j.id
left join public.work_logs wl on wl.job_id = j.id and wl.archived_at is null
group by j.id, j.company_id, j.price, jws.labor_cost, jws.other_costs, jws.profit;

create or replace view public.worker_job_assignment_summary
with (security_invoker = true) as
select
  ja.id as assignment_id,
  ja.job_id,
  ja.profile_id,
  coalesce(ja.labor_hours, 0)::numeric(12, 2) as labor_hours_total,
  coalesce(nullif(ja.hourly_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0)::numeric(12, 2) as effective_hourly_rate,
  coalesce(ja.labor_cost, ja.labor_hours * coalesce(nullif(ja.hourly_rate, 0), nullif(p.default_hourly_rate, 0), nullif(p.hourly_rate, 0), 0), 0)::numeric(12, 2) as labor_cost_total,
  'runtime_patch'::text as calculation_source
from public.job_assignments ja
left join public.profiles p on p.id = ja.profile_id
where ja.archived_at is null;

-- 8. Modules, indexes, grants, RLS enablement for fallback tables
insert into public.company_modules(company_id, module_key, is_enabled, created_at, updated_at)
select c.id, module_key, true, now(), now()
from public.companies c
cross join unnest(array[
  'dashboard',
  'jobs',
  'customers',
  'invoices',
  'workers',
  'calendar',
  'absences',
  'advance_requests',
  'quotes',
  'photos',
  'customer_portal'
]) as module_key
on conflict (company_id, module_key) do update
set is_enabled = true,
    updated_at = now();

insert into public.company_modules(company_id, module_key, is_enabled, created_at, updated_at)
select c.id, 'leads', false, now(), now()
from public.companies c
on conflict (company_id, module_key) do update
set is_enabled = false,
    updated_at = now();

create index if not exists jobs_company_start_idx on public.jobs(company_id, start_at);
create index if not exists jobs_company_scheduled_idx on public.jobs(company_id, scheduled_start);
create index if not exists job_assignments_job_idx on public.job_assignments(job_id);
create index if not exists job_assignments_profile_idx on public.job_assignments(profile_id);
create index if not exists work_shifts_profile_date_idx on public.work_shifts(profile_id, shift_date);
create index if not exists work_logs_profile_date_idx on public.work_logs(profile_id, work_date);
create index if not exists advance_requests_profile_status_idx on public.advance_requests(profile_id, status);
create index if not exists absence_requests_profile_status_idx on public.absence_requests(profile_id, status);
create index if not exists invoices_company_issue_idx on public.invoices(company_id, issue_date);
create index if not exists quotes_company_quote_date_idx on public.quotes(company_id, quote_date);

alter table public.job_customer_contacts enable row level security;
alter table public.absence_requests enable row level security;
alter table public.absences enable row level security;
alter table public.invoice_jobs enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['job_customer_contacts', 'absence_requests', 'absences', 'invoice_jobs'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = table_name || '_select_company_member'
    ) then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id))', table_name || '_select_company_member', table_name);
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname = table_name || '_admin_write'
    ) then
      execute format('create policy %I on public.%I for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id))', table_name || '_admin_write', table_name);
    end if;
  end loop;
end $$;

grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated, anon;

grant select on table public.jobs_with_state to authenticated;
grant select on table public.work_shift_payroll_view to authenticated;
grant select on table public.job_economics_summary to authenticated;
grant select on table public.worker_job_assignment_summary to authenticated;

do $$
begin
  if to_regprocedure('public.current_profile_id()') is not null then
    revoke all on function public.current_profile_id() from public;
    revoke all on function public.current_profile_id() from anon;
    grant execute on function public.current_profile_id() to authenticated;
  end if;
  if to_regprocedure('public.is_company_member(uuid)') is not null then
    revoke all on function public.is_company_member(uuid) from public;
    revoke all on function public.is_company_member(uuid) from anon;
    grant execute on function public.is_company_member(uuid) to authenticated;
  end if;
  if to_regprocedure('public.has_company_role(uuid, text[])') is not null then
    revoke all on function public.has_company_role(uuid, text[]) from public;
    revoke all on function public.has_company_role(uuid, text[]) from anon;
    grant execute on function public.has_company_role(uuid, text[]) to authenticated;
  end if;
  if to_regprocedure('public.is_company_admin(uuid)') is not null then
    revoke all on function public.is_company_admin(uuid) from public;
    revoke all on function public.is_company_admin(uuid) from anon;
    grant execute on function public.is_company_admin(uuid) to authenticated;
  end if;
  if to_regprocedure('public.job_company_id(uuid)') is not null then
    revoke all on function public.job_company_id(uuid) from public;
    revoke all on function public.job_company_id(uuid) from anon;
    grant execute on function public.job_company_id(uuid) to authenticated;
  end if;
  if to_regprocedure('public.is_worker_assigned_to_job(uuid)') is not null then
    revoke all on function public.is_worker_assigned_to_job(uuid) from public;
    revoke all on function public.is_worker_assigned_to_job(uuid) from anon;
    grant execute on function public.is_worker_assigned_to_job(uuid) to authenticated;
  end if;
  if to_regprocedure('public.next_invoice_number(uuid, integer)') is not null then
    revoke all on function public.next_invoice_number(uuid, integer) from public;
    revoke all on function public.next_invoice_number(uuid, integer) from anon;
    grant execute on function public.next_invoice_number(uuid, integer) to authenticated;
  end if;
  if to_regprocedure('public.create_public_lead(uuid, text, text, text, text, text, text, text, text)') is not null then
    revoke all on function public.create_public_lead(uuid, text, text, text, text, text, text, text, text) from public;
    revoke all on function public.create_public_lead(uuid, text, text, text, text, text, text, text, text) from anon;
    grant execute on function public.create_public_lead(uuid, text, text, text, text, text, text, text, text) to authenticated;
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public;
    revoke all on function public.rls_auto_enable() from anon;
    grant execute on function public.rls_auto_enable() to authenticated;
  end if;
end $$;

drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write
on public.profiles
for all
to authenticated
using (
  auth_user_id = auth.uid()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.company_members cm
    where cm.profile_id = profiles.id
      and public.is_company_admin(cm.company_id)
  )
)
with check (
  auth_user_id = auth.uid()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.company_members cm
    where cm.profile_id = profiles.id
      and public.is_company_admin(cm.company_id)
  )
);

-- 9. Verification queries to run manually after patch
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'jobs_with_state' and column_name in ('assigned_total','completed_total','started_total','time_state','work_state_resolved','billing_state_resolved','labor_cost','other_costs','profit') order by column_name;
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'invoices' and column_name in ('pohoda_exported_at','pohoda_export_status','issue_date','due_date','total_with_vat','total_amount') order by column_name;
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'job_assignments' and column_name in ('labor_hours','hourly_rate','labor_cost','started_at','completed_at','status') order by column_name;
-- select column_name from information_schema.columns where table_schema = 'public' and table_name = 'advance_requests' and column_name in ('requested_amount','amount','payroll_month','requested_for_month','approved_by','approved_at','rejected_at','paid_at','note','created_at','updated_at') order by column_name;
