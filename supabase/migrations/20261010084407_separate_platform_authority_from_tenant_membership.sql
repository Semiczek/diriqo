-- Independent platform authority; tenant membership is never a platform grant.
-- Intentionally no backfill from company_members.role or user metadata.
create schema private;
revoke all on schema private from public, anon, authenticated;

create table private.platform_admin_grants (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  granted_at timestamptz not null default now(),
  reason text not null check (length(btrim(reason)) > 0),
  granted_by_auth_user_id uuid references auth.users(id) on delete set null
);
alter table private.platform_admin_grants enable row level security;
revoke all on private.platform_admin_grants from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.platform_admin_grants to service_role;

create table private.platform_admin_grant_events (
  id uuid primary key default gen_random_uuid(),
  subject_auth_user_id uuid not null,
  actor_auth_user_id uuid,
  database_role text not null,
  operation text not null,
  before_grant jsonb,
  after_grant jsonb,
  created_at timestamptz not null default now()
);
alter table private.platform_admin_grant_events enable row level security;
revoke all on private.platform_admin_grant_events from public, anon, authenticated, service_role;
grant select on private.platform_admin_grant_events to service_role;

create function private.audit_platform_admin_grant()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into private.platform_admin_grant_events
    (subject_auth_user_id, actor_auth_user_id, database_role, operation, before_grant, after_grant)
  values (
    case when tg_op = 'DELETE' then old.auth_user_id else new.auth_user_id end,
    auth.uid(), session_user, tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return null;
end;
$function$;
revoke all on function private.audit_platform_admin_grant() from public, anon, authenticated;
create trigger audit_platform_admin_grant after insert or update or delete
on private.platform_admin_grants for each row execute function private.audit_platform_admin_grant();

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $function$
  select auth.uid() is not null and exists (
    select 1 from private.platform_admin_grants g
    where g.auth_user_id = auth.uid() and g.is_active
  );
$function$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated, service_role;

-- Existing log rows keep their profile identity. New events also carry the real Auth actor.
alter table public.superadmin_audit_log
  add column actor_auth_user_id uuid references auth.users(id) on delete set null;
alter table public.superadmin_audit_log alter column superadmin_user_id drop not null;
drop policy if exists superadmin_audit_log_superadmin_insert on public.superadmin_audit_log;
create policy superadmin_audit_log_superadmin_insert on public.superadmin_audit_log
for insert to authenticated with check (
  public.is_super_admin() and actor_auth_user_id = auth.uid()
  and (superadmin_user_id is null or superadmin_user_id = public.current_profile_id())
);

-- SECURITY INVOKER is intentional: trusted provisioning functions run as their owner.
create function private.guard_profile_identity()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.auth_user_id is distinct from old.auth_user_id
      or new.user_id is distinct from old.user_id then
      raise exception 'profile_identity_immutable' using errcode = '42501';
    end if;
  elsif (new.auth_user_id is not null and new.auth_user_id is distinct from auth.uid())
    or (new.user_id is not null and new.user_id is distinct from auth.uid()) then
    raise exception 'profile_identity_mismatch' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_profile_identity() from public, anon, authenticated;
create trigger guard_profile_identity before insert or update on public.profiles
for each row execute function private.guard_profile_identity();

create function private.guard_company_member_identity()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin') then return new; end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id
      or new.profile_id is distinct from old.profile_id then
      raise exception 'membership_identity_immutable' using errcode = '42501';
    end if;
  end if;
  if new.role is null or new.role not in ('company_admin', 'manager', 'worker') then
    -- Existing legacy role can be deactivated, but never assigned to another membership.
    if tg_op <> 'UPDATE' or new.role is distinct from old.role then
      raise exception 'invalid_company_role' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_company_member_identity() from public, anon, authenticated;
create trigger guard_company_member_identity before insert or update on public.company_members
for each row execute function private.guard_company_member_identity();

-- Both onboarding entry points must match Auth identity only, never a mutable email.
CREATE OR REPLACE FUNCTION public.create_onboarding_company(input_company_name text, input_country_code text, input_language text, input_currency text, input_registration_number text DEFAULT NULL::text, input_tax_number text DEFAULT NULL::text, input_address text DEFAULT NULL::text, input_phone text DEFAULT NULL::text, input_email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_auth_user_id uuid := auth.uid();
  v_auth_email text;
  v_email text;
  v_profile_id uuid;
  v_company_id uuid;
  v_company_name text := trim(coalesce(input_company_name, ''));
  v_country_code text := upper(trim(coalesce(input_country_code, 'CZ')));
  v_language text := lower(trim(coalesce(input_language, 'cs')));
  v_currency text := upper(trim(coalesce(input_currency, 'CZK')));
  v_registration_number text := nullif(trim(coalesce(input_registration_number, '')), '');
  v_tax_number text := nullif(trim(coalesce(input_tax_number, '')), '');
  v_address text := nullif(trim(coalesce(input_address, '')), '');
  v_phone text := nullif(trim(coalesce(input_phone, '')), '');
  v_input_email text := nullif(trim(coalesce(input_email, '')), '');
  v_full_name text;
  v_locale text;
  v_timezone text;
begin
  if v_auth_user_id is null then
    raise exception 'auth_required' using errcode = 'P0001';
  end if;

  if length(v_company_name) < 2 then
    raise exception 'company_name_required' using errcode = 'P0001';
  end if;

  v_locale := case
    when v_language in ('cs', 'sk') then 'cs-CZ'
    when v_language = 'de' then 'de-DE'
    else 'en-GB'
  end;

  v_timezone := case
    when v_country_code in ('UK', 'IE') then 'Europe/London'
    when v_country_code in ('DE', 'AT', 'CH', 'NL', 'BE', 'FR', 'IT', 'ES', 'DK', 'SE', 'NO') then 'Europe/Berlin'
    else 'Europe/Prague'
  end;

  select
    u.email,
    nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', '')), '')
  into v_auth_email, v_full_name
  from auth.users u
  where u.id = v_auth_user_id;

  v_email := coalesce(v_input_email, v_auth_email);
  v_full_name := coalesce(v_full_name, nullif(v_auth_email, ''), 'Admin');

  -- Serialize this account's provisioning across both entry points.
  perform pg_advisory_xact_lock(hashtextextended(v_auth_user_id::text, 0));
  if exists (
    select 1 from public.profiles p
    where (p.auth_user_id = v_auth_user_id or p.user_id = v_auth_user_id)
      and ((p.auth_user_id is not null and p.auth_user_id <> v_auth_user_id)
        or (p.user_id is not null and p.user_id <> v_auth_user_id))
  ) or (
    select count(*) from public.profiles p
    where p.auth_user_id = v_auth_user_id or p.user_id = v_auth_user_id
  ) > 1 then
    raise exception 'profile_identity_conflict' using errcode = '42501';
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
     or p.user_id = v_auth_user_id
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
      v_auth_email,
      0
    )
    returning id into v_profile_id;
  else
    update public.profiles
    set
      auth_user_id = coalesce(auth_user_id, v_auth_user_id),
      user_id = coalesce(user_id, v_auth_user_id),
      full_name = coalesce(nullif(full_name, ''), v_full_name),
      email = coalesce(email, v_auth_email),
      updated_at = now()
    where id = v_profile_id;
  end if;

  insert into public.companies (
    name,
    email,
    phone,
    address,
    currency,
    locale,
    timezone,
    billing_country,
    country_code,
    default_language,
    default_currency,
    registration_number,
    tax_number,
    vat_number,
    company_number,
    ico,
    dic
  )
  values (
    v_company_name,
    v_email,
    v_phone,
    v_address,
    v_currency,
    v_locale,
    v_timezone,
    v_country_code,
    v_country_code,
    v_language,
    v_currency,
    v_registration_number,
    v_tax_number,
    v_tax_number,
    v_registration_number,
    v_registration_number,
    v_tax_number
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

  insert into public.company_settings (
    company_id,
    require_job_check,
    allow_multi_day_jobs,
    require_before_after_photos,
    require_checklist_completion,
    require_work_time_tracking,
    default_job_status_after_worker_done
  )
  select
    v_company_id,
    true,
    true,
    false,
    false,
    true,
    'waiting_check'
  where not exists (
    select 1 from public.company_settings s where s.company_id = v_company_id
  );

  insert into public.company_payroll_settings (
    company_id,
    default_worker_type,
    default_pay_type,
    advances_enabled,
    advance_limit_type,
    advance_frequency,
    default_contractor_cost_mode
  )
  select
    v_company_id,
    'employee',
    'monthly',
    true,
    'monthly_amount',
    'monthly',
    'hourly'
  where not exists (
    select 1 from public.company_payroll_settings s where s.company_id = v_company_id
  );

  insert into public.company_billing_settings (
    company_id,
    billing_enabled,
    default_invoice_due_days,
    default_vat_rate,
    is_vat_payer,
    invoice_prefix,
    next_invoice_number
  )
  select
    v_company_id,
    false,
    14,
    21,
    false,
    'FV',
    1
  where not exists (
    select 1 from public.company_billing_settings s where s.company_id = v_company_id
  );

  insert into public.company_modules (
    company_id,
    module_key,
    is_enabled
  )
  select v_company_id, modules.module_key, modules.module_key <> 'public_leads'
  from (
    values
      ('jobs'),
      ('workers'),
      ('shifts'),
      ('finance'),
      ('calendar'),
      ('quotes'),
      ('invoices'),
      ('photos'),
      ('customer_portal'),
      ('public_leads'),
      ('email'),
      ('payroll')
  ) as modules(module_key)
  where not exists (
    select 1
    from public.company_modules cm
    where cm.company_id = v_company_id
      and cm.module_key = modules.module_key
  );

  insert into public.mailboxes (
    company_id,
    name,
    email_address,
    provider_type,
    is_active
  )
  select
    v_company_id,
    'Support',
    coalesce(v_auth_email, 'support@diriqo.com'),
    'resend',
    true
  where not exists (
    select 1
    from public.mailboxes m
    where m.company_id = v_company_id
      and m.email_address = coalesce(v_auth_email, 'support@diriqo.com')
  );

  return v_company_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_trial_company(input_company_name text, input_full_name text DEFAULT NULL::text, input_support_email text DEFAULT NULL::text, input_currency text DEFAULT 'CZK'::text, input_intended_plan_key text DEFAULT NULL::text, input_intended_billing_interval text DEFAULT NULL::text, input_team_members_count integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Serialize this account's provisioning across both entry points.
  perform pg_advisory_xact_lock(hashtextextended(v_auth_user_id::text, 0));
  if exists (
    select 1 from public.profiles p
    where (p.auth_user_id = v_auth_user_id or p.user_id = v_auth_user_id)
      and ((p.auth_user_id is not null and p.auth_user_id <> v_auth_user_id)
        or (p.user_id is not null and p.user_id <> v_auth_user_id))
  ) or (
    select count(*) from public.profiles p
    where p.auth_user_id = v_auth_user_id or p.user_id = v_auth_user_id
  ) > 1 then
    raise exception 'profile_identity_conflict' using errcode = '42501';
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.auth_user_id = v_auth_user_id
     or p.user_id = v_auth_user_id
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
$function$;

revoke all on function public.create_onboarding_company(text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_onboarding_company(text,text,text,text,text,text,text,text,text) to authenticated;
revoke all on function public.create_trial_company(text,text,text,text,text,text,integer) from public, anon;
grant execute on function public.create_trial_company(text,text,text,text,text,text,integer) to authenticated;

notify pgrst, 'reload schema';
