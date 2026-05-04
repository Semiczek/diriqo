drop policy if exists "jobs_all_authenticated" on public.jobs;
drop policy if exists "customers_all_authenticated" on public.customers;
drop policy if exists "customer_contacts_all_authenticated" on public.customer_contacts;
drop policy if exists "job_assignments_all_authenticated" on public.job_assignments;
drop policy if exists "job_cost_items_all_authenticated" on public.job_cost_items;
drop policy if exists "job_checklists_all_authenticated" on public.job_checklists;
drop policy if exists "job_checklist_items_all_authenticated" on public.job_checklist_items;
drop policy if exists "job_customer_contacts_all_authenticated" on public.job_customer_contacts;

create policy "jobs_company_members_access"
on public.jobs
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = jobs.company_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = jobs.company_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

create policy "customers_company_members_access"
on public.customers
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = customers.company_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = customers.company_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

create policy "customer_contacts_company_members_access"
on public.customer_contacts
for all
to authenticated
using (
  exists (
    select 1
    from public.customers c
    join public.company_members cm on cm.company_id = c.company_id
    join public.profiles p on p.id = cm.profile_id
    where c.id = customer_contacts.customer_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.customers c
    join public.company_members cm on cm.company_id = c.company_id
    join public.profiles p on p.id = cm.profile_id
    where c.id = customer_contacts.customer_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

create policy "job_assignments_company_members_access"
on public.job_assignments
for all
to authenticated
using (
  exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where j.id = job_assignments.job_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where j.id = job_assignments.job_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

create policy "job_cost_items_company_members_access"
on public.job_cost_items
for all
to authenticated
using (
  exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where j.id = job_cost_items.job_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where j.id = job_cost_items.job_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

create policy "job_checklists_company_members_access"
on public.job_checklists
for all
to authenticated
using (
  exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where j.id = job_checklists.job_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where j.id = job_checklists.job_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);

create policy "job_checklist_items_company_members_access"
on public.job_checklist_items
for all
to authenticated
using (
  exists (
    select 1
    from public.job_checklists jc
    join public.jobs j on j.id = jc.job_id
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where jc.id = job_checklist_items.job_checklist_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.job_checklists jc
    join public.jobs j on j.id = jc.job_id
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where jc.id = job_checklist_items.job_checklist_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);


create policy "job_customer_contacts_company_members_access"
on public.job_customer_contacts
for all
to authenticated
using (
  exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where j.id = job_customer_contacts.job_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.jobs j
    join public.company_members cm on cm.company_id = j.company_id
    join public.profiles p on p.id = cm.profile_id
    where j.id = job_customer_contacts.job_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
);
