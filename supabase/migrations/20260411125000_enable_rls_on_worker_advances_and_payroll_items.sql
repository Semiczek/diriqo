alter table public.worker_advances enable row level security;
alter table public.payroll_items enable row level security;

create policy "worker_advances_select_company_members"
on public.worker_advances
for select
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and (
        cm.profile_id = worker_advances.profile_id
        or exists (
          select 1
          from public.company_members member_of_same_company
          where member_of_same_company.profile_id = worker_advances.profile_id
            and member_of_same_company.company_id = cm.company_id
            and member_of_same_company.is_active = true
        )
      )
  )
);

create policy "worker_advances_insert_company_members"
on public.worker_advances
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and (
        cm.profile_id = worker_advances.profile_id
        or exists (
          select 1
          from public.company_members member_of_same_company
          where member_of_same_company.profile_id = worker_advances.profile_id
            and member_of_same_company.company_id = cm.company_id
            and member_of_same_company.is_active = true
        )
      )
  )
);

create policy "worker_advances_update_company_members"
on public.worker_advances
for update
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and (
        cm.profile_id = worker_advances.profile_id
        or exists (
          select 1
          from public.company_members member_of_same_company
          where member_of_same_company.profile_id = worker_advances.profile_id
            and member_of_same_company.company_id = cm.company_id
            and member_of_same_company.is_active = true
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and (
        cm.profile_id = worker_advances.profile_id
        or exists (
          select 1
          from public.company_members member_of_same_company
          where member_of_same_company.profile_id = worker_advances.profile_id
            and member_of_same_company.company_id = cm.company_id
            and member_of_same_company.is_active = true
        )
      )
  )
);

create policy "worker_advances_delete_company_members"
on public.worker_advances
for delete
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where cm.is_active = true
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and (
        cm.profile_id = worker_advances.profile_id
        or exists (
          select 1
          from public.company_members member_of_same_company
          where member_of_same_company.profile_id = worker_advances.profile_id
            and member_of_same_company.company_id = cm.company_id
            and member_of_same_company.is_active = true
        )
      )
  )
);
