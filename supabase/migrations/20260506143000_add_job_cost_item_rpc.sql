-- Runtime fix for adding job cost items from the Diriqo job detail.
-- Safe for existing databases: no destructive statements, no auth schema changes.

alter table public.job_cost_items add column if not exists company_id uuid;
alter table public.job_cost_items add column if not exists cost_type text default 'other';
alter table public.job_cost_items add column if not exists name text;
alter table public.job_cost_items add column if not exists title text;
alter table public.job_cost_items add column if not exists amount numeric(12, 2) not null default 0;
alter table public.job_cost_items add column if not exists quantity numeric(12, 2) not null default 1;
alter table public.job_cost_items add column if not exists unit text;
alter table public.job_cost_items add column if not exists unit_price numeric(12, 2) not null default 0;
alter table public.job_cost_items add column if not exists total_price numeric(12, 2) not null default 0;
alter table public.job_cost_items add column if not exists note text;
alter table public.job_cost_items add column if not exists created_at timestamptz not null default now();
alter table public.job_cost_items add column if not exists updated_at timestamptz not null default now();

update public.job_cost_items
set
  company_id = coalesce(company_id, public.job_company_id(job_id)),
  title = coalesce(nullif(title, ''), nullif(name, ''), 'Náklad'),
  name = coalesce(nullif(name, ''), nullif(title, ''), 'Náklad'),
  amount = coalesce(nullif(amount, 0), nullif(total_price, 0), quantity * unit_price, 0),
  total_price = coalesce(nullif(total_price, 0), nullif(amount, 0), quantity * unit_price, 0),
  updated_at = now()
where job_id is not null;

create index if not exists job_cost_items_company_id_idx on public.job_cost_items(company_id);
create index if not exists job_cost_items_job_id_idx on public.job_cost_items(job_id);

create or replace function public.create_job_cost_item(
  p_company_id uuid,
  p_job_id uuid,
  p_cost_type text,
  p_title text,
  p_quantity numeric,
  p_unit text,
  p_unit_price numeric,
  p_total_price numeric,
  p_note text
)
returns public.job_cost_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_item public.job_cost_items;
begin
  select j.company_id
    into v_company_id
  from public.jobs j
  where j.id = p_job_id;

  if v_company_id is null then
    raise exception 'Zakázka neexistuje nebo nemá firmu.';
  end if;

  if p_company_id is not null and p_company_id <> v_company_id then
    raise exception 'Náklad nepatří do aktivní firmy.';
  end if;

  if not (
    public.is_company_admin(v_company_id)
    or public.is_company_member(v_company_id)
  ) then
    raise exception 'Nemáš oprávnění přidat náklad k této zakázce.';
  end if;

  insert into public.job_cost_items (
    company_id,
    job_id,
    cost_type,
    name,
    title,
    amount,
    quantity,
    unit,
    unit_price,
    total_price,
    note,
    created_at,
    updated_at
  )
  values (
    v_company_id,
    p_job_id,
    coalesce(nullif(p_cost_type, ''), 'other'),
    coalesce(nullif(p_title, ''), 'Náklad'),
    coalesce(nullif(p_title, ''), 'Náklad'),
    coalesce(p_total_price, coalesce(p_quantity, 1) * coalesce(p_unit_price, 0), 0),
    coalesce(p_quantity, 1),
    coalesce(nullif(p_unit, ''), 'ks'),
    coalesce(p_unit_price, 0),
    coalesce(p_total_price, coalesce(p_quantity, 1) * coalesce(p_unit_price, 0), 0),
    nullif(p_note, ''),
    now(),
    now()
  )
  returning * into v_item;

  return v_item;
end;
$$;

revoke all on function public.create_job_cost_item(uuid, uuid, text, text, numeric, text, numeric, numeric, text) from public;
revoke all on function public.create_job_cost_item(uuid, uuid, text, text, numeric, text, numeric, numeric, text) from anon;
grant execute on function public.create_job_cost_item(uuid, uuid, text, text, numeric, text, numeric, numeric, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'job_cost_items'
      and policyname = 'job_cost_items_select_company_member_runtime'
  ) then
    create policy job_cost_items_select_company_member_runtime
    on public.job_cost_items
    for select
    to authenticated
    using (
      public.is_company_member(coalesce(company_id, public.job_company_id(job_id)))
    );
  end if;
end $$;
