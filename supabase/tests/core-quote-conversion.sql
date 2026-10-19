-- Owner-run, rollback-only test of the real RPC. Local fault injection proves
-- atomicity/guard placement, not overlapping HTTP or multi-session lock behavior.
do $test$
declare
 ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid(); uw uuid:=gen_random_uuid(); um uuid:=gen_random_uuid();
 pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid(); pw uuid:=gen_random_uuid(); pm uuid:=gen_random_uuid();
 customer_a uuid:=gen_random_uuid(); customer_b uuid:=gen_random_uuid(); qa uuid:=gen_random_uuid(); qb uuid:=gen_random_uuid(); qo uuid:=gen_random_uuid();
 qp uuid:=gen_random_uuid(); qf uuid:=gen_random_uuid(); ql uuid:=gen_random_uuid(); op uuid:=gen_random_uuid(); alias_op uuid:=gen_random_uuid();
 qe uuid:=gen_random_uuid(); short_end timestamptz; started timestamptz;
 job uuid; manual_job uuid:=gen_random_uuid(); legacy_job uuid:=gen_random_uuid(); grant_id uuid:=gen_random_uuid();
 input jsonb; plain jsonb; result jsonb; original_customer jsonb; before_state jsonb; after_state jsonb;
 c record; actor uuid; problem text; code text; passed jsonb:='[]'; marker text:='CoreQuoteTest'||replace(gen_random_uuid()::text,'-','');
 state_sql constant text:=$q$select jsonb_build_object(
 'jobs',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.jobs x where company_id=$1),
 'quotes',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.quotes x where company_id=$1),
 'receipts',(select coalesce(jsonb_agg(to_jsonb(x) order by quote_id),'[]') from private.core_quote_conversions x where company_id=$1),
 'requests',(select coalesce(jsonb_agg(to_jsonb(x) order by operation_id),'[]') from private.core_quote_conversion_requests x where company_id=$1))$q$;
begin
 begin
  insert into auth.users(id,email,raw_user_meta_data) values(ua,marker||'a@example.invalid','{}'),(ub,marker||'b@example.invalid','{}'),(uw,marker||'w@example.invalid','{}'),(um,marker||'m@example.invalid','{}');
  insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values(pa,ua,ua,'Synthetic core admin',true),(pb,ub,ub,'Foreign admin',true),(pw,uw,uw,'Worker',true),(pm,um,um,'Manager',true);
  insert into public.companies(id,name) values(ca,'Synthetic conversion A'),(cb,'Synthetic conversion B');
  insert into public.company_members(company_id,profile_id,role,is_active) values(ca,pa,'company_admin',true),(cb,pb,'company_admin',true),(ca,pw,'worker',true),(ca,pm,'manager',true);
  insert into public.company_modules(company_id,module_key,is_enabled) values(ca,'jobs',true),(ca,'quotes',true);
  insert into public.customers(id,company_id,name,email,address,note) values(customer_a,ca,'Original customer','original@example.invalid','Original address','Preserve unchanged'),(customer_b,cb,'Foreign customer',null,null,null);
  select to_jsonb(x) into original_customer from public.customers x where id=customer_a;
  insert into public.quotes(id,company_id,customer_id,title,total_price,currency,status,accepted_at) values
   (qa,ca,customer_a,'Original offer',1234.56,'EUR','sent',null),(qb,cb,customer_b,'Foreign offer',50,'CZK','draft',null),
   (qo,ca,customer_a,'One day',100,'CZK','accepted','2026-01-01T12:00:00Z'),(qp,ca,null,'No customer',200,'CZK','draft',null),
   (qf,ca,customer_a,'Rollback target',300,'CZK','draft',null),(ql,ca,customer_a,'Legacy ambiguous',400,'CZK','sent',null);
  insert into public.quote_items(company_id,quote_id,name,quantity,unit_price) values(ca,qa,'Preserve on rejected delete',1,1234.56),(ca,qp,'Cascade on permitted delete',1,200);
  insert into public.jobs(id,company_id,title) values(manual_job,ca,'Manual job');
  -- Owner-only fixture represents rows predating the migration. Never enabled for API clients.
  alter table public.jobs disable trigger guard_core_quote_source_link;
  insert into public.jobs(id,company_id,title,source_quote_id,parent_job_id) values(legacy_job,ca,'Legacy reparented',ql,manual_job);
  alter table public.jobs enable trigger guard_core_quote_source_link;
  input:=jsonb_build_object('title',' Converted offer ','description',' Work ','address',' Work address ',
   'start_at','2026-11-01T08:00:00Z','end_at','2026-11-03T16:00:00Z','split_days',jsonb_build_array(
    jsonb_build_object('label','Day 2','start_at','2026-11-02T08:00:00Z','end_at','2026-11-02T16:00:00Z'),
    jsonb_build_object('label','Day 1','start_at','2026-11-01T08:00:00Z','end_at','2026-11-01T16:00:00Z')));
  plain:=input||jsonb_build_object('split_days','[]'::jsonb);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',ua::text,true); execute 'set local role authenticated';
  result:=public.convert_core_quote_to_job_atomic(ca,qa,op,input); job:=(result->>'jobId')::uuid;
  assert result=jsonb_build_object('companyId',ca,'quoteId',qa,'jobId',job,'created',true),'atomic_result_contract';
  execute 'reset role'; set constraints private.core_quote_conversion_complete immediate; set constraints private.core_quote_conversion_complete deferred;
  assert (select count(*) from public.jobs where parent_job_id=job)=2,'all_split_children_created';
  assert exists(select 1 from public.jobs where id=job and price=1234.56 and currency='EUR' and customer_id=customer_a and title='Converted offer')
   and not exists(select 1 from public.jobs where parent_job_id=job and (price<>0 or currency<>'EUR' or customer_id<>customer_a or source_quote_id is not null)),'source_price_currency_customer_preserved';
  assert exists(select 1 from public.quotes where id=qa and status='accepted' and accepted_at is not null),'quote_accepted_atomically';
  assert (select to_jsonb(x) from public.customers x where id=customer_a)=original_customer,'customer_record_untouched';
  passed:=passed||jsonb_build_array('atomic_result_contract','all_split_children_created','source_price_currency_customer_preserved','quote_accepted_atomically','customer_record_untouched');
  execute 'set local role authenticated';
  result:=public.convert_core_quote_to_job_atomic(ca,qa,op,input);
  assert (result->>'jobId')::uuid=job and result->>'created'='false','same_operation_retry';
  result:=public.convert_core_quote_to_job_atomic(ca,qa,alias_op,input||jsonb_build_object('start_at','2026-11-01T09:00:00+01:00'));
  assert (result->>'jobId')::uuid=job and result->>'created'='false','normalized_alias_retry';
  execute 'reset role'; assert (select count(*) from public.jobs where id=job or parent_job_id=job)=3,'retry_no_duplicate_tree';
  passed:=passed||jsonb_build_array('same_operation_retry','normalized_alias_retry','retry_no_duplicate_tree');
  execute 'set local role authenticated';
  result:=public.convert_core_quote_to_job_atomic(ca,qo,gen_random_uuid(),input||jsonb_build_object('split_days',jsonb_build_array(input->'split_days'->0)));
  execute 'reset role'; set constraints private.core_quote_conversion_complete immediate; set constraints private.core_quote_conversion_complete deferred;
  assert (select count(*) from public.jobs where parent_job_id=(result->>'jobId')::uuid)=1,'one_selected_day_has_child';
  assert (select accepted_at from public.quotes where id=qo)='2026-01-01T12:00:00Z'::timestamptz,'original_acceptance_preserved';
  execute 'set local role authenticated'; result:=public.convert_core_quote_to_job_atomic(ca,qp,gen_random_uuid(),plain);
  execute 'reset role'; set constraints private.core_quote_conversion_complete immediate; set constraints private.core_quote_conversion_complete deferred;
  assert exists(select 1 from public.jobs where id=(result->>'jobId')::uuid and customer_id is null)
   and not exists(select 1 from public.jobs where parent_job_id=(result->>'jobId')::uuid),'unsplit_no_customer_supported';
  passed:=passed||jsonb_build_array('one_selected_day_has_child','original_acceptance_preserved','unsplit_no_customer_supported');
  execute state_sql into before_state using ca; execute 'set local role authenticated';
  for c in select * from(values
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qa,op,input||'{"title":"Changed"}'),'CORE_QUOTE_REQUEST_CONFLICT','PT409'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qf,alias_op,plain),'CORE_QUOTE_REQUEST_CONFLICT','PT409'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qa,gen_random_uuid(),plain),'CORE_QUOTE_ALREADY_CONVERTED','PT409'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qb,gen_random_uuid(),plain),'CORE_QUOTE_NOT_FOUND','P0002'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',cb,qb,gen_random_uuid(),plain),'CORE_QUOTE_FORBIDDEN','42501'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,ql,gen_random_uuid(),plain),'CORE_QUOTE_LEGACY_CONVERSION','PT409'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,null,%L)',ca,qf,plain),'CORE_QUOTE_INPUT_INVALID','22023'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qf,gen_random_uuid(),plain||'{"title":""}'),'CORE_QUOTE_INPUT_INVALID','22023'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qf,gen_random_uuid(),plain||jsonb_build_object('title',repeat('x',301))),'CORE_QUOTE_INPUT_INVALID','22023'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qf,gen_random_uuid(),plain||'{"start_at":"2026-11-01T08:00:00"}'),'CORE_QUOTE_INPUT_INVALID','22023'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qf,gen_random_uuid(),plain||'{"start_at":"2026-02-30T08:00:00Z"}'),'CORE_QUOTE_INPUT_INVALID','22023'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qf,gen_random_uuid(),plain||'{"end_at":"2026-10-01T08:00:00Z"}'),'CORE_QUOTE_INPUT_INVALID','22023'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qf,gen_random_uuid(),input||jsonb_build_object('split_days',jsonb_build_array(input->'split_days'->0,input->'split_days'->0))),'CORE_QUOTE_INPUT_INVALID','22023'),
   (format('select public.convert_core_quote_to_job_atomic(%L,%L,%L,%L)',ca,qf,gen_random_uuid(),plain||'{"price":1}'),'CORE_QUOTE_INPUT_INVALID','22023'),
   (format('insert into public.jobs(company_id,title,source_quote_id) values(%L,''Old client'',%L)',ca,qf),'CORE_QUOTE_FORBIDDEN','42501'),
   (format('update public.jobs set source_quote_id=%L where id=%L',qf,manual_job),'CORE_QUOTE_FORBIDDEN','42501'),
   (format('update public.jobs set source_quote_id=null where id=%L',job),'CORE_QUOTE_REQUEST_CONFLICT','PT409')
  ) x(query,expected,expected_code) loop
   problem:=null; code:=null;
   begin execute c.query; exception when others then get stacked diagnostics problem=message_text,code=returned_sqlstate; end;
   assert problem=c.expected and code=c.expected_code,'negative_'||c.expected||'_got_'||coalesce(problem,'NO_ERROR');
   execute 'reset role'; execute state_sql into after_state using ca; assert after_state=before_state,'rejected_conversion_changes_nothing';
   execute 'set local role authenticated'; passed:=passed||jsonb_build_array(c.expected||'_unchanged');
  end loop;
  execute 'reset role'; update public.jobs set parent_job_id=manual_job where id=job;
  execute 'set local role authenticated'; result:=public.convert_core_quote_to_job_atomic(ca,qa,op,input); execute 'reset role';
  assert (result->>'jobId')::uuid=job and result->>'created'='false','reparented_completed_receipt_retry';
  passed:=passed||jsonb_build_array('reparented_completed_receipt_retry');

  create function private.core_quote_test_delete_failure() returns trigger language plpgsql as $fault$
  begin if old.title='Original offer' then raise exception 'INJECTED_DELETE_FAILURE'; end if; return old; end;
  $fault$;
  create trigger core_quote_test_delete_failure before delete on public.quotes for each row execute function private.core_quote_test_delete_failure();
  execute 'set local role authenticated'; problem:=null;
  begin delete from public.quotes where id=qa; exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='INJECTED_DELETE_FAILURE','delete_failure_propagates'; execute 'reset role';
  assert exists(select 1 from public.quote_items where quote_id=qa) and exists(select 1 from public.quotes where id=qa),'delete_failure_preserves_quote_items';
  passed:=passed||jsonb_build_array('delete_failure_preserves_quote_items');
  drop trigger core_quote_test_delete_failure on public.quotes;
  -- The normal delete path relies on FK cleanup; receipt remains a tombstone.
  execute 'set local role authenticated'; delete from public.quotes where id=qp; problem:=null;
  begin perform public.convert_core_quote_to_job_atomic(ca,qp,gen_random_uuid(),plain); exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='CORE_QUOTE_NOT_FOUND','deleted_quote_cannot_replay'; execute 'reset role';
  assert not exists(select 1 from public.quote_items where quote_id=qp),'quote_items_cascade_on_delete';
  passed:=passed||jsonb_build_array('quote_items_cascade_on_delete');
  assert exists(select 1 from private.core_quote_conversions r join public.jobs j on j.id=r.job_id where r.quote_id=qp and j.source_quote_id is null),'deleted_quote_fk_cleanup_preserves_receipt_and_job';
  passed:=passed||jsonb_build_array('deleted_quote_cannot_replay','deleted_quote_fk_cleanup_preserves_receipt_and_job');
  for c in select * from(values
   ('customer_id='||quote_literal(customer_b),'CORE_QUOTE_SCOPE_INVALID'),('status=''rejected''','CORE_QUOTE_STATUS_INVALID'),
   ('status=''expired''','CORE_QUOTE_STATUS_INVALID'),('currency=''bad''','CORE_QUOTE_CURRENCY_UNSUPPORTED'),('total_price=-1','CORE_QUOTE_INPUT_INVALID')
  ) x(mutation,expected) loop
   update public.quotes set customer_id=customer_a,status='draft',currency='CZK',total_price=300 where id=qf;
   execute 'update public.quotes set '||c.mutation||' where id=$1' using qf; execute 'set local role authenticated'; problem:=null;
   begin perform public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),plain); exception when others then get stacked diagnostics problem=message_text; end;
   assert problem=c.expected,'invalid_source_'||c.expected; execute 'reset role';
   assert not exists(select 1 from public.jobs where source_quote_id=qf),'invalid_source_no_job'; passed:=passed||jsonb_build_array(c.expected);
  end loop;
  update public.quotes set customer_id=customer_a,status='draft',currency='CZK',total_price=300 where id=qf;
  for actor in select unnest(array[uw,um,ub]) loop
   perform set_config('request.jwt.claim.sub',actor::text,true); execute 'set local role authenticated'; problem:=null;
   begin perform public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),plain); exception when others then get stacked diagnostics problem=message_text; end;
   assert problem='CORE_QUOTE_FORBIDDEN','worker_manager_foreign_admin_denied'; execute 'reset role'; passed:=passed||jsonb_build_array('worker_manager_foreign_admin_denied');
  end loop;
  perform set_config('request.jwt.claim.sub',ua::text,true);
  for c in select * from(values
   ('update public.profiles set is_active=false where id=$1','update public.profiles set is_active=true where id=$1'),
   ('update public.company_members set is_active=false where profile_id=$1','update public.company_members set is_active=true where profile_id=$1')
  ) x(disable,enable) loop
   execute c.disable using pa; execute 'set local role authenticated'; problem:=null;
   begin perform public.convert_core_quote_to_job_atomic(ca,qa,op,input); exception when others then get stacked diagnostics problem=message_text; end;
   assert problem='CORE_QUOTE_FORBIDDEN','revoked_actor_cannot_replay'; execute 'reset role'; execute c.enable using pa;
   passed:=passed||jsonb_build_array('revoked_actor_cannot_replay');
  end loop;
  for c in select * from(values('jobs'),('quotes')) x(module_key) loop
   update public.company_modules set is_enabled=false where company_id=ca and module_key=c.module_key;
   execute 'set local role authenticated'; problem:=null;
   begin perform public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),plain); exception when others then get stacked diagnostics problem=message_text; end;
   assert problem='CORE_QUOTE_MODULE_REQUIRED','disabled_module_denied'; execute 'reset role';
   update public.company_modules set is_enabled=true where company_id=ca and module_key=c.module_key;
   passed:=passed||jsonb_build_array('disabled_'||c.module_key||'_denied');
  end loop;
  for c in select unnest(array['anon','service_role']) role_name loop
   execute format('set local role %I',c.role_name); problem:=null;
   begin perform public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),plain); exception when insufficient_privilege then problem:='denied'; end;
   assert problem='denied','rpc_acl_denied'; execute 'reset role'; passed:=passed||jsonb_build_array(c.role_name||'_rpc_denied');
  end loop;
  execute 'set local role authenticated';
  for c in select * from(values('select * from private.core_quote_conversions'),('select * from private.core_quote_conversion_requests'),
   ('truncate private.core_quote_conversions cascade'),(format('select private.core_quote_actor(%L)',ca)),
   (format('select private.assert_core_quote_conversion(%L)',ca)),(format('select private.core_quote_conversion_input(%L)',plain))) x(query) loop
   problem:=null; begin execute c.query; exception when insufficient_privilege then problem:='denied'; end;
   assert problem='denied','private_receipts_and_helpers_denied'; passed:=passed||jsonb_build_array('private_receipts_and_helpers_denied');
  end loop;
  execute 'reset role';
  create function private.core_quote_test_fault() returns trigger language plpgsql as $fault$
  begin
   if new.title='Injected expiry' then perform pg_sleep(0.25); end if;
   if new.title like 'Injected child failure%' and new.parent_job_id is not null then raise exception 'INJECTED_CHILD_FAILURE'; end if;
   if new.title='Injected late revoke' and new.source_quote_id is not null then update public.company_members set is_active=false where company_id=new.company_id; end if;
   return new;
  end;
  $fault$;
  create trigger core_quote_test_fault after insert on public.jobs for each row execute function private.core_quote_test_fault();
  for c in select * from(values('Injected child failure','INJECTED_CHILD_FAILURE'),('Injected late revoke','CORE_QUOTE_FORBIDDEN')) x(title,expected) loop
   execute state_sql into before_state using ca; execute 'set local role authenticated'; problem:=null;
   begin perform public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),input||jsonb_build_object('title',c.title)); exception when others then get stacked diagnostics problem=message_text; end;
   assert problem=c.expected,'injected_failure_'||coalesce(problem,'NO_ERROR'); execute 'reset role';
   execute state_sql into after_state using ca; assert before_state=after_state,'parent_children_receipt_quote_all_rollback';
   assert exists(select 1 from public.company_members where company_id=ca and profile_id=pa and is_active),'late_revoke_rollback';
   passed:=passed||jsonb_build_array(c.expected||'_whole_transaction_rollback');
  end loop;
  create function private.core_quote_test_accept_failure() returns trigger language plpgsql as $fault$
  begin if new.status='accepted' and old.status='draft' then raise exception 'INJECTED_ACCEPT_FAILURE'; end if; return new; end;
  $fault$;
  create trigger core_quote_test_accept_failure before update on public.quotes for each row execute function private.core_quote_test_accept_failure();
  execute state_sql into before_state using ca; execute 'set local role authenticated'; problem:=null;
  begin perform public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),input); exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='INJECTED_ACCEPT_FAILURE','accept_failure_propagates'; execute 'reset role';
  execute state_sql into after_state using ca; assert before_state=after_state,'accept_failure_whole_transaction_rollback';
  passed:=passed||jsonb_build_array('accept_failure_whole_transaction_rollback'); drop trigger core_quote_test_accept_failure on public.quotes;
  create function private.core_quote_test_skip_child() returns trigger language plpgsql as $fault$
  begin if new.title like 'Injected skipped child%' and new.parent_job_id is not null then return null; end if; return new; end;
  $fault$;
  create trigger core_quote_test_skip_child before insert on public.jobs for each row execute function private.core_quote_test_skip_child();
  execute state_sql into before_state using ca; execute 'set local role authenticated'; problem:=null;
  begin
   perform public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),input||jsonb_build_object('title','Injected skipped child'));
   set constraints private.core_quote_conversion_complete immediate;
  exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='CORE_QUOTE_RESULT_MISSING','deferred_guard_rejects_incomplete_tree'; execute 'reset role';
  execute state_sql into after_state using ca; assert before_state=after_state,'deferred_failure_whole_transaction_rollback';
  passed:=passed||jsonb_build_array('deferred_guard_rejects_incomplete_tree');
  insert into private.company_module_rollouts(company_id,product,livemode) values(ca,'diriqo_core',false);
  execute 'set local role authenticated'; problem:=null;
  begin perform public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),plain); exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='CORE_QUOTE_MODULE_REQUIRED','enforced_missing_core_denied'; execute 'reset role';
  -- One statement timestamp keeps history_until exactly equal to valid_until.
  insert into private.company_test_module_grants(id,company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(grant_id,ca,'diriqo_core',marker,'Rollback test',now()-interval '1 hour',now()+interval '1 hour',now()+interval '1 hour',array['core.jobs.create']);
  execute 'set local role authenticated'; result:=public.convert_core_quote_to_job_atomic(ca,qf,gen_random_uuid(),plain); execute 'reset role';
  set constraints private.core_quote_conversion_complete immediate; set constraints private.core_quote_conversion_complete deferred;
  assert result->>'created'='true','core_only_grant_allows_conversion';
  update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Test revocation' where id=grant_id;
  execute 'set local role authenticated'; problem:=null;
  begin perform public.convert_core_quote_to_job_atomic(ca,qa,op,input); exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='CORE_QUOTE_MODULE_REQUIRED','revoked_core_denies_retry'; execute 'reset role';
  passed:=passed||jsonb_build_array('enforced_missing_core_denied','core_only_grant_allows_conversion','revoked_core_denies_retry');
  insert into public.quotes(id,company_id,customer_id,title,total_price,currency) values(qe,ca,customer_a,'Expiry target',1,'CZK');
  short_end:=clock_timestamp()+interval '200 milliseconds';
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(ca,'diriqo_core',marker||'-short','Expiry during transaction',short_end-interval '1 hour',short_end,short_end,array['core.jobs.create']);
  execute state_sql into before_state using ca; started:=clock_timestamp(); execute 'set local role authenticated'; problem:=null;
  begin perform public.convert_core_quote_to_job_atomic(ca,qe,gen_random_uuid(),plain||jsonb_build_object('title','Injected expiry'));
  exception when others then get stacked diagnostics problem=message_text; end;
  assert problem='CORE_QUOTE_MODULE_REQUIRED' and clock_timestamp()-started>=interval '250 milliseconds','expiry_after_parent_insert_denied'; execute 'reset role';
  execute state_sql into after_state using ca; assert before_state=after_state,'expiry_rolls_back_parent_receipt_and_quote';
  passed:=passed||jsonb_build_array('expiry_after_parent_insert_whole_transaction_rollback');
  raise exception 'ROLLBACK_SYNTHETIC' using errcode='PT001';
 exception when sqlstate 'PT001' then null; end;
 assert not exists(select 1 from public.companies where id in(ca,cb)),'companies_removed';
 assert not exists(select 1 from auth.users where id in(ua,ub,uw,um)),'auth_removed';
 assert not exists(select 1 from private.core_quote_conversions where company_id=ca),'receipts_removed';
 assert not exists(select 1 from private.core_quote_conversion_requests where company_id=ca),'requests_removed';
 assert not exists(select 1 from public.jobs where company_id=ca),'jobs_removed';
 perform set_config('diriqo.core_quote_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back','cleanup_assertions',5)::text,true);
end;
$test$;
select current_setting('diriqo.core_quote_test_result')::jsonb as result;