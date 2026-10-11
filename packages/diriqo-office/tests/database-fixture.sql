-- TEST ONLY. Run in a NEW disposable local database owned by the test runner.
-- No DROP/TRUNCATE or remote connection logic is present.
-- Minimal host contract fixtures, not a copy of Supabase Auth or Diriqo billing.
do $$
begin
 if to_regclass('public.companies') is not null or to_regnamespace('office_private') is not null then
  raise exception 'Refusing non-empty host database: use a new disposable database';
 end if;
 if current_setting('office_test.host',true) not in ('hub','diriqo') then
  raise exception 'Set office_test.host to hub or diriqo before loading fixtures';
 end if;
end;$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
create schema office_test;
revoke all on schema private from public,anon,authenticated;
revoke create on schema public from public;
grant usage on schema auth,public,office_test to anon,authenticated;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
$$;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(auth.jwt()->>'sub','')::uuid;
$$;
create table auth.users(id uuid primary key);
create table public.companies(id uuid primary key,name text not null);
create table public.profiles(id uuid primary key,auth_user_id uuid references auth.users(id),user_id uuid references auth.users(id));
create table public.company_members(id uuid primary key,company_id uuid not null references public.companies(id),
 profile_id uuid not null references public.profiles(id),role text not null,is_active boolean not null);
create table public.jobs(id uuid primary key,company_id uuid not null references public.companies(id),title text not null);
create table public.customers(id uuid primary key,company_id uuid not null references public.companies(id),name text not null);
create table private.platform_admin_grants(auth_user_id uuid primary key references auth.users(id),is_active boolean not null);
create table private.office_test_capabilities(company_id uuid primary key references public.companies(id),allowed boolean not null);
create function public.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from private.platform_admin_grants g where g.auth_user_id=auth.uid() and g.is_active);
$$;
-- This contract fixture intentionally tests Office's handling of allowed/denied capability
-- responses. It does not validate the real entitlement/billing evaluator implementation.
create function public.get_company_capability_access(target_company_id uuid,target_capability text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if target_capability<>'core.files.upload' then raise exception 'MODULE_CAPABILITY_UNSUPPORTED' using errcode='22023';end if;
 if auth.uid() is null or not exists(select 1 from public.company_members cm join public.profiles p on p.id=cm.profile_id
   where cm.company_id=target_company_id and cm.is_active and p.auth_user_id=auth.uid()) then
  raise exception 'MODULE_CAPABILITY_FORBIDDEN' using errcode='42501';
 end if;
 return jsonb_build_object('allowed',coalesce((select c.allowed from private.office_test_capabilities c where c.company_id=target_company_id),false));
end;$$;
revoke all on function public.is_super_admin(),public.get_company_capability_access(uuid,text) from public,anon;
grant execute on function public.is_super_admin(),public.get_company_capability_access(uuid,text) to authenticated;
create function office_test.id(n integer) returns uuid language sql immutable as $$
 select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function office_test.login(n integer,p_ai boolean default false) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',case when n is null then '{}' else
  jsonb_build_object('sub',office_test.id(n),'role','authenticated',
   'app_metadata',case when p_ai then '{"office_principal":"ai"}'::jsonb else '{}'::jsonb end)::text end,false);
end;$$;
create function office_test.doc(body text) returns jsonb language sql immutable as $$
 select jsonb_build_object('schemaVersion',1,'kind','document','page',jsonb_build_object('marginMm',20,'header','','footer',''),
 'doc',jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',
  case when body='' then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','text','text',body)) end))));
$$;
create table office_test.results(label text primary key);
create table office_test.state(k text primary key,v jsonb not null);
grant select,insert,update on office_test.state to authenticated;
grant select,insert on office_test.results to authenticated,anon;
create function office_test.assert(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label;end if;
 insert into office_test.results values(label);
end;$$;
create function office_test.expect_rpc_error(label text,company uuid,request jsonb,want text,principal text default 'human')
returns void language plpgsql as $$
declare actual text;state text;happened boolean:=false;
begin
 begin
  perform public.office_request(company,request,principal);
 exception when others then
  happened:=true;
  get stacked diagnostics actual=message_text,state=returned_sqlstate;
  if state<>'P0001' then raise exception 'ASSERTION FAILED: % expected Office %, got SQLSTATE %: %',label,want,state,actual;end if;
  if (actual::jsonb->>'code') is distinct from want then
   raise exception 'ASSERTION FAILED: % expected %, got %',label,want,actual;
  end if;
 end;
 perform office_test.assert(happened,label);
end;$$;
create function office_test.expect_sqlstate(label text,statement text,want text)
returns void language plpgsql as $$
declare actual text;detail text;happened boolean:=false;
begin
 begin execute statement;
 exception when others then
  happened:=true;get stacked diagnostics actual=returned_sqlstate,detail=message_text;
  if actual is distinct from want then raise exception 'ASSERTION FAILED: % expected %, got %: %',label,want,actual,detail;end if;
 end;
 perform office_test.assert(happened,label);
end;$$;
create function office_test.expect_setting_error(label text,company uuid)
returns void language plpgsql as $$
declare actual text;happened boolean:=false;
begin
 begin perform public.office_set_enabled(company,true);
 exception when sqlstate 'P0001' then
  happened:=true;get stacked diagnostics actual=message_text;
  if (actual::jsonb->>'code') is distinct from 'FORBIDDEN' then raise exception 'ASSERTION FAILED: % got %',label,actual;end if;
 end;
 perform office_test.assert(happened,label);
end;$$;
insert into auth.users select office_test.id(n) from generate_series(1,13)n;
insert into public.companies values(office_test.id(1001),'Tenant A'),(office_test.id(1002),'Tenant B');
insert into public.profiles select office_test.id(n+100),case when n=9 then null else office_test.id(n) end,
 case when n=8 then office_test.id(13) else office_test.id(n) end from generate_series(1,12)n;
insert into public.company_members
 select office_test.id(n+200),office_test.id(case when n=5 then 1002 else 1001 end),office_test.id(n+100),
 case n when 1 then 'super_admin' when 2 then 'company_admin' when 3 then 'manager'
 when 4 then 'worker'
 when 5 then 'company_admin' when 7 then 'company_admin' when 8 then 'manager' when 9 then 'manager'
 when 10 then 'unknown_role' when 12 then 'super_admin' end,n<>7
 from generate_series(1,12)n where n not in (6,11);
insert into public.jobs values(office_test.id(2001),office_test.id(1001),'Job A'),(office_test.id(2002),office_test.id(1002),'Job B');
insert into public.customers values(office_test.id(3001),office_test.id(1001),'Customer A'),(office_test.id(3002),office_test.id(1002),'Customer B');
insert into private.platform_admin_grants values(office_test.id(1),true),(office_test.id(11),true);
insert into private.office_test_capabilities values(office_test.id(1001),true),(office_test.id(1002),true);
