create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  email_address text not null,
  provider_type text not null default 'resend',
  is_active boolean not null default true,
  is_default_outbound boolean not null default false,
  is_default_inbound boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mailboxes_provider_type_check check (provider_type in ('resend', 'smtp', 'imap', 'mailbox'))
);

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  mailbox_id uuid not null references public.mailboxes(id) on delete restrict,
  related_entity_type text not null,
  related_entity_id uuid not null,
  customer_id uuid null,
  contact_id uuid null,
  subject_original text null,
  subject_normalized text null,
  status text not null default 'open',
  has_unread_inbound boolean not null default false,
  last_message_at timestamptz null,
  last_inbound_at timestamptz null,
  last_outbound_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_threads_related_entity_type_check check (
    related_entity_type in ('job', 'offer', 'inquiry', 'customer')
  ),
  constraint message_threads_status_check check (
    status in ('open', 'waiting_customer', 'waiting_internal', 'closed')
  )
);

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  mailbox_id uuid not null references public.mailboxes(id) on delete restrict,
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  related_entity_type text not null,
  related_entity_id uuid not null,
  customer_id uuid null,
  contact_id uuid null,
  message_type text not null,
  to_email text not null,
  to_name text null,
  cc text null,
  bcc text null,
  reply_to text null,
  subject_rendered text not null,
  html_rendered text null,
  text_rendered text null,
  provider text not null default 'resend',
  provider_message_id text null,
  internet_message_id text null,
  tracking_token text null,
  status text not null default 'queued',
  error_code text null,
  error_message text null,
  triggered_by_user_id uuid null,
  triggered_automatically boolean not null default false,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_messages_related_entity_type_check check (
    related_entity_type in ('job', 'offer', 'inquiry', 'customer')
  ),
  constraint outbound_messages_status_check check (
    status in ('draft', 'queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'cancelled')
  )
);

create table if not exists public.inbound_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  mailbox_id uuid not null references public.mailboxes(id) on delete restrict,
  thread_id uuid null references public.message_threads(id) on delete set null,
  related_entity_type text null,
  related_entity_id uuid null,
  customer_id uuid null,
  contact_id uuid null,
  from_email text not null,
  from_name text null,
  to_email text null,
  cc text null,
  subject text null,
  html_body text null,
  text_body text null,
  internet_message_id text null,
  in_reply_to_message_id text null,
  references_header text null,
  provider text not null default 'mailbox',
  provider_message_id text null,
  matching_status text not null default 'unmatched',
  received_at timestamptz not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbound_messages_related_entity_type_check check (
    related_entity_type is null or related_entity_type in ('job', 'offer', 'inquiry', 'customer')
  ),
  constraint inbound_messages_matching_status_check check (
    matching_status in ('matched', 'fallback_matched', 'unmatched')
  )
);

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  thread_id uuid null references public.message_threads(id) on delete set null,
  outbound_message_id uuid null references public.outbound_messages(id) on delete cascade,
  inbound_message_id uuid null references public.inbound_messages(id) on delete cascade,
  event_type text not null,
  provider_event_id text null,
  provider_payload jsonb null,
  note text null,
  created_at timestamptz not null default now()
);

create unique index if not exists mailboxes_company_email_uidx
  on public.mailboxes(company_id, email_address);

create unique index if not exists mailboxes_default_outbound_uidx
  on public.mailboxes(company_id)
  where is_default_outbound = true;

create unique index if not exists mailboxes_default_inbound_uidx
  on public.mailboxes(company_id)
  where is_default_inbound = true;

create index if not exists message_threads_company_entity_idx
  on public.message_threads(company_id, related_entity_type, related_entity_id);

create index if not exists message_threads_company_customer_idx
  on public.message_threads(company_id, customer_id);

create index if not exists message_threads_company_last_message_idx
  on public.message_threads(company_id, last_message_at desc);

create index if not exists outbound_messages_company_thread_created_idx
  on public.outbound_messages(company_id, thread_id, created_at);

create index if not exists outbound_messages_company_entity_idx
  on public.outbound_messages(company_id, related_entity_type, related_entity_id);

create unique index if not exists outbound_messages_provider_message_uidx
  on public.outbound_messages(provider, provider_message_id)
  where provider_message_id is not null;

create unique index if not exists outbound_messages_internet_message_uidx
  on public.outbound_messages(internet_message_id)
  where internet_message_id is not null;

create unique index if not exists outbound_messages_tracking_token_uidx
  on public.outbound_messages(tracking_token)
  where tracking_token is not null;

create index if not exists inbound_messages_company_thread_received_idx
  on public.inbound_messages(company_id, thread_id, received_at);

create index if not exists inbound_messages_company_entity_idx
  on public.inbound_messages(company_id, related_entity_type, related_entity_id);

create index if not exists inbound_messages_company_from_email_received_idx
  on public.inbound_messages(company_id, from_email, received_at desc);

create unique index if not exists inbound_messages_internet_message_uidx
  on public.inbound_messages(internet_message_id)
  where internet_message_id is not null;

create index if not exists message_events_company_created_idx
  on public.message_events(company_id, created_at desc);

create index if not exists message_events_outbound_idx
  on public.message_events(outbound_message_id);

create index if not exists message_events_inbound_idx
  on public.message_events(inbound_message_id);

create index if not exists message_events_thread_idx
  on public.message_events(thread_id);

drop trigger if exists trg_mailboxes_set_updated_at on public.mailboxes;
create trigger trg_mailboxes_set_updated_at
before update on public.mailboxes
for each row execute function public.set_updated_at();

drop trigger if exists trg_message_threads_set_updated_at on public.message_threads;
create trigger trg_message_threads_set_updated_at
before update on public.message_threads
for each row execute function public.set_updated_at();

drop trigger if exists trg_outbound_messages_set_updated_at on public.outbound_messages;
create trigger trg_outbound_messages_set_updated_at
before update on public.outbound_messages
for each row execute function public.set_updated_at();

drop trigger if exists trg_inbound_messages_set_updated_at on public.inbound_messages;
create trigger trg_inbound_messages_set_updated_at
before update on public.inbound_messages
for each row execute function public.set_updated_at();

alter table public.mailboxes enable row level security;
alter table public.message_threads enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.inbound_messages enable row level security;
alter table public.message_events enable row level security;

drop policy if exists "mailboxes_company_members_access" on public.mailboxes;
create policy "mailboxes_company_members_access"
on public.mailboxes
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = mailboxes.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = mailboxes.company_id
  )
);

drop policy if exists "message_threads_company_members_access" on public.message_threads;
create policy "message_threads_company_members_access"
on public.message_threads
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = message_threads.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = message_threads.company_id
  )
);

drop policy if exists "outbound_messages_company_members_access" on public.outbound_messages;
create policy "outbound_messages_company_members_access"
on public.outbound_messages
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = outbound_messages.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = outbound_messages.company_id
  )
);

drop policy if exists "inbound_messages_company_members_access" on public.inbound_messages;
create policy "inbound_messages_company_members_access"
on public.inbound_messages
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = inbound_messages.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = inbound_messages.company_id
  )
);

drop policy if exists "message_events_company_members_access" on public.message_events;
create policy "message_events_company_members_access"
on public.message_events
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = message_events.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = message_events.company_id
  )
);
