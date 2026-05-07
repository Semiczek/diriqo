-- Diriqo quotes runtime compatibility patch
-- Safe to run in Supabase SQL Editor. It only creates missing objects,
-- adds missing columns, grants API access, and inserts demo quote rows
-- only when the fixed demo IDs are missing.

create extension if not exists pgcrypto;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  title text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quotes add column if not exists source_calculation_id uuid;
alter table public.quotes add column if not exists quote_number text;
alter table public.quotes add column if not exists public_id text;
alter table public.quotes add column if not exists quote_date date not null default current_date;
alter table public.quotes add column if not exists valid_until date;
alter table public.quotes add column if not exists customer_note text;
alter table public.quotes add column if not exists internal_note text;
alter table public.quotes add column if not exists subtotal_price numeric(12, 2) not null default 0;
alter table public.quotes add column if not exists discount_amount numeric(12, 2) not null default 0;
alter table public.quotes add column if not exists total_amount numeric(12, 2) not null default 0;
alter table public.quotes add column if not exists total_price numeric(12, 2) not null default 0;
alter table public.quotes add column if not exists currency text not null default 'CZK';
alter table public.quotes add column if not exists share_token text;
alter table public.quotes add column if not exists share_enabled boolean not null default false;
alter table public.quotes add column if not exists sent_at timestamptz;
alter table public.quotes add column if not exists viewed_at timestamptz;
alter table public.quotes add column if not exists accepted_at timestamptz;
alter table public.quotes add column if not exists rejected_at timestamptz;
alter table public.quotes add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- Detail/public offer content expected by the current app.
alter table public.quotes add column if not exists contact_name text;
alter table public.quotes add column if not exists contact_email text;
alter table public.quotes add column if not exists intro_text text;
alter table public.quotes add column if not exists customer_request_title text;
alter table public.quotes add column if not exists customer_request text;
alter table public.quotes add column if not exists our_solution_title text;
alter table public.quotes add column if not exists proposed_solution text;
alter table public.quotes add column if not exists benefits_text text;
alter table public.quotes add column if not exists timeline_title text;
alter table public.quotes add column if not exists work_description text;
alter table public.quotes add column if not exists work_schedule text;
alter table public.quotes add column if not exists pricing_title text;
alter table public.quotes add column if not exists pricing_text text;
alter table public.quotes add column if not exists payment_terms_title text;
alter table public.quotes add column if not exists payment_terms text;
alter table public.quotes add column if not exists first_viewed_at timestamptz;
alter table public.quotes add column if not exists last_viewed_at timestamptz;
alter table public.quotes add column if not exists view_count integer not null default 0;

update public.quotes
set
  quote_number = coalesce(quote_number, public_id, 'DQ-' || left(id::text, 8)),
  public_id = coalesce(public_id, quote_number, 'DQ-' || left(id::text, 8)),
  valid_until = coalesce(valid_until, quote_date + 14),
  total_price = case
    when coalesce(total_price, 0) = 0 then coalesce(total_amount, subtotal_price, 0)
    else total_price
  end,
  total_amount = case
    when coalesce(total_amount, 0) = 0 then coalesce(total_price, subtotal_price, 0)
    else total_amount
  end,
  subtotal_price = case
    when coalesce(subtotal_price, 0) = 0 then coalesce(total_price, total_amount, 0)
    else subtotal_price
  end,
  payment_terms = coalesce(payment_terms, 'Faktura se splatností 14 dní.'),
  updated_at = coalesce(updated_at, now())
where true;

create unique index if not exists quotes_company_quote_number_uidx
  on public.quotes(company_id, quote_number)
  where quote_number is not null;

create unique index if not exists quotes_public_id_uidx
  on public.quotes(public_id)
  where public_id is not null;

create unique index if not exists quotes_share_token_uidx
  on public.quotes(share_token)
  where share_token is not null;

create index if not exists quotes_company_customer_date_idx
  on public.quotes(company_id, customer_id, quote_date desc);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  sort_order integer not null default 0,
  name text not null,
  description text,
  quantity numeric(12, 2) not null default 1,
  unit text,
  unit_price numeric(12, 2) not null default 0,
  total_price numeric(12, 2) not null default 0,
  vat_rate numeric(5, 2) not null default 21,
  note text,
  created_at timestamptz not null default now()
);

alter table public.quote_items add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.quote_items add column if not exists sort_order integer not null default 0;
alter table public.quote_items add column if not exists description text;
alter table public.quote_items add column if not exists quantity numeric(12, 2) not null default 1;
alter table public.quote_items add column if not exists unit text;
alter table public.quote_items add column if not exists unit_price numeric(12, 2) not null default 0;
alter table public.quote_items add column if not exists total_price numeric(12, 2) not null default 0;
alter table public.quote_items add column if not exists vat_rate numeric(5, 2) not null default 21;
alter table public.quote_items add column if not exists note text;
alter table public.quote_items add column if not exists created_at timestamptz not null default now();

update public.quote_items qi
set
  company_id = coalesce(qi.company_id, q.company_id)
from public.quotes q
where q.id = qi.quote_id;

do $$
begin
  -- Some bootstrap DBs use a generated total_price column. Update it only
  -- when it is a normal stored column.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quote_items'
      and column_name = 'total_price'
      and is_generated = 'NEVER'
  ) then
    update public.quote_items
    set total_price = coalesce(quantity, 1) * coalesce(unit_price, 0)
    where coalesce(total_price, 0) = 0;
  end if;
end $$;

create index if not exists quote_items_quote_id_idx
  on public.quote_items(quote_id, sort_order, created_at);

create table if not exists public.offer_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  quote_id uuid null references public.quotes(id) on delete cascade,
  event_type text not null,
  section_key text,
  event_value text,
  visitor_id text,
  user_agent text,
  device_type text,
  referrer text,
  created_at timestamptz not null default now()
);

alter table public.offer_events add column if not exists user_agent text;
alter table public.offer_events add column if not exists device_type text;
alter table public.offer_events add column if not exists referrer text;
create index if not exists offer_events_quote_created_idx
  on public.offer_events(quote_id, created_at desc);

create table if not exists public.offer_responses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  quote_id uuid null references public.quotes(id) on delete cascade,
  action_type text not null,
  customer_name text,
  customer_email text,
  customer_phone text,
  note text,
  visitor_id text,
  created_at timestamptz not null default now()
);

create index if not exists offer_responses_quote_created_idx
  on public.offer_responses(quote_id, created_at desc);

alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.offer_events enable row level security;
alter table public.offer_responses enable row level security;

grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on table public.quotes to authenticated;
grant select, insert, update, delete on table public.quote_items to authenticated;
grant select, insert, update, delete on table public.offer_events to authenticated;
grant select, insert, update, delete on table public.offer_responses to authenticated;
grant select on table public.quotes to anon;
grant select on table public.quote_items to anon;
grant select on table public.offer_events to anon;
grant select, insert on table public.offer_responses to anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'quotes' and policyname = 'quotes_runtime_select_company_member'
  ) then
    create policy quotes_runtime_select_company_member
    on public.quotes
    for select
    to authenticated
    using (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'quotes' and policyname = 'quotes_runtime_admin_write'
  ) then
    create policy quotes_runtime_admin_write
    on public.quotes
    for all
    to authenticated
    using (public.is_company_admin(company_id))
    with check (public.is_company_admin(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'quote_items' and policyname = 'quote_items_runtime_select_company_member'
  ) then
    create policy quote_items_runtime_select_company_member
    on public.quote_items
    for select
    to authenticated
    using (
      exists (
        select 1 from public.quotes q
        where q.id = quote_items.quote_id
          and public.is_company_member(q.company_id)
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'quote_items' and policyname = 'quote_items_runtime_admin_write'
  ) then
    create policy quote_items_runtime_admin_write
    on public.quote_items
    for all
    to authenticated
    using (
      exists (
        select 1 from public.quotes q
        where q.id = quote_items.quote_id
          and public.is_company_admin(q.company_id)
      )
    )
    with check (
      exists (
        select 1 from public.quotes q
        where q.id = quote_items.quote_id
          and public.is_company_admin(q.company_id)
      )
    );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'offer_events' and policyname = 'offer_events_runtime_select_company_member'
  ) then
    create policy offer_events_runtime_select_company_member
    on public.offer_events
    for select
    to authenticated
    using (public.is_company_member(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'offer_responses' and policyname = 'offer_responses_runtime_select_company_member'
  ) then
    create policy offer_responses_runtime_select_company_member
    on public.offer_responses
    for select
    to authenticated
    using (public.is_company_member(company_id));
  end if;
end $$;

-- Recreate the specific demo quote if it is missing. This does not use real data.
do $$
declare
  v_company uuid := '10000000-0000-4000-8000-000000000001';
  v_customer uuid := '10000000-0000-4000-8000-000000001003';
  v_admin uuid := '10000000-0000-4000-8000-000000000101';
begin
  if exists (select 1 from public.companies where id = v_company)
     and exists (select 1 from public.customers where id = v_customer)
     and not exists (
       select 1 from public.quotes
       where id = '10000000-0000-4000-8000-000000011001'
     ) then
    insert into public.quotes (
      id,
      company_id,
      customer_id,
      source_calculation_id,
      quote_number,
      public_id,
      title,
      status,
      quote_date,
      valid_until,
      subtotal_price,
      total_amount,
      total_price,
      currency,
      created_by,
      created_at,
      updated_at
    )
    values (
      '10000000-0000-4000-8000-000000011001',
      v_company,
      v_customer,
      case
        when exists (
          select 1 from public.calculations
          where id = '10000000-0000-4000-8000-000000010001'
        )
        then '10000000-0000-4000-8000-000000010001'::uuid
        else null
      end,
      'DQ-2026-001',
      'DQ-2026-001',
      'Pravidelný úklid kanceláří',
      'draft',
      current_date,
      current_date + 14,
      18500,
      18500,
      18500,
      'CZK',
      case when exists (select 1 from public.profiles where id = v_admin) then v_admin else null end,
      now(),
      now()
    );
  end if;

  if exists (
    select 1 from public.quotes
    where id = '10000000-0000-4000-8000-000000011001'
  ) then
    insert into public.quote_items (
      id,
      company_id,
      quote_id,
      sort_order,
      name,
      quantity,
      unit,
      unit_price,
      created_at
    )
    values (
      '10000000-0000-4000-8000-000000011101',
      v_company,
      '10000000-0000-4000-8000-000000011001',
      1,
      'Pravidelný měsíční úklid kanceláří',
      1,
      'měsíc',
      18500,
      now()
    )
    on conflict (id) do update
    set
      company_id = excluded.company_id,
      quote_id = excluded.quote_id,
      name = excluded.name,
      quantity = excluded.quantity,
      unit = excluded.unit,
      unit_price = excluded.unit_price;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Quick verification:
select
  q.id,
  q.company_id,
  q.customer_id,
  c.name as customer_name,
  q.quote_number,
  q.title,
  q.status,
  q.total_price
from public.quotes q
left join public.customers c on c.id = q.customer_id
where q.id = '10000000-0000-4000-8000-000000011001';
