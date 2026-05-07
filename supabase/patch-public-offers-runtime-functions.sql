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
    'Cenová kalkulace'::text as pricing_title,
    null::text as pricing_text,
    'Platební podmínky'::text as payment_terms_title,
    'Faktura 14 dní po předání.'::text as payment_terms,
    null::text as benefits_text,
    q.total_price,
    c.name as customer_name,
    q.created_at,
    q.updated_at,
    p.full_name as creator_name
  from public.quotes q
  left join public.customers c on c.id = q.customer_id
  left join public.profiles p on p.id = q.created_by
  where q.share_token = input_token
    and q.share_token is not null
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
    select q.id, q.source_calculation_id
    from public.quotes q
    where q.share_token = input_token
      and q.share_token is not null
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
    join public.quote_items qi on qi.quote_id = offer.id
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
    join public.calculation_items ci on ci.calculation_id = offer.source_calculation_id
    where not exists (select 1 from direct_items)
      and ci.item_type = 'customer'
  ),
  latest_version as (
    select cv.id
    from offer
    join public.calculation_versions cv on cv.calculation_id = offer.source_calculation_id
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
  next_status text;
begin
  if input_token is null or btrim(input_token) = '' then
    return false;
  end if;

  if input_event_type is null or btrim(input_event_type) = '' then
    return false;
  end if;

  select *
  into quote_row
  from public.quotes
  where share_token = input_token
    and share_token is not null
  limit 1;

  if not found then
    return false;
  end if;

  insert into public.offer_events (
    company_id,
    quote_id,
    event_type,
    visitor_id
  )
  values (
    quote_row.company_id,
    quote_row.id,
    btrim(input_event_type),
    nullif(btrim(coalesce(input_visitor_id, '')), '')
  );

  if btrim(input_event_type) = 'offer_opened' then
    next_status :=
      case
        when quote_row.valid_until is not null and quote_row.valid_until < current_date then 'expired'
        when quote_row.status in ('draft', 'ready', 'sent') then 'viewed'
        else quote_row.status
      end;

    update public.quotes
    set
      status = coalesce(next_status, quote_row.status),
      viewed_at = coalesce(quote_row.viewed_at, now())
    where id = quote_row.id;
  end if;

  return true;
end;
$$;

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
  resolved_status text;
  resolved_event_type text;
begin
  if input_token is null or btrim(input_token) = '' then
    return query select false, null::uuid, null::text, null::uuid;
    return;
  end if;

  if input_action_type not in ('interested', 'contact_requested', 'revision_requested', 'not_interested') then
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
  from public.quotes
  where share_token = input_token
    and share_token is not null
  limit 1;

  if not found then
    return query select false, null::uuid, null::text, null::uuid;
    return;
  end if;

  resolved_status := quote_row.status;
  resolved_event_type := input_action_type;

  if input_action_type = 'interested' then
    resolved_status := 'waiting_followup';
    resolved_event_type := 'cta_interested_submitted';
  elsif input_action_type = 'revision_requested' then
    resolved_status := 'revision_requested';
    resolved_event_type := 'cta_revision_submitted';
  elsif input_action_type = 'contact_requested' then
    resolved_event_type := 'cta_contact_submitted';
  elsif input_action_type = 'not_interested' then
    resolved_status := 'rejected';
    resolved_event_type := 'cta_not_interested_submitted';
  end if;

  insert into public.offer_responses (
    company_id,
    quote_id,
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
    input_action_type,
    btrim(input_customer_name),
    lower(btrim(input_customer_email)),
    btrim(input_customer_phone),
    nullif(btrim(coalesce(input_note, '')), ''),
    nullif(btrim(coalesce(input_visitor_id, '')), '')
  )
  returning id into inserted_response_id;

  insert into public.offer_events (
    company_id,
    quote_id,
    event_type,
    visitor_id
  )
  values (
    quote_row.company_id,
    quote_row.id,
    resolved_event_type,
    nullif(btrim(coalesce(input_visitor_id, '')), '')
  );

  update public.quotes
  set status = resolved_status
  where id = quote_row.id;

  return query select true, quote_row.id, resolved_status, inserted_response_id;
end;
$$;

revoke all on function public.get_public_offer_by_token(text) from public;
revoke all on function public.get_public_offer_items_by_token(text) from public;
revoke all on function public.track_public_offer_event(text, text, text, text, text, text, text, text) from public;
revoke all on function public.submit_public_offer_response(text, text, text, text, text, text, text, text, text) from public;

grant execute on function public.get_public_offer_by_token(text) to anon, authenticated;
grant execute on function public.get_public_offer_items_by_token(text) to anon, authenticated;
grant execute on function public.track_public_offer_event(text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.submit_public_offer_response(text, text, text, text, text, text, text, text, text) to anon, authenticated;
