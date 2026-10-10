-- Additive test-only rollout authority. This migration enrolls no company.
-- This slice enforces core job INSERTs and reuses the invoice authority already installed.
-- A supported capability check does not imply that every domain path is enforced yet.
-- History/settlement, register-scoped POS and budgeted operations deliberately remain
-- unsupported by this company-scoped new-operation API.

create table private.company_module_rollouts (
  company_id uuid not null references public.companies(id) on delete restrict,
  product text not null check (product in ('diriqo_core','inventory','invoicing','smart_quotes','fleet')),
  livemode boolean not null check (not livemode),
  created_at timestamptz not null default now(),
  primary key (company_id,product)
);
alter table private.company_module_rollouts enable row level security;
revoke all on private.company_module_rollouts from public, anon, authenticated, service_role;

-- The helper is read-only. Its timestamp overload is internal to trusted domain code;
-- a returned UUID or decision is not an authorization token and cannot be submitted to
-- bypass a database trigger. The public API below always supplies the database clock.
create function private.evaluate_company_capability_access(
  target_company_id uuid, target_capability text, target_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_product text; v_mode boolean; v_enforced boolean; v_entitlement_id uuid;
begin
  select known.product into v_product from (values
    ('diriqo_core','core.jobs.create'), ('diriqo_core','core.jobs.update'),
    ('diriqo_core','core.jobs.close'), ('diriqo_core','core.customers.manage'),
    ('diriqo_core','core.workers.manage'), ('diriqo_core','core.rates.manage'),
    ('diriqo_core','core.time.record'), ('diriqo_core','core.time.approve'),
    ('diriqo_core','core.quotes.create'), ('diriqo_core','core.calendar.manage'),
    ('diriqo_core','core.absences.request'), ('diriqo_core','core.absences.approve'),
    ('diriqo_core','core.advances.request'), ('diriqo_core','core.advances.pay'),
    ('diriqo_core','core.files.upload'), ('diriqo_core','core.handover.confirm'),
    ('diriqo_core','core.costs.record'),
    ('inventory','inventory.receipt.post'), ('inventory','inventory.movement.post'),
    ('invoicing','invoicing.invoice.issue'), ('smart_quotes','smart_quotes.template.manage'),
    ('fleet','fleet.vehicle.manage'), ('fleet','fleet.trip.record')
  ) known(product,capability) where known.capability = target_capability;
  if v_product is null then
    raise exception 'MODULE_CAPABILITY_UNSUPPORTED' using errcode = '22023';
  end if;
  if target_at is null or not isfinite(target_at) then
    raise exception 'MODULE_CAPABILITY_INVALID' using errcode = '22023';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.company_members cm join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_company_id and cm.is_active and p.auth_user_id = auth.uid()
  ) then raise exception 'MODULE_CAPABILITY_FORBIDDEN' using errcode = '42501'; end if;

  select r.livemode into v_mode from private.company_module_rollouts r
    where r.company_id = target_company_id and r.product = v_product for share;
  v_enforced := found;
  -- Preserve the already-installed invoice pilot and its audit/test contracts.
  -- Both rollout stores are owner-only and test-only; neither can select a live mode.
  if not v_enforced and v_product = 'invoicing' then
    select r.livemode into v_mode from private.invoice_module_rollouts r
      where r.company_id = target_company_id for share;
    v_enforced := found;
  end if;
  if not v_enforced then
    return jsonb_build_object('company_id',target_company_id,'capability',target_capability,
      'enforced',false,'allowed',true,'reason','legacy','livemode',null,'entitlement_id',null);
  end if;

  select e.id into v_entitlement_id from public.company_module_entitlements e
  where e.company_id = target_company_id and e.product = v_product and e.register_id is null
    and e.livemode = v_mode and e.policy_version = 'diriqo-capabilities-v0.1'
    and e.origin = 'paid' and e.state = 'active' and not e.revoked
    and e.valid_from <= target_at and target_at < e.valid_until
    and target_capability = any(e.capabilities)
    and (v_product = 'diriqo_core' or exists (
      select 1 from public.company_module_entitlements base
      where base.company_id = target_company_id and base.livemode = v_mode
        and base.policy_version = 'diriqo-capabilities-v0.1'
        and base.origin = 'paid' and base.state = 'active' and not base.revoked
        and base.valid_from <= target_at and target_at < base.valid_until
        and ((base.product = 'diriqo_core' and base.register_id is null and 'core.jobs.create' = any(base.capabilities))
          or (v_product in ('inventory','invoicing') and base.product = 'pos'
            and base.register_id is not null and 'pos.sale.create' = any(base.capabilities)))
    ))
  order by e.valid_until desc,e.id limit 1;
  return jsonb_build_object('company_id',target_company_id,'capability',target_capability,
    'enforced',true,'allowed',v_entitlement_id is not null,
    'reason',case when v_entitlement_id is null then 'module_required' else 'paid' end,
    'livemode',v_mode,'entitlement_id',v_entitlement_id);
end;
$function$;
revoke all on function private.evaluate_company_capability_access(uuid,text,timestamptz)
  from public, anon, authenticated, service_role;

-- Only this clock-bound, identifier-free wrapper is callable by authenticated clients.
-- The internal evaluator remains owner-only for trusted invoice issuance timestamps.
create function private.get_company_capability_access(target_company_id uuid, target_capability text)
returns jsonb language sql security definer set search_path = '' as $function$
  select private.evaluate_company_capability_access(target_company_id,target_capability,clock_timestamp()) - 'entitlement_id';
$function$;
revoke all on function private.get_company_capability_access(uuid,text) from public, anon, authenticated, service_role;
grant execute on function private.get_company_capability_access(uuid,text) to authenticated;

-- License introspection only: fresh tenant membership is mandatory, while existing
-- operation-specific roles and RLS still decide whether an operation may be performed.
create function public.get_company_capability_access(target_company_id uuid, target_capability text)
returns jsonb language sql security invoker set search_path = '' as $function$
  select private.get_company_capability_access(target_company_id,target_capability);
$function$;
revoke all on function public.get_company_capability_access(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.get_company_capability_access(uuid,text) to authenticated;

create function private.guard_core_job_creation()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_access jsonb;
begin
  if tg_op = 'UPDATE' then
    -- Otherwise an administrator could INSERT into an unenrolled company then move
    -- the row into an enrolled company without ever crossing the paid creation guard.
    if new.id is distinct from old.id or new.company_id is distinct from old.company_id then
      raise exception 'CORE_JOB_SCOPE_IMMUTABLE' using errcode = '23514';
    end if;
    return new;
  end if;
  if not exists (select 1 from private.company_module_rollouts r
    where r.company_id = new.company_id and r.product = 'diriqo_core') then return new; end if;
  if auth.uid() is null or not public.has_company_role(new.company_id,array['company_admin','super_admin']::text[]) then
    raise exception 'CORE_JOB_CREATE_FORBIDDEN' using errcode = '42501';
  end if;
  v_access := private.evaluate_company_capability_access(new.company_id,'core.jobs.create',clock_timestamp());
  if not (v_access->>'allowed')::boolean then
    raise exception 'CORE_MODULE_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_core_job_creation() from public, anon, authenticated, service_role;
create trigger guard_core_job_creation before insert or update on public.jobs
for each row execute function private.guard_core_job_creation();

-- Preserve the invoice API, error contract and UUID provenance while centralizing
-- paid eligibility. Invoice authorization still has its own administrator boundary.
create or replace function private.invoice_issue_entitlement(target_company_id uuid, target_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_access jsonb;
begin
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_ISSUE_FORBIDDEN' using errcode = '42501';
  end if;
  v_access := private.evaluate_company_capability_access(target_company_id,'invoicing.invoice.issue',target_at);
  if not (v_access->>'allowed')::boolean then
    raise exception 'INVOICE_MODULE_REQUIRED' using errcode = '42501';
  end if;
  return (v_access->>'entitlement_id')::uuid;
end;
$function$;
revoke all on function private.invoice_issue_entitlement(uuid,timestamptz) from public, anon, authenticated, service_role;

-- Extend INSERT enrollment detection too: general-rollout companies must start in draft.
create or replace function private.guard_invoice_issue()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_first_issue boolean := false;
  v_enrolled boolean;
  v_job record;
begin
  select exists(select 1 from private.invoice_module_rollouts r where r.company_id = new.company_id)
    or exists(select 1 from private.company_module_rollouts r where r.company_id = new.company_id and r.product = 'invoicing')
    into v_enrolled;
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
