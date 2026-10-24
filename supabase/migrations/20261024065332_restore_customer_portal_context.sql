-- Restore the customer-only portal path without giving the server role broad
-- SELECT access to customers or customer_portal_users. Existing company member
-- and administrator policies remain unchanged.
alter table public.customer_portal_users enable row level security;
drop policy if exists customer_portal_users_select_own_row on public.customer_portal_users;
create policy customer_portal_users_select_own_row
 on public.customer_portal_users for select to authenticated
 using ((select auth.uid()) = auth_user_id and is_active);

create function private.get_customer_portal_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
 actor uuid := auth.uid();
 active_links bigint;
 result jsonb;
begin
 if actor is null then return null; end if;
 -- Preserve the application's previous maybeSingle behaviour: never silently
 -- choose one company when an identity has more than one active portal link.
 select count(*) into active_links from public.customer_portal_users
 where auth_user_id = actor and is_active;
 if active_links <> 1 then return null; end if;
 select jsonb_build_object(
  'portalUserId', u.id, 'companyId', u.company_id, 'customerId', u.customer_id,
  'contactId', u.contact_id, 'email', u.email, 'fullName', u.full_name,
  'customerName', c.name
 ) into result
 from public.customer_portal_users u
 join public.customers c on c.id = u.customer_id and c.company_id = u.company_id
 where u.auth_user_id = actor and u.is_active;
 return result;
end;
$function$;
revoke all on function private.get_customer_portal_context() from public, anon, authenticated, service_role;
grant execute on function private.get_customer_portal_context() to authenticated;

create function public.get_customer_portal_context()
returns jsonb language sql stable security invoker set search_path = '' as $function$
 select private.get_customer_portal_context();
$function$;
revoke all on function public.get_customer_portal_context() from public, anon, authenticated, service_role;
grant execute on function public.get_customer_portal_context() to authenticated;

notify pgrst, 'reload schema';
