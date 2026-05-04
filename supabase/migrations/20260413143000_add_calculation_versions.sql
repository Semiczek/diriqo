create table if not exists public.calculation_versions (
  id uuid primary key default gen_random_uuid(),
  calculation_id uuid not null references public.calculations(id) on delete cascade,
  company_id uuid not null,
  customer_id uuid null references public.customers(id) on delete set null,
  version_number integer not null,
  title text not null,
  description text null,
  status text not null,
  calculation_date date null,
  internal_note text null,
  subtotal_cost numeric(12, 2) not null default 0,
  subtotal_price numeric(12, 2) not null default 0,
  margin_amount numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  currency text not null default 'CZK',
  saved_by uuid null references public.profiles(id) on delete set null,
  saved_at timestamptz not null default now()
);

create unique index if not exists calculation_versions_calc_version_uidx
  on public.calculation_versions (calculation_id, version_number);

create index if not exists calculation_versions_calc_saved_idx
  on public.calculation_versions (calculation_id, saved_at desc);

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
  vat_rate numeric(6, 2) not null default 21,
  total_cost numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists calculation_version_items_version_idx
  on public.calculation_version_items (calculation_version_id, sort_order, created_at);

alter table public.calculation_versions enable row level security;
alter table public.calculation_version_items enable row level security;

drop policy if exists "calculation_versions_select_company_members" on public.calculation_versions;
create policy "calculation_versions_select_company_members"
on public.calculation_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
      and cm.company_id = calculation_versions.company_id
  )
);

drop policy if exists "calculation_versions_insert_company_members" on public.calculation_versions;
create policy "calculation_versions_insert_company_members"
on public.calculation_versions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
      and cm.company_id = calculation_versions.company_id
  )
);

drop policy if exists "calculation_version_items_select_company_members" on public.calculation_version_items;
create policy "calculation_version_items_select_company_members"
on public.calculation_version_items
for select
to authenticated
using (
  exists (
    select 1
    from public.calculation_versions cv
    join public.company_members cm on cm.company_id = cv.company_id
    join public.profiles p on p.id = cm.profile_id
    where cv.id = calculation_version_items.calculation_version_id
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
  )
);

drop policy if exists "calculation_version_items_insert_company_members" on public.calculation_version_items;
create policy "calculation_version_items_insert_company_members"
on public.calculation_version_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.calculation_versions cv
    join public.company_members cm on cm.company_id = cv.company_id
    join public.profiles p on p.id = cm.profile_id
    where cv.id = calculation_version_items.calculation_version_id
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
  )
);
