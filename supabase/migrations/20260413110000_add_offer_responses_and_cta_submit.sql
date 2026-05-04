alter table public.quotes
  drop constraint if exists quotes_status_check;

alter table public.quotes
  add constraint quotes_status_check
  check (status in ('draft', 'ready', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'waiting_followup', 'revision_requested'));

create table if not exists public.offer_responses (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  quote_title_snapshot text not null,
  action_type text not null check (action_type in ('interested', 'contact_requested', 'revision_requested')),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  note text null,
  visitor_id text null,
  user_agent text null,
  referrer text null,
  created_at timestamptz not null default now()
);

create index if not exists offer_responses_quote_created_idx
  on public.offer_responses (quote_id, created_at desc);

create index if not exists offer_responses_quote_action_idx
  on public.offer_responses (quote_id, action_type);

alter table public.offer_responses enable row level security;

drop policy if exists "offer_responses_select_company_members" on public.offer_responses;
create policy "offer_responses_select_company_members"
on public.offer_responses
for select
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = offer_responses.quote_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

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

  if input_action_type not in ('interested', 'contact_requested', 'revision_requested') then
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

  if input_action_type in ('interested', 'revision_requested') then
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
