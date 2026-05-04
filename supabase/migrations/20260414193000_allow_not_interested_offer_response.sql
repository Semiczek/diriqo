alter table public.offer_responses
  drop constraint if exists offer_responses_action_type_check;

alter table public.offer_responses
  add constraint offer_responses_action_type_check
  check (action_type in ('interested', 'contact_requested', 'revision_requested', 'not_interested'));

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
    quote_id,
    quote_title_snapshot,
    action_type,
    customer_name,
    customer_email,
    customer_phone,
    note,
    visitor_id,
    user_agent,
    referrer
  )
  values (
    quote_row.id,
    quote_row.title,
    input_action_type,
    btrim(input_customer_name),
    lower(btrim(input_customer_email)),
    btrim(input_customer_phone),
    nullif(btrim(coalesce(input_note, '')), ''),
    nullif(btrim(coalesce(input_visitor_id, '')), ''),
    nullif(btrim(coalesce(input_user_agent, '')), ''),
    nullif(btrim(coalesce(input_referrer, '')), '')
  )
  returning id into inserted_response_id;

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
    'cta',
    resolved_event_type,
    null,
    nullif(btrim(coalesce(input_visitor_id, '')), ''),
    nullif(btrim(coalesce(input_user_agent, '')), ''),
    null,
    nullif(btrim(coalesce(input_referrer, '')), '')
  );

  if input_action_type in ('interested', 'revision_requested', 'not_interested') then
    update public.quotes
    set status = resolved_status,
        updated_at = now()
    where id = quote_row.id;
  end if;

  return query select true, quote_row.id, resolved_status, inserted_response_id;
end;
$$;

revoke all on function public.submit_public_offer_response(text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.submit_public_offer_response(text, text, text, text, text, text, text, text, text) to anon, authenticated;
