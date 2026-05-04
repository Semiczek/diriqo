alter table public.calculations
  alter column customer_id drop not null;

drop policy if exists "calculations_insert_company_members" on public.calculations;
drop policy if exists "calculations_update_company_members" on public.calculations;

create policy "calculations_insert_company_members"
on public.calculations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = calculations.company_id
  )
  and (
    calculations.customer_id is null
    or exists (
      select 1
      from public.customers c
      where c.id = calculations.customer_id
        and c.company_id = calculations.company_id
    )
  )
);

create policy "calculations_update_company_members"
on public.calculations
for update
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = calculations.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = calculations.company_id
  )
  and (
    calculations.customer_id is null
    or exists (
      select 1
      from public.customers c
      where c.id = calculations.customer_id
        and c.company_id = calculations.company_id
    )
  )
);
