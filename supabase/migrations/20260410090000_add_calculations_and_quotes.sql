create table if not exists public.calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  title text not null,
  description text null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
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

create index if not exists calculations_customer_id_idx
  on public.calculations(customer_id, calculation_date desc);

create index if not exists calculations_company_id_idx
  on public.calculations(company_id, created_at desc);

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

create index if not exists calculation_items_calculation_id_idx
  on public.calculation_items(calculation_id, sort_order, created_at);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_calculation_id uuid null references public.calculations(id) on delete set null,
  quote_number text not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'sent', 'accepted', 'rejected')),
  quote_date date not null default current_date,
  valid_until date null,
  customer_note text null,
  internal_note text null,
  subtotal_price numeric(12, 2) not null default 0,
  discount_amount numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  currency text not null default 'CZK',
  sent_at timestamptz null,
  accepted_at timestamptz null,
  rejected_at timestamptz null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists quotes_company_quote_number_uidx
  on public.quotes(company_id, quote_number);

create index if not exists quotes_customer_id_idx
  on public.quotes(customer_id, quote_date desc);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  sort_order integer not null default 0,
  name text not null,
  description text null,
  quantity numeric(12, 2) not null default 1,
  unit text null,
  unit_price numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists quote_items_quote_id_idx
  on public.quote_items(quote_id, sort_order, created_at);

alter table public.calculations enable row level security;
alter table public.calculation_items enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;

create policy "calculations_select_company_members"
on public.calculations
for select
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = calculations.company_id
  )
);

create policy "calculations_insert_company_members"
on public.calculations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.customers c on c.id = calculations.customer_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = calculations.company_id
      and c.company_id = calculations.company_id
  )
);

create policy "calculations_update_company_members"
on public.calculations
for update
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = calculations.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.customers c on c.id = calculations.customer_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = calculations.company_id
      and c.company_id = calculations.company_id
  )
);

create policy "calculation_items_select_company_members"
on public.calculation_items
for select
to authenticated
using (
  exists (
    select 1
    from public.calculations c
    join public.company_members cm on cm.company_id = c.company_id
    join public.profiles p on p.id = cm.profile_id
    where c.id = calculation_items.calculation_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
);

create policy "calculation_items_insert_company_members"
on public.calculation_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.calculations c
    join public.company_members cm on cm.company_id = c.company_id
    join public.profiles p on p.id = cm.profile_id
    where c.id = calculation_items.calculation_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
);

create policy "calculation_items_update_company_members"
on public.calculation_items
for update
to authenticated
using (
  exists (
    select 1
    from public.calculations c
    join public.company_members cm on cm.company_id = c.company_id
    join public.profiles p on p.id = cm.profile_id
    where c.id = calculation_items.calculation_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.calculations c
    join public.company_members cm on cm.company_id = c.company_id
    join public.profiles p on p.id = cm.profile_id
    where c.id = calculation_items.calculation_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
);

create policy "quotes_select_company_members"
on public.quotes
for select
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = quotes.company_id
  )
);

create policy "quotes_insert_company_members"
on public.quotes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.customers c on c.id = quotes.customer_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = quotes.company_id
      and c.company_id = quotes.company_id
  )
);

create policy "quotes_update_company_members"
on public.quotes
for update
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = quotes.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.customers c on c.id = quotes.customer_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = quotes.company_id
      and c.company_id = quotes.company_id
  )
);

create policy "quote_items_select_company_members"
on public.quote_items
for select
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
);

create policy "quote_items_insert_company_members"
on public.quote_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
);

create policy "quote_items_update_company_members"
on public.quote_items
for update
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
);
