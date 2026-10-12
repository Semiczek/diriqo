-- Office is a base module for existing and future companies.
-- Preserve every explicit company switch, membership, role and tenant boundary.
begin;
set local lock_timeout = '5s';
-- Lock in onboarding order: companies, then office_settings.
lock table public.companies in share row exclusive mode;

alter table public.office_settings alter column enabled set default true;

create or replace function office_private.enable_office_for_new_company()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op <> 'INSERT' or tg_table_schema <> 'public' or tg_table_name <> 'companies' then
    raise exception 'OFFICE_INVALID_TRIGGER_CONTEXT';
  end if;
  insert into public.office_settings (company_id, enabled, updated_by)
  values (new.id, true, auth.uid())
  on conflict (company_id) do nothing;
  return new;
end;
$$;

revoke all on function office_private.enable_office_for_new_company()
  from public, anon, authenticated;

drop trigger if exists office_new_company_default on public.companies;
create trigger office_new_company_default
  after insert on public.companies
  for each row execute function office_private.enable_office_for_new_company();

insert into public.office_settings (company_id, enabled, updated_by)
select id, true, null from public.companies
on conflict (company_id) do nothing;

-- Remove only the Office paid entitlement. The host validates real auth identity,
-- active membership and tenant. The shared authorizer still enforces enabled,
-- writer role, operation permissions, revisions and AI approval.
create or replace function public.office_host_write_allowed(p_company_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  ctx jsonb;
begin
  ctx := public.office_host_context(p_company_id);
  return coalesce(ctx->>'role' in ('owner', 'editor'), false);
end;
$$;
revoke all on function public.office_host_write_allowed(uuid)
  from public, anon, authenticated;

commit;
