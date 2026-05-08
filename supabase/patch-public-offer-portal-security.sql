-- Diriqo public offer + customer portal hardening patch.
-- Safe to run in Supabase SQL Editor. Additive only, no destructive table changes.

create extension if not exists pgcrypto;

-- 1. Public offer token metadata.
alter table public.quotes
  add column if not exists share_token_scope text,
  add column if not exists share_token_expires_at timestamptz,
  add column if not exists share_token_revoked_at timestamptz,
  add column if not exists share_token_last_used_at timestamptz,
  add column if not exists first_viewed_at timestamptz,
  add column if not exists last_viewed_at timestamptz,
  add column if not exists viewed_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists view_count integer not null default 0;

update public.quotes
set share_token_scope = 'quote_public_offer'
where share_token is not null
  and share_token_scope is null;

update public.quotes
set share_token_expires_at = coalesce(
  (valid_until::timestamptz + interval '23 hours 59 minutes 59 seconds'),
  now() + interval '30 days'
)
where share_token is not null
  and share_token_expires_at is null;

create index if not exists quotes_public_offer_token_idx
  on public.quotes (share_token)
  where share_token is not null;

create index if not exists quotes_public_offer_scope_expiry_idx
  on public.quotes (share_token_scope, share_token_expires_at)
  where share_token is not null;

alter table public.calculation_items
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.quote_items
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.invoice_items
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.calculation_items ci
set company_id = c.company_id
from public.calculations c
where ci.calculation_id = c.id
  and ci.company_id is null;

update public.quote_items qi
set company_id = q.company_id
from public.quotes q
where qi.quote_id = q.id
  and qi.company_id is null;

update public.invoice_items ii
set company_id = i.company_id
from public.invoices i
where ii.invoice_id = i.id
  and ii.company_id is null;

-- 2. Response/event tenant metadata and replay indexes.
alter table public.offer_responses
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists quote_title_snapshot text,
  add column if not exists visitor_id text;

alter table public.offer_events
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists section_key text,
  add column if not exists event_value text,
  add column if not exists user_agent text,
  add column if not exists device_type text,
  add column if not exists referrer text,
  add column if not exists visitor_id text;

update public.offer_responses r
set company_id = q.company_id
from public.quotes q
where r.quote_id = q.id
  and r.company_id is null;

update public.offer_events e
set company_id = q.company_id
from public.quotes q
where e.quote_id = q.id
  and e.company_id is null;

create index if not exists offer_responses_company_quote_idx
  on public.offer_responses (company_id, quote_id, created_at desc);

create index if not exists offer_responses_replay_idx
  on public.offer_responses (quote_id, visitor_id, action_type, created_at desc);

create index if not exists offer_events_company_quote_idx
  on public.offer_events (company_id, quote_id, created_at desc);

create index if not exists offer_events_replay_idx
  on public.offer_events (quote_id, visitor_id, event_type, section_key, created_at desc);

-- 3. Shared token predicate.
create or replace function public.is_public_offer_token_active(quote_row public.quotes)
returns boolean
language sql
stable
set search_path = public
as $$
  select quote_row.share_token is not null
    and coalesce(quote_row.share_token_scope, 'quote_public_offer') = 'quote_public_offer'
    and quote_row.share_token_revoked_at is null
    and (quote_row.share_token_expires_at is null or quote_row.share_token_expires_at > now())
    and coalesce(quote_row.status, 'draft') <> 'draft';
$$;

-- 4. Public offer read RPCs scoped by active token.
create or replace function public.get_public_offer_by_token(input_token text)
returns table (
  id uuid,
  title text,
  status text,
  valid_until date,
  intro_text text,
  contact_name text,
  contact_email text,
  customer_request_title text,
  customer_request text,
  our_solution_title text,
  proposed_solution text,
  timeline_title text,
  work_description text,
  work_schedule text,
  pricing_title text,
  pricing_text text,
  payment_terms_title text,
  payment_terms text,
  benefits_text text,
  total_price numeric,
  customer_name text,
  created_at timestamptz,
  updated_at timestamptz,
  creator_name text
)
language sql
security definer
set search_path = public
as $$
  select
    q.id,
    q.title,
    q.status,
    q.valid_until,
    null::text as intro_text,
    null::text as contact_name,
    null::text as contact_email,
    null::text as customer_request_title,
    null::text as customer_request,
    null::text as our_solution_title,
    null::text as proposed_solution,
    null::text as timeline_title,
    null::text as work_description,
    null::text as work_schedule,
    'Cenova kalkulace'::text as pricing_title,
    null::text as pricing_text,
    'Platebni podminky'::text as payment_terms_title,
    'Faktura 14 dni po predani.'::text as payment_terms,
    null::text as benefits_text,
    q.total_price,
    c.name as customer_name,
    q.created_at,
    q.updated_at,
    p.full_name as creator_name
  from public.quotes q
  left join public.customers c on c.id = q.customer_id and c.company_id = q.company_id
  left join public.profiles p on p.id = q.created_by
  where q.share_token = input_token
    and public.is_public_offer_token_active(q)
  limit 1;
$$;

create or replace function public.get_public_offer_items_by_token(input_token text)
returns table (
  id uuid,
  name text,
  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  total_price numeric,
  note text
)
language sql
security definer
set search_path = public
as $$
  with offer as (
    select q.id, q.company_id, q.source_calculation_id
    from public.quotes q
    where q.share_token = input_token
      and public.is_public_offer_token_active(q)
    limit 1
  ),
  direct_items as (
    select
      qi.id,
      qi.name,
      qi.description,
      qi.quantity,
      qi.unit,
      qi.unit_price,
      qi.total_price,
      qi.note,
      qi.sort_order,
      qi.created_at
    from offer
    join public.quote_items qi
      on qi.quote_id = offer.id
     and qi.company_id = offer.company_id
  ),
  current_calculation_items as (
    select
      ci.id,
      ci.name,
      ci.description,
      ci.quantity,
      ci.unit,
      ci.unit_price,
      ci.total_price,
      ci.note,
      ci.sort_order,
      ci.created_at
    from offer
    join public.calculation_items ci
      on ci.calculation_id = offer.source_calculation_id
     and ci.company_id = offer.company_id
    where not exists (select 1 from direct_items)
      and ci.item_type = 'customer'
  ),
  latest_version as (
    select cv.id
    from offer
    join public.calculation_versions cv
      on cv.calculation_id = offer.source_calculation_id
     and cv.company_id = offer.company_id
    where not exists (select 1 from direct_items)
      and not exists (select 1 from current_calculation_items)
    order by cv.version_number desc
    limit 1
  ),
  version_items as (
    select
      cvi.id,
      cvi.name,
      cvi.description,
      cvi.quantity,
      cvi.unit,
      cvi.unit_price,
      cvi.total_price,
      cvi.note,
      cvi.sort_order,
      cvi.created_at
    from latest_version
    join public.calculation_version_items cvi on cvi.calculation_version_id = latest_version.id
    where cvi.item_type = 'customer'
  ),
  resolved_items as (
    select * from direct_items
    union all
    select * from current_calculation_items
    union all
    select * from version_items
  )
  select
    resolved_items.id,
    resolved_items.name,
    resolved_items.description,
    resolved_items.quantity,
    resolved_items.unit,
    resolved_items.unit_price,
    resolved_items.total_price,
    resolved_items.note
  from resolved_items
  order by resolved_items.sort_order asc, resolved_items.created_at asc;
$$;

-- 5. Public tracking with token scope, expiry, revocation and short-window replay protection.
create or replace function public.track_public_offer_event(
  input_token text,
  input_event_type text,
  input_section_key text default null,
  input_event_value text default null,
  input_visitor_id text default null,
  input_user_agent text default null,
  input_device_type text default null,
  input_referrer text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_row public.quotes%rowtype;
  normalized_visitor text;
  normalized_event text;
begin
  normalized_event := nullif(btrim(coalesce(input_event_type, '')), '');
  normalized_visitor := nullif(btrim(coalesce(input_visitor_id, '')), '');

  if input_token is null or btrim(input_token) = '' or normalized_event is null then
    return false;
  end if;

  select *
  into quote_row
  from public.quotes q
  where q.share_token = input_token
    and public.is_public_offer_token_active(q)
  limit 1;

  if not found then
    return false;
  end if;

  if normalized_visitor is not null and exists (
    select 1
    from public.offer_events e
    where e.quote_id = quote_row.id
      and e.visitor_id = normalized_visitor
      and e.event_type = normalized_event
      and coalesce(e.section_key, '') = coalesce(nullif(btrim(coalesce(input_section_key, '')), ''), '')
      and e.created_at > now() - interval '5 minutes'
  ) then
    return true;
  end if;

  insert into public.offer_events (
    company_id,
    quote_id,
    event_type,
    section_key,
    event_value,
    visitor_id,
    user_agent,
    device_type,
    referrer
  )
  values (
    quote_row.company_id,
    quote_row.id,
    normalized_event,
    nullif(btrim(coalesce(input_section_key, '')), ''),
    nullif(btrim(coalesce(input_event_value, '')), ''),
    normalized_visitor,
    nullif(btrim(coalesce(input_user_agent, '')), ''),
    nullif(btrim(coalesce(input_device_type, '')), ''),
    nullif(btrim(coalesce(input_referrer, '')), '')
  );

  update public.quotes
  set
    share_token_last_used_at = now(),
    first_viewed_at = case when normalized_event = 'offer_opened' then coalesce(first_viewed_at, now()) else first_viewed_at end,
    last_viewed_at = case when normalized_event = 'offer_opened' then now() else last_viewed_at end,
    viewed_at = case when normalized_event = 'offer_opened' then coalesce(viewed_at, now()) else viewed_at end,
    view_count = case when normalized_event = 'offer_opened' then coalesce(view_count, 0) + 1 else view_count end,
    status = case
      when normalized_event = 'offer_opened' and status in ('ready', 'sent') then 'viewed'
      else status
    end
  where id = quote_row.id;

  return true;
end;
$$;

-- 6. Public response with token scope, expiry, terminal-state protection and replay protection.
create or replace function public.submit_public_offer_response(
  input_token text,
  input_action_type text,
  input_customer_name text,
  input_customer_email text,
  input_customer_phone text,
  input_note text default null,
  input_visitor_id text default null,
  input_user_agent text default null,
  input_referrer text default null
)
returns table (
  success boolean,
  quote_id uuid,
  new_status text,
  response_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_row public.quotes%rowtype;
  inserted_response_id uuid;
  existing_response_id uuid;
  normalized_visitor text;
  normalized_action text;
  resolved_status text;
  resolved_event_type text;
begin
  normalized_action := nullif(btrim(coalesce(input_action_type, '')), '');
  normalized_visitor := nullif(btrim(coalesce(input_visitor_id, '')), '');

  if input_token is null or btrim(input_token) = '' then
    return query select false, null::uuid, null::text, null::uuid;
    return;
  end if;

  if normalized_action not in ('interested', 'contact_requested', 'revision_requested', 'not_interested') then
    return query select false, null::uuid, null::text, null::uuid;
    return;
  end if;

  if btrim(coalesce(input_customer_name, '')) = ''
    or btrim(coalesce(input_customer_email, '')) = ''
    or btrim(coalesce(input_customer_phone, '')) = '' then
    return query select false, null::uuid, null::text, null::uuid;
    return;
  end if;

  select *
  into quote_row
  from public.quotes q
  where q.share_token = input_token
    and public.is_public_offer_token_active(q)
    and coalesce(q.status, 'draft') not in ('accepted', 'rejected', 'expired')
    and (q.valid_until is null or q.valid_until >= current_date)
  limit 1;

  if not found then
    return query select false, null::uuid, null::text, null::uuid;
    return;
  end if;

  select r.id
  into existing_response_id
  from public.offer_responses r
  where r.quote_id = quote_row.id
    and r.action_type = normalized_action
    and lower(r.customer_email) = lower(btrim(input_customer_email))
    and coalesce(r.visitor_id, '') = coalesce(normalized_visitor, '')
    and r.created_at > now() - interval '10 minutes'
  order by r.created_at desc
  limit 1;

  if existing_response_id is not null then
    return query select true, quote_row.id, quote_row.status, existing_response_id;
    return;
  end if;

  resolved_status := quote_row.status;
  resolved_event_type := normalized_action;

  if normalized_action = 'interested' then
    resolved_status := 'waiting_followup';
    resolved_event_type := 'cta_interested_submitted';
  elsif normalized_action = 'revision_requested' then
    resolved_status := 'revision_requested';
    resolved_event_type := 'cta_revision_submitted';
  elsif normalized_action = 'contact_requested' then
    resolved_event_type := 'cta_contact_submitted';
  elsif normalized_action = 'not_interested' then
    resolved_status := 'rejected';
    resolved_event_type := 'cta_not_interested_submitted';
  end if;

  insert into public.offer_responses (
    company_id,
    quote_id,
    quote_title_snapshot,
    action_type,
    customer_name,
    customer_email,
    customer_phone,
    note,
    visitor_id
  )
  values (
    quote_row.company_id,
    quote_row.id,
    quote_row.title,
    normalized_action,
    btrim(input_customer_name),
    lower(btrim(input_customer_email)),
    btrim(input_customer_phone),
    nullif(btrim(coalesce(input_note, '')), ''),
    normalized_visitor
  )
  returning id into inserted_response_id;

  insert into public.offer_events (
    company_id,
    quote_id,
    event_type,
    visitor_id,
    user_agent,
    referrer
  )
  values (
    quote_row.company_id,
    quote_row.id,
    resolved_event_type,
    normalized_visitor,
    nullif(btrim(coalesce(input_user_agent, '')), ''),
    nullif(btrim(coalesce(input_referrer, '')), '')
  );

  update public.quotes
  set
    status = resolved_status,
    share_token_last_used_at = now(),
    rejected_at = case when resolved_status = 'rejected' then coalesce(rejected_at, now()) else rejected_at end
  where id = quote_row.id;

  return query select true, quote_row.id, resolved_status, inserted_response_id;
end;
$$;

revoke all on function public.is_public_offer_token_active(public.quotes) from public;
revoke all on function public.get_public_offer_by_token(text) from public;
revoke all on function public.get_public_offer_items_by_token(text) from public;
revoke all on function public.track_public_offer_event(text, text, text, text, text, text, text, text) from public;
revoke all on function public.submit_public_offer_response(text, text, text, text, text, text, text, text, text) from public;

grant execute on function public.get_public_offer_by_token(text) to anon, authenticated;
grant execute on function public.get_public_offer_items_by_token(text) to anon, authenticated;
grant execute on function public.track_public_offer_event(text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_public_offer_response(text, text, text, text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
