drop policy if exists "calculations_select_company_members" on public.calculations;
drop policy if exists "calculations_insert_company_members" on public.calculations;
drop policy if exists "calculations_update_company_members" on public.calculations;
drop policy if exists "calculation_items_select_company_members" on public.calculation_items;
drop policy if exists "calculation_items_insert_company_members" on public.calculation_items;
drop policy if exists "calculation_items_update_company_members" on public.calculation_items;
drop policy if exists "quotes_select_company_members" on public.quotes;
drop policy if exists "quotes_insert_company_members" on public.quotes;
drop policy if exists "quotes_update_company_members" on public.quotes;
drop policy if exists "quote_items_select_company_members" on public.quote_items;
drop policy if exists "quote_items_insert_company_members" on public.quote_items;
drop policy if exists "quote_items_update_company_members" on public.quote_items;

create policy "calculations_select_company_members"
on public.calculations
for select
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

create policy "calculations_insert_company_members"
on public.calculations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
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
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
      and cm.company_id = calculations.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
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

create policy "calculation_items_select_company_members"
on public.calculation_items
for select
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

create policy "calculation_items_insert_company_members"
on public.calculation_items
for insert
to authenticated
with check (
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

create policy "calculation_items_update_company_members"
on public.calculation_items
for update
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
)
with check (
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

create policy "quotes_select_company_members"
on public.quotes
for select
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
      and cm.company_id = quotes.company_id
  )
);

create policy "quotes_insert_company_members"
on public.quotes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.customers c on c.id = quotes.customer_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
      and cm.company_id = quotes.company_id
      and c.company_id = quotes.company_id
  )
);

create policy "quotes_update_company_members"
on public.quotes
for update
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
      and cm.company_id = quotes.company_id
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    join public.customers c on c.id = quotes.customer_id
    where (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
      and cm.company_id = quotes.company_id
      and c.company_id = quotes.company_id
  )
);

create policy "quote_items_select_company_members"
on public.quote_items
for select
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
  )
);

create policy "quote_items_insert_company_members"
on public.quote_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
  )
);

create policy "quote_items_update_company_members"
on public.quote_items
for update
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and (p.auth_user_id = auth.uid() or p.user_id = auth.uid())
      and cm.is_active = true
  )
);
