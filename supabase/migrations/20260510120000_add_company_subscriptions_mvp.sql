create extension if not exists pgcrypto;

create table if not exists public.company_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_key text not null default 'starter',
  status text not null default 'trialing',
  trial_started_at timestamptz null,
  trial_ends_at timestamptz null,
  stripe_customer_id text null,
  stripe_subscription_id text null,
  stripe_price_id text null,
  current_period_start timestamptz null,
  current_period_end timestamptz null,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_subscriptions_company_id_key'
  ) then
    alter table public.company_subscriptions
      add constraint company_subscriptions_company_id_key unique (company_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_subscriptions_status_check'
  ) then
    alter table public.company_subscriptions
      add constraint company_subscriptions_status_check
      check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'incomplete'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'company_subscriptions_plan_key_check'
  ) then
    alter table public.company_subscriptions
      add constraint company_subscriptions_plan_key_check
      check (plan_key in ('starter', 'growth', 'business', 'scale', 'enterprise', 'custom'));
  end if;
end $$;

create unique index if not exists company_subscriptions_stripe_customer_id_unique
  on public.company_subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists company_subscriptions_stripe_subscription_id_unique
  on public.company_subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists company_subscriptions_status_idx
  on public.company_subscriptions(status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists company_subscriptions_set_updated_at on public.company_subscriptions;
create trigger company_subscriptions_set_updated_at
  before update on public.company_subscriptions
  for each row execute function public.set_updated_at();

insert into public.company_subscriptions (
  company_id,
  plan_key,
  status,
  trial_started_at,
  trial_ends_at,
  created_at,
  updated_at
)
select
  c.id,
  'starter',
  case
    when coalesce(c.created_at, now()) + interval '7 days' >= now() then 'trialing'
    else 'expired'
  end,
  coalesce(c.created_at, now()),
  coalesce(c.created_at, now()) + interval '7 days',
  now(),
  now()
from public.companies c
where not exists (
  select 1
  from public.company_subscriptions cs
  where cs.company_id = c.id
);

create or replace function public.create_company_trial_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_subscriptions (
    company_id,
    plan_key,
    status,
    trial_started_at,
    trial_ends_at
  )
  values (
    new.id,
    'starter',
    'trialing',
    now(),
    now() + interval '7 days'
  )
  on conflict (company_id) do nothing;

  return new;
end;
$$;

drop trigger if exists companies_create_trial_subscription on public.companies;
create trigger companies_create_trial_subscription
  after insert on public.companies
  for each row execute function public.create_company_trial_subscription();

create or replace function public.transition_expired_company_subscriptions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.company_subscriptions
  set
    status = 'expired',
    updated_at = now()
  where status = 'trialing'
    and trial_ends_at is not null
    and trial_ends_at < now();

  update public.company_subscriptions
  set
    status = 'expired',
    updated_at = now()
  where status = 'past_due'
    and current_period_end is not null
    and current_period_end + interval '3 days' < now();
end;
$$;

create or replace function public.enforce_company_worker_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_key text;
  v_worker_limit integer;
  v_current_workers integer;
begin
  if new.is_active is not true or lower(coalesce(new.role, '')) <> 'worker' then
    return new;
  end if;

  select cs.plan_key
  into v_plan_key
  from public.company_subscriptions cs
  where cs.company_id = new.company_id
  limit 1;

  v_worker_limit := case coalesce(v_plan_key, 'starter')
    when 'starter' then 5
    when 'growth' then 15
    when 'business' then 30
    when 'scale' then 50
    when 'enterprise' then 100
    else null
  end;

  if v_worker_limit is null then
    return new;
  end if;

  select count(*)::integer
  into v_current_workers
  from public.company_members cm
  where cm.company_id = new.company_id
    and cm.is_active = true
    and lower(coalesce(cm.role, '')) = 'worker'
    and cm.id is distinct from new.id;

  if v_current_workers >= v_worker_limit then
    raise exception 'company_worker_limit_exceeded:%', v_worker_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists company_members_enforce_limit on public.company_members;
drop trigger if exists company_members_enforce_worker_limit on public.company_members;
create trigger company_members_enforce_worker_limit
  before insert or update of company_id, role, is_active on public.company_members
  for each row execute function public.enforce_company_worker_limit();

alter table public.company_subscriptions enable row level security;

drop policy if exists company_subscriptions_select_company_members on public.company_subscriptions;
create policy company_subscriptions_select_company_members
on public.company_subscriptions
for select
to authenticated
using (
  public.has_company_role(company_id, array['super_admin', 'company_admin', 'manager', 'worker'])
);

drop policy if exists company_subscriptions_no_direct_insert on public.company_subscriptions;
drop policy if exists company_subscriptions_no_direct_update on public.company_subscriptions;
drop policy if exists company_subscriptions_no_direct_delete on public.company_subscriptions;

grant select on table public.company_subscriptions to authenticated;
revoke insert, update, delete on table public.company_subscriptions from authenticated;
grant execute on function public.transition_expired_company_subscriptions() to authenticated;

notify pgrst, 'reload schema';
