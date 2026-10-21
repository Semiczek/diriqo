-- C02-02: existing rows have unknown history, even if currently marked draft.
-- Never backfill an old document with today's customer identity.
alter table public.quotes
  add column customer_identity_state text not null default 'legacy_unknown',
  add column customer_snapshot jsonb,
  add column customer_snapshot_captured_at timestamptz,
  add column customer_snapshot_captured_by uuid;
alter table public.quotes alter column customer_identity_state set default 'draft';
alter table public.quotes add constraint quotes_customer_identity_consistent check (
  (customer_identity_state in ('draft','legacy_unknown') and customer_snapshot is null and customer_snapshot_captured_at is null and customer_snapshot_captured_by is null)
  or (customer_identity_state='captured' and customer_snapshot is not null and jsonb_typeof(customer_snapshot)='object'
    and (customer_snapshot->'version') is not distinct from '1'::jsonb and customer_snapshot_captured_at is not null and customer_snapshot_captured_by is not null)
);

create function private.quote_customer_actor(p_company_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid;
begin
  if auth.uid() is null then raise exception 'QUOTE_CUSTOMER_FORBIDDEN' using errcode='42501'; end if;
  select p.id into v_actor from public.profiles p join public.company_members m on m.profile_id=p.id
  where p.auth_user_id=auth.uid() and (p.user_id is null or p.user_id=p.auth_user_id)
    and p.is_active and m.company_id=p_company_id and m.is_active and m.role in('manager','company_admin','super_admin');
  if v_actor is null then raise exception 'QUOTE_CUSTOMER_FORBIDDEN' using errcode='42501'; end if;
  return v_actor;
end;
$f$;
revoke all on function private.quote_customer_actor(uuid) from public,anon,authenticated,service_role;

-- Recheck current rows and wall-clock validity after any entitlement/customer wait.
create function private.assert_quote_customer_publication(p_company_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid; v_access jsonb; v_paid public.company_module_entitlements%rowtype;
  v_test private.company_test_module_grants%rowtype; v_valid boolean; v_now timestamptz;
begin
  v_actor:=private.quote_customer_actor(p_company_id);
  perform 1 from public.profiles where id=v_actor for share;
  perform 1 from public.company_members where company_id=p_company_id and profile_id=v_actor for share;
  perform 1 from public.company_modules where company_id=p_company_id and module_key='quotes' for share;
  perform private.quote_customer_actor(p_company_id);
  if exists(select 1 from public.company_modules where company_id=p_company_id and module_key='quotes' and not is_enabled) then
    raise exception 'QUOTE_CUSTOMER_MODULE_REQUIRED' using errcode='42501';
  end if;
  perform private.evaluate_company_capability_access(p_company_id,'core.quotes.create',clock_timestamp());
  v_access:=private.evaluate_company_capability_access(p_company_id,'core.quotes.create',clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then raise exception 'QUOTE_CUSTOMER_MODULE_REQUIRED' using errcode='42501'; end if;
  if v_access->>'reason'='paid' then
    select * into v_paid from public.company_module_entitlements where id=(v_access->>'entitlement_id')::uuid and company_id=p_company_id for share;
    if not found then raise exception 'QUOTE_CUSTOMER_MODULE_REQUIRED' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    v_valid:=v_paid.product='diriqo_core' and v_paid.register_id is null
      and v_paid.policy_version='diriqo-capabilities-v0.1' and v_paid.origin='paid' and v_paid.state='active' and not v_paid.revoked
      and v_paid.livemode=(v_access->>'livemode')::boolean and v_paid.valid_from<=v_now and v_now<v_paid.valid_until
      and 'core.quotes.create'=any(v_paid.capabilities);
  elsif v_access->>'reason'='test' then
    select * into v_test from private.company_test_module_grants where id=(v_access->>'test_grant_id')::uuid and company_id=p_company_id for share;
    if not found then raise exception 'QUOTE_CUSTOMER_MODULE_REQUIRED' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    v_valid:=v_test.product='diriqo_core' and v_test.register_id is null
      and v_test.policy_version='diriqo-capabilities-v0.1' and v_test.origin='manual_grant' and v_test.state='active' and v_test.revoked_at is null
      and not v_test.livemode and (v_access->>'livemode')::boolean=false
      and v_test.valid_from<=v_now and v_now<v_test.valid_until and 'core.quotes.create'=any(v_test.capabilities);
  else
    v_valid:=v_access->>'reason'='legacy' and (v_access->>'enforced')::boolean=false;
  end if;
  if v_valid is distinct from true then raise exception 'QUOTE_CUSTOMER_MODULE_REQUIRED' using errcode='42501'; end if;
  perform private.quote_customer_actor(p_company_id);
  if exists(select 1 from public.company_modules where company_id=p_company_id and module_key='quotes' and not is_enabled) then
    raise exception 'QUOTE_CUSTOMER_MODULE_REQUIRED' using errcode='42501';
  end if;
  return v_actor;
exception when insufficient_privilege then
  if sqlerrm='MODULE_CAPABILITY_FORBIDDEN' then raise exception 'QUOTE_CUSTOMER_FORBIDDEN' using errcode='42501'; end if;
  raise;
end;
$f$;
revoke all on function private.assert_quote_customer_publication(uuid) from public,anon,authenticated,service_role;

create function private.guard_quote_customer_identity()
returns trigger language plpgsql security definer set search_path='' as $f$
declare v_customer public.customers%rowtype; v_actor uuid;
begin
  -- No client-controlled flag or privileged API role may forge historical identity.
  if tg_op='INSERT' then
    if new.customer_identity_state is distinct from 'draft' or new.customer_snapshot is not null or new.customer_snapshot_captured_at is not null or new.customer_snapshot_captured_by is not null then
      raise exception 'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE' using errcode='23514';
    end if;
  else
    if new.customer_identity_state is distinct from old.customer_identity_state
      or new.customer_snapshot is distinct from old.customer_snapshot
      or new.customer_snapshot_captured_at is distinct from old.customer_snapshot_captured_at
      or new.customer_snapshot_captured_by is distinct from old.customer_snapshot_captured_by then
      raise exception 'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE' using errcode='23514';
    end if;
    if old.customer_identity_state in('captured','legacy_unknown') then
      if new.company_id is distinct from old.company_id or new.id is distinct from old.id then
        raise exception 'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE' using errcode='23514';
      end if;
      if new.customer_id is distinct from old.customer_id then
        -- Preserve the real FK's ON DELETE SET NULL, not a manual detach/reassignment.
        if new.customer_id is not null or exists(select 1 from public.customers where id=old.customer_id) then
          raise exception 'QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE' using errcode='23514';
        end if;
      end if;
      return new;
    end if;
  end if;

  if new.share_token is not null or new.share_enabled
    or new.status in('sent','viewed','waiting_followup','revision_requested','accepted','rejected')
    or new.sent_at is not null or new.accepted_at is not null or new.rejected_at is not null
    or to_jsonb(new)->>'viewed_at' is not null or to_jsonb(new)->>'first_viewed_at' is not null or to_jsonb(new)->>'last_viewed_at' is not null then
    perform private.assert_quote_customer_publication(new.company_id);
    if new.customer_id is not null then
      select * into v_customer from public.customers where id=new.customer_id and company_id=new.company_id for share;
      if not found then raise exception 'QUOTE_CUSTOMER_SCOPE_INVALID' using errcode='23514'; end if;
    end if;
    v_actor:=private.assert_quote_customer_publication(new.company_id);
    new.customer_snapshot_captured_by:=v_actor;
    new.customer_snapshot:=jsonb_build_object(
      'version',1,'name',v_customer.name,'billingName',v_customer.billing_name,
      'companyNumber',v_customer.company_number,'vatNumber',v_customer.vat_number,
      'billingStreet',v_customer.billing_street,'billingCity',v_customer.billing_city,
      'billingPostalCode',v_customer.billing_postal_code,'billingCountry',v_customer.billing_country,
      'email',v_customer.email,'phone',v_customer.phone);
    new.customer_snapshot_captured_at:=clock_timestamp();
    new.customer_identity_state:='captured';
  end if;
  return new;
end;
$f$;
revoke all on function private.guard_quote_customer_identity() from public,anon,authenticated,service_role;
create trigger guard_quote_customer_identity before insert or update on public.quotes
  for each row execute function private.guard_quote_customer_identity();

-- Explicit publication precedes all external mail. It does not claim mail was sent.
create function private.publish_core_quote_customer_identity(p_company_id uuid,p_quote_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v_quote public.quotes%rowtype;
begin
  if p_company_id is null or p_quote_id is null then raise exception 'QUOTE_CUSTOMER_INPUT_INVALID' using errcode='22023'; end if;
  perform private.quote_customer_actor(p_company_id);
  select * into v_quote from public.quotes where id=p_quote_id and company_id=p_company_id for update;
  if not found then raise exception 'QUOTE_CUSTOMER_NOT_FOUND' using errcode='P0002'; end if;
  perform private.assert_quote_customer_publication(p_company_id);
  if v_quote.share_token is null or not v_quote.share_enabled then
    update public.quotes set share_token=coalesce(share_token,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')),
      share_enabled=true,share_token_scope=coalesce(share_token_scope,'quote_public_offer'),
      share_token_expires_at=coalesce(share_token_expires_at,clock_timestamp()+interval '30 days'),updated_at=clock_timestamp()
      where id=p_quote_id and company_id=p_company_id returning * into v_quote;
  end if;
  perform private.assert_quote_customer_publication(p_company_id);
  return jsonb_build_object('quoteId',v_quote.id,'shareToken',v_quote.share_token,
    'state',v_quote.customer_identity_state,'capturedAt',v_quote.customer_snapshot_captured_at);
end;
$f$;
revoke all on function private.publish_core_quote_customer_identity(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.publish_core_quote_customer_identity(uuid,uuid) to authenticated;
create function public.publish_core_quote_customer_identity(p_company_id uuid,p_quote_id uuid)
returns jsonb language sql security invoker set search_path='' as $f$
  select private.publish_core_quote_customer_identity(p_company_id,p_quote_id);
$f$;
revoke all on function public.publish_core_quote_customer_identity(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.publish_core_quote_customer_identity(uuid,uuid) to authenticated;

-- Keep the deployed public projection and token predicates unchanged. Never expose
-- the billing snapshot through this public RPC or substitute a live legacy name.
create or replace function public.get_public_offer_by_token(input_token text)
returns table (
  id uuid,title text,status text,valid_until date,intro_text text,contact_name text,contact_email text,
  customer_request_title text,customer_request text,our_solution_title text,proposed_solution text,
  timeline_title text,work_description text,work_schedule text,pricing_title text,pricing_text text,
  payment_terms_title text,payment_terms text,benefits_text text,total_price numeric,customer_name text,
  company_name text,company_logo_url text,created_at timestamptz,updated_at timestamptz,creator_name text
)
language sql security definer set search_path='' as $f$
  select q.id,q.title,q.status,q.valid_until::date,q.intro_text,q.contact_name,q.contact_email,
    q.customer_request_title,q.customer_request,q.our_solution_title,q.proposed_solution,q.timeline_title,
    q.work_description,q.work_schedule,q.pricing_title,q.pricing_text,q.payment_terms_title,q.payment_terms,
    q.benefits_text,q.total_price,
    case when q.customer_identity_state='captured' then q.customer_snapshot->>'name'
      when q.customer_identity_state='draft' and q.share_token is null and not q.share_enabled and q.status='draft'
        and q.sent_at is null and q.accepted_at is null and q.rejected_at is null then c.name
      else null end as customer_name,
    co.name,co.logo_url,q.created_at,q.updated_at,p.full_name
  from public.quotes q
  left join public.customers c on c.id=q.customer_id and c.company_id=q.company_id
  left join public.companies co on co.id=q.company_id
  left join public.profiles p on p.id=q.created_by
  where q.share_token=input_token and q.share_token is not null
  limit 1;
$f$;
revoke all on function public.get_public_offer_by_token(text) from public;
grant execute on function public.get_public_offer_by_token(text) to anon,authenticated;
