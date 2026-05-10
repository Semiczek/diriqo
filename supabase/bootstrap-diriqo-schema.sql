-- Diriqo clean database bootstrap.
-- Target: new empty Supabase project.
-- Safety: no drop table, no production data, no destructive data changes.

-- 1. Extensions
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- 2. Helper functions
create or replace function public.current_profile_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  select p.id into result_id
  from public.profiles p
  where p.auth_user_id = auth.uid()
     or p.user_id = auth.uid()
  order by p.created_at asc
  limit 1;

  return result_id;
end;
$$;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_company_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  );
end;
$$;

create or replace function public.has_company_role(target_company_id uuid, allowed_roles text[])
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_company_id
      and cm.is_active = true
      and lower(coalesce(cm.role, '')) = any(allowed_roles)
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  );
end;
$$;

create or replace function public.is_company_admin(target_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.has_company_role(target_company_id, array['super_admin', 'company_admin', 'manager']);
end;
$$;

create or replace function public.job_company_id(target_job_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result_id uuid;
begin
  select company_id into result_id from public.jobs where id = target_job_id;
  return result_id;
end;
$$;

create or replace function public.is_worker_assigned_to_job(target_job_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return exists (
    select 1
    from public.job_assignments ja
    where ja.job_id = target_job_id
      and ja.profile_id = public.current_profile_id()
  );
end;
$$;

-- 3. Tables
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ico text null,
  dic text null,
  address text null,
  email text null,
  phone text null,
  billing_name text null,
  company_number text null,
  vat_number text null,
  billing_street text null,
  billing_city text null,
  billing_postal_code text null,
  billing_country text null,
  bank_account_number text null,
  bank_code text null,
  iban text null,
  swift_bic text null,
  domain text null,
  ares_last_checked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null references auth.users(id) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  full_name text not null,
  email text null,
  phone text null,
  role text null,
  hourly_rate numeric(12, 2) not null default 0,
  default_hourly_rate numeric(12, 2) not null default 0,
  advance_paid numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'worker',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, profile_id)
);

create table if not exists public.company_modules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_key text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, module_key)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  type text null,
  email text null,
  phone text null,
  address text null,
  note text null,
  contact_name text null,
  billing_name text null,
  billing_street text null,
  billing_city text null,
  billing_postal_code text null,
  billing_country text null,
  company_number text null,
  vat_number text null,
  ares_last_checked_at timestamptz null,
  web_lead_source text null,
  web_lead_locale text null,
  web_lead_service_slug text null,
  web_lead_message text null,
  web_lead_status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  email text null,
  phone text null,
  role text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  contact_id uuid null references public.customer_contacts(id) on delete set null,
  parent_job_id uuid null references public.jobs(id) on delete set null,
  title text not null,
  description text null,
  location text null,
  address text null,
  scheduled_start timestamptz null,
  scheduled_end timestamptz null,
  start_at timestamptz null,
  end_at timestamptz null,
  status text not null default 'planned',
  work_state text not null default 'not_started',
  billing_state text not null default 'waiting_for_invoice',
  billing_status text null,
  price numeric(12, 2) not null default 0,
  currency text not null default 'CZK',
  internal_note text null,
  is_paid boolean not null default false,
  is_internal boolean not null default false,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_label text null default 'worker',
  hourly_rate numeric(12, 2) not null default 0,
  hours_override numeric(12, 2) null,
  work_started_at timestamptz null,
  work_completed_at timestamptz null,
  note text null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, profile_id)
);

create table if not exists public.work_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid null references public.jobs(id) on delete set null,
  shift_date date null,
  started_at timestamptz null,
  ended_at timestamptz null,
  hourly_rate numeric(12, 2) not null default 0,
  hours_override numeric(12, 2) null,
  job_hours_override numeric(12, 2) null,
  status text null default 'planned',
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid null references public.jobs(id) on delete set null,
  shift_id uuid null references public.work_shifts(id) on delete set null,
  started_at timestamptz null,
  ended_at timestamptz null,
  note text null,
  created_at timestamptz not null default now()
);

create table if not exists public.job_cost_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null default '',
  title text null,
  cost_type text null,
  amount numeric(12, 2) not null default 0,
  quantity numeric(12, 2) not null default 1,
  unit text null,
  unit_price numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text null,
  created_at timestamptz not null default now()
);

create table if not exists public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.job_checklists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  template_id uuid null references public.checklist_templates(id) on delete set null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_checklist_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  job_checklist_id uuid not null references public.job_checklists(id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid null references public.jobs(id) on delete set null,
  created_by uuid null references public.profiles(id) on delete set null,
  assigned_to uuid null references public.profiles(id) on delete set null,
  title text not null,
  description text null,
  priority text not null default 'normal',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid null references public.jobs(id) on delete set null,
  title text not null,
  description text null,
  starts_at timestamptz null,
  ends_at timestamptz null,
  start_at timestamptz null,
  end_at timestamptz null,
  location text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_event_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  calendar_event_id uuid null references public.calendar_events(id) on delete cascade,
  event_id uuid null references public.calendar_events(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(calendar_event_id, profile_id),
  unique(event_id, profile_id)
);

create table if not exists public.calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
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
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calculation_items (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references public.calculations(id) on delete cascade,
  sort_order integer not null default 0,
  item_type text null,
  name text not null,
  description text null,
  quantity numeric(12, 2) not null default 1,
  unit text null,
  unit_cost numeric(12, 2) not null default 0,
  unit_price numeric(12, 2) not null default 0,
  total_cost numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  note text null,
  created_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  source_calculation_id uuid null references public.calculations(id) on delete set null,
  title text not null,
  status text not null default 'draft',
  public_id text unique,
  quote_number text null,
  quote_date date not null default current_date,
  valid_until date null,
  customer_note text null,
  internal_note text null,
  subtotal_price numeric(12, 2) not null default 0,
  discount_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  currency text not null default 'CZK',
  share_token text null unique,
  share_enabled boolean not null default false,
  sent_at timestamptz null,
  accepted_at timestamptz null,
  rejected_at timestamptz null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  sort_order integer not null default 0,
  name text not null,
  description text null,
  quantity numeric(12, 2) not null default 1,
  unit text null,
  unit_price numeric(12, 2) not null default 0,
  total_price numeric(12, 2) generated always as (quantity * unit_price) stored,
  note text null,
  created_at timestamptz not null default now()
);

create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  uploaded_by uuid null references public.profiles(id) on delete set null,
  photo_type text null,
  storage_path text not null,
  thumb_storage_path text null,
  file_name text null,
  note text null,
  mime_type text null,
  size_bytes bigint null,
  thumb_size_bytes bigint null,
  taken_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  worker_id uuid null references public.profiles(id) on delete cascade,
  period_month date not null,
  payroll_month date null,
  amount numeric(12, 2) not null default 0,
  note text null,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payroll_month text not null,
  amount numeric(12, 2) not null default 0,
  status text not null default 'paid',
  paid_at timestamptz not null default now(),
  paid_by uuid null references public.profiles(id) on delete set null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_payments_month_format check (payroll_month ~ '^\d{4}-\d{2}$'),
  constraint payroll_payments_status_check check (status in ('paid')),
  constraint payroll_payments_company_profile_month_unique unique(company_id, profile_id, payroll_month)
);

create table if not exists public.advance_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12, 2) not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  approved_at timestamptz null,
  paid_at timestamptz null,
  payroll_month date null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.absence_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  absence_mode text not null default 'planned',
  absence_type text not null default 'planned',
  start_at timestamptz null,
  end_at timestamptz null,
  note text null,
  status text not null default 'pending',
  reviewed_at timestamptz null,
  reviewed_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.worker_advances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12, 2) not null,
  paid_at timestamptz not null default now(),
  payroll_month date null,
  advance_request_id uuid null references public.advance_requests(id) on delete set null,
  note text null,
  created_at timestamptz not null default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null,
  website_locale text null,
  service_slug text null,
  customer_name text not null,
  customer_company text null,
  customer_email text not null,
  customer_phone text null,
  message text not null,
  page_url text null,
  referrer text null,
  user_agent text null,
  status text not null default 'new',
  created_customer_id uuid null references public.customers(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_portal_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  contact_id uuid null references public.customer_contacts(id) on delete set null,
  auth_user_id uuid null references auth.users(id) on delete set null,
  email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, email)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_number text null,
  invoice_year integer not null default extract(year from current_date)::integer,
  variable_symbol text null,
  status text not null default 'draft',
  currency text not null default 'CZK',
  issue_date date not null default current_date,
  taxable_supply_date date not null default current_date,
  due_date date not null default (current_date + interval '14 days')::date,
  payment_method text not null default 'bank_transfer',
  is_vat_payer boolean not null default true,
  vat_note text null,
  subtotal_without_vat numeric(12, 2) not null default 0,
  vat_total numeric(12, 2) not null default 0,
  total_with_vat numeric(12, 2) not null default 0,
  customer_snapshot jsonb not null default '{}'::jsonb,
  supplier_snapshot jsonb not null default '{}'::jsonb,
  note text null,
  issued_at timestamptz null,
  sent_at timestamptz null,
  paid_at timestamptz null,
  cancelled_at timestamptz null,
  created_by uuid null references public.profiles(id) on delete set null,
  pohoda_export_status text not null default 'not_exported',
  pohoda_exported_at timestamptz null,
  pohoda_external_id text null,
  pohoda_last_error text null,
  pohoda_last_export_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, invoice_number)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sort_order integer not null default 0,
  source_job_id uuid null references public.jobs(id) on delete set null,
  item_name text not null,
  description text null,
  quantity numeric(12, 2) not null default 1,
  unit text null default 'ks',
  unit_price_without_vat numeric(12, 2) not null default 0,
  vat_rate numeric(5, 2) not null default 21,
  vat_amount numeric(12, 2) not null default 0,
  total_without_vat numeric(12, 2) not null default 0,
  total_with_vat numeric(12, 2) not null default 0,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_jobs (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  is_active boolean not null default true,
  linked_at timestamptz not null default now(),
  primary key (invoice_id, job_id)
);

create table if not exists public.invoice_number_sequences (
  company_id uuid not null references public.companies(id) on delete cascade,
  year integer not null,
  last_number integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, year)
);

create table if not exists public.pohoda_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  export_type text not null default 'issued_invoices',
  status text not null default 'pending',
  file_path text null,
  xml_content text null,
  invoice_count integer not null default 0,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  exported_at timestamptz null,
  error_message text null
);

create table if not exists public.pohoda_export_invoices (
  export_id uuid not null references public.pohoda_exports(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'included',
  error_message text null,
  created_at timestamptz not null default now(),
  primary key (export_id, invoice_id)
);

create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email_address text not null,
  provider_type text not null default 'resend',
  is_active boolean not null default true,
  is_default_outbound boolean not null default false,
  is_default_inbound boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, email_address)
);

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailbox_id uuid null references public.mailboxes(id) on delete set null,
  related_entity_type text null,
  related_entity_id uuid null,
  customer_id uuid null references public.customers(id) on delete set null,
  contact_id uuid null references public.customer_contacts(id) on delete set null,
  subject_original text null,
  subject_normalized text null,
  status text not null default 'open',
  has_unread_inbound boolean not null default false,
  last_message_at timestamptz null,
  last_inbound_at timestamptz null,
  last_outbound_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailbox_id uuid null references public.mailboxes(id) on delete set null,
  thread_id uuid null references public.message_threads(id) on delete set null,
  related_entity_type text null,
  related_entity_id uuid null,
  customer_id uuid null references public.customers(id) on delete set null,
  contact_id uuid null references public.customer_contacts(id) on delete set null,
  message_type text not null default 'transactional',
  to_email text not null,
  to_name text null,
  cc text null,
  bcc text null,
  reply_to text null,
  subject_rendered text not null,
  html_rendered text null,
  text_rendered text null,
  provider text null,
  provider_message_id text null,
  internet_message_id text null,
  tracking_token text null,
  status text not null default 'queued',
  error_code text null,
  error_message text null,
  triggered_by_user_id uuid null references public.profiles(id) on delete set null,
  triggered_automatically boolean not null default false,
  sent_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mailbox_id uuid null references public.mailboxes(id) on delete set null,
  thread_id uuid null references public.message_threads(id) on delete set null,
  related_entity_type text null,
  related_entity_id uuid null,
  customer_id uuid null references public.customers(id) on delete set null,
  contact_id uuid null references public.customer_contacts(id) on delete set null,
  from_email text not null,
  from_name text null,
  to_email text null,
  subject text null,
  subject_normalized text null,
  html_body text null,
  text_body text null,
  provider text null,
  provider_message_id text null,
  internet_message_id text null,
  tracking_token text null,
  matched_by text null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  thread_id uuid null references public.message_threads(id) on delete set null,
  outbound_message_id uuid null references public.outbound_messages(id) on delete set null,
  inbound_message_id uuid null references public.inbound_messages(id) on delete set null,
  event_type text not null,
  provider_event_id text null,
  provider_payload jsonb null,
  note text null,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  quote_id uuid null references public.quotes(id) on delete cascade,
  event_type text not null,
  section_key text null,
  event_value text null,
  visitor_id text null,
  referrer text null,
  created_at timestamptz not null default now()
);

create table if not exists public.offer_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  quote_id uuid null references public.quotes(id) on delete cascade,
  action_type text not null,
  customer_name text null,
  customer_email text null,
  customer_phone text null,
  note text null,
  visitor_id text null,
  created_at timestamptz not null default now()
);

-- 4. Indexes
create index if not exists company_members_profile_idx on public.company_members(profile_id, is_active);
create index if not exists customers_company_idx on public.customers(company_id, created_at desc);
create index if not exists customer_contacts_customer_idx on public.customer_contacts(customer_id);
create index if not exists jobs_company_idx on public.jobs(company_id, created_at desc);
create index if not exists jobs_customer_idx on public.jobs(customer_id, start_at desc);
create index if not exists job_assignments_profile_idx on public.job_assignments(profile_id);
create index if not exists work_shifts_company_profile_idx on public.work_shifts(company_id, profile_id, started_at desc);
create index if not exists work_logs_company_job_idx on public.work_logs(company_id, job_id);
create index if not exists job_cost_items_job_idx on public.job_cost_items(job_id);
create index if not exists calendar_events_company_idx on public.calendar_events(company_id, start_at);
create index if not exists quotes_company_idx on public.quotes(company_id, created_at desc);
create index if not exists invoices_company_idx on public.invoices(company_id, issue_date desc);
create index if not exists mailboxes_company_idx on public.mailboxes(company_id);
create index if not exists message_threads_company_idx on public.message_threads(company_id, last_message_at desc);
create index if not exists outbound_messages_thread_idx on public.outbound_messages(thread_id, created_at desc);
create index if not exists inbound_messages_thread_idx on public.inbound_messages(thread_id, received_at desc);

-- 5. Views and RPC helpers
create or replace view public.jobs_with_state as
with costs as (
  select
    job_id,
    sum(coalesce(nullif(total_price, 0), nullif(amount, 0), quantity * unit_price, 0))::numeric(12, 2) as other_costs
  from public.job_cost_items
  group by job_id
),
labor as (
  select
    wl.job_id,
    sum(
      coalesce(
        extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0,
        0
      ) * coalesce(p.default_hourly_rate, p.hourly_rate, 0)
    )::numeric(12, 2) as labor_cost
  from public.work_logs wl
  left join public.profiles p on p.id = wl.profile_id
  where wl.job_id is not null
    and wl.started_at is not null
    and wl.ended_at is not null
    and wl.ended_at > wl.started_at
  group by wl.job_id
)
select
  j.*,
  case
    when coalesce(j.scheduled_start, j.start_at) > now() then 'future'
    when coalesce(j.scheduled_start, j.start_at) <= now()
      and coalesce(j.scheduled_end, j.end_at) >= now() then 'active'
    when coalesce(j.scheduled_end, j.end_at) < now() then 'finished'
    else 'unknown'
  end as time_state,
  coalesce(j.work_state, 'not_started') as work_state_resolved,
  coalesce(j.billing_state, j.billing_status, 'waiting_for_invoice') as billing_state_resolved,
  coalesce(l.labor_cost, 0::numeric)::numeric(12, 2) as labor_cost,
  coalesce(c.other_costs, 0::numeric)::numeric(12, 2) as other_costs,
  (coalesce(j.price, 0::numeric) - coalesce(l.labor_cost, 0::numeric) - coalesce(c.other_costs, 0::numeric))::numeric(12, 2) as profit
from public.jobs j
left join costs c on c.job_id = j.id
left join labor l on l.job_id = j.id;

create or replace view public.work_shift_payroll_view as
select
  ws.company_id,
  ws.profile_id,
  ws.id as shift_id,
  ws.started_at,
  ws.ended_at,
  coalesce(
    ws.hours_override,
    extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0,
    0
  )::numeric(12, 2) as hours,
  coalesce(nullif(ws.hourly_rate, 0), p.default_hourly_rate, p.hourly_rate, 0)::numeric(12, 2) as hourly_rate,
  (
    coalesce(ws.hours_override, extract(epoch from (ws.ended_at - ws.started_at)) / 3600.0, 0)
    * coalesce(nullif(ws.hourly_rate, 0), p.default_hourly_rate, p.hourly_rate, 0)
  )::numeric(12, 2) as total_pay
from public.work_shifts ws
left join public.profiles p on p.id = ws.profile_id;

create or replace view public.job_economics_summary as
select
  j.id as job_id,
  j.company_id,
  coalesce(sum(extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0), 0)::numeric(12, 2) as labor_hours_total,
  coalesce(sum((extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0) * coalesce(p.default_hourly_rate, p.hourly_rate, 0)), 0)::numeric(12, 2) as labor_cost_total,
  coalesce(max(jws.other_costs), 0)::numeric(12, 2) as other_cost_total,
  coalesce(max(j.price), 0)::numeric(12, 2) as revenue_total,
  (coalesce(max(jws.labor_cost), 0) + coalesce(max(jws.other_costs), 0))::numeric(12, 2) as total_cost_total,
  coalesce(max(jws.profit), 0)::numeric(12, 2) as profit_total,
  case when coalesce(max(j.price), 0) = 0 then null
    else round((coalesce(max(jws.profit), 0) / max(j.price)) * 100, 2)
  end as margin_percent,
  'mvp'::text as labor_source
from public.jobs j
left join public.jobs_with_state jws on jws.id = j.id
left join public.work_logs wl on wl.job_id = j.id and wl.ended_at > wl.started_at
left join public.profiles p on p.id = wl.profile_id
group by j.id, j.company_id;

create or replace view public.worker_job_assignment_summary as
select
  ja.id as assignment_id,
  ja.job_id,
  ja.profile_id,
  coalesce(sum(extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0), 0)::numeric(12, 2) as labor_hours_total,
  coalesce(max(nullif(ja.hourly_rate, 0)), max(p.default_hourly_rate), max(p.hourly_rate), 0)::numeric(12, 2) as effective_hourly_rate,
  (
    coalesce(sum(extract(epoch from (wl.ended_at - wl.started_at)) / 3600.0), 0)
    * coalesce(max(nullif(ja.hourly_rate, 0)), max(p.default_hourly_rate), max(p.hourly_rate), 0)
  )::numeric(12, 2) as labor_cost_total,
  'mvp'::text as calculation_source
from public.job_assignments ja
left join public.work_logs wl on wl.job_id = ja.job_id and wl.profile_id = ja.profile_id and wl.ended_at > wl.started_at
left join public.profiles p on p.id = ja.profile_id
where ja.archived_at is null
group by ja.id, ja.job_id, ja.profile_id;

create or replace function public.next_invoice_number(target_company_id uuid, target_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  insert into public.invoice_number_sequences(company_id, year, last_number)
  values (target_company_id, target_year, 1)
  on conflict (company_id, year)
  do update set
    last_number = public.invoice_number_sequences.last_number + 1,
    updated_at = now()
  returning last_number into next_number;

  return target_year::text || '-' || lpad(next_number::text, 4, '0');
end;
$$;

create or replace function public.create_public_lead(
  p_company_id uuid,
  p_name text,
  p_company_name text,
  p_email text,
  p_phone text,
  p_message text,
  p_service_slug text,
  p_website_locale text,
  p_source text
)
returns table(success boolean, error text, lead_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id uuid;
begin
  insert into public.leads(
    company_id, source, website_locale, service_slug, customer_name, customer_company,
    customer_email, customer_phone, message, page_url, referrer, user_agent, created_at
  )
  values (
    p_company_id, p_source, p_website_locale, p_service_slug, p_name, p_company_name,
    p_email, p_phone, p_message, null, null, null, now()
  )
  returning id into inserted_id;

  return query select true, null::text, inserted_id;
exception
  when others then
    return query select false, sqlerrm, null::uuid;
end;
$$;

-- 5b. API grants
-- Supabase PostgREST still requires table/view/function privileges; RLS then filters rows.
grant usage on schema public to authenticated, anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant usage, select on all sequences in schema public to authenticated;
grant usage, select on all sequences in schema public to anon;

grant select on table public.jobs_with_state to authenticated;
grant select on table public.work_shift_payroll_view to authenticated;
grant select on table public.job_economics_summary to authenticated;
grant select on table public.worker_job_assignment_summary to authenticated;

grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.has_company_role(uuid, text[]) to authenticated;
grant execute on function public.is_company_admin(uuid) to authenticated;
grant execute on function public.job_company_id(uuid) to authenticated;
grant execute on function public.is_worker_assigned_to_job(uuid) to authenticated;
grant execute on function public.next_invoice_number(uuid, integer) to authenticated;
grant execute on function public.create_public_lead(uuid, text, text, text, text, text, text, text, text) to authenticated;

revoke all on function public.current_profile_id() from public;
revoke all on function public.is_company_member(uuid) from public;
revoke all on function public.has_company_role(uuid, text[]) from public;
revoke all on function public.is_company_admin(uuid) from public;
revoke all on function public.job_company_id(uuid) from public;
revoke all on function public.is_worker_assigned_to_job(uuid) from public;
revoke all on function public.next_invoice_number(uuid, integer) from public;
revoke all on function public.create_public_lead(uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.create_public_lead(uuid, text, text, text, text, text, text, text, text) from anon;

-- 6. RLS
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'companies', 'profiles', 'company_members', 'company_modules',
    'customers', 'customer_contacts', 'jobs', 'job_assignments',
    'work_shifts', 'work_logs', 'job_cost_items',
    'checklist_templates', 'checklist_template_items', 'job_checklists', 'job_checklist_items',
    'issues', 'calendar_events', 'calendar_event_assignments',
    'calculations', 'calculation_items', 'quotes', 'quote_items',
    'job_photos', 'payroll_items', 'payroll_payments', 'advance_requests', 'worker_advances', 'leads',
    'absence_requests',
    'customer_portal_users', 'invoices', 'invoice_items', 'invoice_jobs',
    'invoice_number_sequences', 'pohoda_exports', 'pohoda_export_invoices',
    'mailboxes', 'message_threads', 'outbound_messages', 'inbound_messages', 'message_events',
    'offer_events', 'offer_responses'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'company_modules', 'customers', 'customer_contacts', 'jobs', 'work_shifts', 'work_logs',
    'checklist_templates', 'issues', 'calendar_events', 'calculations', 'quotes',
    'job_photos', 'payroll_items', 'payroll_payments', 'advance_requests', 'worker_advances', 'leads',
    'absence_requests',
    'customer_portal_users', 'invoices', 'invoice_number_sequences', 'pohoda_exports',
    'mailboxes', 'message_threads', 'outbound_messages', 'inbound_messages', 'message_events',
    'offer_events', 'offer_responses'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name and policyname = table_name || '_select_company_member'
    ) then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id))', table_name || '_select_company_member', table_name);
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name and policyname = table_name || '_admin_write'
    ) then
      execute format('create policy %I on public.%I for all to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id))', table_name || '_admin_write', table_name);
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_select_member') then
    create policy companies_select_member on public.companies
    for select to authenticated
    using (public.is_company_member(id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'companies' and policyname = 'companies_admin_write') then
    create policy companies_admin_write on public.companies
    for all to authenticated
    using (public.is_company_admin(id))
    with check (public.is_company_admin(id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_related') then
    create policy profiles_select_related on public.profiles
    for select to authenticated
    using (
      auth_user_id = auth.uid()
      or user_id = auth.uid()
      or exists (
        select 1
        from public.company_members cm
        where cm.profile_id = profiles.id
          and cm.is_active = true
          and public.is_company_member(cm.company_id)
      )
    );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_admin_write') then
    create policy profiles_admin_write on public.profiles
    for all to authenticated
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
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_members' and policyname = 'company_members_select_member') then
    create policy company_members_select_member on public.company_members
    for select to authenticated
    using (public.is_company_member(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'company_members' and policyname = 'company_members_admin_write') then
    create policy company_members_admin_write on public.company_members
    for all to authenticated
    using (public.is_company_admin(company_id))
    with check (public.is_company_admin(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_assignments' and policyname = 'job_assignments_select_member_or_own') then
    create policy job_assignments_select_member_or_own on public.job_assignments
    for select to authenticated
    using (
      profile_id = public.current_profile_id()
      or public.is_company_member(coalesce(company_id, public.job_company_id(job_id)))
    );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_assignments' and policyname = 'job_assignments_admin_write') then
    create policy job_assignments_admin_write on public.job_assignments
    for all to authenticated
    using (public.is_company_admin(coalesce(company_id, public.job_company_id(job_id))))
    with check (public.is_company_admin(coalesce(company_id, public.job_company_id(job_id))));
  end if;
end $$;

do $$
declare
  table_name text;
  company_expr text;
begin
  foreach table_name in array array['job_cost_items', 'job_checklists'] loop
    company_expr := 'coalesce(company_id, public.job_company_id(job_id))';

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = table_name and policyname = table_name || '_select_company_member') then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_company_member(%s))', table_name || '_select_company_member', table_name, company_expr);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = table_name and policyname = table_name || '_admin_write') then
      execute format('create policy %I on public.%I for all to authenticated using (public.is_company_admin(%s)) with check (public.is_company_admin(%s))', table_name || '_admin_write', table_name, company_expr, company_expr);
    end if;
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_select_company_member') then
    create policy invoice_items_select_company_member on public.invoice_items
    for select to authenticated
    using (exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and public.is_company_member(i.company_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_admin_write') then
    create policy invoice_items_admin_write on public.invoice_items
    for all to authenticated
    using (exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and public.is_company_admin(i.company_id)))
    with check (exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and public.is_company_admin(i.company_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quote_items' and policyname = 'quote_items_select_company_member') then
    create policy quote_items_select_company_member on public.quote_items
    for select to authenticated
    using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and public.is_company_member(q.company_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'quote_items' and policyname = 'quote_items_admin_write') then
    create policy quote_items_admin_write on public.quote_items
    for all to authenticated
    using (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and public.is_company_admin(q.company_id)))
    with check (exists (select 1 from public.quotes q where q.id = quote_items.quote_id and public.is_company_admin(q.company_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calculation_items' and policyname = 'calculation_items_select_company_member') then
    create policy calculation_items_select_company_member on public.calculation_items
    for select to authenticated
    using (exists (select 1 from public.calculations c where c.id = calculation_items.calculation_id and public.is_company_member(c.company_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calculation_items' and policyname = 'calculation_items_admin_write') then
    create policy calculation_items_admin_write on public.calculation_items
    for all to authenticated
    using (exists (select 1 from public.calculations c where c.id = calculation_items.calculation_id and public.is_company_admin(c.company_id)))
    with check (exists (select 1 from public.calculations c where c.id = calculation_items.calculation_id and public.is_company_admin(c.company_id)));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_event_assignments' and policyname = 'calendar_event_assignments_select_member_or_own') then
    create policy calendar_event_assignments_select_member_or_own on public.calendar_event_assignments
    for select to authenticated
    using (
      profile_id = public.current_profile_id()
      or exists (
        select 1
        from public.calendar_events ce
        where ce.id = coalesce(calendar_event_assignments.calendar_event_id, calendar_event_assignments.event_id)
          and public.is_company_member(ce.company_id)
      )
    );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calendar_event_assignments' and policyname = 'calendar_event_assignments_admin_write') then
    create policy calendar_event_assignments_admin_write on public.calendar_event_assignments
    for all to authenticated
    using (
      exists (
        select 1
        from public.calendar_events ce
        where ce.id = coalesce(calendar_event_assignments.calendar_event_id, calendar_event_assignments.event_id)
          and public.is_company_admin(ce.company_id)
      )
    )
    with check (
      exists (
        select 1
        from public.calendar_events ce
        where ce.id = coalesce(calendar_event_assignments.calendar_event_id, calendar_event_assignments.event_id)
          and public.is_company_admin(ce.company_id)
      )
    );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_jobs' and policyname = 'invoice_jobs_select_company_member') then
    create policy invoice_jobs_select_company_member on public.invoice_jobs
    for select to authenticated
    using (public.is_company_member(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_jobs' and policyname = 'invoice_jobs_admin_write') then
    create policy invoice_jobs_admin_write on public.invoice_jobs
    for all to authenticated
    using (public.is_company_admin(company_id))
    with check (public.is_company_admin(company_id));
  end if;
end $$;

create or replace function public.delete_job_safe(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_job record;
  job_ids uuid[];
  fk_row record;
begin
  if p_job_id is null then
    raise exception 'Missing job id.' using errcode = '22023';
  end if;

  select j.id, j.company_id
  into target_job
  from public.jobs j
  where j.id = p_job_id;

  if not found then
    raise exception 'Job was not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_job.company_id
      and cm.is_active = true
      and cm.role in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  ) then
    raise exception 'You do not have permission to delete this job.' using errcode = '42501';
  end if;

  job_ids := array[p_job_id];

  update public.jobs
  set parent_job_id = null
  where parent_job_id = p_job_id
    and company_id = target_job.company_id;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'work_shifts'
      and column_name = 'job_id'
  ) then
    update public.work_shifts
    set job_id = null
    where job_id = any(job_ids);
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoice_items'
      and column_name = 'source_job_id'
  ) then
    update public.invoice_items
    set source_job_id = null
    where source_job_id = any(job_ids);
  end if;

  for fk_row in
    select
      child_ns.nspname as child_schema,
      child_cls.relname as child_table,
      child_att.attname as child_column,
      child_att.attnotnull as child_not_null
    from pg_constraint con
    join pg_class parent_cls on parent_cls.oid = con.confrelid
    join pg_namespace parent_ns on parent_ns.oid = parent_cls.relnamespace
    join pg_class child_cls on child_cls.oid = con.conrelid
    join pg_namespace child_ns on child_ns.oid = child_cls.relnamespace
    join unnest(con.conkey) with ordinality as child_key(attnum, ord) on true
    join unnest(con.confkey) with ordinality as parent_key(attnum, ord) on parent_key.ord = child_key.ord
    join pg_attribute child_att on child_att.attrelid = child_cls.oid and child_att.attnum = child_key.attnum
    join pg_attribute parent_att on parent_att.attrelid = parent_cls.oid and parent_att.attnum = parent_key.attnum
    where con.contype = 'f'
      and parent_ns.nspname = 'public'
      and parent_cls.relname = 'jobs'
      and parent_att.attname = 'id'
      and array_length(con.conkey, 1) = 1
      and not (child_ns.nspname = 'public' and child_cls.relname = 'jobs' and child_att.attname = 'parent_job_id')
      and not (child_ns.nspname = 'public' and child_cls.relname = 'work_shifts' and child_att.attname = 'job_id')
      and not (child_ns.nspname = 'public' and child_cls.relname = 'invoice_items' and child_att.attname = 'source_job_id')
  loop
    if fk_row.child_not_null then
      execute format('delete from %I.%I where %I = any($1)', fk_row.child_schema, fk_row.child_table, fk_row.child_column) using job_ids;
    else
      execute format('update %I.%I set %I = null where %I = any($1)', fk_row.child_schema, fk_row.child_table, fk_row.child_column, fk_row.child_column) using job_ids;
    end if;
  end loop;

  delete from public.jobs
  where id = any(job_ids)
    and company_id = target_job.company_id;
end;
$$;

revoke all on function public.delete_job_safe(uuid) from public;
grant execute on function public.delete_job_safe(uuid) to authenticated;

-- 7. Storage notes
-- Create Supabase Storage bucket `job-photos` manually in the Supabase dashboard.
-- Recommended: private bucket; upload/download through signed URL API routes.
-- Optional storage policy sketch, review before use:
-- insert into storage.buckets (id, name, public) values ('job-photos', 'job-photos', false)
-- on conflict (id) do nothing;
-- Storage policies depend on the final path convention, so they are intentionally not enabled here.

-- 8. Demo seed compatibility notes
-- Run supabase/seed-demo-diriqo.sql after this bootstrap.
-- The bootstrap includes both MVP column names and app-compatible aliases:
-- jobs.scheduled_start plus jobs.start_at, jobs.location plus jobs.address,
-- calendar_events.starts_at plus calendar_events.start_at,
-- job_cost_items.name/amount plus title/quantity/unit_price/total_price.
-- Demo Auth users are not created by SQL; create them manually and link auth_user_id in profiles.
