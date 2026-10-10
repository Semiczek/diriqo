-- Nonfinancial, owner-issued TEST licences. This migration activates no company.
-- No paid receipt, Stripe object, credit budget or domain application is created.
-- The provider migration version is assigned only after review and application.

create table private.company_test_module_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  product text not null,
  register_id uuid,
  policy_version text not null default 'diriqo-capabilities-v0.1',
  source_ref text not null check (length(btrim(source_ref)) between 1 and 500),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  origin text not null default 'manual_grant' check (origin = 'manual_grant'),
  state text not null default 'active' check (state = 'active'),
  livemode boolean not null default false check (not livemode),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  history_until timestamptz not null,
  capabilities text[] not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by_db_role text not null default session_user,
  revoked_at timestamptz,
  revocation_reason text,
  unique (company_id,id),
  unique nulls not distinct (company_id,source_ref,product,register_id),
  constraint company_test_module_grants_period check (
    isfinite(valid_from) and isfinite(valid_until) and isfinite(history_until)
    and valid_until > valid_from and valid_until <= valid_from + interval '720 hours'
    and history_until = valid_until
  ),
  constraint company_test_module_grants_scope check (
    (product = 'pos' and register_id is not null) or (product <> 'pos' and register_id is null)
  ),
  constraint company_test_module_grants_configuration check (
    private.module_offer_configuration_valid(product,capabilities,policy_version)
  ),
  constraint company_test_module_grants_revocation check (
    (revoked_at is null and revocation_reason is null)
    or (revoked_at is not null and isfinite(revoked_at)
      and revocation_reason is not null and length(btrim(revocation_reason)) between 1 and 1000)
  )
);
create index company_test_module_grants_company_product_idx on private.company_test_module_grants(company_id,product);
alter table private.company_test_module_grants enable row level security;
revoke all on private.company_test_module_grants from public, anon, authenticated, service_role;

-- Only one-way, reasoned revocation is mutable. Extending a trial requires a new,
-- independently audited grant instead of rewriting the original authorisation.
create function private.guard_test_module_grant_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'UPDATE' then
    if old.revoked_at is null and new.revoked_at is not null
      and nullif(btrim(new.revocation_reason),'') is not null
      and (to_jsonb(new) - 'revoked_at' - 'revocation_reason')
        = (to_jsonb(old) - 'revoked_at' - 'revocation_reason') then
      new.revoked_at := clock_timestamp();
      return new;
    end if;
  end if;
  raise exception 'TEST_MODULE_GRANT_IMMUTABLE' using errcode = '42501';
end;
$function$;
revoke all on function private.guard_test_module_grant_immutable() from public, anon, authenticated, service_role;
create trigger guard_test_module_grant_immutable before update or delete on private.company_test_module_grants
for each row execute function private.guard_test_module_grant_immutable();

-- A JSON scalar avoids PostgREST row-cap truncation. A hard bound fails closed.
-- Expired/revoked rows remain visible as licence history, never as active grants.
create function private.get_company_test_module_entitlements(target_company_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.company_members cm join public.profiles p on p.id=cm.profile_id
    where cm.company_id=target_company_id and cm.is_active and p.auth_user_id=auth.uid()
      and (p.user_id is null or p.user_id=p.auth_user_id)
  ) then raise exception 'TEST_MODULE_FORBIDDEN' using errcode='42501'; end if;
  if (select count(*) from private.company_test_module_grants g where g.company_id=target_company_id)>10000 then
    raise exception 'TEST_MODULE_SNAPSHOT_TOO_LARGE' using errcode='54000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',g.id,'company_id',g.company_id,'product',g.product,'register_id',g.register_id,
    'policy_version',g.policy_version,'source_ref',g.source_ref,'origin',g.origin,'state',g.state,
    'revoked',g.revoked_at is not null,'valid_from',g.valid_from,'valid_until',g.valid_until,
    'history_until',g.history_until,'capabilities',g.capabilities,'grace_capabilities','[]'::jsonb,
    'grace_until',null,'cancel_at_period_end',false,'livemode',g.livemode
  ) order by g.id),'[]'::jsonb) into v_result
  from private.company_test_module_grants g where g.company_id=target_company_id;
  return v_result;
end;
$function$;
revoke all on function private.get_company_test_module_entitlements(uuid) from public, anon, authenticated, service_role;
grant execute on function private.get_company_test_module_entitlements(uuid) to authenticated;
create function public.get_company_test_module_entitlements(target_company_id uuid)
returns jsonb language sql security invoker set search_path = '' as $function$
  select private.get_company_test_module_entitlements(target_company_id);
$function$;
revoke all on function public.get_company_test_module_entitlements(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_company_test_module_entitlements(uuid) to authenticated;

create table private.invoice_test_issue_authorizations (
  invoice_id uuid primary key references public.invoices(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  test_grant_id uuid not null,
  issued_at timestamptz not null check (isfinite(issued_at)),
  actor_auth_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id,test_grant_id) references private.company_test_module_grants(company_id,id) on delete restrict
);
create index invoice_test_issue_authorizations_grant_idx on private.invoice_test_issue_authorizations(company_id,test_grant_id);
alter table private.invoice_test_issue_authorizations enable row level security;
revoke all on private.invoice_test_issue_authorizations from public, anon, authenticated, service_role;
create trigger guard_invoice_test_issue_authorization_immutable
before update or delete on private.invoice_test_issue_authorizations
for each row execute function private.guard_invoice_issue_authorization_immutable();

-- Preserve the paid branch, including its paid dependencies and provenance. A test
-- licence is a separate fallback only in the server-owned, test-only rollout.
create or replace function private.evaluate_company_capability_access(
  target_company_id uuid, target_capability text, target_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_product text; v_mode boolean; v_enforced boolean; v_entitlement_id uuid; v_test_grant_id uuid;
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
  if v_product is null then raise exception 'MODULE_CAPABILITY_UNSUPPORTED' using errcode='22023'; end if;
  if target_at is null or not isfinite(target_at) then
    raise exception 'MODULE_CAPABILITY_INVALID' using errcode='22023';
  end if;
  if auth.uid() is null or not exists (
    select 1 from public.company_members cm join public.profiles p on p.id=cm.profile_id
    where cm.company_id=target_company_id and cm.is_active and p.auth_user_id=auth.uid()
  ) then raise exception 'MODULE_CAPABILITY_FORBIDDEN' using errcode='42501'; end if;
  select r.livemode into v_mode from private.company_module_rollouts r
    where r.company_id=target_company_id and r.product=v_product for share;
  v_enforced := found;
  if not v_enforced and v_product='invoicing' then
    select r.livemode into v_mode from private.invoice_module_rollouts r
      where r.company_id=target_company_id for share;
    v_enforced := found;
  end if;
  if not v_enforced then
    return jsonb_build_object('company_id',target_company_id,'capability',target_capability,
      'enforced',false,'allowed',true,'reason','legacy','livemode',null,
      'entitlement_id',null,'test_grant_id',null);
  end if;
  select e.id into v_entitlement_id from public.company_module_entitlements e
  where e.company_id=target_company_id and e.product=v_product and e.register_id is null
    and e.livemode=v_mode and e.policy_version='diriqo-capabilities-v0.1'
    and e.origin='paid' and e.state='active' and not e.revoked
    and e.valid_from<=target_at and target_at<e.valid_until
    and target_capability=any(e.capabilities)
    and (v_product='diriqo_core' or exists (
      select 1 from public.company_module_entitlements base
      where base.company_id=target_company_id and base.livemode=v_mode
        and base.policy_version='diriqo-capabilities-v0.1'
        and base.origin='paid' and base.state='active' and not base.revoked
        and base.valid_from<=target_at and target_at<base.valid_until
        and ((base.product='diriqo_core' and base.register_id is null and 'core.jobs.create'=any(base.capabilities))
          or (v_product in ('inventory','invoicing') and base.product='pos'
            and base.register_id is not null and 'pos.sale.create'=any(base.capabilities)))
    )) order by e.valid_until desc,e.id limit 1;
  if v_entitlement_id is null and v_mode=false then
    -- Serialize revocation of either the selected grant or its test dependency.
    -- No caller setting, trigger-depth exemption or RLS bypass flag is accepted.
    perform 1 from private.company_test_module_grants locked
      where locked.company_id=target_company_id order by locked.id for share;
    select g.id into v_test_grant_id from private.company_test_module_grants g
    where g.company_id=target_company_id and g.product=v_product and g.register_id is null
      and not g.livemode and g.origin='manual_grant' and g.state='active' and g.revoked_at is null
      and g.policy_version='diriqo-capabilities-v0.1'
      and g.valid_from<=target_at and target_at<g.valid_until and target_capability=any(g.capabilities)
      and (v_product='diriqo_core' or exists (
        select 1 from (
          select base.product,base.register_id,base.capabilities from public.company_module_entitlements base
          where base.company_id=target_company_id and not base.livemode
            and base.policy_version='diriqo-capabilities-v0.1'
            and base.origin='paid' and base.state='active' and not base.revoked
            and base.valid_from<=target_at and target_at<base.valid_until
          union all
          select base.product,base.register_id,base.capabilities from private.company_test_module_grants base
          where base.company_id=target_company_id and not base.livemode
            and base.policy_version='diriqo-capabilities-v0.1'
            and base.origin='manual_grant' and base.state='active' and base.revoked_at is null
            and base.valid_from<=target_at and target_at<base.valid_until
        ) base where (base.product='diriqo_core' and base.register_id is null and 'core.jobs.create'=any(base.capabilities))
          or (v_product in ('inventory','invoicing') and base.product='pos'
            and base.register_id is not null and 'pos.sale.create'=any(base.capabilities))
      )) order by g.valid_until desc,g.id limit 1;
  end if;
  return jsonb_build_object('company_id',target_company_id,'capability',target_capability,
    'enforced',true,'allowed',v_entitlement_id is not null or v_test_grant_id is not null,
    'reason',case when v_entitlement_id is not null then 'paid' when v_test_grant_id is not null then 'test' else 'module_required' end,
    'livemode',v_mode,'entitlement_id',v_entitlement_id,'test_grant_id',v_test_grant_id);
end;
$function$;
revoke all on function private.evaluate_company_capability_access(uuid,text,timestamptz) from public, anon, authenticated, service_role;

create or replace function private.get_company_capability_access(target_company_id uuid, target_capability text)
returns jsonb language sql security definer set search_path = '' as $function$
  select private.evaluate_company_capability_access(target_company_id,target_capability,clock_timestamp())
    - 'entitlement_id' - 'test_grant_id';
$function$;
revoke all on function private.get_company_capability_access(uuid,text) from public, anon, authenticated, service_role;
grant execute on function private.get_company_capability_access(uuid,text) to authenticated;

-- invoice_issue_entitlement remains the fresh-admin gate. Its UUID return continues
-- to mean a PAID receipt only; for test access it returns NULL after authorisation.
-- Test provenance is recorded separately, never inserted into the paid ledger.
create or replace function private.complete_invoice_issue()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_entitlement_id uuid; v_access jsonb;
begin
  if new.status not in ('issued','sent','paid','overdue') then return new; end if;
  if tg_op='UPDATE' and old.status<>'draft' then return new; end if;
  if auth.uid() is null or not public.is_company_admin(new.company_id) then
    raise exception 'INVOICE_ISSUE_FORBIDDEN' using errcode='42501';
  end if;
  -- Select eligibility and provenance from one decision. A concurrent paid grant
  -- must not change the source between two reads and leave an issued invoice unaudited.
  v_access := private.evaluate_company_capability_access(new.company_id,'invoicing.invoice.issue',new.issued_at);
  if not (v_access->>'allowed')::boolean then
    raise exception 'INVOICE_MODULE_REQUIRED' using errcode='42501';
  end if;
  v_entitlement_id := (v_access->>'entitlement_id')::uuid;
  update public.jobs j set billing_status=case when new.status='paid' then 'paid' else 'due' end,
    invoiced_at=new.issued_at,due_date=new.due_date,is_paid=(new.status='paid')
  where j.company_id=new.company_id and j.customer_id=new.customer_id
    and exists(select 1 from public.invoice_jobs ij where ij.invoice_id=new.id
      and ij.job_id=j.id and ij.company_id=new.company_id and ij.customer_id=new.customer_id and ij.is_active);
  if v_entitlement_id is not null then
    insert into private.invoice_issue_authorizations(invoice_id,company_id,entitlement_id,issued_at,actor_auth_user_id)
      values(new.id,new.company_id,v_entitlement_id,new.issued_at,auth.uid());
  elsif v_access->>'reason'='test' then
    insert into private.invoice_test_issue_authorizations(invoice_id,company_id,test_grant_id,issued_at,actor_auth_user_id)
      values(new.id,new.company_id,(v_access->>'test_grant_id')::uuid,new.issued_at,auth.uid());
  end if;
  return new;
end;
$function$;
revoke all on function private.complete_invoice_issue() from public, anon, authenticated, service_role;
