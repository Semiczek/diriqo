drop policy if exists "calendar_events_all_authenticated" on public.calendar_events;
drop policy if exists "calendar_event_assignments_all_authenticated" on public.calendar_event_assignments;

create policy "calendar_events_company_members_access"
on public.calendar_events
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = calendar_events.company_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.company_id = calendar_events.company_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
  and (
    calendar_events.job_id is null
    or exists (
      select 1
      from public.jobs j
      where j.id = calendar_events.job_id
        and j.company_id = calendar_events.company_id
    )
  )
);

create policy "calendar_event_assignments_company_members_access"
on public.calendar_event_assignments
for all
to authenticated
using (
  exists (
    select 1
    from public.calendar_events ce
    join public.company_members cm on cm.company_id = ce.company_id
    join public.profiles p on p.id = cm.profile_id
    where ce.id = calendar_event_assignments.event_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.calendar_events ce
    join public.company_members cm on cm.company_id = ce.company_id
    join public.profiles p on p.id = cm.profile_id
    where ce.id = calendar_event_assignments.event_id
      and cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
  )
  and exists (
    select 1
    from public.company_members target_cm
    where target_cm.profile_id = calendar_event_assignments.profile_id
      and target_cm.is_active = true
      and target_cm.company_id = (
        select ce.company_id
        from public.calendar_events ce
        where ce.id = calendar_event_assignments.event_id
      )
  )
);
