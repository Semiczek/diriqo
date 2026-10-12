-- TEST ONLY: run after the Hub fixture, core, adapter and base SQL assertions.
reset role;
insert into public.office_settings(company_id,enabled) values(office_test.id(1001),true),(office_test.id(1002),true)
on conflict(company_id) do update set enabled=true;
-- Reproduce a restricted table read without relaxing the application's RLS.
alter table public.companies enable row level security;
grant select on public.companies to authenticated;
create policy office_test_no_direct_labels on public.companies for select to authenticated using(false);
create function office_test.expect_labels_error(label text,company uuid,ids uuid[],want text)
returns void language plpgsql as $$
declare actual text;happened boolean:=false;
begin
 begin perform * from public.office_company_labels(company,ids);
 exception when sqlstate 'P0001' then
  happened:=true;get stacked diagnostics actual=message_text;
  if (actual::jsonb->>'code') is distinct from want then raise exception 'ASSERTION FAILED: % got %',label,actual;end if;
 end;
 perform office_test.assert(happened,label);
end;$$;
select office_test.assert(has_function_privilege('authenticated','public.office_company_labels(uuid,uuid[])','EXECUTE'),'labels authenticated execute granted');
select office_test.assert(not has_function_privilege('anon','public.office_company_labels(uuid,uuid[])','EXECUTE'),'labels anon execute denied');
select office_test.assert(not exists(select 1 from pg_proc p,aclexplode(p.proacl)a where p.oid='public.office_company_labels(uuid,uuid[])'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'labels PUBLIC execute denied');
select office_test.assert((select prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc where oid='public.office_company_labels(uuid,uuid[])'::regprocedure),'labels fixed search path and definer');
set role authenticated;
select office_test.login(3);
select office_test.assert((select count(*)=0 from public.companies),'labels manager direct table remains restricted');
select office_test.assert((select count(*)=1 and min(name)='Tenant A' from public.office_company_labels(office_test.id(1001),array[office_test.id(1001),office_test.id(1002)])),'labels manager reads own name without foreign company');
select office_test.assert((select count(*)=0 from public.office_company_labels(office_test.id(1001),array[office_test.id(9999)])),'labels unknown private ID stays absent');
select office_test.expect_labels_error('labels foreign context rejected',office_test.id(1002),array[office_test.id(1001)],'FORBIDDEN');
select office_test.expect_labels_error('labels null IDs rejected',office_test.id(1001),null,'INVALID_REQUEST');
select office_test.expect_labels_error('labels empty IDs rejected',office_test.id(1001),'{}'::uuid[],'INVALID_REQUEST');
select office_test.expect_labels_error('labels null element rejected',office_test.id(1001),array[null::uuid],'INVALID_REQUEST');
select office_test.expect_labels_error('labels excessive IDs rejected',office_test.id(1001),array_fill(office_test.id(1001),array[101]),'INVALID_REQUEST');
select office_test.expect_labels_error('labels multidimensional IDs rejected',office_test.id(1001),array_fill(office_test.id(1001),array[2,2]),'INVALID_REQUEST');
select office_test.login(4);
select office_test.assert((select count(*)=1 and min(name)='Tenant A' from public.office_company_labels(office_test.id(1001),array[office_test.id(1001),office_test.id(1002)])),'labels worker reads own name only');
select office_test.login(7);
select office_test.expect_labels_error('labels inactive membership rejected',office_test.id(1001),array[office_test.id(1001)],'FORBIDDEN');
select office_test.login(6);
select office_test.expect_labels_error('labels absent membership rejected',office_test.id(1001),array[office_test.id(1001)],'FORBIDDEN');
select office_test.login(null);
select office_test.expect_labels_error('labels authenticated without user rejected',office_test.id(1001),array[office_test.id(1001)],'UNAUTHENTICATED');
reset role;
insert into public.company_members values(office_test.id(1500),office_test.id(1002),office_test.id(103),'manager',true);
set role authenticated;
select office_test.login(3);
select office_test.assert((select count(*)=2 from public.office_company_labels(office_test.id(1001),array[office_test.id(1001),office_test.id(1002)])),'labels dual manager reads only requested enabled memberships');
select office_test.assert((select count(*)=1 from public.office_company_labels(office_test.id(1001),array[office_test.id(1001),office_test.id(1001)])),'labels duplicate request produces no duplicate rows');
reset role;
update public.office_settings set enabled=false where company_id=office_test.id(1002);
set role authenticated;
select office_test.login(3);
select office_test.assert((select count(*)=1 and min(name)='Tenant A' from public.office_company_labels(office_test.id(1001),array[office_test.id(1001),office_test.id(1002)])),'labels disabled target excluded');
select office_test.expect_labels_error('labels disabled active context rejected',office_test.id(1002),array[office_test.id(1001)],'MODULE_DISABLED');
select office_test.assert((select count(*)=0 from public.companies),'labels RPC leaves direct companies visibility unchanged');
reset role;
