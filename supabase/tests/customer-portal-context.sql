-- Draft for the authorized Diriqo test project only. No existing business row is changed.
-- Uses the already established hosted test pattern: all synthetic DML is inside a
-- subtransaction, rolled back by a caught sentinel, then independently checked.
-- Run through the postgres SQL editor/MCP, not an authenticated application role.
do $test$
#variable_conflict use_variable
declare
 c1 uuid := 'd1600000-0000-4000-8000-000000000001'; c2 uuid := 'd1600000-0000-4000-8000-000000000002';
 customer1 uuid := 'd1600000-0000-4000-8000-000000000003'; customer2 uuid := 'd1600000-0000-4000-8000-000000000004';
 portal_auth uuid := 'd1600000-0000-4000-8000-000000000005'; other_auth uuid := 'd1600000-0000-4000-8000-000000000006';
 foreign_auth uuid := 'd1600000-0000-4000-8000-000000000007'; admin_auth uuid := 'd1600000-0000-4000-8000-000000000008';
 member_auth uuid := 'd1600000-0000-4000-8000-000000000009'; admin_profile uuid := 'd1600000-0000-4000-8000-000000000010';
 member_profile uuid := 'd1600000-0000-4000-8000-000000000011'; link1 uuid := 'd1600000-0000-4000-8000-000000000012';
 link2 uuid := 'd1600000-0000-4000-8000-000000000013'; link3 uuid := 'd1600000-0000-4000-8000-000000000014';
 rows_found integer; affected integer; payload jsonb; tests text[] := '{}'; cleanup integer := 0; duplicate_inserted boolean := false;
 link4 uuid := 'd1600000-0000-4000-8000-000000000015';
begin
 if current_user <> 'postgres' then raise exception 'RUN_AS_POSTGRES_ONLY'; end if;
 if exists(select 1 from public.companies where id in(c1,c2))
  or exists(select 1 from auth.users where id in(portal_auth,other_auth,foreign_auth,admin_auth,member_auth))
  or exists(select 1 from public.customer_portal_users where id in(link1,link2,link3,link4)) then raise exception 'TEST_FIXTURE_COLLISION'; end if;
 begin
  insert into auth.users(id,email,raw_user_meta_data) values
   (portal_auth,'portal-self-test@example.invalid','{}'),(other_auth,'portal-peer-test@example.invalid','{}'),
   (foreign_auth,'portal-foreign-test@example.invalid','{}'),(admin_auth,'portal-admin-test@example.invalid','{}'),
   (member_auth,'portal-member-test@example.invalid','{}');
  insert into public.companies(id,name) values(c1,'TEST portal self read'),(c2,'TEST portal self read foreign');
  insert into public.customers(id,company_id,name) values(customer1,c1,'TEST portal customer'),(customer2,c2,'TEST foreign portal customer');
  insert into public.customer_portal_users(id,company_id,customer_id,auth_user_id,email,full_name,is_active) values
   (link1,c1,customer1,portal_auth,'portal-self-test@example.invalid','TEST portal owner',true),
   (link2,c1,customer1,other_auth,'portal-peer-test@example.invalid','TEST portal peer',true),
   (link3,c2,customer2,foreign_auth,'portal-foreign-test@example.invalid','TEST foreign portal',true);
  insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values
   (admin_profile,admin_auth,admin_auth,'TEST portal admin',true),(member_profile,member_auth,member_auth,'TEST portal member',true);
  insert into public.company_members(company_id,profile_id,role,is_active) values(c1,admin_profile,'company_admin',true),(c1,member_profile,'worker',true);

  if exists(select 1 from public.profiles where auth_user_id=portal_auth or user_id=portal_auth) then raise exception 'portal_actor_has_employee_profile'; end if;
  tests := array_append(tests,'portal_actor_has_no_employee_profile');
  if exists(select 1 from public.company_members m join public.profiles p on p.id=m.profile_id where p.auth_user_id=portal_auth or p.user_id=portal_auth) then raise exception 'portal_actor_has_company_membership'; end if;
  tests := array_append(tests,'portal_actor_has_no_company_membership');

  perform set_config('request.jwt.claim.sub',portal_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',portal_auth,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into rows_found from public.customer_portal_users where id=link1 and auth_user_id=portal_auth and is_active;
  if rows_found <> 1 then raise exception 'own_active_link_proxy_read'; end if; tests:=array_append(tests,'own_active_link_proxy_read');
  select jsonb_build_object('id',u.id,'customer_id',u.customer_id,'contact_id',u.contact_id,'email',u.email,'full_name',u.full_name) into payload
   from public.customer_portal_users u where u.auth_user_id=portal_auth and u.is_active;
  if payload->>'id' is distinct from link1::text or payload->>'customer_id' is distinct from customer1::text or payload->>'email' is distinct from 'portal-self-test@example.invalid' then raise exception 'own_context_projection'; end if;
  tests:=array_append(tests,'own_context_projection');
  payload:=public.get_customer_portal_context();
  if payload is distinct from jsonb_build_object('portalUserId',link1,'companyId',c1,'customerId',customer1,'contactId',null,'email','portal-self-test@example.invalid','fullName','TEST portal owner','customerName','TEST portal customer') then raise exception 'context_minimal_owned_dto'; end if;
  tests:=array_append(tests,'context_minimal_owned_dto');
  begin
   delete from public.customer_portal_users where id=link1;
   get diagnostics affected = row_count;
   if affected<>0 then raise exception 'self_link_delete_allowed';end if;
  exception when insufficient_privilege then null;end;tests:=array_append(tests,'self_link_delete_denied');
  begin
   insert into public.customer_portal_users(id,company_id,customer_id,auth_user_id,email,is_active) values(link4,c1,customer1,portal_auth,'portal-self-insert@example.invalid',true);
   raise exception 'self_link_insert_allowed';
  exception when insufficient_privilege then null;end;tests:=array_append(tests,'self_link_insert_denied');
  if exists(select 1 from public.customer_portal_users where id=link2) then raise exception 'other_auth_same_company_read'; end if; tests:=array_append(tests,'other_auth_same_company_denied');
  if exists(select 1 from public.customer_portal_users where id=link3) then raise exception 'other_company_read'; end if; tests:=array_append(tests,'other_company_denied');
  begin
   update public.customer_portal_users set email='self-escalation@example.invalid' where id=link1;
   get diagnostics affected = row_count;
   if affected <> 0 then raise exception 'self_email_update_allowed'; end if;
  exception when insufficient_privilege then null; end; tests:=array_append(tests,'self_email_update_denied');
  begin
   update public.customer_portal_users set company_id=c2,customer_id=customer2 where id=link1;
   get diagnostics affected = row_count;
   if affected <> 0 then raise exception 'self_company_update_allowed'; end if;
  exception when insufficient_privilege then null; end; tests:=array_append(tests,'self_company_reassignment_denied');
  begin
   update public.customer_portal_users set auth_user_id=other_auth where id=link1;
   get diagnostics affected = row_count;
   if affected <> 0 then raise exception 'self_auth_update_allowed'; end if;
  exception when insufficient_privilege then null; end; tests:=array_append(tests,'self_auth_reassignment_denied');

  execute 'reset role';
  if not exists(select 1 from public.customer_portal_users where id=link1 and company_id=c1 and customer_id=customer1 and auth_user_id=portal_auth and email='portal-self-test@example.invalid' and is_active) then raise exception 'denied_writes_changed_row'; end if;
  tests:=array_append(tests,'denied_writes_leave_link_unchanged');
  update public.customer_portal_users set is_active=false where id=link1;
  execute 'set local role authenticated';
  if public.get_customer_portal_context() is not null then raise exception 'inactive_context_visible';end if;tests:=array_append(tests,'inactive_context_denied_with_same_actor');
  if exists(select 1 from public.customer_portal_users where id=link1) then raise exception 'inactive_link_visible'; end if; tests:=array_append(tests,'inactive_own_link_invisible');
  begin
   update public.customer_portal_users set is_active=true where id=link1;
   get diagnostics affected = row_count;
   if affected <> 0 then raise exception 'self_reactivation_allowed'; end if;
  exception when insufficient_privilege then null; end; tests:=array_append(tests,'self_reactivation_denied');
  execute 'reset role';
  if (select is_active from public.customer_portal_users where id=link1) then raise exception 'self_reactivated'; end if;
  update public.customer_portal_users set is_active=true where id=link1;

  perform set_config('request.jwt.claim.sub',other_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_auth,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.customer_portal_users where id=link1) then raise exception 'peer_can_read_original_actor'; end if;
  if not exists(select 1 from public.customer_portal_users where id=link2) then raise exception 'peer_cannot_read_own_link'; end if;
  tests:=array_append(tests,'different_auth_isolated_to_own_link');
  if public.get_customer_portal_context()->>'portalUserId' is distinct from link2::text then raise exception 'peer_context_leaked_original_actor';end if;tests:=array_append(tests,'peer_context_is_exact_own_link');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  execute 'set local role authenticated';
  if public.get_customer_portal_context() is not null then raise exception 'empty_auth_context';end if;tests:=array_append(tests,'missing_auth_subject_denied');
  execute 'reset role';
  execute 'set local role anon';
  begin perform public.get_customer_portal_context();raise exception 'anon_context_execution_allowed';exception when insufficient_privilege then null;end;tests:=array_append(tests,'anonymous_context_execution_denied');
  begin
   select count(*) into rows_found from public.customer_portal_users where id in(link1,link2,link3,link4);
   if rows_found <> 0 then raise exception 'anonymous_link_read'; end if;
  exception when insufficient_privilege then null; end; tests:=array_append(tests,'anonymous_read_denied');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',member_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_auth,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into rows_found from public.customer_portal_users where id in(link1,link2);
  if rows_found <> 2 then raise exception 'existing_company_member_read_regressed'; end if; tests:=array_append(tests,'existing_company_member_read_preserved');
  if exists(select 1 from public.customer_portal_users where id=link3) then raise exception 'member_foreign_company_read'; end if; tests:=array_append(tests,'member_foreign_company_denied');
  begin
   update public.customer_portal_users set email='member-escalation@example.invalid' where id=link1;
   get diagnostics affected = row_count;
   if affected <> 0 then raise exception 'member_email_update_allowed'; end if;
  exception when insufficient_privilege then null; end; tests:=array_append(tests,'member_write_still_denied');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub',admin_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_auth,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into rows_found from public.customer_portal_users where id in(link1,link2);
  if rows_found <> 2 then raise exception 'existing_admin_read_regressed'; end if; tests:=array_append(tests,'existing_company_admin_read_preserved');
  update public.customer_portal_users set full_name='TEST admin updated' where id=link1;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'existing_admin_write_regressed'; end if; tests:=array_append(tests,'existing_company_admin_write_preserved');
  if exists(select 1 from public.customer_portal_users where id=link3) then raise exception 'admin_foreign_company_read'; end if; tests:=array_append(tests,'admin_foreign_company_denied');
  execute 'reset role';
  if (select full_name from public.customer_portal_users where id=link1) is distinct from 'TEST admin updated' then raise exception 'admin_write_not_persisted_in_transaction'; end if;
  if has_function_privilege('anon','public.get_customer_portal_context()','EXECUTE')
   or has_function_privilege('anon','private.get_customer_portal_context()','EXECUTE')
   or has_function_privilege('service_role','public.get_customer_portal_context()','EXECUTE')
   or has_function_privilege('service_role','private.get_customer_portal_context()','EXECUTE') then raise exception 'unexpected_context_execute_grant';end if;
  tests:=array_append(tests,'context_execute_only_authenticated');
  if has_table_privilege('service_role','public.customers','SELECT') or has_table_privilege('service_role','public.customer_portal_users','SELECT') then raise exception 'broad_service_table_grant_added';end if;
  tests:=array_append(tests,'service_role_broad_select_remains_denied');
  perform set_config('request.jwt.claim.sub',portal_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',portal_auth,'role','authenticated')::text,true);
  update public.customer_portal_users set company_id=c2 where id=link1;
  execute 'set local role authenticated';
  if public.get_customer_portal_context() is not null then raise exception 'mismatched_customer_company_context';end if;tests:=array_append(tests,'customer_company_mismatch_denied');
  execute 'reset role';
  update public.customer_portal_users set company_id=c1 where id=link1;
  begin
   insert into public.customer_portal_users(id,company_id,customer_id,auth_user_id,email,is_active) values(link4,c2,customer2,portal_auth,'portal-duplicate-test@example.invalid',true);
   duplicate_inserted:=true;
  exception when unique_violation then duplicate_inserted:=false;end;
  if duplicate_inserted then
   execute 'set local role authenticated';
   if public.get_customer_portal_context() is not null then raise exception 'ambiguous_active_context_selected';end if;
   execute 'reset role';
   tests:=array_append(tests,'ambiguous_active_context_denied');
   update public.customer_portal_users set customer_id=customer1 where id=link4;
   execute 'set local role authenticated';
   if public.get_customer_portal_context() is not null then raise exception 'invalid_second_link_hidden_by_join';end if;
   execute 'reset role';
   tests:=array_append(tests,'invalid_second_link_does_not_hide_ambiguity');
   delete from public.customer_portal_users where id=link4;
  else
   tests:=array_append(tests,'ambiguous_active_context_prevented_by_unique_constraint');
   tests:=array_append(tests,'invalid_second_link_prevented_by_unique_constraint');
  end if;
  execute 'set local role authenticated';
  if public.get_customer_portal_context()->>'portalUserId' is distinct from link1::text then raise exception 'restored_actor_context';end if;tests:=array_append(tests,'restored_actor_context_reads_again');
  execute 'reset role';
  if cardinality(tests) <> 33 then raise exception 'EXPECTED_33_SCENARIOS actual %',cardinality(tests); end if;
  raise exception 'ROLLBACK_SYNTHETIC_PORTAL_SELF_READ' using errcode='PT001';
 exception when sqlstate 'PT001' then
  if sqlerrm <> 'ROLLBACK_SYNTHETIC_PORTAL_SELF_READ' then raise; end if;
 end;
 if exists(select 1 from public.companies where id in(c1,c2)) then raise exception 'cleanup_companies'; end if; cleanup:=cleanup+1;
 if exists(select 1 from public.customers where id in(customer1,customer2)) then raise exception 'cleanup_customers'; end if; cleanup:=cleanup+1;
 if exists(select 1 from public.customer_portal_users where id in(link1,link2,link3,link4)) then raise exception 'cleanup_links'; end if; cleanup:=cleanup+1;
 if exists(select 1 from auth.users where id in(portal_auth,other_auth,foreign_auth,admin_auth,member_auth)) then raise exception 'cleanup_auth'; end if; cleanup:=cleanup+1;
 if exists(select 1 from public.profiles where id in(admin_profile,member_profile)) or exists(select 1 from public.company_members where company_id in(c1,c2)) then raise exception 'cleanup_staff'; end if; cleanup:=cleanup+1;
 perform set_config('diriqo.test_portal_self_read',jsonb_build_object('fixtures','rolled_back','count',cardinality(tests),'cleanup_assertions',cleanup,'tests',tests)::text,false);
end;
$test$;
select current_setting('diriqo.test_portal_self_read')::jsonb as result;
