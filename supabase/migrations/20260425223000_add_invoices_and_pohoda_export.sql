alter table public.companies
add column if not exists billing_name text null,
add column if not exists company_number text null,
add column if not exists vat_number text null,
add column if not exists billing_street text null,
add column if not exists billing_city text null,
add column if not exists billing_postal_code text null,
add column if not exists billing_country text null,
add column if not exists bank_account_number text null,
add column if not exists bank_code text null,
add column if not exists iban text null,
add column if not exists swift_bic text null,
add column if not exists ares_last_checked_at timestamptz null;

create table if not exists public.invoice_number_sequences (
  company_id uuid not null references public.companies(id) on delete cascade,
  year integer not null,
  last_number integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, year)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_number text null,
  invoice_year integer not null,
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
  customer_snapshot jsonb not null,
  supplier_snapshot jsonb not null,
  note text null,
  issued_at timestamptz null,
  sent_at timestamptz null,
  paid_at timestamptz null,
  cancelled_at timestamptz null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pohoda_export_status text not null default 'not_exported',
  pohoda_exported_at timestamptz null,
  pohoda_external_id text null,
  pohoda_last_error text null,
  pohoda_last_export_id uuid null,
  constraint invoices_status_check check (
    status in ('draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled')
  ),
  constraint invoices_pohoda_export_status_check check (
    pohoda_export_status in ('not_exported', 'exported', 'failed')
  ),
  constraint invoices_currency_check check (currency = upper(currency)),
  constraint invoices_company_number_uidx unique (company_id, invoice_number)
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
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  is_active boolean not null default true,
  linked_at timestamptz not null default now(),
  primary key (invoice_id, job_id)
);

create table if not exists public.pohoda_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  export_type text not null default 'issued_invoices',
  status text not null default 'pending',
  file_path text null,
  xml_content text null,
  invoice_count integer not null default 0,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  exported_at timestamptz null,
  error_message text null,
  constraint pohoda_exports_export_type_check check (export_type in ('issued_invoices')),
  constraint pohoda_exports_status_check check (status in ('pending', 'generated', 'exported', 'failed'))
);

create table if not exists public.pohoda_export_invoices (
  export_id uuid not null references public.pohoda_exports(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  status text not null default 'included',
  error_message text null,
  created_at timestamptz not null default now(),
  primary key (export_id, invoice_id),
  constraint pohoda_export_invoices_status_check check (status in ('included', 'exported', 'failed'))
);

create unique index if not exists invoice_jobs_one_active_invoice_per_job_uidx
  on public.invoice_jobs(job_id)
  where is_active = true;

create index if not exists invoices_company_created_idx
  on public.invoices(company_id, created_at desc);

create index if not exists invoices_company_status_idx
  on public.invoices(company_id, status, issue_date desc);

create index if not exists invoices_company_pohoda_status_idx
  on public.invoices(company_id, pohoda_export_status, issue_date desc);

create index if not exists invoices_customer_idx
  on public.invoices(customer_id, issue_date desc);

create index if not exists invoice_items_invoice_idx
  on public.invoice_items(invoice_id, sort_order, created_at);

create index if not exists invoice_jobs_company_customer_idx
  on public.invoice_jobs(company_id, customer_id);

create index if not exists pohoda_exports_company_created_idx
  on public.pohoda_exports(company_id, created_at desc);

create or replace function public.next_invoice_number(
  target_company_id uuid,
  target_year integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  if not exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  ) then
    raise exception 'Not allowed to issue invoice number for this company.';
  end if;

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

alter table public.invoice_number_sequences enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_jobs enable row level security;
alter table public.pohoda_exports enable row level security;
alter table public.pohoda_export_invoices enable row level security;

drop policy if exists invoice_number_sequences_admin_access on public.invoice_number_sequences;
create policy invoice_number_sequences_admin_access
on public.invoice_number_sequences
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = invoice_number_sequences.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = invoice_number_sequences.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

drop policy if exists invoices_admin_access on public.invoices;
create policy invoices_admin_access
on public.invoices
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = invoices.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.customers c on c.id = invoices.customer_id
    where cm.company_id = invoices.company_id
      and c.company_id = invoices.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

drop policy if exists invoice_items_admin_access on public.invoice_items;
create policy invoice_items_admin_access
on public.invoice_items
for all
to authenticated
using (
  exists (
    select 1
    from public.invoices i
    join public.company_members cm on cm.company_id = i.company_id
    join public.profiles p on p.id = cm.profile_id
    where i.id = invoice_items.invoice_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.invoices i
    join public.company_members cm on cm.company_id = i.company_id
    join public.profiles p on p.id = cm.profile_id
    where i.id = invoice_items.invoice_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

drop policy if exists invoice_jobs_admin_access on public.invoice_jobs;
create policy invoice_jobs_admin_access
on public.invoice_jobs
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = invoice_jobs.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.jobs j on j.id = invoice_jobs.job_id
    where cm.company_id = invoice_jobs.company_id
      and j.company_id = invoice_jobs.company_id
      and j.customer_id = invoice_jobs.customer_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

drop policy if exists pohoda_exports_admin_access on public.pohoda_exports;
create policy pohoda_exports_admin_access
on public.pohoda_exports
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = pohoda_exports.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = pohoda_exports.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

drop policy if exists pohoda_export_invoices_admin_access on public.pohoda_export_invoices;
create policy pohoda_export_invoices_admin_access
on public.pohoda_export_invoices
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = pohoda_export_invoices.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.invoices i on i.id = pohoda_export_invoices.invoice_id
    where cm.company_id = pohoda_export_invoices.company_id
      and i.company_id = pohoda_export_invoices.company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) in ('super_admin', 'company_admin')
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);
