-- PROPOSED MIGRATION ONLY - REVIEW BEFORE RUNNING IN SUPABASE.
-- Goal: split RLS access between admin Hub users, workers, and customer portal users.
-- This migration is intentionally conservative and uses SECURITY DEFINER helpers to avoid
-- recursive policies on profiles/company_members.

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
     or p.user_id = auth.uid()
  limit 1
$$;

create or replace function public.has_company_role(target_company_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = target_company_id
      and cm.is_active = true
      and lower(coalesce(cm.role::text, '')) = any (allowed_roles)
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
$$;

create or replace function public.is_company_admin(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_company_role(target_company_id, array['super_admin', 'company_admin'])
$$;

create or replace function public.is_company_worker(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_company_role(target_company_id, array['worker'])
$$;

create or replace function public.is_own_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_profile_id = public.current_profile_id()
$$;

create or replace function public.is_member_profile_in_admin_company(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members target_cm
    where target_cm.profile_id = target_profile_id
      and target_cm.is_active = true
      and public.is_company_admin(target_cm.company_id)
  )
$$;

create or replace function public.is_customer_portal_user_for_customer(target_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.customer_portal_users cpu
    where cpu.customer_id = target_customer_id
      and cpu.auth_user_id = auth.uid()
      and cpu.is_active = true
  )
$$;

create or replace function public.is_worker_assigned_to_job(target_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.job_assignments ja
    where ja.job_id = target_job_id
      and ja.profile_id = public.current_profile_id()
  )
  or exists (
    select 1
    from public.work_shifts ws
    where ws.job_id = target_job_id
      and ws.profile_id = public.current_profile_id()
  )
$$;

create or replace function public.job_company_id(target_job_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select j.company_id
  from public.jobs j
  where j.id = target_job_id
  limit 1
$$;

create or replace function public.customer_company_id(target_customer_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.company_id
  from public.customers c
  where c.id = target_customer_id
  limit 1
$$;

do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array[
    'profiles',
    'company_members',
    'companies',
    'customers',
    'customer_contacts',
    'jobs',
    'job_assignments',
    'job_cost_items',
    'job_checklists',
    'job_checklist_items',
    'job_customer_contacts',
    'work_shifts',
    'work_logs',
    'worker_advances',
    'advance_requests',
    'payroll_items',
    'calendar_events',
    'calendar_event_assignments',
    'issues',
    'job_photos',
    'calculations',
    'calculation_items',
    'calculation_versions',
    'calculation_version_items',
    'quotes',
    'quote_items',
    'offer_events',
    'offer_responses',
    'leads',
    'mailboxes',
    'message_threads',
    'outbound_messages',
    'inbound_messages',
    'message_events',
    'customer_portal_users'
  ] loop
    if to_regclass('public.' || target_table) is not null then
      execute format('alter table public.%I enable row level security', target_table);

      for policy_name in
        select pol.polname
        from pg_policy pol
        join pg_class cls on cls.oid = pol.polrelid
        join pg_namespace nsp on nsp.oid = cls.relnamespace
        where nsp.nspname = 'public'
          and cls.relname = target_table
      loop
        execute format('drop policy if exists %I on public.%I', policy_name, target_table);
      end loop;
    end if;
  end loop;
end $$;

create policy profiles_select_role_scoped
on public.profiles
for select
to authenticated
using (
  public.is_own_profile(id)
  or public.is_member_profile_in_admin_company(id)
);

create policy profiles_update_own_or_admin_company
on public.profiles
for update
to authenticated
using (
  public.is_own_profile(id)
  or public.is_member_profile_in_admin_company(id)
)
with check (
  public.is_own_profile(id)
  or public.is_member_profile_in_admin_company(id)
);

create policy company_members_select_role_scoped
on public.company_members
for select
to authenticated
using (
  public.is_own_profile(profile_id)
  or public.is_company_admin(company_id)
);

create policy company_members_admin_write
on public.company_members
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy companies_select_members_or_portal
on public.companies
for select
to authenticated
using (
  public.is_company_admin(id)
  or public.is_company_worker(id)
  or exists (
    select 1
    from public.customers c
    where c.company_id = companies.id
      and public.is_customer_portal_user_for_customer(c.id)
  )
);

create policy companies_admin_write
on public.companies
for update
to authenticated
using (public.is_company_admin(id))
with check (public.is_company_admin(id));

create policy customers_select_admin_or_portal
on public.customers
for select
to authenticated
using (
  public.is_company_admin(company_id)
  or public.is_customer_portal_user_for_customer(id)
);

create policy customers_admin_write
on public.customers
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy customer_contacts_select_admin_or_own_portal_customer
on public.customer_contacts
for select
to authenticated
using (
  public.is_company_admin(public.customer_company_id(customer_id))
  or public.is_customer_portal_user_for_customer(customer_id)
);

create policy customer_contacts_admin_write
on public.customer_contacts
for all
to authenticated
using (public.is_company_admin(public.customer_company_id(customer_id)))
with check (public.is_company_admin(public.customer_company_id(customer_id)));

create policy customer_portal_users_select_own_row
on public.customer_portal_users
for select
to authenticated
using (
  auth.uid() = auth_user_id
  and is_active = true
);

create policy customer_portal_users_admin_by_customer_company
on public.customer_portal_users
for all
to authenticated
using (public.is_company_admin(public.customer_company_id(customer_id)))
with check (public.is_company_admin(public.customer_company_id(customer_id)));

create policy jobs_select_admin_worker_or_portal_customer
on public.jobs
for select
to authenticated
using (
  public.is_company_admin(company_id)
  or (
    public.is_company_worker(company_id)
    and public.is_worker_assigned_to_job(id)
  )
  or (
    customer_id is not null
    and public.is_customer_portal_user_for_customer(customer_id)
  )
);

create policy jobs_admin_write
on public.jobs
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy job_assignments_select_admin_or_own_worker
on public.job_assignments
for select
to authenticated
using (
  public.is_company_admin(public.job_company_id(job_id))
  or profile_id = public.current_profile_id()
);

create policy job_assignments_admin_write
on public.job_assignments
for all
to authenticated
using (public.is_company_admin(public.job_company_id(job_id)))
with check (public.is_company_admin(public.job_company_id(job_id)));

create policy job_cost_items_admin_only
on public.job_cost_items
for all
to authenticated
using (public.is_company_admin(public.job_company_id(job_id)))
with check (public.is_company_admin(public.job_company_id(job_id)));

create policy job_checklists_select_admin_or_assigned_worker
on public.job_checklists
for select
to authenticated
using (
  public.is_company_admin(public.job_company_id(job_id))
  or public.is_worker_assigned_to_job(job_id)
);

create policy job_checklists_admin_write
on public.job_checklists
for all
to authenticated
using (public.is_company_admin(public.job_company_id(job_id)))
with check (public.is_company_admin(public.job_company_id(job_id)));

create policy job_checklist_items_select_admin_or_assigned_worker
on public.job_checklist_items
for select
to authenticated
using (
  exists (
    select 1
    from public.job_checklists jc
    where jc.id = job_checklist_items.job_checklist_id
      and (
        public.is_company_admin(public.job_company_id(jc.job_id))
        or public.is_worker_assigned_to_job(jc.job_id)
      )
  )
);

create policy job_checklist_items_admin_write
on public.job_checklist_items
for all
to authenticated
using (
  exists (
    select 1
    from public.job_checklists jc
    where jc.id = job_checklist_items.job_checklist_id
      and public.is_company_admin(public.job_company_id(jc.job_id))
  )
)
with check (
  exists (
    select 1
    from public.job_checklists jc
    where jc.id = job_checklist_items.job_checklist_id
      and public.is_company_admin(public.job_company_id(jc.job_id))
  )
);

create policy job_customer_contacts_admin_or_portal_customer
on public.job_customer_contacts
for select
to authenticated
using (
  public.is_company_admin(public.job_company_id(job_id))
  or exists (
    select 1
    from public.jobs j
    where j.id = job_customer_contacts.job_id
      and j.customer_id is not null
      and public.is_customer_portal_user_for_customer(j.customer_id)
  )
);

create policy job_customer_contacts_admin_write
on public.job_customer_contacts
for all
to authenticated
using (public.is_company_admin(public.job_company_id(job_id)))
with check (public.is_company_admin(public.job_company_id(job_id)));

create policy work_shifts_select_admin_or_own_worker
on public.work_shifts
for select
to authenticated
using (
  public.is_company_admin(company_id)
  or profile_id = public.current_profile_id()
);

create policy work_shifts_worker_insert_own
on public.work_shifts
for insert
to authenticated
with check (
  public.is_company_admin(company_id)
  or (
    profile_id = public.current_profile_id()
    and public.is_company_worker(company_id)
  )
);

create policy work_shifts_worker_update_own
on public.work_shifts
for update
to authenticated
using (
  public.is_company_admin(company_id)
  or profile_id = public.current_profile_id()
)
with check (
  public.is_company_admin(company_id)
  or (
    profile_id = public.current_profile_id()
    and public.is_company_worker(company_id)
  )
);

create policy worker_advances_select_admin_or_own_worker
on public.worker_advances
for select
to authenticated
using (
  public.is_own_profile(profile_id)
  or public.is_member_profile_in_admin_company(profile_id)
);

create policy worker_advances_admin_write
on public.worker_advances
for all
to authenticated
using (public.is_member_profile_in_admin_company(profile_id))
with check (public.is_member_profile_in_admin_company(profile_id));

create policy payroll_items_select_admin_or_own_worker
on public.payroll_items
for select
to authenticated
using (
  public.is_own_profile(profile_id)
  or public.is_member_profile_in_admin_company(profile_id)
);

create policy payroll_items_admin_write
on public.payroll_items
for all
to authenticated
using (public.is_member_profile_in_admin_company(profile_id))
with check (public.is_member_profile_in_admin_company(profile_id));

create policy calendar_events_select_admin_or_assigned_worker
on public.calendar_events
for select
to authenticated
using (
  public.is_company_admin(company_id)
  or exists (
    select 1
    from public.calendar_event_assignments cea
    where cea.event_id = calendar_events.id
      and cea.profile_id = public.current_profile_id()
  )
);

create policy calendar_events_admin_write
on public.calendar_events
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy calendar_event_assignments_select_admin_or_own_worker
on public.calendar_event_assignments
for select
to authenticated
using (
  profile_id = public.current_profile_id()
  or exists (
    select 1
    from public.calendar_events ce
    where ce.id = calendar_event_assignments.event_id
      and public.is_company_admin(ce.company_id)
  )
);

create policy calendar_event_assignments_admin_write
on public.calendar_event_assignments
for all
to authenticated
using (
  exists (
    select 1
    from public.calendar_events ce
    where ce.id = calendar_event_assignments.event_id
      and public.is_company_admin(ce.company_id)
  )
)
with check (
  exists (
    select 1
    from public.calendar_events ce
    where ce.id = calendar_event_assignments.event_id
      and public.is_company_admin(ce.company_id)
  )
);

create policy calculations_admin_only
on public.calculations
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy calculation_items_admin_only
on public.calculation_items
for all
to authenticated
using (
  exists (
    select 1
    from public.calculations c
    where c.id = calculation_items.calculation_id
      and public.is_company_admin(c.company_id)
  )
)
with check (
  exists (
    select 1
    from public.calculations c
    where c.id = calculation_items.calculation_id
      and public.is_company_admin(c.company_id)
  )
);

create policy calculation_versions_admin_only
on public.calculation_versions
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy calculation_version_items_admin_only
on public.calculation_version_items
for all
to authenticated
using (
  exists (
    select 1
    from public.calculation_versions cv
    where cv.id = calculation_version_items.calculation_version_id
      and public.is_company_admin(cv.company_id)
  )
)
with check (
  exists (
    select 1
    from public.calculation_versions cv
    where cv.id = calculation_version_items.calculation_version_id
      and public.is_company_admin(cv.company_id)
  )
);

create policy quotes_select_admin_or_portal_customer
on public.quotes
for select
to authenticated
using (
  public.is_company_admin(company_id)
  or public.is_customer_portal_user_for_customer(customer_id)
);

create policy quotes_admin_write
on public.quotes
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy quote_items_select_admin_or_portal_customer
on public.quote_items
for select
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    where q.id = quote_items.quote_id
      and (
        public.is_company_admin(q.company_id)
        or public.is_customer_portal_user_for_customer(q.customer_id)
      )
  )
);

create policy quote_items_admin_write
on public.quote_items
for all
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    where q.id = quote_items.quote_id
      and public.is_company_admin(q.company_id)
  )
)
with check (
  exists (
    select 1
    from public.quotes q
    where q.id = quote_items.quote_id
      and public.is_company_admin(q.company_id)
  )
);

create policy leads_select_admin_or_portal_customer
on public.leads
for select
to authenticated
using (
  public.is_company_admin(company_id)
  or (
    customer_id is not null
    and public.is_customer_portal_user_for_customer(customer_id)
  )
);

create policy leads_admin_write
on public.leads
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy offer_events_admin_only
on public.offer_events
for select
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    where q.id = offer_events.quote_id
      and public.is_company_admin(q.company_id)
  )
);

create policy offer_responses_admin_only
on public.offer_responses
for select
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    where q.id = offer_responses.quote_id
      and public.is_company_admin(q.company_id)
  )
);

create policy mailboxes_admin_only
on public.mailboxes
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy message_threads_admin_only
on public.message_threads
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy outbound_messages_admin_only
on public.outbound_messages
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy inbound_messages_admin_only
on public.inbound_messages
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy message_events_admin_only
on public.message_events
for all
to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

do $$
begin
  if to_regclass('public.work_logs') is not null then
    execute $pol$
      create policy work_logs_select_admin_or_own_worker
      on public.work_logs
      for select
      to authenticated
      using (
        public.is_own_profile(profile_id)
        or public.is_member_profile_in_admin_company(profile_id)
      )
    $pol$;
    execute $pol$
      create policy work_logs_worker_insert_own
      on public.work_logs
      for insert
      to authenticated
      with check (
        public.is_own_profile(profile_id)
        or public.is_member_profile_in_admin_company(profile_id)
      )
    $pol$;
    execute $pol$
      create policy work_logs_worker_update_own
      on public.work_logs
      for update
      to authenticated
      using (
        public.is_own_profile(profile_id)
        or public.is_member_profile_in_admin_company(profile_id)
      )
      with check (
        public.is_own_profile(profile_id)
        or public.is_member_profile_in_admin_company(profile_id)
      )
    $pol$;
  end if;

  if to_regclass('public.advance_requests') is not null then
    execute $pol$
      create policy advance_requests_select_admin_or_own_worker
      on public.advance_requests
      for select
      to authenticated
      using (
        public.is_own_profile(profile_id)
        or public.is_member_profile_in_admin_company(profile_id)
      )
    $pol$;
    execute $pol$
      create policy advance_requests_worker_insert_own
      on public.advance_requests
      for insert
      to authenticated
      with check (public.is_own_profile(profile_id))
    $pol$;
    execute $pol$
      create policy advance_requests_admin_update
      on public.advance_requests
      for update
      to authenticated
      using (public.is_member_profile_in_admin_company(profile_id))
      with check (public.is_member_profile_in_admin_company(profile_id))
    $pol$;
  end if;

  if to_regclass('public.job_photos') is not null then
    execute $pol$
      create policy job_photos_select_admin_worker_or_portal_customer
      on public.job_photos
      for select
      to authenticated
      using (
        public.is_company_admin(public.job_company_id(job_id))
        or public.is_worker_assigned_to_job(job_id)
        or exists (
          select 1
          from public.jobs j
          where j.id = job_photos.job_id
            and j.customer_id is not null
            and public.is_customer_portal_user_for_customer(j.customer_id)
        )
      )
    $pol$;
    execute $pol$
      create policy job_photos_admin_or_assigned_worker_write
      on public.job_photos
      for all
      to authenticated
      using (
        public.is_company_admin(public.job_company_id(job_id))
        or public.is_worker_assigned_to_job(job_id)
      )
      with check (
        public.is_company_admin(public.job_company_id(job_id))
        or public.is_worker_assigned_to_job(job_id)
      )
    $pol$;
  end if;

  if to_regclass('public.issues') is not null then
    execute $pol$
      create policy issues_select_admin_worker_or_portal_customer
      on public.issues
      for select
      to authenticated
      using (
        public.is_company_admin(company_id)
        or (job_id is not null and public.is_worker_assigned_to_job(job_id))
      )
    $pol$;
    execute $pol$
      create policy issues_admin_worker_or_portal_insert
      on public.issues
      for insert
      to authenticated
      with check (
        public.is_company_admin(company_id)
        or (job_id is not null and public.is_worker_assigned_to_job(job_id))
      )
    $pol$;
    execute $pol$
      create policy issues_admin_update
      on public.issues
      for update
      to authenticated
      using (public.is_company_admin(company_id))
      with check (public.is_company_admin(company_id))
    $pol$;
  end if;
end $$;
