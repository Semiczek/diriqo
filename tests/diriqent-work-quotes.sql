-- Local/authorized test DB only. Real RPCs, no external provider calls, rollback.
do $test$
declare
 ua uuid:=gen_random_uuid();um uuid:=gen_random_uuid();uw uuid:=gen_random_uuid();uf uuid:=gen_random_uuid();
 pa uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();pw uuid:=gen_random_uuid();pf uuid:=gen_random_uuid();
 c uuid:=gen_random_uuid();fc uuid:=gen_random_uuid();j1 uuid:=gen_random_uuid();j2 uuid:=gen_random_uuid();
 op uuid:=gen_random_uuid();plan_op uuid:=gen_random_uuid();pending_op uuid:=gen_random_uuid();manager_op uuid:=gen_random_uuid();worker_op uuid:=gen_random_uuid();
 limit_op uuid:=gen_random_uuid();failed_op uuid:=gen_random_uuid();tiny_op uuid:=gen_random_uuid();cap_op uuid:=gen_random_uuid();
 quote jsonb;plan_quote jsonb;pending_quote jsonb;manager_quote jsonb;worker_quote jsonb;body jsonb;spec jsonb:='{"dataset":"operations","from":"2020-01-01","to":"2020-01-02"}';
 finance_spec jsonb:='{"dataset":"finance","from":"2020-01-01","to":"2020-01-02"}';
 quote_id uuid;expired_id uuid;attempt uuid;advanced_conv uuid;empty_advanced_conv uuid:=gen_random_uuid();failure text;before_units bigint;passed integer:=0;
 marker text:='Work'||right(replace(gen_random_uuid()::text,'-',''),16);answer jsonb:='{"answer":"Testovací návrh bez zápisu","jobProposal":null}';
begin
 begin
  insert into auth.users(id,email,raw_user_meta_data) values(ua,marker||'a@example.invalid','{}'),(um,marker||'m@example.invalid','{}'),(uw,marker||'w@example.invalid','{}'),(uf,marker||'f@example.invalid','{}');
  insert into public.profiles(id,auth_user_id,user_id,full_name) values(pa,ua,ua,'Work admin'),(pm,um,um,'Work manager'),(pw,uw,uw,'Work worker'),(pf,uf,uf,'Work foreign');
  insert into public.companies(id,name) values(c,'Work test'),(fc,'Foreign work test');
  insert into public.company_members(company_id,profile_id,role,is_active) values(c,pa,'company_admin',true),(c,pm,'manager',true),(c,pw,'worker',true),(fc,pf,'company_admin',true);
  insert into public.jobs(id,company_id,title,status,work_state,start_at,end_at,price,currency) values
   (j1,c,'Done at first boundary','done','done','2020-01-01T00:00:00+01:00','2020-01-01T02:00:00+01:00',100,'CZK'),
   (j2,c,'Overdue at last boundary','planned','not_started','2020-01-02T23:59:00+01:00','2020-01-03T01:00:00+01:00',200,'EUR'),
   (gen_random_uuid(),c,'Outside period','planned','not_started','2020-01-03T00:00:00+01:00','2020-01-03T01:00:00+01:00',9000,'CZK'),
   (gen_random_uuid(),fc,'FOREIGN SECRET','planned','not_started','2020-01-01T08:00:00+01:00','2020-01-01T09:00:00+01:00',999999,'CZK');
  insert into public.job_assignments(company_id,job_id,profile_id) values(c,j1,pw);
  insert into public.work_shifts(company_id,profile_id,job_id,shift_date,started_at,ended_at,status,hours_override,job_hours_override) values
   (c,pa,j1,'2020-01-01','2020-01-01T08:00:00+01:00','2020-01-01T10:00:00+01:00','completed',null,null),
   (c,pa,j1,'2020-01-01','2020-01-01T10:00:00+01:00','2020-01-01T12:00:00+01:00','completed',9,3),
   (c,pm,j1,'2020-01-01','2020-01-01T08:00:00+01:00','2020-01-01T12:00:00+01:00','completed',null,null),
   (c,pw,j1,'2020-01-01','2020-01-01T08:00:00+01:00','2020-01-01T09:00:00+01:00','completed',null,null);
  insert into private.company_module_rollouts(company_id,product,livemode)
   select co,pr,false from unnest(array[c,fc]) companies(co) cross join unnest(array['diriqo_core','ai_assistant']) products(pr);
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   select co,pr,marker,'Synthetic quoted work rollback test',now()-interval '1 day',now()+interval '1 day',now()+interval '1 day',case pr
    when 'diriqo_core' then array['core.jobs.create','core.history.read','core.history.export']
    else array['ai_assistant.conversation.run','ai_assistant.history.read','ai_assistant.history.export'] end
   from unnest(array[c,fc]) companies(co) cross join unnest(array['diriqo_core','ai_assistant']) products(pr);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  perform public.diriqent_test_credit_grant(c,10000,marker,'Synthetic quoted work credit',now()+interval '1 day');
  execute 'reset role';perform set_config('request.jwt.claim.sub',ua::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  assert public.diriqent_access_policy(c)->>'workPolicyVersion'='diriqent-work-v1','advanced policy preflight marker';passed:=passed+1;
  assert not has_table_privilege('authenticated','private.diriqent_work_quotes','select'),'private quotes cannot be queried directly';passed:=passed+1;
  assert not has_function_privilege('authenticated','private.diriqent_reserve_scoped(uuid,uuid,text,uuid,text,text,integer,text)','execute'),'internal reserve is revoked';passed:=passed+1;
  quote:=public.diriqent_prepare_work(c,'analytics',finance_spec,'  Souhrn hodnot zakázek  ',500);quote_id:=(quote->>'id')::uuid;
  assert quote->>'multiplier'='2' and quote->>'rateVersion'='diriqent-analytics-test-czk-v1' and quote->>'prompt'='Souhrn hodnot zakázek','quote has canonical prompt and explicit analytics price';passed:=passed+1;
  assert (quote->>'expiresAt')::timestamptz between clock_timestamp()+interval '9 minutes' and clock_timestamp()+interval '11 minutes','quote expires after ten minutes';passed:=passed+1;
  assert public.diriqent_read(c)->>'availableUnits'='10000' and (select count(*)=0 from public.diriqent_operations where company_id=c),'preparing quote reserves no credit and starts no operation';passed:=passed+1;
  failure:=null;begin perform public.diriqent_prepare_work(c,'analytics',spec||'{"to":"2020-04-01"}','Long report',500);exception when others then failure:=sqlerrm;end;
  assert failure is not null,'more than 90 inclusive days rejected';passed:=passed+1;
  failure:=null;begin perform public.diriqent_prepare_work(c,'analytics',spec||'{"extra":"forged"}','Report',500);exception when others then failure:=sqlerrm;end;
  assert failure is not null,'unrecognized spec keys rejected';passed:=passed+1;
  failure:=null;begin perform public.diriqent_prepare_work(c,'analytics',spec,'Report',null);exception when others then failure:=sqlerrm;end;
  assert failure is not null,'price limit required';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve_work(c,quote_id,op,500,quote->>'rateVersion',false);exception when others then failure:=sqlerrm;end;
  assert failure is not null,'explicit confirmation required';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve_work(c,quote_id,op,100,quote->>'rateVersion',true);exception when others then failure:=sqlerrm;end;
  assert failure is not null,'accepted limit must match server quote';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve_work(c,quote_id,op,500,'diriqent-test-czk-v1',true);exception when others then failure:=sqlerrm;end;
  assert failure is not null,'accepted rate cannot be downgraded';passed:=passed+1;
  execute 'reset role';
  failure:=null;begin update private.diriqent_work_quotes set max_units=100 where id=quote_id;exception when others then failure:=sqlerrm;end;
  assert failure is not null,'saved price quote is immutable';passed:=passed+1;
  expired_id:=gen_random_uuid();
  insert into private.diriqent_work_quotes(id,company_id,profile_id,access_scope,work_mode,work_spec,prompt,max_units,rate_version,expires_at)
   values(expired_id,c,pa,'company_admin','analytics',spec,'Expired quote',500,'diriqent-analytics-test-czk-v1',clock_timestamp()-interval '1 minute');
  execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_reserve_work(c,expired_id,op,500,'diriqent-analytics-test-czk-v1',true);exception when others then failure:=sqlerrm;end;
  assert failure is not null,'expired unconsumed quote rejected';passed:=passed+1;
  body:=public.diriqent_reserve_work(c,quote_id,op,500,quote->>'rateVersion',true);advanced_conv:=(body->>'conversation_id')::uuid;
  assert body->>'work_mode'='analytics' and body->>'work_quote_id'=quote_id::text and body->'work_spec'=finance_spec,'reserved operation stores canonical consent';passed:=passed+1;
  assert (select work_mode='analytics' from public.diriqent_conversations where id=advanced_conv),'analytics conversation stores its own mode under existing RLS';passed:=passed+1;
  assert public.diriqent_read(c)->'conversations'->0->>'work_mode'='analytics','workspace exposes conversation mode for mode-specific selectors';passed:=passed+1;
  assert public.diriqent_reserve_work(c,quote_id,op,500,quote->>'rateVersion',true)->>'id'=op::text,'same request and quote are idempotent';passed:=passed+1;
  assert public.diriqent_read(c)->>'availableUnits'='9500','quote retry reserves once';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve_work(c,quote_id,gen_random_uuid(),500,quote->>'rateVersion',true);exception when others then failure:=sqlerrm;end;
  assert failure is not null,'quote cannot fund a second operation';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve(c,op,'chat',null,quote->>'prompt',body->>'fingerprint',500,null);exception when others then failure:=sqlstate;end;
  assert failure='42501','basic RPC cannot replay an advanced request id';passed:=passed+1;
  failure:=null;begin perform public.diriqent_reserve(c,gen_random_uuid(),'chat',advanced_conv,'Cheap continuation',repeat('a',64),500,null);exception when others then failure:=sqlstate;end;
  assert failure='42501','basic conversation cannot continue advanced context';passed:=passed+1;
  execute 'reset role';
  insert into public.diriqent_conversations(id,company_id,profile_id,title,requires_manager,access_scope,work_mode)
   values(empty_advanced_conv,c,pa,'Empty advanced conversation',true,'company_admin','plan');
  execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_reserve(c,gen_random_uuid(),'chat',empty_advanced_conv,'No operation to infer mode from',repeat('a',64),500,null);exception when others then failure:=sqlstate;end;
  assert failure='42501','basic RPC rejects an advanced conversation even without any operations';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  body:=public.diriqent_provider_claim(op,c,pa,'{"metrics":{"FORGED":999}}');attempt:=(body->>'attemptId')::uuid;
  assert body->'context'->'metrics'->>'jobCount'='2' and body->'context'->'metrics'->>'completedJobCount'='1' and body->'context'->'metrics'->>'overdueJobCount'='1','job statistics use tenant-filtered inclusive local dates';passed:=passed+1;
  assert body->'context'->'metrics'->>'ownCompletedShiftCount'='2' and (body->'context'->'metrics'->>'ownHours')::numeric=5,'own hours use job override before hours override before duration';passed:=passed+1;
  assert body->'context'->'metrics'->'contractValueByCurrency'='[{"currency":"CZK","amount":100.00},{"currency":"EUR","amount":200.00}]'::jsonb,'admin contract values separated by currency';passed:=passed+1;
  assert jsonb_array_length(body->'history')=0 and not body::text like '%FORGED%' and not body::text like '%FOREIGN SECRET%','advanced context is canonical and has no imported history';passed:=passed+1;
  assert not body->'context'->'jobs'->0 ? 'price','preview rows contain no raw finance columns';passed:=passed+1;
  body:=public.diriqent_settle(op,attempt,answer,true,1000,100,0,null);
  assert body->>'charged_units'='48','analytics test rate is twice baseline before rounding';passed:=passed+1;
  assert public.diriqent_settle(op,attempt,answer,true,1000,100,0,null)->>'charged_units'='48','settlement remains idempotent';passed:=passed+1;
  execute 'reset role';
  assert (select pricing->>'creditMultiplier'='6' and pricing->>'version'='diriqent-analytics-test-czk-v1' from private.ai_provider_attempts where operation_id=op),'provider attempt stores accepted tariff snapshot';passed:=passed+1;
  failure:=null;begin update private.ai_provider_attempts set pricing='{}' where operation_id=op;exception when others then failure:=sqlerrm;end;
  assert failure is not null,'provider pricing snapshot cannot change after claim';passed:=passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  plan_quote:=public.diriqent_prepare_work(c,'plan',spec,'Navrhni provozní plán',500);
  assert plan_quote->>'multiplier'='3' and plan_quote->>'rateVersion'='diriqent-plan-test-czk-v1','plan quote declares triple test rate';passed:=passed+1;
  body:=public.diriqent_reserve_work(c,(plan_quote->>'id')::uuid,plan_op,500,plan_quote->>'rateVersion',true);
  assert (select work_mode='plan' from public.diriqent_conversations where id=(body->>'conversation_id')::uuid),'plan conversation stores plan mode atomically';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  attempt:=(public.diriqent_provider_claim(plan_op,c,pa)->>'attemptId')::uuid;
  assert public.diriqent_settle(plan_op,attempt,answer,true,1000,100,0,null)->>'charged_units'='72','plan costs three times baseline';passed:=passed+1;
  execute 'reset role';
  assert (select count(*)=3 from public.jobs where company_id=c) and (select count(*)=4 from public.work_shifts where company_id=c),'plan and analytics did not write jobs or attendance';passed:=passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  pending_quote:=public.diriqent_prepare_work(c,'analytics',finance_spec,'Pending finance quote',500);
  execute 'reset role';update public.company_members set role='manager' where company_id=c and profile_id=pa;execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_reserve_work(c,(pending_quote->>'id')::uuid,pending_op,500,pending_quote->>'rateVersion',true);exception when others then failure:=sqlstate;end;
  assert failure='42501','role downgrade invalidates unconfirmed finance quote';passed:=passed+1;
  assert (select count(*)=0 from public.diriqent_operations where id=op),'advanced finance history hidden by RLS after downgrade';passed:=passed+1;
  assert public.diriqent_export(c)->>'recordCount'='0','advanced finance export hidden after downgrade';passed:=passed+1;
  execute 'reset role';update public.company_members set role='company_admin' where company_id=c and profile_id=pa;execute 'set local role authenticated';
  perform public.diriqent_reserve_work(c,(pending_quote->>'id')::uuid,pending_op,500,pending_quote->>'rateVersion',true);
  execute 'reset role';update public.company_members set role='manager' where company_id=c and profile_id=pa;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  failure:=null;begin perform public.diriqent_provider_claim(pending_op,c,pa);exception when others then failure:=sqlstate;end;
  assert failure='42501','role downgrade between quote reservation and claim denies provider';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  perform public.diriqent_cancel_unstarted(c,pending_op);
  execute 'reset role';update public.company_members set role='company_admin' where company_id=c and profile_id=pa;
  perform set_config('request.jwt.claim.sub',um::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',um,'role','authenticated')::text,true);execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_prepare_work(c,'analytics',finance_spec,'Forbidden finance',500);exception when others then failure:=sqlstate;end;
  assert failure='42501','manager cannot even quote finance dataset';passed:=passed+1;
  manager_quote:=public.diriqent_prepare_work(c,'analytics',spec,'Provoz pro manažera',500);
  perform public.diriqent_reserve_work(c,(manager_quote->>'id')::uuid,manager_op,500,manager_quote->>'rateVersion',true);
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  body:=public.diriqent_provider_claim(manager_op,c,pm);attempt:=(body->>'attemptId')::uuid;
  assert body->'context'->'metrics'->>'jobCount'='2' and (body->'context'->'metrics'->>'ownHours')::numeric=4,'manager gets company jobs and own shifts only';passed:=passed+1;
  assert not body->'context'->'metrics' ? 'contractValueByCurrency','manager provider context omits finance field entirely';passed:=passed+1;
  perform public.diriqent_settle(manager_op,attempt,answer,true,100,10,0,null);
  execute 'reset role';perform set_config('request.jwt.claim.sub',uw::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',uw,'role','authenticated')::text,true);execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_prepare_work(c,'plan',finance_spec,'Forbidden worker finance',500);exception when others then failure:=sqlstate;end;
  assert failure='42501','worker cannot quote financial planning';passed:=passed+1;
  worker_quote:=public.diriqent_prepare_work(c,'plan',spec,'Moje úkoly',500);
  perform public.diriqent_reserve_work(c,(worker_quote->>'id')::uuid,worker_op,500,worker_quote->>'rateVersion',true);
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  body:=public.diriqent_provider_claim(worker_op,c,pw);attempt:=(body->>'attemptId')::uuid;
  assert body->'context'->'metrics'->>'jobCount'='1' and (body->'context'->'metrics'->>'ownHours')::numeric=1 and body->'context'->'jobs'->0->>'id'=j1::text,'worker context has assigned jobs and own hours only';passed:=passed+1;
  assert not body->'context'->'metrics' ? 'contractValueByCurrency','worker provider context has no finance field';passed:=passed+1;
  perform public.diriqent_settle(worker_op,attempt,answer,true,100,10,0,null);
  execute 'reset role';perform set_config('request.jwt.claim.sub',uf::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',uf,'role','authenticated')::text,true);execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_reserve_work(fc,(worker_quote->>'id')::uuid,gen_random_uuid(),500,worker_quote->>'rateVersion',true);exception when others then failure:=sqlstate;end;
  assert failure='42501','quote cannot be consumed by another tenant';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claim.sub',ua::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  quote:=public.diriqent_prepare_work(c,'plan',spec,'Limit test',100);
  perform public.diriqent_reserve_work(c,(quote->>'id')::uuid,limit_op,100,quote->>'rateVersion',true);
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  attempt:=(public.diriqent_provider_claim(limit_op,c,pa)->>'attemptId')::uuid;
  assert public.diriqent_settle(limit_op,attempt,answer,true,1000000,0,0,null)->>'charged_units'='100','customer charge never exceeds confirmed limit';passed:=passed+1;
  execute 'reset role';
  assert (select unbilled_credit_units=44900 and provider_cost_microusd=2000000 from private.ai_provider_attempts where operation_id=limit_op),'provider cost and unbilled overspend recorded separately';passed:=passed+1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  quote:=public.diriqent_prepare_work(c,'plan',spec,'Unusable result test',500);
  perform public.diriqent_reserve_work(c,(quote->>'id')::uuid,failed_op,500,quote->>'rateVersion',true);
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  attempt:=(public.diriqent_provider_claim(failed_op,c,pa)->>'attemptId')::uuid;
  assert public.diriqent_settle(failed_op,attempt,null,false,1000,100,0,'unusable_result')->>'charged_units'='0','failed advanced result charges no customer credit';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  quote:=public.diriqent_prepare_work(c,'plan',spec,'Small rounding test',500);
  perform public.diriqent_reserve_work(c,(quote->>'id')::uuid,tiny_op,500,quote->>'rateVersion',true);
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  attempt:=(public.diriqent_provider_claim(tiny_op,c,pa)->>'attemptId')::uuid;
  assert public.diriqent_settle(tiny_op,attempt,answer,true,1,0,0,null)->>'charged_units'='1','tariff multiplication happens before integer credit rounding';passed:=passed+1;
  execute 'reset role';perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';
  quote:=public.diriqent_prepare_work(c,'analytics',spec,'Revoked Core test',500);
  execute 'reset role';update private.company_test_module_grants set revoked_at=now() where company_id=c and product='diriqo_core';execute 'set local role authenticated';
  failure:=null;begin perform public.diriqent_reserve_work(c,(quote->>'id')::uuid,gen_random_uuid(),500,quote->>'rateVersion',true);exception when others then failure:=sqlstate;end;
  assert failure='42501','Core revocation between quote and reserve denies paid work';passed:=passed+1;
  execute 'reset role';update private.company_test_module_grants set revoked_at=null where company_id=c and product='diriqo_core';execute 'set local role authenticated';
  quote:=public.diriqent_prepare_work(c,'analytics',spec,'Revoked Core before claim',500);
  pending_op:=gen_random_uuid();perform public.diriqent_reserve_work(c,(quote->>'id')::uuid,pending_op,500,quote->>'rateVersion',true);
  execute 'reset role';update private.company_test_module_grants set revoked_at=now() where company_id=c and product='diriqo_core';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  failure:=null;begin perform public.diriqent_provider_claim(pending_op,c,pa);exception when others then failure:=sqlstate;end;
  assert failure='42501','Core revocation before claim prevents provider context';passed:=passed+1;
  execute 'reset role';update private.company_test_module_grants set revoked_at=null where company_id=c and product='diriqo_core';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);execute 'set local role authenticated';perform public.diriqent_cancel_unstarted(c,pending_op);
  execute 'reset role';
  insert into public.jobs(company_id,title,status,work_state,start_at,end_at,price,currency)
   select c,'Bounded job '||n,'planned','not_started','2020-01-01T08:00:00+01:00'::timestamptz+n*interval '1 minute','2020-01-01T09:00:00+01:00'::timestamptz+n*interval '1 minute',100,'CZK' from generate_series(1,201)n;
  insert into public.work_shifts(company_id,profile_id,job_id,shift_date,started_at,ended_at,status)
   select c,pm,j1,'2020-01-01','2020-01-01T08:00:00+01:00'::timestamptz+n*interval '1 minute','2020-01-01T09:00:00+01:00'::timestamptz+n*interval '1 minute','completed' from generate_series(1,501)n;
  perform set_config('request.jwt.claim.sub',um::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',um,'role','authenticated')::text,true);execute 'set local role authenticated';
  quote:=public.diriqent_prepare_work(c,'analytics',spec,'Bounded source report',500);
  perform public.diriqent_reserve_work(c,(quote->>'id')::uuid,cap_op,500,quote->>'rateVersion',true);
  execute 'reset role';perform set_config('request.jwt.claims','{"role":"service_role"}',true);execute 'set local role service_role';
  body:=public.diriqent_provider_claim(cap_op,c,pm);attempt:=(body->>'attemptId')::uuid;
  assert body->'context'->'metrics'->>'jobCount'='200' and body->'context'->'coverage'->>'jobRows'='200' and (body->'context'->'coverage'->>'jobsTruncated')::boolean,'job aggregation is capped before totals with explicit truncation';passed:=passed+1;
  assert body->'context'->'coverage'->>'shiftRows'='500' and (body->'context'->'coverage'->>'shiftsTruncated')::boolean,'own shifts are capped before aggregation';passed:=passed+1;
  assert jsonb_array_length(body->'context'->'jobs')=30 and (body->'context'->'coverage'->>'truncated')::boolean and jsonb_array_length(body->'context'->'warnings')>=2,'bounded preview and warnings disclose partial coverage';passed:=passed+1;
  perform public.diriqent_settle(cap_op,attempt,answer,true,100,10,0,null);
  execute 'reset role';
  assert (select sum(reserved_delta)=0 from private.ai_credit_ledger where company_id=c),'all advanced reservations are settled or released';passed:=passed+1;
  assert (select -sum(credit_delta) from private.ai_credit_ledger where company_id=c)=(select sum(charged_units) from public.diriqent_operations where company_id=c),'append-only ledger matches exactly the saved customer charges';passed:=passed+1;
  raise exception 'rollback quoted work fixtures' using errcode='PT001';
 exception when sqlstate 'PT001' then null;
 end;
 assert not exists(select 1 from public.companies where id in(c,fc)),'all quoted work fixtures rolled back';
 perform set_config('diriqo.work_test_result',jsonb_build_object('passed',passed,'fixtures','rolled_back','provider','no external calls','concurrency','not tested in single session')::text,true);
end $test$;
select current_setting('diriqo.work_test_result')::jsonb as result;
