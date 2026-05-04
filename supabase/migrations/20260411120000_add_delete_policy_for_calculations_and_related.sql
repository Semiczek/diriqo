create policy "calculations_delete_company_members"
on public.calculations
for delete
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
      and cm.company_id = calculations.company_id
  )
);

create policy "calculation_items_delete_company_members"
on public.calculation_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.calculations c
    join public.company_members cm on cm.company_id = c.company_id
    join public.profiles p on p.id = cm.profile_id
    where c.id = calculation_items.calculation_id
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
  )
);
