-- Pending additive migration. No commercial offers, prices, orders or grants are seeded.
-- The provider-assigned migration version is recorded by the root agent after review/apply.
-- This is payment authority only, not a checkout or complete domain authorization layer.

create function private.module_offer_configuration_valid(
  p_product text, p_capabilities text[], p_policy_version text
) returns boolean language sql immutable set search_path = '' as $function$
  select coalesce(
    p_policy_version = 'diriqo-capabilities-v0.1'
    and p_product = any(array['diriqo_core','inventory','invoicing','smart_quotes','fleet','ai_assistant','pos'])
    and cardinality(p_capabilities) > 0 and array_ndims(p_capabilities) = 1
    and array_lower(p_capabilities, 1) = 1
    and array_position(p_capabilities, null) is null
    and cardinality(p_capabilities) = (select count(distinct c) from unnest(p_capabilities) c)
    and not exists (
      select 1 from unnest(p_capabilities) requested(code)
      where not exists (
        -- Exact registry snapshot: lib/platform/capabilities.ts, diriqo-capabilities-v0.1.
        select 1 from (values
          ('diriqo_core','core.jobs.create'), ('diriqo_core','core.jobs.update'),
          ('diriqo_core','core.jobs.close'), ('diriqo_core','core.customers.manage'),
          ('diriqo_core','core.workers.manage'), ('diriqo_core','core.rates.manage'),
          ('diriqo_core','core.time.record'), ('diriqo_core','core.time.approve'),
          ('diriqo_core','core.quotes.create'), ('diriqo_core','core.calendar.manage'),
          ('diriqo_core','core.absences.request'), ('diriqo_core','core.absences.approve'),
          ('diriqo_core','core.advances.request'), ('diriqo_core','core.advances.pay'),
          ('diriqo_core','core.files.upload'), ('diriqo_core','core.handover.confirm'),
          ('diriqo_core','core.costs.record'), ('diriqo_core','core.economics.read'),
          ('diriqo_core','core.history.read'), ('diriqo_core','core.history.export'),
          ('inventory','inventory.receipt.post'), ('inventory','inventory.movement.post'),
          ('inventory','inventory.ocr.request'), ('inventory','inventory.history.read'),
          ('inventory','inventory.history.export'), ('invoicing','invoicing.invoice.issue'),
          ('invoicing','invoicing.ocr.request'), ('invoicing','invoicing.payment.settle'),
          ('invoicing','invoicing.history.read'), ('invoicing','invoicing.history.export'),
          ('smart_quotes','smart_quotes.template.manage'), ('smart_quotes','smart_quotes.ocr.request'),
          ('smart_quotes','smart_quotes.history.read'), ('smart_quotes','smart_quotes.history.export'),
          ('fleet','fleet.vehicle.manage'), ('fleet','fleet.trip.record'),
          ('fleet','fleet.history.read'), ('fleet','fleet.history.export'),
          ('ai_assistant','ai_assistant.conversation.run'), ('ai_assistant','ai_assistant.history.read'),
          ('ai_assistant','ai_assistant.history.export'), ('pos','pos.sale.create'),
          ('pos','pos.sale.settle'), ('pos','pos.catalog.manage'), ('pos','pos.shift.close'),
          ('pos','pos.shift.manage'), ('pos','pos.offline_cash.sell'),
          ('pos','pos.open_account.manage'), ('pos','pos.kitchen.send'),
          ('pos','pos.history.read'), ('pos','pos.history.export')
        ) known(product, code)
        where known.product = p_product and known.code = requested.code
      )
    ), false
  );
$function$;
revoke all on function private.module_offer_configuration_valid(text,text[],text) from public, anon, authenticated;
grant execute on function private.module_offer_configuration_valid(text,text[],text) to service_role;

create table public.module_offers (
  id uuid primary key default gen_random_uuid(),
  offer_key text not null unique check (length(btrim(offer_key)) > 0 and offer_key = btrim(offer_key)),
  product text not null,
  stripe_price_id text not null unique check (length(btrim(stripe_price_id)) > 0 and stripe_price_id = btrim(stripe_price_id)),
  livemode boolean not null,
  currency text not null check (length(currency) = 3 and currency ~ '^[a-z]{3}$'),
  unit_amount bigint not null check (unit_amount > 0 and unit_amount <= 9007199254740991),
  capabilities text[] not null,
  policy_version text not null,
  history_days integer not null check (history_days >= 0),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  constraint module_offer_known_configuration check (
    private.module_offer_configuration_valid(product, capabilities, policy_version)
  )
);

create table public.module_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  offer_id uuid not null references public.module_offers(id) on delete restrict,
  stripe_customer_id text not null check (length(btrim(stripe_customer_id)) > 0 and stripe_customer_id = btrim(stripe_customer_id)),
  stripe_subscription_id text unique check (stripe_subscription_id is null or (length(btrim(stripe_subscription_id)) > 0 and stripe_subscription_id = btrim(stripe_subscription_id))),
  register_id uuid,
  created_at timestamptz not null default now()
);
create index module_purchase_orders_company_idx on public.module_purchase_orders(company_id);
create index module_purchase_orders_offer_idx on public.module_purchase_orders(offer_id);

create table public.company_module_entitlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  product text not null,
  register_id uuid,
  policy_version text not null,
  source_ref text not null check (length(btrim(source_ref)) > 0),
  origin text not null default 'paid' check (origin = 'paid'),
  state text not null default 'active' check (state = 'active'),
  revoked boolean not null default false check (not revoked),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  history_until timestamptz not null,
  capabilities text[] not null,
  grace_capabilities text[] not null default '{}' check (cardinality(grace_capabilities) = 0),
  grace_until timestamptz check (grace_until is null),
  cancel_at_period_end boolean not null default false check (not cancel_at_period_end),
  invoice_id text not null check (length(btrim(invoice_id)) > 0),
  invoice_line_id text not null check (length(btrim(invoice_line_id)) > 0),
  livemode boolean not null,
  order_id uuid not null references public.module_purchase_orders(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint company_module_entitlements_receipt_key unique (invoice_id, invoice_line_id, livemode),
  constraint company_module_entitlements_valid_period check (
    isfinite(valid_from) and isfinite(valid_until) and isfinite(history_until)
    and valid_until > valid_from and history_until >= valid_until
  ),
  constraint company_module_entitlements_scope check (
    (product = 'pos' and register_id is not null) or (product <> 'pos' and register_id is null)
  ),
  constraint company_module_entitlements_known_configuration check (
    private.module_offer_configuration_valid(product, capabilities, policy_version)
  )
);
create index company_module_entitlements_company_idx on public.company_module_entitlements(company_id, product);
create index company_module_entitlements_order_idx on public.company_module_entitlements(order_id);

create table private.module_payment_events (
  event_id text not null check (length(btrim(event_id)) > 0),
  livemode boolean not null,
  receipt_hash text not null check (receipt_hash ~ '^[0-9a-f]{64}$'),
  order_id uuid not null references public.module_purchase_orders(id) on delete restrict,
  entitlement_id uuid not null references public.company_module_entitlements(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (event_id, livemode)
);
create index module_payment_events_entitlement_idx on private.module_payment_events(entitlement_id);
create index module_payment_events_order_idx on private.module_payment_events(order_id);

alter table public.module_offers enable row level security;
alter table public.module_purchase_orders enable row level security;
alter table public.company_module_entitlements enable row level security;
alter table private.module_payment_events enable row level security;
revoke all on public.module_offers, public.module_purchase_orders,
  public.company_module_entitlements, private.module_payment_events
  from public, anon, authenticated, service_role;
grant select, insert on public.module_offers, public.module_purchase_orders to service_role;
grant update(is_published) on public.module_offers to service_role;
grant select on public.company_module_entitlements, private.module_payment_events to service_role;
grant select on public.company_module_entitlements to authenticated;
create policy company_module_entitlements_member_read on public.company_module_entitlements
for select to authenticated using (
  auth.uid() is not null and public.has_company_role(
    company_id, array['super_admin','company_admin','manager','worker']::text[]
  )
);

create function private.guard_module_offer_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'module_offer_immutable' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'is_published') is distinct from (to_jsonb(old) - 'is_published') then
    raise exception 'module_offer_immutable' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_module_offer_immutable() from public, anon, authenticated;
create trigger guard_module_offer_immutable before update or delete on public.module_offers
for each row execute function private.guard_module_offer_immutable();

create function private.guard_module_order_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare v_product text; v_published boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'module_order_immutable' using errcode = '42501';
  elsif tg_op = 'INSERT' then
    if new.stripe_subscription_id is not null then
      raise exception 'module_subscription_must_bind_from_payment' using errcode = '42501';
    end if;
    select o.product, o.is_published into v_product, v_published
      from public.module_offers o where o.id = new.offer_id for share;
    if not found or not v_published then
      raise exception 'module_offer_not_published' using errcode = '22023';
    end if;
    if (v_product = 'pos' and new.register_id is null)
      or (v_product <> 'pos' and new.register_id is not null) then
      raise exception 'module_order_register_scope' using errcode = '22023';
    end if;
  elsif (to_jsonb(new) - 'stripe_subscription_id') is distinct from (to_jsonb(old) - 'stripe_subscription_id')
    or old.stripe_subscription_id is not null or new.stripe_subscription_id is null
    or current_user not in ('postgres','supabase_admin') then
    -- The SECURITY DEFINER payment RPC binds once as its owner. Service role has no UPDATE grant.
    raise exception 'module_order_immutable' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_module_order_immutable() from public, anon, authenticated;
create trigger guard_module_order_immutable before insert or update or delete on public.module_purchase_orders
for each row execute function private.guard_module_order_immutable();

create function private.guard_module_payment_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception 'module_payment_record_immutable' using errcode = '42501';
end;
$function$;
revoke all on function private.guard_module_payment_append_only() from public, anon, authenticated;
create trigger guard_company_module_entitlements_append_only
before update or delete on public.company_module_entitlements
for each row execute function private.guard_module_payment_append_only();
create trigger guard_module_payment_events_append_only
before update or delete on private.module_payment_events
for each row execute function private.guard_module_payment_append_only();

create function public.apply_paid_module_invoice(
  p_order_id uuid, p_event_id text, p_livemode boolean,
  p_invoice_id text, p_invoice_line_id text, p_customer_id text,
  p_subscription_id text, p_price_id text, p_currency text,
  p_quantity integer, p_line_amount bigint, p_amount_paid bigint, p_amount_due bigint,
  p_period_start bigint, p_period_end bigint
) returns uuid language plpgsql security definer set search_path = '' set timezone = 'UTC' as $function$
declare
  v_order public.module_purchase_orders%rowtype;
  v_offer public.module_offers%rowtype;
  v_event private.module_payment_events%rowtype;
  v_receipt_hash text;
  v_existing_hash text;
  v_entitlement_id uuid;
  v_from timestamptz; v_until timestamptz; v_history_until timestamptz;
begin
  -- Only a trusted service handler may call this RPC after verifying the signed paid event.
  -- SQL independently validates its stored purchase scope and strict v1 invoice economics.
  if p_order_id is null or p_livemode is null
    or p_event_id is null or p_invoice_id is null or p_invoice_line_id is null
    or p_customer_id is null or p_subscription_id is null or p_price_id is null
    or p_currency is null or p_quantity is null or p_line_amount is null
    or p_amount_paid is null or p_amount_due is null or p_period_start is null or p_period_end is null
    or length(btrim(p_event_id)) = 0 or p_event_id <> btrim(p_event_id)
    or length(btrim(p_invoice_id)) = 0 or p_invoice_id <> btrim(p_invoice_id)
    or length(btrim(p_invoice_line_id)) = 0 or p_invoice_line_id <> btrim(p_invoice_line_id)
    or length(btrim(p_customer_id)) = 0 or p_customer_id <> btrim(p_customer_id)
    or length(btrim(p_subscription_id)) = 0 or p_subscription_id <> btrim(p_subscription_id)
    or length(btrim(p_price_id)) = 0 or p_price_id <> btrim(p_price_id)
    or length(p_currency) <> 3 or p_currency !~ '^[a-z]{3}$'
    or p_quantity <> 1 or p_line_amount <= 0 or p_amount_due <= 0
    or p_amount_paid < p_amount_due or p_amount_paid > 9007199254740991
    or p_period_start < 0 or p_period_end <= p_period_start or p_period_end > 253402300799 then
    raise exception 'invalid_paid_module_receipt' using errcode = '22023';
  end if;

  v_receipt_hash := encode(sha256(convert_to(jsonb_build_array(
    p_order_id, p_livemode, p_invoice_id, p_invoice_line_id, p_customer_id,
    p_subscription_id, p_price_id, p_currency, p_quantity,
    p_line_amount, p_amount_paid, p_amount_due, p_period_start, p_period_end
  )::text, 'UTF8')), 'hex');

  -- Stable lock ordering serializes retries even when a conflicting request names another order.
  perform pg_advisory_xact_lock(hashtextextended('module-event:' || p_livemode::text || ':' || p_event_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('module-receipt:' || p_livemode::text || ':' || p_invoice_id || ':' || p_invoice_line_id, 0));
  select * into v_order from public.module_purchase_orders where id = p_order_id for update;
  if not found then raise exception 'module_order_not_found' using errcode = '22023'; end if;
  select * into v_offer from public.module_offers where id = v_order.offer_id;
  if not found or not private.module_offer_configuration_valid(v_offer.product, v_offer.capabilities, v_offer.policy_version) then
    raise exception 'invalid_module_offer_configuration' using errcode = '22023';
  end if;
  if v_order.stripe_customer_id <> p_customer_id or v_offer.stripe_price_id <> p_price_id
    or v_offer.livemode <> p_livemode or v_offer.currency <> p_currency
    or v_offer.unit_amount <> p_line_amount or v_offer.unit_amount <> p_amount_due
    or (v_order.stripe_subscription_id is not null and v_order.stripe_subscription_id <> p_subscription_id) then
    raise exception 'module_order_receipt_mismatch' using errcode = '22023';
  end if;

  select * into v_event from private.module_payment_events
    where event_id = p_event_id and livemode = p_livemode;
  if found then
    if v_event.receipt_hash <> v_receipt_hash or v_event.order_id <> p_order_id then
      raise exception 'module_payment_event_conflict' using errcode = '23505';
    end if;
    return v_event.entitlement_id;
  end if;

  select id into v_entitlement_id from public.company_module_entitlements
    where invoice_id = p_invoice_id and invoice_line_id = p_invoice_line_id and livemode = p_livemode;
  if found then
    select e.receipt_hash into v_existing_hash from private.module_payment_events e
      where e.entitlement_id = v_entitlement_id order by e.created_at, e.event_id limit 1;
    if not found or v_existing_hash is distinct from v_receipt_hash then
      raise exception 'module_invoice_line_conflict' using errcode = '23505';
    end if;
  else
    if v_order.stripe_subscription_id is null then
      update public.module_purchase_orders set stripe_subscription_id = p_subscription_id where id = p_order_id;
    end if;
    v_from := to_timestamp(p_period_start::double precision);
    v_until := to_timestamp(p_period_end::double precision);
    v_history_until := v_until + (v_offer.history_days::bigint * 86400) * interval '1 second';
    insert into public.company_module_entitlements (
      company_id, product, register_id, policy_version, source_ref,
      valid_from, valid_until, history_until, capabilities,
      invoice_id, invoice_line_id, livemode, order_id
    ) values (
      v_order.company_id, v_offer.product, v_order.register_id, v_offer.policy_version,
      'stripe:invoice:' || case when p_livemode then 'live:' else 'test:' end || p_invoice_id || ':line:' || p_invoice_line_id,
      v_from, v_until, v_history_until, v_offer.capabilities,
      p_invoice_id, p_invoice_line_id, p_livemode, p_order_id
    ) returning id into v_entitlement_id;
  end if;

  insert into private.module_payment_events(event_id, livemode, receipt_hash, order_id, entitlement_id)
    values (p_event_id, p_livemode, v_receipt_hash, p_order_id, v_entitlement_id);
  return v_entitlement_id;
end;
$function$;
revoke all on function public.apply_paid_module_invoice(uuid,text,boolean,text,text,text,text,text,text,integer,bigint,bigint,bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.apply_paid_module_invoice(uuid,text,boolean,text,text,text,text,text,text,integer,bigint,bigint,bigint,bigint,bigint)
  to service_role;

comment on table public.module_offers is 'Immutable commercial snapshots; initially empty. Publish only after the commercial flow is ready.';
comment on table public.company_module_entitlements is 'Append-only paid module grant periods; no legacy subscription rewrite or global company status.';
comment on function public.apply_paid_module_invoice(uuid,text,boolean,text,text,text,text,text,text,integer,bigint,bigint,bigint,bigint,bigint)
  is 'Service-only activation from a verified paid invoice; strict single-unit full-price v1, replay safe. Caller must verify provider signature, event type and actual payment.';
