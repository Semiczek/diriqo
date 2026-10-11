-- Apply after office-core.sql, only to the Diriqo host.
begin;
create or replace function public.office_host_can_configure(p_company_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and public.is_super_admin();
$$;
create or replace function public.office_host_context(p_company_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_profile uuid;v_role text;
begin
 if auth.uid() is null then perform office_private.fail('UNAUTHENTICATED','Sign in required.',401);end if;
 select p.id,lower(cm.role::text) into v_profile,v_role from public.company_members cm join public.profiles p on p.id=cm.profile_id
 where cm.company_id=p_company_id and cm.is_active=true and p.auth_user_id=auth.uid()
 and (p.user_id is null or p.user_id=p.auth_user_id)
 and lower(cm.role::text) in ('super_admin','company_admin','manager','worker') limit 1;
 if v_profile is null then perform office_private.fail('FORBIDDEN','Company membership required.',403);end if;
 return jsonb_build_object('actorId',v_profile,'role',case when v_role in ('super_admin','company_admin') then 'owner' when v_role='manager' then 'editor' else 'reader' end,'hostRole',v_role);
end;$$;
create or replace function public.office_host_write_allowed(p_company_id uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare access_result jsonb;
begin
 perform public.office_host_context(p_company_id);
 access_result:=public.get_company_capability_access(target_company_id=>p_company_id,target_capability=>'core.files.upload');
 return (access_result->>'allowed') is not distinct from 'true';
end;$$;
revoke all on function public.office_host_context(uuid),public.office_host_can_configure(uuid),public.office_host_write_allowed(uuid) from public,anon,authenticated;
commit;
