create extension if not exists pgcrypto;

alter table public.profiles add column if not exists worker_status text;
alter table public.profiles add column if not exists activated_at timestamptz;
alter table public.profiles add column if not exists disabled_at timestamptz;
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists device_registered_at timestamptz;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
     or p.user_id = auth.uid()
  limit 1
$$;

create or replace function public.has_company_role(target_company_id uuid, allowed_roles text[])
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
    where cm.company_id = target_company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) = any (allowed_roles)
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
$$;

create or replace function public.create_worker_profile_for_invite(
  target_company_id uuid,
  worker_full_name text,
  worker_email text default null,
  worker_phone text default null,
  worker_type_value text default 'employee',
  default_hourly_rate_value numeric default null,
  contractor_billing_type_value text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_profile_id uuid;
  normalized_worker_type text;
  normalized_contractor_billing_type text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if not public.has_company_role(target_company_id, array['super_admin', 'company_admin']) then
    raise exception 'not_allowed';
  end if;

  if nullif(trim(coalesce(worker_full_name, '')), '') is null then
    raise exception 'missing_worker_name';
  end if;

  if nullif(trim(coalesce(worker_phone, '')), '') is null then
    raise exception 'missing_worker_phone';
  end if;

  normalized_worker_type := case
    when lower(coalesce(worker_type_value, 'employee')) = 'contractor' then 'contractor'
    else 'employee'
  end;

  normalized_contractor_billing_type := case
    when lower(coalesce(contractor_billing_type_value, 'hourly')) in ('fixed', 'invoice')
      then lower(coalesce(contractor_billing_type_value, 'hourly'))
    else 'hourly'
  end;

  insert into public.profiles (
    auth_user_id,
    user_id,
    full_name,
    email,
    phone,
    worker_status,
    default_hourly_rate,
    advance_paid,
    worker_type,
    contractor_billing_type,
    contractor_default_rate
  )
  values (
    null,
    null,
    trim(worker_full_name),
    nullif(trim(coalesce(worker_email, '')), ''),
    trim(worker_phone),
    'invited',
    case when normalized_worker_type = 'contractor' then null else default_hourly_rate_value end,
    0,
    normalized_worker_type,
    case when normalized_worker_type = 'contractor' then normalized_contractor_billing_type else null end,
    null
  )
  returning id into new_profile_id;

  insert into public.company_members (
    profile_id,
    company_id,
    role,
    is_active
  )
  values (
    new_profile_id,
    target_company_id,
    'worker',
    true
  );

  return new_profile_id;
end;
$$;

revoke all on function public.create_worker_profile_for_invite(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text
) from public;

grant execute on function public.create_worker_profile_for_invite(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  text
) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_worker_status_chk'
  ) then
    alter table public.profiles
      add constraint profiles_worker_status_chk
      check (worker_status is null or worker_status in ('invited', 'active', 'disabled'));
  end if;
end $$;

create table if not exists public.worker_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  worker_profile_id uuid null references public.profiles(id) on delete cascade,
  phone text not null,
  token_hash text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null,
  used_at timestamptz null,
  revoked_at timestamptz null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_invites_status_chk check (status in ('pending', 'used', 'revoked', 'expired'))
);

create index if not exists worker_invites_company_id_idx on public.worker_invites(company_id);
create index if not exists worker_invites_worker_profile_id_idx on public.worker_invites(worker_profile_id);
create index if not exists worker_invites_phone_idx on public.worker_invites(phone);
create index if not exists worker_invites_status_idx on public.worker_invites(status);
create index if not exists worker_invites_expires_at_idx on public.worker_invites(expires_at);
create unique index if not exists worker_invites_token_hash_uidx on public.worker_invites(token_hash);

drop trigger if exists worker_invites_set_updated_at on public.worker_invites;
create trigger worker_invites_set_updated_at
before update on public.worker_invites
for each row
execute function public.set_updated_at();

alter table public.worker_invites enable row level security;

drop policy if exists worker_invites_select_company_admins on public.worker_invites;
create policy worker_invites_select_company_admins
on public.worker_invites
for select
to authenticated
using (
  public.has_company_role(company_id, array['super_admin', 'company_admin'])
);

drop policy if exists worker_invites_insert_company_admins on public.worker_invites;
create policy worker_invites_insert_company_admins
on public.worker_invites
for insert
to authenticated
with check (
  public.has_company_role(company_id, array['super_admin', 'company_admin'])
  and created_by = public.current_profile_id()
);

drop policy if exists worker_invites_update_company_admins on public.worker_invites;
create policy worker_invites_update_company_admins
on public.worker_invites
for update
to authenticated
using (
  public.has_company_role(company_id, array['super_admin', 'company_admin'])
)
with check (
  public.has_company_role(company_id, array['super_admin', 'company_admin'])
);

notify pgrst, 'reload schema';
