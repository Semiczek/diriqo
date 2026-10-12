-- Apply after office-core.sql, only to the JSPD Hub host.
-- Hub's existing companies SELECT policy excludes managers. Expose only the
-- requested Office labels after the existing host membership and module checks;
-- leave all companies policies, table grants and host roles unchanged.
begin;
create or replace function public.office_company_labels(p_company_id uuid,p_company_ids uuid[])
returns table(company_id uuid,name text)
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
  if auth.uid() is null then perform office_private.fail('UNAUTHENTICATED','Sign in required.',401); end if;
  perform public.office_host_context(p_company_id);
  if not exists(select 1 from public.office_settings os where os.company_id=p_company_id and os.enabled=true) then
    perform office_private.fail('MODULE_DISABLED','Office is disabled for this company.',403);
  end if;
  if p_company_ids is null or cardinality(p_company_ids)<1 or cardinality(p_company_ids)>100
    or array_ndims(p_company_ids) is distinct from 1 then
    perform office_private.fail('INVALID_REQUEST','One to one hundred company IDs are required.');
  end if;
  if array_position(p_company_ids,null) is not null then
    perform office_private.fail('INVALID_REQUEST','One to one hundred company IDs are required.');
  end if;
  return query
    select c.id,c.name::text
    from public.companies c join public.office_settings os on os.company_id=c.id and os.enabled=true
    where c.id=any(p_company_ids) and public.office_is_member(c.id)
    order by c.id;
end;
$$;
revoke all on function public.office_company_labels(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.office_company_labels(uuid,uuid[]) to authenticated;
commit;
