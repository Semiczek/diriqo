create extension if not exists pgcrypto;

alter table public.companies
  add column if not exists plan_key text not null default 'starter',
  add column if not exists trial_started_at timestamptz null,
  add column if not exists trial_ends_at timestamptz null,
  add column if not exists onboarding_completed_at timestamptz null,
  add column if not exists is_demo boolean not null default false,
  add column if not exists support_email text null;

create table if not exists public.billing_plans (
  key text primary key,
  name text not null,
  min_members integer not null default 1,
  max_members integer null,
  monthly_price_eur numeric(12,2) null,
  yearly_price_eur numeric(12,2) null,
  stripe_monthly_price_id text null,
  stripe_yearly_price_id text null,
  is_custom boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  plan_key text not null references public.billing_plans(key),
  billing_interval text null,
  status text not null,
  max_members integer not null,
  intended_plan_key text null,
  intended_billing_interval text null,
  trial_started_at timestamptz null,
  trial_ends_at timestamptz null,
  grace_until timestamptz null,
  current_period_end timestamptz null,
  stripe_customer_id text null,
  stripe_subscription_id text null,
  stripe_price_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_company_id_unique
  on public.subscriptions(company_id);

create index if not exists subscriptions_status_idx
  on public.subscriptions(status);

create index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions(stripe_customer_id)
  where stripe_customer_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'billing_plans_members_check') then
    alter table public.billing_plans
      add constraint billing_plans_members_check
      check (
        min_members >= 1
        and (max_members is null or max_members >= min_members)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'billing_plans_key_check') then
    alter table public.billing_plans
      add constraint billing_plans_key_check
      check (key in ('starter', 'growth', 'business', 'scale', 'enterprise', 'custom'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_check') then
    alter table public.subscriptions
      add constraint subscriptions_status_check
      check (status in ('trialing', 'active', 'past_due', 'grace_period', 'suspended', 'canceled', 'expired'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscriptions_interval_check') then
    alter table public.subscriptions
      add constraint subscriptions_interval_check
      check (billing_interval is null or billing_interval in ('monthly', 'yearly'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscriptions_intended_plan_check') then
    alter table public.subscriptions
      add constraint subscriptions_intended_plan_check
      check (
        intended_plan_key is null
        or intended_plan_key in ('starter', 'growth', 'business', 'scale', 'enterprise')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'subscriptions_intended_interval_check') then
    alter table public.subscriptions
      add constraint subscriptions_intended_interval_check
      check (
        intended_billing_interval is null
        or intended_billing_interval in ('monthly', 'yearly')
      );
  end if;
end $$;

insert into public.billing_plans (
  key,
  name,
  min_members,
  max_members,
  monthly_price_eur,
  yearly_price_eur,
  is_custom,
  is_active
)
values
  ('starter', 'Starter', 1, 5, 19, 190, false, true),
  ('growth', 'Growth', 1, 15, 39, 390, false, true),
  ('business', 'Business', 1, 30, 59, 590, false, true),
  ('scale', 'Scale', 1, 50, 99, 990, false, true),
  ('enterprise', 'Enterprise', 1, 100, 149, 1490, false, true),
  ('custom', 'Custom', 1, null, null, null, true, true)
on conflict (key) do update
set
  name = excluded.name,
  min_members = excluded.min_members,
  max_members = excluded.max_members,
  monthly_price_eur = excluded.monthly_price_eur,
  yearly_price_eur = excluded.yearly_price_eur,
  is_custom = excluded.is_custom,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.subscriptions (
  company_id,
  plan_key,
  billing_interval,
  status,
  max_members,
  trial_started_at,
  trial_ends_at,
  created_at,
  updated_at
)
select
  c.id,
  'starter',
  null,
  case
    when coalesce(c.trial_ends_at, c.created_at + interval '7 days', now()) >= now() then 'trialing'
    else 'expired'
  end,
  5,
  coalesce(c.trial_started_at, c.created_at, now()),
  coalesce(c.trial_ends_at, coalesce(c.created_at, now()) + interval '7 days'),
  now(),
  now()
from public.companies c
where not exists (
  select 1
  from public.subscriptions s
  where s.company_id = c.id
);

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.is_active = true
      and lower(coalesce(cm.role, '')) = 'super_admin'
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
$$;

create or replace function public.get_company_active_member_count(target_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.company_members cm
  where cm.company_id = target_company_id
    and cm.is_active = true
$$;

create or replace function public.has_active_support_access(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.support_access_grants sag
    where sag.company_id = target_company_id
      and sag.revoked_at is null
      and sag.expires_at > now()
  )
$$;

create table if not exists public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  granted_by uuid not null references public.profiles(id) on delete restrict,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  reason text null,
  created_at timestamptz not null default now()
);

create index if not exists support_access_grants_company_active_idx
  on public.support_access_grants(company_id, expires_at desc)
  where revoked_at is null;

create table if not exists public.superadmin_audit_log (
  id uuid primary key default gen_random_uuid(),
  superadmin_user_id uuid not null references public.profiles(id) on delete restrict,
  company_id uuid null references public.companies(id) on delete set null,
  action text not null,
  reason text null,
  metadata jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists superadmin_audit_log_company_created_idx
  on public.superadmin_audit_log(company_id, created_at desc);

create index if not exists superadmin_audit_log_superadmin_created_idx
  on public.superadmin_audit_log(superadmin_user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'billing_plans_set_updated_at'
      and tgrelid = 'public.billing_plans'::regclass
  ) then
    create trigger billing_plans_set_updated_at
      before update on public.billing_plans
      for each row execute function public.set_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'subscriptions_set_updated_at'
      and tgrelid = 'public.subscriptions'::regclass
  ) then
    create trigger subscriptions_set_updated_at
      before update on public.subscriptions
      for each row execute function public.set_updated_at();
  end if;
end $$;

create or replace function public.enforce_company_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_members integer;
  v_current_members integer;
begin
  if new.is_active is not true then
    return new;
  end if;

  select s.max_members
  into v_max_members
  from public.subscriptions s
  where s.company_id = new.company_id
  order by s.created_at desc
  limit 1;

  if v_max_members is null then
    return new;
  end if;

  select count(*)::integer
  into v_current_members
  from public.company_members cm
  where cm.company_id = new.company_id
    and cm.is_active = true
    and cm.id is distinct from new.id;

  if v_current_members >= v_max_members then
    raise exception 'company_member_limit_exceeded:%', v_max_members
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists company_members_enforce_limit on public.company_members;
create trigger company_members_enforce_limit
  before insert or update of company_id, is_active on public.company_members
  for each row execute function public.enforce_company_member_limit();

create or replace function public.transition_expired_subscriptions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
  set
    status = 'grace_period',
    grace_until = coalesce(grace_until, now() + interval '48 hours'),
    updated_at = now()
  where status = 'trialing'
    and trial_ends_at is not null
    and trial_ends_at < now();

  update public.subscriptions
  set
    status = 'suspended',
    updated_at = now()
  where status = 'grace_period'
    and grace_until is not null
    and grace_until < now();
end;
$$;

create or replace function public.create_trial_company(
  input_company_name text,
  input_full_name text default null,
  input_support_email text default null,
  input_currency text default 'CZK',
  input_intended_plan_key text default null,
  input_intended_billing_interval text default null,
  input_team_members_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_email text;
  v_profile_id uuid;
  v_company_id uuid;
  v_company_name text := trim(coalesce(input_company_name, ''));
  v_full_name text := trim(coalesce(input_full_name, ''));
  v_support_email text := trim(coalesce(input_support_email, ''));
  v_currency text := upper(trim(coalesce(input_currency, 'CZK')));
  v_intended_plan_key text := lower(trim(coalesce(input_intended_plan_key, '')));
  v_intended_interval text := lower(trim(coalesce(input_intended_billing_interval, '')));
  v_trial_started_at timestamptz := now();
  v_trial_ends_at timestamptz := now() + interval '7 days';
begin
  if v_auth_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  if length(v_company_name) < 2 then
    raise exception 'company_name_required' using errcode = 'P0001';
  end if;

  if input_team_members_count is not null and input_team_members_count > 5 then
    raise exception 'starter_trial_member_limit' using errcode = 'P0001';
  end if;

  if v_intended_plan_key not in ('starter', 'growth', 'business', 'scale', 'enterprise') then
    v_intended_plan_key := null;
  end if;

  if v_intended_interval not in ('monthly', 'yearly') then
    v_intended_interval := null;
  end if;

  select email into v_email
  from auth.users
  where id = v_auth_user_id;

  if v_full_name = '' then
    v_full_name := coalesce(nullif(v_email, ''), 'Admin');
  end if;

  if v_support_email = '' then
    v_support_email := coalesce(v_email, 'support@diriqo.com');
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
     or p.user_id = v_auth_user_id
     or (v_email is not null and lower(coalesce(p.email, '')) = lower(v_email))
  order by p.created_at asc
  limit 1;

  if v_profile_id is null then
    insert into public.profiles (
      auth_user_id,
      user_id,
      full_name,
      email,
      default_hourly_rate
    )
    values (
      v_auth_user_id,
      v_auth_user_id,
      v_full_name,
      v_email,
      0
    )
    returning id into v_profile_id;
  else
    update public.profiles
    set
      auth_user_id = coalesce(auth_user_id, v_auth_user_id),
      user_id = coalesce(user_id, v_auth_user_id),
      full_name = coalesce(nullif(full_name, ''), v_full_name),
      email = coalesce(email, v_email),
      updated_at = now()
    where id = v_profile_id;
  end if;

  insert into public.companies (
    name,
    email,
    currency,
    locale,
    timezone,
    plan_key,
    trial_started_at,
    trial_ends_at,
    onboarding_completed_at,
    support_email,
    is_demo
  )
  values (
    v_company_name,
    v_support_email,
    case when v_currency in ('CZK', 'EUR') then v_currency else 'CZK' end,
    'cs-CZ',
    'Europe/Prague',
    'starter',
    v_trial_started_at,
    v_trial_ends_at,
    now(),
    v_support_email,
    false
  )
  returning id into v_company_id;

  insert into public.company_members (
    company_id,
    profile_id,
    role,
    is_active
  )
  values (
    v_company_id,
    v_profile_id,
    'company_admin',
    true
  );

  insert into public.subscriptions (
    company_id,
    plan_key,
    billing_interval,
    status,
    max_members,
    intended_plan_key,
    intended_billing_interval,
    trial_started_at,
    trial_ends_at
  )
  values (
    v_company_id,
    'starter',
    null,
    'trialing',
    5,
    v_intended_plan_key,
    v_intended_interval,
    v_trial_started_at,
    v_trial_ends_at
  );

  insert into public.company_settings (
    company_id,
    require_job_check,
    allow_multi_day_jobs,
    require_before_after_photos,
    require_checklist_completion,
    require_work_time_tracking,
    default_job_status_after_worker_done
  )
  values (
    v_company_id,
    true,
    true,
    false,
    false,
    true,
    'waiting_check'
  )
  on conflict (company_id) do nothing;

  insert into public.company_payroll_settings (
    company_id,
    default_worker_type,
    default_pay_type,
    advances_enabled,
    advance_limit_type,
    advance_frequency,
    default_contractor_cost_mode
  )
  values (
    v_company_id,
    'employee',
    'monthly',
    true,
    'monthly_amount',
    'monthly',
    'hourly'
  )
  on conflict (company_id) do nothing;

  insert into public.company_billing_settings (
    company_id,
    billing_enabled,
    default_invoice_due_days,
    default_vat_rate,
    is_vat_payer,
    invoice_prefix,
    next_invoice_number
  )
  values (
    v_company_id,
    false,
    14,
    21,
    false,
    'FV',
    1
  )
  on conflict (company_id) do nothing;

  insert into public.company_modules (
    company_id,
    module_key,
    is_enabled
  )
  select v_company_id, module_key, module_key <> 'public_leads'
  from (
    values
      ('dashboard'),
      ('jobs'),
      ('customers'),
      ('workers'),
      ('shifts'),
      ('finance'),
      ('calendar'),
      ('absences'),
      ('advance_requests'),
      ('quotes'),
      ('invoices'),
      ('kalkulace'),
      ('photos'),
      ('customer_portal'),
      ('public_leads'),
      ('email'),
      ('payroll')
  ) as modules(module_key)
  on conflict (company_id, module_key) do nothing;

  insert into public.mailboxes (
    company_id,
    name,
    email_address,
    provider_type,
    is_active
  )
  values (
    v_company_id,
    'Support',
    v_support_email,
    'resend',
    true
  )
  on conflict (company_id, email_address) do nothing;

  return v_company_id;
end;
$$;

alter table public.billing_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.support_access_grants enable row level security;
alter table public.superadmin_audit_log enable row level security;

drop policy if exists billing_plans_read_authenticated on public.billing_plans;
create policy billing_plans_read_authenticated
on public.billing_plans
for select
to authenticated
using (is_active = true or public.is_super_admin());

drop policy if exists subscriptions_select_company_admin_or_super on public.subscriptions;
create policy subscriptions_select_company_admin_or_super
on public.subscriptions
for select
to authenticated
using (
  public.has_company_role(company_id, array['super_admin', 'company_admin', 'manager', 'worker'])
  or public.is_super_admin()
);

drop policy if exists subscriptions_company_admin_update on public.subscriptions;

drop policy if exists support_access_grants_company_admin_select on public.support_access_grants;
create policy support_access_grants_company_admin_select
on public.support_access_grants
for select
to authenticated
using (
  public.has_company_role(company_id, array['super_admin', 'company_admin'])
  or public.is_super_admin()
);

drop policy if exists support_access_grants_company_admin_insert on public.support_access_grants;
create policy support_access_grants_company_admin_insert
on public.support_access_grants
for insert
to authenticated
with check (
  public.has_company_role(company_id, array['company_admin'])
  and granted_by = public.current_profile_id()
);

drop policy if exists support_access_grants_company_admin_revoke on public.support_access_grants;
create policy support_access_grants_company_admin_revoke
on public.support_access_grants
for update
to authenticated
using (public.has_company_role(company_id, array['company_admin']))
with check (public.has_company_role(company_id, array['company_admin']));

drop policy if exists superadmin_audit_log_superadmin_select on public.superadmin_audit_log;
create policy superadmin_audit_log_superadmin_select
on public.superadmin_audit_log
for select
to authenticated
using (public.is_super_admin());

drop policy if exists superadmin_audit_log_superadmin_insert on public.superadmin_audit_log;
create policy superadmin_audit_log_superadmin_insert
on public.superadmin_audit_log
for insert
to authenticated
with check (
  public.is_super_admin()
  and superadmin_user_id = public.current_profile_id()
);

grant select on table public.billing_plans to authenticated;
revoke insert, update, delete on table public.subscriptions from authenticated;
grant select on table public.subscriptions to authenticated;
grant select, insert, update on table public.support_access_grants to authenticated;
grant select, insert on table public.superadmin_audit_log to authenticated;
grant execute on function public.create_trial_company(text, text, text, text, text, text, integer) to authenticated;
grant execute on function public.transition_expired_subscriptions() to authenticated;
grant execute on function public.get_company_active_member_count(uuid) to authenticated;
grant execute on function public.has_active_support_access(uuid) to authenticated;

notify pgrst, 'reload schema';
