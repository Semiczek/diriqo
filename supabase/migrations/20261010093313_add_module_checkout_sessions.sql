-- Initial purchase reservations only. Completed scope is deliberately not released:
-- repurchase/cancellation/refund reconciliation needs a separate reviewed lifecycle.
-- No offers, Stripe customers, sessions, purchase orders or entitlements are seeded.

create table public.module_billing_customers (
  company_id uuid not null references public.companies(id) on delete restrict,
  livemode boolean not null,
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  primary key (company_id, livemode),
  unique (livemode, stripe_customer_id)
);

create table public.module_checkout_sessions (
  order_id uuid primary key references public.module_purchase_orders(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  product text not null check (product in ('diriqo_core','inventory','invoicing','smart_quotes','fleet')),
  register_id uuid check (register_id is null), -- POS registry/checkout is not supported in v1.
  livemode boolean not null,
  offer_id uuid not null references public.module_offers(id) on delete restrict,
  actor_auth_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  stripe_session_id text unique check (stripe_session_id is null or stripe_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  stripe_session_url text,
  state text not null default 'preparing' check (state in ('preparing','open','complete','expired')),
  constraint module_checkout_period check (
    isfinite(created_at) and isfinite(expires_at)
    and created_at = date_trunc('second', created_at)
    and expires_at = created_at + interval '60 minutes'
  ),
  constraint module_checkout_session_binding check (
    (state = 'preparing' and stripe_session_id is null and stripe_session_url is null)
    or (state <> 'preparing' and stripe_session_id is not null and stripe_session_url is not null)
  )
);
create unique index module_checkout_active_scope_key on public.module_checkout_sessions (
  company_id, product, coalesce(register_id, '00000000-0000-0000-0000-000000000000'::uuid), livemode
) where state <> 'expired';
create index module_checkout_offer_idx on public.module_checkout_sessions(offer_id);
create index module_checkout_actor_idx on public.module_checkout_sessions(actor_auth_user_id);

alter table public.module_billing_customers enable row level security;
alter table public.module_checkout_sessions enable row level security;
revoke all on public.module_billing_customers, public.module_checkout_sessions
  from public, anon, authenticated, service_role;
grant select on public.module_billing_customers, public.module_checkout_sessions to service_role;
-- A service writer must reserve the scope; direct order creation could bypass uniqueness.
revoke insert on public.module_purchase_orders from service_role;

create function private.guard_module_billing_customer_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op <> 'INSERT' or current_user not in ('postgres','supabase_admin') then
    raise exception 'module_billing_customer_immutable' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_module_billing_customer_immutable() from public, anon, authenticated, service_role;
create trigger guard_module_billing_customer_immutable
before insert or update or delete on public.module_billing_customers
for each row execute function private.guard_module_billing_customer_immutable();

create function private.guard_module_checkout_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare v_order public.module_purchase_orders%rowtype; v_offer public.module_offers%rowtype;
begin
  if tg_op = 'DELETE' or current_user not in ('postgres','supabase_admin') then
    raise exception 'module_checkout_immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select * into v_order from public.module_purchase_orders where id = new.order_id;
    select * into v_offer from public.module_offers where id = new.offer_id;
    if v_order.id is null or v_offer.id is null
      or v_order.company_id is distinct from new.company_id
      or v_order.offer_id is distinct from new.offer_id
      or v_order.register_id is distinct from new.register_id
      or v_offer.product is distinct from new.product
      or v_offer.livemode is distinct from new.livemode
      or new.state <> 'preparing' or new.stripe_session_id is not null or new.stripe_session_url is not null then
      raise exception 'module_checkout_scope_mismatch' using errcode = '22023';
    end if;
  else
    if (to_jsonb(new) - array['state','stripe_session_id','stripe_session_url']::text[])
      is distinct from (to_jsonb(old) - array['state','stripe_session_id','stripe_session_url']::text[]) then
      raise exception 'module_checkout_scope_immutable' using errcode = '42501';
    end if;
    if old.stripe_session_id is not null and (
      new.stripe_session_id is distinct from old.stripe_session_id
      or new.stripe_session_url is distinct from old.stripe_session_url
    ) then raise exception 'module_checkout_binding_immutable' using errcode = '42501'; end if;
    if not (
      (old.state = 'preparing' and new.state = 'open' and new.stripe_session_id is not null and new.stripe_session_url is not null)
      or (old.state = 'open' and new.state in ('complete','expired'))
    ) then raise exception 'module_checkout_state_transition' using errcode = '22023'; end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_module_checkout_immutable() from public, anon, authenticated, service_role;
create trigger guard_module_checkout_immutable before insert or update or delete on public.module_checkout_sessions
for each row execute function private.guard_module_checkout_immutable();

create function public.bind_module_billing_customer(p_company_id uuid, p_livemode boolean, p_customer_id text)
returns text language plpgsql security definer set search_path = '' as $function$
declare v_customer_id text;
begin
  if p_company_id is null or p_livemode is null or p_customer_id is null
    or p_customer_id !~ '^cus_[A-Za-z0-9]+$' then
    raise exception 'invalid_module_billing_customer' using errcode = '22023';
  end if;
  perform 1 from public.companies where id = p_company_id for share;
  if not found then raise exception 'module_company_not_found' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('module-customer:' || p_company_id::text || ':' || p_livemode::text, 0));
  select stripe_customer_id into v_customer_id from public.module_billing_customers
    where company_id = p_company_id and livemode = p_livemode;
  if found then return v_customer_id; end if;
  insert into public.module_billing_customers(company_id, livemode, stripe_customer_id)
    values (p_company_id, p_livemode, p_customer_id) returning stripe_customer_id into v_customer_id;
  return v_customer_id;
end;
$function$;

create function public.reserve_module_checkout(
  p_company_id uuid, p_offer_id uuid, p_register_id uuid, p_livemode boolean, p_actor_auth_user_id uuid
) returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $function$
declare
  v_offer public.module_offers%rowtype;
  v_attempt public.module_checkout_sessions%rowtype;
  v_customer_id text; v_now timestamptz; v_order_id uuid;
begin
  if p_company_id is null or p_offer_id is null or p_livemode is null or p_actor_auth_user_id is null then
    raise exception 'invalid_module_checkout_request' using errcode = '22023';
  end if;
  -- Canonical company guards require an existing company and an active admin membership.
  -- The API authenticates the actor; this service-only RPC independently checks the scope.
  perform 1 from public.companies where id = p_company_id for share;
  if not found then raise exception 'module_company_not_found' using errcode = '22023'; end if;
  perform 1 from public.company_members cm join public.profiles p on p.id = cm.profile_id
    where cm.company_id = p_company_id and cm.is_active = true
      and lower(btrim(coalesce(cm.role, ''))) in ('company_admin','super_admin')
      and (p.auth_user_id = p_actor_auth_user_id or p.user_id = p_actor_auth_user_id)
      and (p.auth_user_id is null or p.auth_user_id = p_actor_auth_user_id)
      and (p.user_id is null or p.user_id = p_actor_auth_user_id)
    for share of cm, p;
  if not found then raise exception 'module_checkout_admin_required' using errcode = '42501'; end if;

  select * into v_offer from public.module_offers where id = p_offer_id for share;
  if not found or not v_offer.is_published or v_offer.livemode <> p_livemode then
    raise exception 'module_checkout_offer_unavailable' using errcode = '22023';
  end if;
  if p_register_id is not null or v_offer.product not in ('diriqo_core','inventory','invoicing','smart_quotes','fleet') then
    raise exception 'module_checkout_product_unsupported' using errcode = '22023';
  end if;
  select stripe_customer_id into v_customer_id from public.module_billing_customers
    where company_id = p_company_id and livemode = p_livemode;
  if not found then raise exception 'module_billing_customer_required' using errcode = '22023'; end if;

  -- Identical advisory key plus the partial unique index serialize competing reservations.
  -- No local-clock expiry release: the service must first retrieve canonical Stripe expiry.
  perform pg_advisory_xact_lock(hashtextextended(
    'module-checkout:' || p_company_id::text || ':' || v_offer.product || ':company:' || p_livemode::text, 0));
  v_now := date_trunc('second', clock_timestamp());
  if exists (
    select 1 from public.company_module_entitlements e
    where e.company_id = p_company_id and e.product = v_offer.product
      and e.register_id is not distinct from p_register_id and e.livemode = p_livemode
      and e.origin = 'paid' and e.state = 'active' and not e.revoked
      and e.valid_from <= v_now and e.valid_until > v_now
  ) then raise exception 'module_checkout_already_active' using errcode = '23505'; end if;

  if v_offer.product <> 'diriqo_core' and not exists (
    select 1 from public.company_module_entitlements e
    where e.company_id = p_company_id and e.livemode = p_livemode
      and e.origin = 'paid' and e.state = 'active' and not e.revoked
      and e.valid_from <= v_now and e.valid_until > v_now
      and (e.product = 'diriqo_core' or (v_offer.product in ('inventory','invoicing') and e.product = 'pos'))
  ) then raise exception 'module_checkout_dependency_required' using errcode = '22023'; end if;

  select * into v_attempt from public.module_checkout_sessions
    where company_id = p_company_id and product = v_offer.product
      and register_id is not distinct from p_register_id and livemode = p_livemode and state <> 'expired'
    for update;
  if found then
    if v_attempt.offer_id <> p_offer_id then
      raise exception 'module_checkout_offer_conflict' using errcode = '23505';
    end if;
    -- A second authorized admin resumes the company reservation; creator is immutable audit.
    return to_jsonb(v_attempt) || jsonb_build_object('stripe_customer_id', v_customer_id);
  end if;
  insert into public.module_purchase_orders(company_id, offer_id, stripe_customer_id, register_id)
    values (p_company_id, p_offer_id, v_customer_id, p_register_id) returning id into v_order_id;
  insert into public.module_checkout_sessions(
    order_id, company_id, product, register_id, livemode, offer_id, actor_auth_user_id, created_at, expires_at
  ) values (
    v_order_id, p_company_id, v_offer.product, p_register_id, p_livemode, p_offer_id, p_actor_auth_user_id,
    v_now, v_now + interval '60 minutes'
  ) returning * into v_attempt;
  return to_jsonb(v_attempt) || jsonb_build_object('stripe_customer_id', v_customer_id);
end;
$function$;

create function public.record_module_checkout_session(
  p_order_id uuid, p_session_id text, p_session_url text, p_expires_at bigint
) returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $function$
declare v_attempt public.module_checkout_sessions%rowtype; v_customer_id text;
begin
  if p_order_id is null or p_session_id is null or p_session_url is null or p_expires_at is null
    or p_session_id !~ '^cs_[A-Za-z0-9_]+$' or length(p_session_url) > 4096
    or p_session_url !~ ('^https://checkout[.]stripe[.]com/(c/pay|pay)/' || p_session_id || '([?#][^[:space:]]*)?$')
    or strpos(p_session_url, chr(92)) > 0 or p_session_url ~ '[[:cntrl:]]' then
    raise exception 'invalid_module_checkout_session' using errcode = '22023';
  end if;
  select * into v_attempt from public.module_checkout_sessions where order_id = p_order_id for update;
  if not found then raise exception 'module_checkout_not_found' using errcode = '22023'; end if;
  if p_expires_at <> extract(epoch from v_attempt.expires_at)::bigint then
    raise exception 'module_checkout_expiry_mismatch' using errcode = '22023';
  end if;
  if v_attempt.stripe_session_id is not null then
    if v_attempt.stripe_session_id <> p_session_id or v_attempt.stripe_session_url <> p_session_url then
      raise exception 'module_checkout_session_conflict' using errcode = '23505';
    end if;
  else
    if v_attempt.state <> 'preparing' then raise exception 'module_checkout_state_conflict' using errcode = '22023'; end if;
    update public.module_checkout_sessions set stripe_session_id = p_session_id, stripe_session_url = p_session_url, state = 'open'
      where order_id = p_order_id returning * into v_attempt;
  end if;
  select stripe_customer_id into v_customer_id from public.module_purchase_orders where id = p_order_id;
  return to_jsonb(v_attempt) || jsonb_build_object('stripe_customer_id', v_customer_id);
end;
$function$;

create function public.close_module_checkout_session(p_order_id uuid, p_session_id text, p_state text)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $function$
declare v_attempt public.module_checkout_sessions%rowtype; v_customer_id text;
begin
  -- Caller must retrieve canonical Stripe status. This RPC neither grants nor revokes time.
  if p_order_id is null or p_session_id is null or p_state is null or p_state not in ('complete','expired') then
    raise exception 'invalid_module_checkout_close' using errcode = '22023';
  end if;
  select * into v_attempt from public.module_checkout_sessions where order_id = p_order_id for update;
  if not found then raise exception 'module_checkout_not_found' using errcode = '22023'; end if;
  if v_attempt.stripe_session_id is distinct from p_session_id then
    raise exception 'module_checkout_session_conflict' using errcode = '23505';
  end if;
  if v_attempt.state <> p_state then
    if v_attempt.state <> 'open' then
      raise exception 'module_checkout_terminal_state_conflict' using errcode = '22023';
    end if;
    update public.module_checkout_sessions set state = p_state where order_id = p_order_id returning * into v_attempt;
  end if;
  select stripe_customer_id into v_customer_id from public.module_purchase_orders where id = p_order_id;
  return to_jsonb(v_attempt) || jsonb_build_object('stripe_customer_id', v_customer_id);
end;
$function$;

revoke all on function public.bind_module_billing_customer(uuid,boolean,text) from public, anon, authenticated;
revoke all on function public.reserve_module_checkout(uuid,uuid,uuid,boolean,uuid) from public, anon, authenticated;
revoke all on function public.record_module_checkout_session(uuid,text,text,bigint) from public, anon, authenticated;
revoke all on function public.close_module_checkout_session(uuid,text,text) from public, anon, authenticated;
grant execute on function public.bind_module_billing_customer(uuid,boolean,text) to service_role;
grant execute on function public.reserve_module_checkout(uuid,uuid,uuid,boolean,uuid) to service_role;
grant execute on function public.record_module_checkout_session(uuid,text,text,bigint) to service_role;
grant execute on function public.close_module_checkout_session(uuid,text,text) to service_role;

comment on table public.module_checkout_sessions is 'Service-only initial module checkout reservation; local expiry never releases scope without canonical Stripe reconciliation. No paid activation here.';
comment on function public.reserve_module_checkout(uuid,uuid,uuid,boolean,uuid) is 'Service-only active-company-admin reservation; same scope and offer resume the same order. Current actor is reauthorized; creator remains immutable audit. POS/AI checkout unsupported.';
notify pgrst, 'reload schema';
