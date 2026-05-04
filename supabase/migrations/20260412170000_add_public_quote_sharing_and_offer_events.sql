alter table public.quotes
  drop constraint if exists quotes_status_check;

alter table public.quotes
  add column if not exists contact_name text null,
  add column if not exists contact_email text null,
  add column if not exists share_token text null,
  add column if not exists intro_text text null,
  add column if not exists customer_request_title text not null default 'Požadavek zákazníka',
  add column if not exists our_solution_title text not null default 'Naše řešení',
  add column if not exists timeline_title text not null default 'Časový harmonogram',
  add column if not exists pricing_title text not null default 'Cenová kalkulace',
  add column if not exists payment_terms_title text not null default 'Platební podmínky',
  add column if not exists pricing_text text null,
  add column if not exists view_count integer not null default 0,
  add column if not exists first_viewed_at timestamptz null,
  add column if not exists last_viewed_at timestamptz null;

alter table public.quotes
  add constraint quotes_status_check
  check (status in ('draft', 'ready', 'sent', 'viewed', 'accepted', 'rejected', 'expired'));

create unique index if not exists quotes_share_token_uidx
  on public.quotes (share_token)
  where share_token is not null;

create index if not exists quotes_share_token_idx
  on public.quotes (share_token);

create table if not exists public.offer_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  section_key text null,
  event_type text not null,
  event_value text null,
  visitor_id text null,
  user_agent text null,
  device_type text null,
  referrer text null,
  created_at timestamptz not null default now()
);

create index if not exists offer_events_quote_created_idx
  on public.offer_events (quote_id, created_at desc);

create index if not exists offer_events_quote_type_idx
  on public.offer_events (quote_id, event_type);

create index if not exists offer_events_quote_section_idx
  on public.offer_events (quote_id, section_key);

alter table public.offer_events enable row level security;

drop policy if exists "offer_events_select_company_members" on public.offer_events;
create policy "offer_events_select_company_members"
on public.offer_events
for select
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = offer_events.quote_id
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
  )
);
