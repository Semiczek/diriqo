-- Draft, additive pilot: no existing company is enrolled and no commercial data is seeded.
-- Covers invoice creation and first issuance only. Historical reads, exports, settlement,
-- cancellation, draft editing and item editing retain their existing authorization rules.
-- Live/test-schema drift is intentional: use only invoice columns present in both schemas.

-- The provenance timestamp must retain the exact issuance instant. A historical patch
-- used a DATE column; fail before any schema change instead of silently truncating it.
do $preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.invoices'::regclass and a.attname = 'issued_at'
      and not a.attisdropped and a.atttypid = 'timestamptz'::regtype
  ) then
    raise exception 'INVOICE_SCHEMA_UNSUPPORTED: invoices.issued_at must be timestamptz'
      using errcode = '55000';
  end if;
end;
$preflight$;

create table private.invoice_module_rollouts (
  company_id uuid primary key references public.companies(id) on delete restrict,
  livemode boolean not null check (not livemode),
  created_at timestamptz not null default now()
);
alter table private.invoice_module_rollouts enable row level security;
revoke all on private.invoice_module_rollouts from public, anon, authenticated, service_role;

create table private.invoice_issue_authorizations (
  invoice_id uuid primary key references public.invoices(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  entitlement_id uuid not null references public.company_module_entitlements(id) on delete restrict,
  issued_at timestamptz not null check (isfinite(issued_at)),
  actor_auth_user_id uuid not null,
  created_at timestamptz not null default now()
);
create index invoice_issue_authorizations_company_idx on private.invoice_issue_authorizations(company_id);
create index invoice_issue_authorizations_entitlement_idx on private.invoice_issue_authorizations(entitlement_id);
alter table private.invoice_issue_authorizations enable row level security;
revoke all on private.invoice_issue_authorizations from public, anon, authenticated, service_role;

create function private.guard_invoice_issue_authorization_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception 'INVOICE_AUTHORIZATION_IMMUTABLE' using errcode = '42501';
end;
$function$;
revoke all on function private.guard_invoice_issue_authorization_immutable() from public, anon, authenticated, service_role;
create trigger guard_invoice_issue_authorization_immutable
before update or delete on private.invoice_issue_authorizations
for each row execute function private.guard_invoice_issue_authorization_immutable();

-- Private definer access is needed only for the non-exposed rollout/paid-authority tables.
-- No client-supplied flag or session setting can enable, disable or select a rollout mode.
create function private.invoice_issue_entitlement(target_company_id uuid, target_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_mode boolean;
  v_entitlement_id uuid;
begin
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_ISSUE_FORBIDDEN' using errcode = '42501';
  end if;
  select r.livemode into v_mode from private.invoice_module_rollouts r
    where r.company_id = target_company_id for share;
  if not found then return null; end if;

  select e.id into v_entitlement_id from public.company_module_entitlements e
  where e.company_id = target_company_id and e.product = 'invoicing'
    and e.register_id is null and e.livemode = v_mode
    and e.policy_version = 'diriqo-capabilities-v0.1'
    and e.origin = 'paid' and e.state = 'active' and not e.revoked
    and e.valid_from <= target_at and target_at < e.valid_until
    and 'invoicing.invoice.issue' = any(e.capabilities)
    and exists (
      select 1 from public.company_module_entitlements base
      where base.company_id = target_company_id and base.livemode = v_mode
        and base.policy_version = 'diriqo-capabilities-v0.1'
        and base.origin = 'paid' and base.state = 'active' and not base.revoked
        and base.valid_from <= target_at and target_at < base.valid_until
        and ((base.product = 'diriqo_core' and base.register_id is null and 'core.jobs.create' = any(base.capabilities))
          or (base.product = 'pos' and base.register_id is not null and 'pos.sale.create' = any(base.capabilities)))
    )
  order by e.valid_until desc, e.id limit 1;
  if v_entitlement_id is null then
    raise exception 'INVOICE_MODULE_REQUIRED' using errcode = '42501';
  end if;
  return v_entitlement_id;
end;
$function$;
revoke all on function private.invoice_issue_entitlement(uuid,timestamptz) from public, anon, authenticated, service_role;

-- Legacy public number allocation had no authorization in the current test database.
-- Keep the existing API but authorize against fresh membership and the pilot licence.
create or replace function public.next_invoice_number(target_company_id uuid, target_year integer)
returns text language plpgsql security definer set search_path = '' as $function$
declare
  v_next integer;
  v_number text;
begin
  perform private.invoice_issue_entitlement(target_company_id, clock_timestamp());
  if target_year is null or target_year < 1900 or target_year > 9999 then
    raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
  end if;
  -- Also serializes custom-number issuance, including schemas without the canonical unique index.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-issue:' || target_company_id::text, 0));
  loop
    insert into public.invoice_number_sequences(company_id, year, last_number)
    values (target_company_id, target_year, 1)
    on conflict (company_id, year) do update
      set last_number = public.invoice_number_sequences.last_number + 1, updated_at = clock_timestamp()
    returning last_number into v_next;
    v_number := target_year::text || '-' || lpad(v_next::text, greatest(4, length(v_next::text)), '0');
    exit when not exists (select 1 from public.invoices i where i.company_id = target_company_id and i.invoice_number = v_number);
  end loop;
  return v_number;
end;
$function$;
revoke all on function public.next_invoice_number(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.next_invoice_number(uuid,integer) to authenticated;

create function private.guard_invoice_issue()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_first_issue boolean := false;
  v_enrolled boolean;
  v_job record;
begin
  select exists(select 1 from private.invoice_module_rollouts r where r.company_id = new.company_id) into v_enrolled;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id
      or new.customer_id is distinct from old.customer_id then
      raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514';
    end if;
    if old.status <> 'draft' then
      if new.issued_at is distinct from old.issued_at
        or new.invoice_number is distinct from old.invoice_number
        or new.invoice_year is distinct from old.invoice_year
        or new.status = 'draft'
        or (old.status = 'cancelled' and new.status <> 'cancelled') then
        raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
      end if;
      return new;
    end if;
    if new.status = 'cancelled' then
      if new.issued_at is distinct from old.issued_at then
        raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
      end if;
      return new;
    end if;
    if new.status not in ('draft','issued') then
      raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
    end if;
    v_first_issue := new.status = 'issued';
  else
    if v_enrolled then
      perform private.invoice_issue_entitlement(new.company_id, clock_timestamp());
      if new.status <> 'draft' then
        raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
      end if;
    end if;
    if new.status not in ('draft','issued','sent','paid','overdue','cancelled') then
      raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
    end if;
    v_first_issue := new.status in ('issued','sent','paid','overdue');
  end if;

  if not exists (select 1 from public.customers c where c.id = new.customer_id and c.company_id = new.company_id) then
    raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514';
  end if;
  if not v_first_issue then
    if new.issued_at is not null then
      raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
    end if;
    return new;
  end if;

  -- Row update locks the invoice. The company lock serializes number/custom-number allocation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invoice-issue:' || new.company_id::text, 0));
  new.issued_at := clock_timestamp();
  perform private.invoice_issue_entitlement(new.company_id, new.issued_at);
  if new.invoice_year is null or new.invoice_year < 1900 or new.invoice_year > 9999 then
    raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
  end if;

  -- invoice_jobs mutations lock their parent too, so a concurrent link cannot be missed.
  for v_job in
    select j.id, j.company_id, j.customer_id, ij.company_id link_company, ij.customer_id link_customer
    from public.invoice_jobs ij left join public.jobs j on j.id = ij.job_id
    where ij.invoice_id = new.id and ij.is_active order by ij.job_id
  loop
    if v_job.id is null or v_job.company_id is distinct from new.company_id
      or v_job.customer_id is distinct from new.customer_id
      or v_job.link_company is distinct from new.company_id
      or v_job.link_customer is distinct from new.customer_id then
      raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514';
    end if;
    perform 1 from public.jobs j where j.id = v_job.id
      and j.company_id = new.company_id and j.customer_id = new.customer_id for update;
    if not found then raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514'; end if;
    if exists (
      select 1 from public.invoice_jobs ij join public.invoices i on i.id = ij.invoice_id
      where ij.job_id = v_job.id and ij.is_active and ij.invoice_id <> new.id and i.status <> 'cancelled'
    ) then raise exception 'INVOICE_LINK_CONFLICT' using errcode = '23514'; end if;
  end loop;

  new.invoice_number := nullif(btrim(new.invoice_number), '');
  if new.invoice_number is null then
    new.invoice_number := public.next_invoice_number(new.company_id, new.invoice_year);
  elsif exists (select 1 from public.invoices i where i.company_id = new.company_id
    and i.invoice_number = new.invoice_number and i.id <> new.id) then
    raise exception 'INVOICE_NUMBER_CONFLICT' using errcode = '23514';
  end if;
  new.variable_symbol := coalesce(nullif(btrim(new.variable_symbol), ''),
    nullif(left(regexp_replace(new.invoice_number, '[^0-9]', '', 'g'), 10), ''));
  return new;
end;
$function$;
revoke all on function private.guard_invoice_issue() from public, anon, authenticated, service_role;
create trigger guard_invoice_issue before insert or update on public.invoices
for each row execute function private.guard_invoice_issue();

create function private.complete_invoice_issue()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_entitlement_id uuid;
begin
  if new.status not in ('issued','sent','paid','overdue') then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' then return new; end if;
  v_entitlement_id := private.invoice_issue_entitlement(new.company_id, new.issued_at);
  -- Same statement/transaction as invoice transition and number allocation: every failure rolls back all three.
  update public.jobs j set billing_status = case when new.status = 'paid' then 'paid' else 'due' end,
    invoiced_at = new.issued_at, due_date = new.due_date, is_paid = (new.status = 'paid')
  where j.company_id = new.company_id and j.customer_id = new.customer_id
    and exists(select 1 from public.invoice_jobs ij where ij.invoice_id = new.id
      and ij.job_id = j.id and ij.company_id = new.company_id and ij.customer_id = new.customer_id and ij.is_active);
  if v_entitlement_id is not null then
    insert into private.invoice_issue_authorizations(invoice_id,company_id,entitlement_id,issued_at,actor_auth_user_id)
      values(new.id,new.company_id,v_entitlement_id,new.issued_at,auth.uid());
  end if;
  return new;
end;
$function$;
revoke all on function private.complete_invoice_issue() from public, anon, authenticated, service_role;
create trigger complete_invoice_issue after insert or update on public.invoices
for each row execute function private.complete_invoice_issue();

create function private.guard_invoice_job_issue_scope()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_invoice public.invoices%rowtype; v_invoice_id uuid;
begin
  v_invoice_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  if tg_op = 'UPDATE' and (new.invoice_id is distinct from old.invoice_id
    or new.job_id is distinct from old.job_id or new.company_id is distinct from old.company_id
    or new.customer_id is distinct from old.customer_id) then
    raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514';
  end if;
  select * into v_invoice from public.invoices where id = v_invoice_id for update;
  if tg_op = 'DELETE' then return old; end if; -- Includes parent cascades and explicit historical cleanup.
  if not found or new.company_id is distinct from v_invoice.company_id
    or new.customer_id is distinct from v_invoice.customer_id then
    raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514';
  end if;
  perform 1 from public.jobs j where j.id = new.job_id and j.company_id = new.company_id
    and j.customer_id = new.customer_id for update;
  if not found then raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514'; end if;
  if (tg_op = 'INSERT' or (new.is_active and not old.is_active)) and v_invoice.status <> 'draft' then
    raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
  end if;
  if new.is_active and exists (
    select 1 from public.invoice_jobs ij join public.invoices i on i.id = ij.invoice_id
    where ij.job_id = new.job_id and ij.invoice_id <> new.invoice_id and ij.is_active and i.status <> 'cancelled'
  ) then raise exception 'INVOICE_LINK_CONFLICT' using errcode = '23514'; end if;
  return new;
end;
$function$;
revoke all on function private.guard_invoice_job_issue_scope() from public, anon, authenticated, service_role;
create trigger guard_invoice_job_issue_scope before insert or update or delete on public.invoice_jobs
for each row execute function private.guard_invoice_job_issue_scope();

-- No elevated application RPC: existing tenant RLS remains in effect on its row lock and UPDATE.
-- Private triggers enforce the same invariants for direct Data API mutations.
create function public.issue_invoice_atomic(target_company_id uuid, target_invoice_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_ISSUE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_invoice from public.invoices i
    where i.id = target_invoice_id and i.company_id = target_company_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_invoice.status in ('issued','sent','paid','overdue') then
    if nullif(btrim(v_invoice.invoice_number), '') is null then
      raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
    end if;
    return jsonb_build_object('invoice_id',v_invoice.id,'status',v_invoice.status,
      'invoice_number',v_invoice.invoice_number,'issued',false);
  end if;
  if v_invoice.status <> 'draft' then raise exception 'INVOICE_INVALID_STATE' using errcode = '23514'; end if;
  update public.invoices set status = 'issued'
    where id = target_invoice_id and company_id = target_company_id and status = 'draft'
    returning * into v_invoice;
  if not found then raise exception 'INVOICE_INVALID_STATE' using errcode = '23514'; end if;
  return jsonb_build_object('invoice_id',v_invoice.id,'status',v_invoice.status,
    'invoice_number',v_invoice.invoice_number,'issued',true);
end;
$function$;
revoke all on function public.issue_invoice_atomic(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.issue_invoice_atomic(uuid,uuid) to authenticated;

-- Deleting a draft is one transaction. Reject issued/history rows before any child cleanup;
-- the immutable issuance provenance must never fail after earlier application requests
-- have already deleted links or reset a job's billing state.
create function public.delete_invoice_draft_atomic(target_company_id uuid, target_invoice_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_DELETE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_invoice from public.invoices i
    where i.id = target_invoice_id and i.company_id = target_company_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_invoice.status <> 'draft' or v_invoice.issued_at is not null
    or v_invoice.pohoda_export_status = 'exported' then
    raise exception 'INVOICE_DELETE_FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.pohoda_export_invoices
    where invoice_id = target_invoice_id and company_id = target_company_id;
  -- invoice_items and invoice_jobs have invoice_id ON DELETE CASCADE in both schemas.
  -- Referential cascades enforce integrity even where the child's client RLS is deny-all.
  delete from public.invoices where id = target_invoice_id and company_id = target_company_id;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('invoice_id',target_invoice_id,'deleted',true);
end;
$function$;
revoke all on function public.delete_invoice_draft_atomic(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_invoice_draft_atomic(uuid,uuid) to authenticated;
