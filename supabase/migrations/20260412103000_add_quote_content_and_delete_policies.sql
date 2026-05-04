alter table public.quotes
  add column if not exists customer_request text null,
  add column if not exists proposed_solution text null,
  add column if not exists work_description text null,
  add column if not exists work_schedule text null,
  add column if not exists payment_terms text not null default 'Faktura 14 dni po predani.';

drop policy if exists "quotes_delete_company_members" on public.quotes;
create policy "quotes_delete_company_members"
on public.quotes
for delete
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.id = cm.profile_id
    where p.auth_user_id = auth.uid()
      and cm.is_active = true
      and cm.company_id = quotes.company_id
  )
);

drop policy if exists "quote_items_delete_company_members" on public.quote_items;
create policy "quote_items_delete_company_members"
on public.quote_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.quotes q
    join public.company_members cm on cm.company_id = q.company_id
    join public.profiles p on p.id = cm.profile_id
    where q.id = quote_items.quote_id
      and p.auth_user_id = auth.uid()
      and cm.is_active = true
  )
);
