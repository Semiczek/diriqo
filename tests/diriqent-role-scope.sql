-- Run ONLY against a local/explicitly authorized test DB after all migrations:
-- psql -X -v ON_ERROR_STOP=1 "$DIRIQO_LOCAL_TEST_DATABASE_URL" -f tests/diriqent-role-scope.sql
-- No external provider calls. Every synthetic fixture is rolled back.
do $test$
declare
 ua uuid:=gen_random_uuid(); uw uuid:=gen_random_uuid(); uf uuid:=gen_random_uuid();
 pa uuid:=gen_random_uuid(); pw uuid:=gen_random_uuid(); pf uuid:=gen_random_uuid();
 c uuid:=gen_random_uuid(); foreign_c uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
 admin_op uuid:=gen_random_uuid(); pending_op uuid:=gen_random_uuid(); manager_op uuid:=gen_random_uuid(); worker_op uuid:=gen_random_uuid();
 admin_conv uuid; manager_conv uuid; worker_conv uuid; attempt uuid; body jsonb; proposal jsonb; payload jsonb;
 marker text:='Scope'||right(replace(gen_random_uuid()::text,'-',''),16); fp text:=repeat('e',64);
 secret text:='ADMIN_ONLY_PRICE_938291'; failure text; passed integer:=0;
begin
 begin
  insert into auth.users(id,email,raw_user_meta_data) values(ua,marker||'admin@example.invalid','{}'),(uw,marker||'worker@example.invalid','{}'),(uf,marker||'foreign@example.invalid','{}');
  insert into public.profiles(id,auth_user_id,user_id,full_name) values(pa,ua,ua,'Scope test admin'),(pw,uw,uw,'Scope test worker'),(pf,uf,uf,'Scope foreign admin');
  insert into public.companies(id,name) values(c,'Scope synthetic test'),(foreign_c,'Scope foreign test');
  insert into public.company_members(company_id,profile_id,role,is_active) values(c,pa,'company_admin',true),(c,pw,'worker',true),(foreign_c,pf,'company_admin',true);
  insert into public.customers(id,company_id,name) values(customer,c,'Operational customer');
  insert into private.company_module_rollouts(company_id,product,livemode)
   select co,pr,false from unnest(array[c,foreign_c]) companies(co) cross join unnest(array['diriqo_core','ai_assistant']) products(pr);
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   select co,pr,marker,'Synthetic role scope rollback check',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',case pr
    when 'diriqo_core' then array['core.jobs.create','core.history.read','core.history.export']
    else array['ai_assistant.conversation.run','ai_assistant.history.read','ai_assistant.history.export'] end
   from unnest(array[c,foreign_c]) companies(co) cross join unnest(array['diriqo_core','ai_assistant']) products(pr);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  perform public.diriqent_test_credit_grant(c,10000,marker,'Synthetic scope credit only',now()+interval '1 day');
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',ua::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  body:=public.diriqent_access_policy(c);
  assert body->>'scope'='company_admin' and body->>'policyVersion'='diriqent-role-scopes-v1' and body->>'profileId'=pa::text,'preflight returns current verified scope';passed:=passed+1;
  assert not has_function_privilege('authenticated','private.diriqent_read_v1(uuid,text)','execute'),'legacy read is not directly callable';passed:=passed+1;
  assert not has_function_privilege('authenticated','private.diriqent_operation_v1(uuid,uuid)','execute'),'legacy detail is not directly callable';passed:=passed+1;
  assert not has_function_privilege('authenticated','private.diriqent_reserve_v1(uuid,uuid,text,uuid,text,text,integer,text)','execute'),'legacy reserve is not directly callable';passed:=passed+1;
  assert not has_function_privilege('authenticated','private.diriqent_export_v1(uuid,text,uuid)','execute'),'legacy export is not directly callable';passed:=passed+1;
  assert not has_function_privilege('service_role','private.diriqent_provider_claim_v1(uuid,uuid,uuid,jsonb)','execute'),'legacy provider claim is not directly callable';passed:=passed+1;
  body:=public.diriqent_reserve(c,admin_op,'proposal',null,secret,fp,500,null);admin_conv:=(body->>'conversation_id')::uuid;
  assert body->>'access_scope'='company_admin','admin operation scope is server assigned';passed:=passed+1;
  assert (select access_scope='company_admin' from public.diriqent_conversations where id=admin_conv),'admin title scope is server assigned';passed:=passed+1;
  assert public.diriqent_reserve(c,admin_op,'proposal',null,secret,fp,500,null)->>'id'=admin_op::text,'same-scope retry remains idempotent';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  body:=public.diriqent_provider_claim(admin_op,c,pa);attempt:=(body->>'attemptId')::uuid;
  perform public.diriqent_settle(admin_op,attempt,jsonb_build_object('answer',secret,'jobProposal',null),true,100,10,0,null);
  execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  payload:=jsonb_build_object('title',secret,'description','Private financial proposal','address','Test','customerId',customer,'startAt','2026-11-01T08:00:00Z','endAt','2026-11-01T09:00:00Z','price',938291);
  proposal:=public.diriqent_prepare_job(c,admin_op,payload);
  assert proposal->>'access_scope'='company_admin','prepared price is always admin-only';passed:=passed+1;
  perform public.diriqent_reserve(c,pending_op,'chat',null,'Reserved with admin authority',fp,500,null);
  execute 'reset role';update public.company_members set role='manager' where company_id=c and profile_id=pa;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  assert (select count(*)=0 from public.diriqent_conversations where id=admin_conv),'admin conversation title hidden after manager downgrade';passed:=passed+1;
  assert (select count(*)=0 from public.diriqent_operations where id in(admin_op,pending_op)),'admin result and context hidden by direct RLS';passed:=passed+1;
  assert (select count(*)=0 from public.diriqent_job_proposals where operation_id=admin_op),'admin proposal price hidden by direct RLS';passed:=passed+1;
  body:=public.diriqent_read(c);
  assert body->>'policyVersion'='diriqent-role-scopes-v1' and body->>'roleScope'='manager','policy version and current role are returned';passed:=passed+1;
  assert not body::text like '%'||secret||'%' and jsonb_array_length(body->'operations')=0 and jsonb_array_length(body->'proposals')=0,'read RPC hides old admin payloads';passed:=passed+1;
  failure:=null;begin perform public.diriqent_operation(c,admin_op);exception when others then failure:=sqlstate;end;
  assert failure='42501','detail RPC rejects old admin result and source metadata';passed:=passed+1;
  failure:=null;begin perform public.diriqent_export(c,'chat',admin_op);exception when others then failure:=sqlstate;end;
  assert failure='42501','single export rejects old admin operation';passed:=passed+1;
  body:=public.diriqent_export(c);
  assert body->>'recordCount'='0' and not body::text like '%'||secret||'%' and jsonb_array_length(body->'proposals')=0,'full export excludes old admin content and count';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve(c,admin_op,'proposal',null,secret,fp,500,null);exception when others then failure:=sqlstate;end;
  assert failure='42501','idempotent request id cannot reopen old admin payload';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve(c,gen_random_uuid(),'chat',admin_conv,'Continue old conversation',fp,500,null);exception when others then failure:=sqlstate;end;
  assert failure='42501','manager cannot continue an admin conversation';passed:=passed+1;
  failure:=null;begin perform public.diriqent_confirm_job(c,admin_op,proposal->>'payload_hash');exception when others then failure:=sqlstate;end;
  assert failure='42501','manager cannot confirm prepared admin price';passed:=passed+1;
  assert jsonb_array_length(public.diriqent_context(c)->'customers')=1,'manager operational context remains available';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  failure:=null;begin perform public.diriqent_provider_claim(pending_op,c,pa);exception when others then failure:=sqlstate;end;
  assert failure='42501','admin-to-manager downgrade blocks provider claim';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  body:=public.diriqent_cancel_unstarted(c,pending_op);
  assert body->>'state'='failed' and not body ? 'prompt','downgraded member releases unused credit without reading content';passed:=passed+1;
  body:=public.diriqent_reserve(c,manager_op,'chat',null,'Manager operational request',fp,500,null);manager_conv:=(body->>'conversation_id')::uuid;
  assert body->>'access_scope'='manager','new manager operation is classified separately';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  body:=public.diriqent_provider_claim(manager_op,c,pa);attempt:=(body->>'attemptId')::uuid;
  assert not body::text like '%'||secret||'%' and jsonb_array_length(body->'history')=0,'manager provider request excludes admin history';passed:=passed+1;
  perform public.diriqent_settle(manager_op,attempt,'{"answer":"Manager result","jobProposal":null}',true,100,10,0,null);
  execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  assert public.diriqent_operation(c,manager_op)->>'policyVersion'='diriqent-role-scopes-v1','manager reads their new result with current policy';passed:=passed+1;
  assert public.diriqent_export(c)->>'recordCount'='1','export count describes only accessible records';passed:=passed+1;
  -- Newer inaccessible rows must be filtered before workspace pagination and
  -- export limits, not merely removed from the already-limited JSON result.
  execute 'reset role';
  insert into public.diriqent_conversations(company_id,profile_id,title,requires_manager,access_scope,created_at)
   select c,pa,secret||n,true,'company_admin',now()+n*interval '1 second' from generate_series(1,60)n;
  insert into public.diriqent_operations(id,company_id,profile_id,conversation_id,kind,prompt,fingerprint,requires_manager,access_scope,state,reserved_units,created_at)
   select gen_random_uuid(),c,pa,admin_conv,'chat',secret||n,fp,true,'company_admin','completed',0,now()+n*interval '1 second'
   from generate_series(1,1001)n;
  execute 'set local role authenticated';
  body:=public.diriqent_read(c);
  assert jsonb_array_length(body->'operations')=1 and body->'operations'->0->>'id'=manager_op::text,
   '1001 newer hidden admin operations do not displace accessible manager history';passed:=passed+1;
  assert jsonb_array_length(body->'conversations')=1 and body->'conversations'->0->>'id'=manager_conv::text,
   '60 newer hidden admin conversation titles do not displace accessible conversations';passed:=passed+1;
  body:=public.diriqent_export(c);
  assert body->>'recordCount'='1' and (body->>'complete')::boolean and body->'operations'->0->>'id'=manager_op::text,
   '1001 hidden admin operations do not trigger export limit for one accessible manager result';passed:=passed+1;
  assert not body::text like '%'||secret||'%' and jsonb_array_length(body->'proposals')=0,
   'large hidden archive does not leak titles, results, proposals or counts';passed:=passed+1;
  execute 'reset role';update public.company_members set role='worker' where company_id=c and profile_id=pa;execute 'set local role authenticated';
  assert (select count(*)=0 from public.diriqent_operations where id in(admin_op,manager_op)),'worker downgrade hides both higher scopes';passed:=passed+1;
  body:=public.diriqent_reserve(c,worker_op,'chat',null,'Worker request',fp,500,null);worker_conv:=(body->>'conversation_id')::uuid;
  assert body->>'access_scope'='worker','worker operation uses worker scope';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  body:=public.diriqent_provider_claim(worker_op,c,pa);attempt:=(body->>'attemptId')::uuid;
  assert jsonb_array_length(body->'context'->'customers')=0 and jsonb_array_length(body->'context'->'jobs')=0,'worker context still excludes directory and unassigned jobs';passed:=passed+1;
  perform public.diriqent_settle(worker_op,attempt,'{"answer":"Worker result","jobProposal":null}',true,100,10,0,null);
  execute 'reset role';update public.company_members set role='manager' where company_id=c and profile_id=pa;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  assert public.diriqent_operation(c,worker_op)->>'access_scope'='worker','promotion preserves readable lower-scope history';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve(c,gen_random_uuid(),'chat',worker_conv,'Continue worker chat as manager',fp,500,null);exception when others then failure:=sqlstate;end;
  assert failure='42501','promotion starts a fresh scope rather than contaminating lower history';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claim.sub',uw::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',uw,'role','authenticated')::text,true);execute 'set local role authenticated';
  assert (select count(*)=0 from public.diriqent_operations where profile_id=pa),'another member cannot read any scope';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claim.sub',uf::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',uf,'role','authenticated')::text,true);execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_read(c);exception when others then failure:=sqlstate;end;
  assert failure='42501','foreign-company admin cannot read history';passed:=passed+1;
  failure:=null;begin perform public.diriqent_access_policy(c);exception when others then failure:=sqlstate;end;
  assert failure='42501','foreign-company admin cannot preflight another company';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_access_policy(c);exception when others then failure:=sqlstate;end;
  assert failure='42501','unknown member cannot pass preflight';passed:=passed+1;
  execute 'reset role';
  assert (select sum(reserved_delta)=0 from private.ai_credit_ledger where company_id=c),'all settled or cancelled reservations balance';passed:=passed+1;
  raise exception 'rollback scope fixtures' using errcode='PT001';
 exception when sqlstate 'PT001' then null;
 end;
 assert not exists(select 1 from public.companies where id in(c,foreign_c)),'synthetic fixtures rolled back';
 perform set_config('diriqo.scope_test_result',jsonb_build_object('passed',passed,'fixtures','rolled_back','provider','no external calls','concurrency','not tested in single session')::text,true);
end $test$;
select current_setting('diriqo.scope_test_result')::jsonb as result;
