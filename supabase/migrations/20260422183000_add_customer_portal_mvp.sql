create table if not exists public.customer_portal_users (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  contact_id uuid null references public.customer_contacts(id) on delete set null,
  auth_user_id uuid not null unique,
  email text not null,
  full_name text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz null
);

create index if not exists customer_portal_users_customer_idx
  on public.customer_portal_users (customer_id, is_active, created_at desc);

create index if not exists customer_portal_users_auth_user_idx
  on public.customer_portal_users (auth_user_id);

alter table public.customer_portal_users enable row level security;

drop policy if exists "customer_portal_users_select_own_row" on public.customer_portal_users;
create policy "customer_portal_users_select_own_row"
on public.customer_portal_users
for select
to authenticated
using (
  auth.uid() = auth_user_id
  and is_active = true
);

alter table public.jobs
  add column if not exists customer_summary text null;

alter table public.quotes
  add column if not exists customer_summary text null,
  add column if not exists customer_portal_approved_by uuid null references public.customer_portal_users(id) on delete set null,
  add column if not exists customer_portal_approved_note text null;

alter table public.leads
  add column if not exists customer_id uuid null references public.customers(id) on delete set null,
  add column if not exists customer_portal_user_id uuid null references public.customer_portal_users(id) on delete set null,
  add column if not exists subject text null,
  add column if not exists location_text text null,
  add column if not exists preferred_month date null,
  add column if not exists customer_note text null,
  add column if not exists closed_at timestamptz null;

create index if not exists leads_customer_id_created_at_idx
  on public.leads (customer_id, created_at desc);

create index if not exists leads_customer_portal_user_created_at_idx
  on public.leads (customer_portal_user_id, created_at desc);
