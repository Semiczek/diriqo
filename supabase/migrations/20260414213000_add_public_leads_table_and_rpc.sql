create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  company_name text null,
  email text not null,
  phone text null,
  message text not null,
  service_slug text null,
  website_locale text not null,
  source text not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create index if not exists leads_company_created_at_idx
  on public.leads(company_id, created_at desc);

alter table public.leads enable row level security;

drop policy if exists "leads_company_members_access" on public.leads;

create policy "leads_company_members_access"
on public.leads
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = leads.company_id
      and cm.is_active = true
      and (
        cm.profile_id = auth.uid()
        or cm.profile_id in (
          select p.id
          from public.profiles p
          where p.auth_user_id = auth.uid()
             or p.user_id = auth.uid()
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = leads.company_id
      and cm.is_active = true
      and (
        cm.profile_id = auth.uid()
        or cm.profile_id in (
          select p.id
          from public.profiles p
          where p.auth_user_id = auth.uid()
             or p.user_id = auth.uid()
        )
      )
  )
);

create or replace function public.create_public_lead(
  p_company_id uuid,
  p_name text,
  p_company_name text,
  p_email text,
  p_phone text,
  p_message text,
  p_service_slug text,
  p_website_locale text,
  p_source text
)
returns table (
  success boolean,
  lead_id uuid,
  error text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_lead_id uuid;
begin
  if p_company_id is null then
    return query select false, null::uuid, 'Missing company id'::text;
    return;
  end if;

  if coalesce(btrim(p_name), '') = '' then
    return query select false, null::uuid, 'Missing name'::text;
    return;
  end if;

  if coalesce(btrim(p_email), '') = '' then
    return query select false, null::uuid, 'Missing email'::text;
    return;
  end if;

  if coalesce(btrim(p_message), '') = '' then
    return query select false, null::uuid, 'Missing message'::text;
    return;
  end if;

  if coalesce(btrim(p_website_locale), '') = '' then
    return query select false, null::uuid, 'Missing website locale'::text;
    return;
  end if;

  if coalesce(btrim(p_source), '') = '' then
    return query select false, null::uuid, 'Missing source'::text;
    return;
  end if;

  insert into public.leads (
    company_id,
    name,
    company_name,
    email,
    phone,
    message,
    service_slug,
    website_locale,
    source,
    status
  )
  values (
    p_company_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_company_name, '')), ''),
    lower(btrim(p_email)),
    nullif(btrim(coalesce(p_phone, '')), ''),
    btrim(p_message),
    nullif(btrim(coalesce(p_service_slug, '')), ''),
    lower(btrim(p_website_locale)),
    btrim(p_source),
    'new'
  )
  returning id into inserted_lead_id;

  return query select true, inserted_lead_id, null::text;
end;
$$;

revoke all on function public.create_public_lead(uuid, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_public_lead(uuid, text, text, text, text, text, text, text, text) to anon, authenticated;
