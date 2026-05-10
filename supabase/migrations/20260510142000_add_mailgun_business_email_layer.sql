create table if not exists public.mail_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  job_id uuid null references public.jobs(id) on delete set null,
  offer_id uuid null,
  subject text not null,
  thread_key text not null unique,
  status text not null default 'open',
  last_message_at timestamptz,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_threads_status_check check (status in ('open', 'closed', 'archived')),
  constraint mail_threads_thread_key_check check (thread_key ~ '^t_[a-z0-9-]{8,64}$')
);

do $$
begin
  if to_regclass('public.offers') is not null then
    alter table public.mail_threads
      add constraint mail_threads_offer_id_fkey
      foreign key (offer_id) references public.offers(id) on delete set null;
  end if;
exception
  when duplicate_object then null;
end $$;

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  from_email text not null,
  from_name text,
  to_email text not null,
  to_name text,
  subject text not null,
  body_text text,
  body_html text,
  provider text not null default 'mailgun',
  provider_message_id text,
  mailgun_message_id text,
  in_reply_to text,
  references_header text,
  recipient_email text,
  sent_by uuid null references public.profiles(id) on delete set null,
  received_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mail_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  message_id uuid null references public.mail_messages(id) on delete cascade,
  event_type text not null,
  provider text not null default 'mailgun',
  provider_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mail_threads_company_job_idx
  on public.mail_threads(company_id, job_id, last_message_at desc);

create index if not exists mail_threads_company_customer_idx
  on public.mail_threads(company_id, customer_id, last_message_at desc);

create index if not exists mail_threads_company_offer_idx
  on public.mail_threads(company_id, offer_id, last_message_at desc);

create index if not exists mail_messages_company_thread_created_idx
  on public.mail_messages(company_id, thread_id, created_at);

create index if not exists mail_messages_company_direction_created_idx
  on public.mail_messages(company_id, direction, created_at desc);

create unique index if not exists mail_messages_provider_message_uidx
  on public.mail_messages(provider, provider_message_id)
  where provider_message_id is not null;

create unique index if not exists mail_messages_mailgun_message_uidx
  on public.mail_messages(mailgun_message_id)
  where mailgun_message_id is not null;

create index if not exists mail_events_company_created_idx
  on public.mail_events(company_id, created_at desc);

create index if not exists mail_events_message_idx
  on public.mail_events(message_id);

drop trigger if exists trg_mail_threads_set_updated_at on public.mail_threads;
create trigger trg_mail_threads_set_updated_at
before update on public.mail_threads
for each row execute function public.set_updated_at();

alter table public.mail_threads enable row level security;
alter table public.mail_messages enable row level security;
alter table public.mail_events enable row level security;

drop policy if exists mail_threads_select_company_admin on public.mail_threads;
create policy mail_threads_select_company_admin
on public.mail_threads
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists mail_messages_select_company_admin on public.mail_messages;
create policy mail_messages_select_company_admin
on public.mail_messages
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']));

drop policy if exists mail_events_select_company_admin on public.mail_events;
create policy mail_events_select_company_admin
on public.mail_events
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin']));

grant select on public.mail_threads to authenticated;
grant select on public.mail_messages to authenticated;
grant select on public.mail_events to authenticated;
