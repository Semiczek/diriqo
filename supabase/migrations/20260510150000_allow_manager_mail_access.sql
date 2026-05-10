drop policy if exists mail_threads_select_company_admin on public.mail_threads;
drop policy if exists mail_threads_select_mail_sender on public.mail_threads;
create policy mail_threads_select_mail_sender
on public.mail_threads
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin', 'manager']));

drop policy if exists mail_messages_select_company_admin on public.mail_messages;
drop policy if exists mail_messages_select_mail_sender on public.mail_messages;
create policy mail_messages_select_mail_sender
on public.mail_messages
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin', 'manager']));

drop policy if exists mail_events_select_company_admin on public.mail_events;
drop policy if exists mail_events_select_mail_sender on public.mail_events;
create policy mail_events_select_mail_sender
on public.mail_events
for select
to authenticated
using (public.has_company_role(company_id, array['super_admin', 'company_admin', 'manager']));
