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
  total_price numeric,
  customer_name text
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
    q.intro_text,
    q.contact_name,
    q.contact_email,
    q.customer_request_title,
    q.customer_request,
    q.our_solution_title,
    q.proposed_solution,
    q.timeline_title,
    q.work_description,
    q.work_schedule,
    q.pricing_title,
    q.pricing_text,
    q.payment_terms_title,
    q.payment_terms,
    q.total_price,
    c.name as customer_name
  from public.quotes q
  left join public.customers c on c.id = q.customer_id
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
  select
    qi.id,
    qi.name,
    qi.description,
    qi.quantity,
    qi.unit,
    qi.unit_price,
    qi.total_price,
    qi.note
  from public.quotes q
  join public.quote_items qi on qi.quote_id = q.id
  where q.share_token = input_token
    and q.share_token is not null
  order by qi.sort_order asc, qi.created_at asc;
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
  now_utc timestamptz := now();
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
    quote_id,
    section_key,
    event_type,
    event_value,
    visitor_id,
    user_agent,
    device_type,
    referrer
  )
  values (
    quote_row.id,
    nullif(btrim(input_section_key), ''),
    btrim(input_event_type),
    nullif(btrim(input_event_value), ''),
    nullif(btrim(input_visitor_id), ''),
    nullif(btrim(input_user_agent), ''),
    nullif(btrim(input_device_type), ''),
    nullif(btrim(input_referrer), '')
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
      first_viewed_at = coalesce(quote_row.first_viewed_at, now_utc),
      last_viewed_at = now_utc,
      view_count = coalesce(quote_row.view_count, 0) + 1
    where id = quote_row.id;
  end if;

  return true;
end;
$$;

revoke all on function public.get_public_offer_by_token(text) from public;
revoke all on function public.get_public_offer_items_by_token(text) from public;
revoke all on function public.track_public_offer_event(text, text, text, text, text, text, text, text) from public;

grant execute on function public.get_public_offer_by_token(text) to anon, authenticated;
grant execute on function public.get_public_offer_items_by_token(text) to anon, authenticated;
grant execute on function public.track_public_offer_event(text, text, text, text, text, text, text, text) to anon, authenticated;
