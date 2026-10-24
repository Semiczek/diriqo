-- Owner-only synthetic regression. All domain rows and the injected trigger are rolled back.
-- Real single-session PostgreSQL transactions, not overlapping HTTP/concurrency evidence.
create or replace function pg_temp.batch_expected_error(query text, expected_code text, expected_message text default null)
returns jsonb language plpgsql as $f$
declare result jsonb; error_code text; error_message text; error_detail text;
begin
 begin
  execute query;
  raise exception 'BATCH_TEST_UNEXPECTED_SUCCESS';
 exception when others then
  get stacked diagnostics error_code=returned_sqlstate,error_message=message_text,error_detail=pg_exception_detail;
  assert error_code=expected_code,format('Expected code %s, got %s (%s)',expected_code,error_code,error_message);
  assert expected_message is null or error_message=expected_message,format('Expected message %s, got %s',expected_message,error_message);
  result:=jsonb_build_object('code',error_code,'message',error_message,'details',error_detail);
 end;
 return result;
end $f$;
create temporary sequence batch_write_counter;
create or replace function pg_temp.batch_fail_after_write() returns trigger language plpgsql as $f$
begin
 perform nextval('pg_temp.batch_write_counter');
 if new.profile_id::text=current_setting('diriqo.batch_fail_worker',true) then
  raise exception 'BATCH_FIXTURE_FAILURE';
 end if;
 return new;
end $f$;

do $test$
declare
 c uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); a2 uuid:=gen_random_uuid();
 w uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); w3 uuid:=gen_random_uuid();
 m uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); au uuid:=gen_random_uuid(); a2u uuid:=gen_random_uuid(); mu uuid:=gen_random_uuid(); wu uuid:=gen_random_uuid(); fu uuid:=gen_random_uuid();
 j uuid:=gen_random_uuid(); child uuid:=gen_random_uuid(); child2 uuid:=gen_random_uuid(); foreign_j uuid:=gen_random_uuid(); extra uuid:=gen_random_uuid();
 op uuid; assignment_id uuid; protected_id uuid; sid uuid; vid uuid;
 workspace jsonb; receipt jsonb; original_receipt jsonb; payload jsonb; old_payload jsonb; before_rows jsonb; cancel_payload jsonb; cancellation jsonb;
 p jsonb; q jsonb; err jsonb; preview jsonb; errors jsonb:='[]'; contracts jsonb:='[]'; checks text[]:='{}';
 field text; value jsonb; worker uuid; count_before bigint; actor_role text;
 expiry_at timestamptz:=clock_timestamp()-interval '1 day';
 marker text:='BATCH_TEST_ROLLBACK_'||gen_random_uuid()::text;
begin
 assert current_user='postgres','RUN_AS_POSTGRES_ONLY';
 if w>w2 then worker:=w;w:=w2;w2:=worker;end if;
 begin
  insert into auth.users(id,email,raw_user_meta_data) values
   (au,'batch-admin@example.invalid','{}'),(a2u,'batch-admin-two@example.invalid','{}'),(mu,'batch-manager@example.invalid','{}'),(wu,'batch-worker@example.invalid','{}'),(fu,'batch-foreign@example.invalid','{}');
  insert into public.companies(id,name,currency,timezone) values(c,'Synthetic batch A','CZK','Europe/Prague'),(b,'Synthetic batch B','CZK','Europe/Prague');
  insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values
   (a,au,au,'Batch admin',true),(a2,a2u,a2u,'Second admin',true),(m,mu,mu,'Batch manager',true),(w,wu,wu,'Batch first worker',true),
   (w2,null,null,'Batch second worker',true),(w3,null,null,'Batch third worker',true),(f,fu,fu,'Foreign worker',true);
  insert into public.company_members(company_id,profile_id,role,is_active) values
   (c,a,'company_admin',true),(c,a2,'super_admin',true),(c,m,'manager',true),(c,w,'worker',true),(c,w2,'worker',true),(c,w3,'worker',true),(b,f,'company_admin',true);
  insert into public.jobs(id,company_id,title,currency,parent_job_id) values
   (j,c,'Batch root','CZK',null),(foreign_j,b,'Foreign job','CZK',null),(child,c,'Batch child one','CZK',j),(child2,c,'Batch child two','CZK',j);
  insert into public.company_modules(company_id,module_key,is_enabled) values(c,'jobs',true),(c,'workers',true),(c,'shifts',true);
  perform set_config('request.jwt.claim.sub',au::text,true);execute 'set local role authenticated';
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  assert workspace->>'company_id'=c::text and workspace->>'actor_id'=a::text and workspace->>'job_id'=j::text;
  assert jsonb_array_length(workspace->'target_job_ids')=3 and workspace->'assignments'='[]'::jsonb and workspace->>'scope_token' ~ '^[a-f0-9]{64}$';
  checks:=checks||array['empty_workspace_identity','root_children_scope'];
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','empty workspace','kind','workspace','data',workspace,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',null));
  op:=gen_random_uuid();payload:=jsonb_build_object('actor_id',a,'operation_id',op,'scope_token',workspace->>'scope_token','kind','upsert','assignments',jsonb_build_array(
   jsonb_build_object('profile_id',w,'labor_hours','7.25','hourly_rate','200.50','worker_type_snapshot','employee','note','First worker'),
   jsonb_build_object('profile_id',w2,'labor_hours',8,'hourly_rate',250,'worker_type_snapshot','employee','note','Second worker')));
  receipt:=public.mutate_job_assignments_atomic(c,j,payload);original_receipt:=receipt;old_payload:=payload;
  assert receipt->>'operation_id'=op::text and receipt->>'kind'='upsert' and jsonb_array_length(receipt->'assignments')=2;
  execute 'reset role';assert (select count(*) from public.job_assignments where company_id=c)=6;
  assert (select count(*) from public.job_assignments where company_id=c and profile_id=w and labor_hours=7.25 and hourly_rate=200.50)=3;
  assert (select count(*) from public.job_assignments where company_id=c and profile_id=w2 and labor_hours=8 and hourly_rate=250)=3;
  execute 'set local role authenticated';checks:=checks||array['multiworker_root_child_commit','decimal_values_preserved'];
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','root upsert receipt','kind','receipt','data',receipt,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',payload));
  assert public.mutate_job_assignments_atomic(c,j,payload)=receipt,'same_operation_exact_replay';checks:=array_append(checks,'same_operation_exact_replay');
  assert public.get_job_assignment_batch_receipt(c,j,op)=receipt,'receipt_lookup_exact';checks:=array_append(checks,'receipt_lookup_exact');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','receipt lookup','kind','receipt','data',public.get_job_assignment_batch_receipt(c,j,op),'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',payload));
  -- Serial order 1: a completed mutation wins; cancellation only returns its applied receipt.
  execute 'reset role';select count(*) into count_before from private.job_assignment_batch_receipts where company_id=c;
  select jsonb_agg(to_jsonb(x) order by id) into before_rows from public.job_assignments x where company_id=c;execute 'set local role authenticated';
  assert public.cancel_job_assignment_batch_operation(c,j,payload)=original_receipt;
  execute 'reset role';assert (select count(*) from private.job_assignment_batch_receipts where company_id=c)=count_before;
  assert (select jsonb_agg(to_jsonb(x) order by id) from public.job_assignments x where company_id=c)=before_rows;execute 'set local role authenticated';
  checks:=array_append(checks,'applied_before_cancel_returns_applied_without_effect');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','cancel after applied receipt','kind','outcome','data',public.cancel_job_assignment_batch_operation(c,j,payload),'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',payload));
  err:=pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,jsonb_set(payload,'{assignments,0,labor_hours}','6')),'PT409','JOB_ASSIGNMENT_OPERATION_CONFLICT');errors:=errors||jsonb_build_array(err);checks:=array_append(checks,'same_operation_changed_payload_conflict');
  err:=pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload||jsonb_build_object('operation_id',gen_random_uuid())),'PT409','JOB_ASSIGNMENT_SCOPE_CONFLICT');errors:=errors||jsonb_build_array(err);checks:=array_append(checks,'stale_scope_rejected');
  workspace:=public.get_job_assignment_batch_workspace(c,j);assert jsonb_array_length(workspace->'assignments')=6;
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','populated workspace','kind','workspace','data',workspace,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',null));
  q:=public.get_job_assignment_batch_workspace(c,child);assert q->'target_job_ids'=jsonb_build_array(child) and jsonb_array_length(q->'assignments')=2;checks:=array_append(checks,'child_scope_excludes_parent_and_sibling');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','child workspace','kind','workspace','data',q,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',child),'input',null));

  -- Editing one child must leave the root and its sibling byte-for-byte unchanged.
  execute 'reset role';select jsonb_agg(to_jsonb(x) order by id) into before_rows from public.job_assignments x where company_id=c and job_id<>child;execute 'set local role authenticated';
  payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',q->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',w,'labor_hours','7.25','hourly_rate','200.50','note','Child only')));
  receipt:=public.mutate_job_assignments_atomic(c,child,payload);
  assert receipt->'target_job_ids'=jsonb_build_array(child);
  execute 'reset role';assert (select jsonb_agg(to_jsonb(x) order by id) from public.job_assignments x where company_id=c and job_id<>child)=before_rows;
  assert (select note from public.job_assignments where job_id=child and profile_id=w)='Child only';execute 'set local role authenticated';
  checks:=array_append(checks,'child_write_excludes_parent_and_sibling');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','child upsert receipt','kind','receipt','data',receipt,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',child),'input',payload));
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  perform set_config('TimeZone','Europe/Prague',true);q:=public.get_job_assignment_batch_workspace(c,j);
  perform set_config('TimeZone','America/New_York',true);assert public.get_job_assignment_batch_workspace(c,j)=q;
  perform set_config('TimeZone','UTC',true);checks:=array_append(checks,'workspace_token_stable_across_session_timezones');

  -- Serial order 2: cancellation wins even with an old scope token, and a late mutation cannot write.
  execute 'reset role';select count(*) into count_before from private.job_assignment_batch_receipts where company_id=c;
  select jsonb_agg(to_jsonb(x) order by id) into before_rows from public.job_assignments x where company_id=c;execute 'set local role authenticated';
  op:=gen_random_uuid();cancel_payload:=old_payload||jsonb_build_object('operation_id',op);
  cancellation:=public.cancel_job_assignment_batch_operation(c,j,cancel_payload);
  assert cancellation=jsonb_build_object('company_id',c,'actor_id',a,'job_id',j,'operation_id',op,'kind','upsert','cancelled',true);
  assert public.cancel_job_assignment_batch_operation(c,j,cancel_payload)=cancellation;
  assert public.get_job_assignment_batch_receipt(c,j,op)=cancellation;
  checks:=checks||array['cancel_before_mutate_creates_terminal_marker','cancel_exact_replay_and_lookup'];
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','terminal cancellation','kind','outcome','data',cancellation,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',cancel_payload));
  assert public.mutate_job_assignments_atomic(c,j,cancel_payload)=cancellation;
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','late mutate after cancellation','kind','outcome','data',public.mutate_job_assignments_atomic(c,j,cancel_payload),'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',cancel_payload));
  execute 'reset role';assert (select count(*) from private.job_assignment_batch_receipts where company_id=c)=count_before+1;
  assert (select jsonb_agg(to_jsonb(x) order by id) from public.job_assignments x where company_id=c)=before_rows;execute 'set local role authenticated';
  checks:=array_append(checks,'late_mutate_after_cancel_no_assignment_effect');
  p:=jsonb_set(cancel_payload,'{assignments,0,labor_hours}','19');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.cancel_job_assignment_batch_operation(%L,%L,%L::jsonb)',c,j,p),'PT409','JOB_ASSIGNMENT_OPERATION_CONFLICT'));
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,p),'PT409','JOB_ASSIGNMENT_OPERATION_CONFLICT'));
  checks:=array_append(checks,'cancelled_operation_payload_change_conflicts_for_both_commands');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.cancel_job_assignment_batch_operation(%L,%L,%L::jsonb)',c,j,cancel_payload||jsonb_build_object('actor_id',a2)),'42501','JOB_ASSIGNMENT_ACTOR_CHANGED'));
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.cancel_job_assignment_batch_operation(%L,%L,%L::jsonb)',b,foreign_j,cancel_payload),'42501','JOB_ASSIGNMENT_FORBIDDEN'));
  checks:=checks||array['cancel_actor_pin_denied','cancel_foreign_company_denied'];
  execute 'reset role';perform set_config('request.jwt.claim.sub',a2u::text,true);execute 'set local role authenticated';
  assert public.get_job_assignment_batch_receipt(c,j,op) is null;
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.cancel_job_assignment_batch_operation(%L,%L,%L::jsonb)',c,j,cancel_payload),'42501','JOB_ASSIGNMENT_ACTOR_CHANGED'));
  checks:=array_append(checks,'other_admin_cannot_cancel_original_actor_operation');
  execute 'reset role';perform set_config('request.jwt.claim.sub',au::text,true);execute 'set local role authenticated';
  -- Cancellation never needs the business row and remains safe for a removed job.
  execute 'reset role';insert into public.jobs(id,company_id,title,parent_job_id) values(extra,c,'Deleted cancellation target',null);delete from public.jobs where id=extra;execute 'set local role authenticated';
  p:=old_payload||jsonb_build_object('operation_id',gen_random_uuid());q:=public.cancel_job_assignment_batch_operation(c,extra,p);
  assert q->>'cancelled'='true' and q->>'job_id'=extra::text;
  assert public.mutate_job_assignments_atomic(c,extra,p)=q;checks:=array_append(checks,'deleted_job_cancellation_prevents_late_write');

  -- Malformed rows in any position must fail without changing previously valid rows.
  execute 'reset role';select jsonb_agg(to_jsonb(x) order by id) into before_rows from public.job_assignments x where company_id=c;execute 'set local role authenticated';
  foreach field in array array['labor_hours','hourly_rate'] loop
   for value in select v from jsonb_array_elements('[null,""," ",-1,true,{},[],"NaN",0.001,10000000000]'::jsonb) t(v) loop
    p:=jsonb_build_object('profile_id',w2,'labor_hours',9,'hourly_rate',300,'worker_type_snapshot','employee')||jsonb_build_object(field,value);
    payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',w,'labor_hours',9,'hourly_rate',200),p));
    err:=pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'22023','JOB_ASSIGNMENT_INVALID');errors:=errors||jsonb_build_array(err);
   end loop;
   checks:=array_append(checks,'invalid_'||field||'_all_types_before_writes');
  end loop;
  foreach field in array array['scope_token','unknown_key','duplicate_worker','row_unknown_key','empty_rows'] loop
   payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token');
   if field='scope_token' then payload:=payload||jsonb_build_object('scope_token','invalid');
   elsif field='unknown_key' then payload:=payload||jsonb_build_object('company_id',b);
   elsif field='duplicate_worker' then payload:=payload||jsonb_build_object('assignments',jsonb_build_array(payload->'assignments'->0,payload->'assignments'->0));
   elsif field='row_unknown_key' then payload:=jsonb_set(payload,'{assignments,0}',payload->'assignments'->0||jsonb_build_object('company_id',b));
   else payload:=payload||jsonb_build_object('assignments','[]'::jsonb);end if;
   errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'22023','JOB_ASSIGNMENT_INVALID'));
   checks:=array_append(checks,'invalid_'||field||'_rejected');
  end loop;
  execute 'reset role';assert (select jsonb_agg(to_jsonb(x) order by id) from public.job_assignments x where company_id=c)=before_rows;execute 'set local role authenticated';checks:=array_append(checks,'validation_failures_leave_all_rows_unchanged');
  payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',w,'labor_hours',0,'hourly_rate',0)));
  receipt:=public.mutate_job_assignments_atomic(c,j,payload);
  execute 'reset role';assert (select count(*) from public.job_assignments where company_id=c and profile_id=w and labor_hours=0 and hourly_rate=0)=3;execute 'set local role authenticated';checks:=array_append(checks,'explicit_zero_preserved');
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  payload:=payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',w2,'worker_type_snapshot','contractor','assignment_billing_type','fixed','external_amount','1200.50')));
  receipt:=public.mutate_job_assignments_atomic(c,j,payload);
  execute 'reset role';assert (select count(*) from public.job_assignments where company_id=c and profile_id=w2 and labor_hours=8 and hourly_rate=250 and external_amount=1200.50 and assignment_billing_type='fixed')=3;execute 'set local role authenticated';checks:=array_append(checks,'fixed_optional_hours_and_rate_preserved');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','fixed receipt preserving hours','kind','receipt','data',receipt,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',payload));
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  payload:=payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',w3,'worker_type_snapshot','contractor','assignment_billing_type','invoice','external_amount',500)));
  receipt:=public.mutate_job_assignments_atomic(c,j,payload);
  execute 'reset role';assert (select count(*) from public.job_assignments where company_id=c and profile_id=w3 and labor_hours=0 and hourly_rate=0 and external_amount=500)=3;execute 'set local role authenticated';checks:=array_append(checks,'invoice_insert_uses_legacy_nonnull_defaults');
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  for value in select v from jsonb_array_elements('[null,"",-1,false,0.001,10000000000]'::jsonb) t(v) loop
   p:=jsonb_set(payload,'{assignments,0,external_amount}',value)||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token');
   errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,p),'22023','JOB_ASSIGNMENT_INVALID'));
  end loop;checks:=array_append(checks,'fixed_invoice_required_amount_validation');

  -- A real row trigger raises after earlier writes. PostgreSQL rolls back all rows and the receipt.
  execute 'reset role';
  select jsonb_agg(to_jsonb(x) order by id) into before_rows from public.job_assignments x where company_id=c;
  perform set_config('diriqo.batch_fail_worker',w2::text,true);
  create trigger zz_batch_fixture_failure before insert or update on public.job_assignments for each row execute function pg_temp.batch_fail_after_write();
  perform setval('pg_temp.batch_write_counter',1,false);
  execute 'set local role authenticated';
  op:=gen_random_uuid();payload:=old_payload||jsonb_build_object('operation_id',op,'scope_token',workspace->>'scope_token');
  err:=pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'P0001','BATCH_FIXTURE_FAILURE');errors:=errors||jsonb_build_array(err);
  execute 'reset role';assert (select last_value from pg_temp.batch_write_counter)>1,'injected_failure_reached_after_first_write';
  assert (select jsonb_agg(to_jsonb(x) order by id) from public.job_assignments x where company_id=c)=before_rows;
  assert not exists(select 1 from private.job_assignment_batch_receipts where operation_id=op);
  drop trigger zz_batch_fixture_failure on public.job_assignments;perform set_config('diriqo.batch_fail_worker','',true);
  execute 'set local role authenticated';checks:=checks||array['injected_error_after_first_write','injected_error_rolls_back_all_workers_and_children','injected_error_creates_no_receipt'];

  -- Scope hashes cover every affected child and retain archived source history.
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  execute 'reset role';update public.job_assignments set note='concurrent child edit' where job_id=child and profile_id=w;execute 'set local role authenticated';
  payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'PT409','JOB_ASSIGNMENT_SCOPE_CONFLICT'));checks:=array_append(checks,'child_row_change_invalidates_root_scope');
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  execute 'reset role';insert into public.jobs(id,company_id,title,parent_job_id) values(extra,c,'New child',j);execute 'set local role authenticated';
  payload:=payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'PT409','JOB_ASSIGNMENT_SCOPE_CONFLICT'));checks:=array_append(checks,'new_child_invalidates_root_scope');
  execute 'reset role';delete from public.jobs where id=extra;
  update public.job_assignments set archived_at=clock_timestamp(),note='archived evidence' where job_id=child and profile_id=w3;execute 'set local role authenticated';
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',w3,'worker_type_snapshot','contractor','assignment_billing_type','fixed','external_amount',700)));
  receipt:=public.mutate_job_assignments_atomic(c,j,payload);
  execute 'reset role';assert (select archived_at is not null from public.job_assignments where job_id=child and profile_id=w3);execute 'set local role authenticated';checks:=array_append(checks,'upsert_preserves_archived_flag');

  -- Exact source row/job/worker identity must match; foreign tenants never enter the batch.
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'profile_id',w,'labor_hours',8,'hourly_rate',200)));
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'PT409','JOB_ASSIGNMENT_SCOPE_CONFLICT'));checks:=array_append(checks,'mismatched_source_id_denied');
  payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','actor_id',m);
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'42501','JOB_ASSIGNMENT_ACTOR_CHANGED'));checks:=array_append(checks,'actor_pin_denied');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.get_job_assignment_batch_workspace(%L,%L)',c,foreign_j),'42501','JOB_ASSIGNMENT_NOT_FOUND'));checks:=array_append(checks,'foreign_job_denied');
  payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',f,'labor_hours',8,'hourly_rate',200)));
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'42501','JOB_ASSIGNMENT_FORBIDDEN'));checks:=array_append(checks,'foreign_worker_denied');
  execute 'reset role';update public.company_members set is_active=false where company_id=c and profile_id=w2;execute 'set local role authenticated';
  workspace:=public.get_job_assignment_batch_workspace(c,j);payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'42501','JOB_ASSIGNMENT_FORBIDDEN'));checks:=array_append(checks,'inactive_worker_denied');
  execute 'reset role';update public.company_members set is_active=true where company_id=c and profile_id=w2;
  foreach actor_role in array array['manager','worker','accountant'] loop
   update public.company_members set role=actor_role where company_id=c and profile_id=a;execute 'set local role authenticated';
   errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.get_job_assignment_batch_workspace(%L,%L)',c,j),'42501','JOB_ASSIGNMENT_FORBIDDEN'));
   errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.get_job_assignment_batch_receipt(%L,%L,%L)',c,j,old_payload->>'operation_id'),'42501','JOB_ASSIGNMENT_FORBIDDEN'));
   errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.cancel_job_assignment_batch_operation(%L,%L,%L::jsonb)',c,j,old_payload),'42501','JOB_ASSIGNMENT_FORBIDDEN'));checks:=array_append(checks,'role_'||actor_role||'_cancel_denied');
   execute 'reset role';checks:=array_append(checks,'role_'||actor_role||'_workspace_and_receipt_denied');
  end loop;
  update public.company_members set role='company_admin' where company_id=c and profile_id=a;
  perform set_config('request.jwt.claim.sub',fu::text,true);execute 'set local role authenticated';
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.get_job_assignment_batch_workspace(%L,%L)',c,j),'42501','JOB_ASSIGNMENT_FORBIDDEN'));checks:=array_append(checks,'foreign_actor_denied');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.cancel_job_assignment_batch_operation(%L,%L,%L::jsonb)',c,j,old_payload),'42501','JOB_ASSIGNMENT_FORBIDDEN'));checks:=array_append(checks,'foreign_actor_cancel_denied');
  execute 'reset role';perform set_config('request.jwt.claim.sub','',true);execute 'set local role anon';
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.get_job_assignment_batch_workspace(%L,%L)',c,j),'42501'));checks:=array_append(checks,'anonymous_rpc_denied');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.cancel_job_assignment_batch_operation(%L,%L,%L::jsonb)',c,j,old_payload),'42501'));checks:=array_append(checks,'anonymous_cancel_rpc_denied');
  execute 'reset role';perform set_config('request.jwt.claim.sub',a2u::text,true);execute 'set local role authenticated';
  assert public.get_job_assignment_batch_receipt(c,j,(old_payload->>'operation_id')::uuid) is null;checks:=array_append(checks,'other_admin_cannot_claim_actor_receipt');
  execute 'reset role';perform set_config('request.jwt.claim.sub',au::text,true);execute 'set local role authenticated';

  -- A switched-off module blocks new effects while preserving the existing receipt.
  execute 'reset role';update public.company_modules set is_enabled=false where company_id=c and module_key='jobs';execute 'set local role authenticated';
  workspace:=public.get_job_assignment_batch_workspace(c,j);payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'42501','JOB_ASSIGNMENT_MODULE_REQUIRED'));
  assert public.get_job_assignment_batch_receipt(c,j,(old_payload->>'operation_id')::uuid)=original_receipt;
  checks:=array_append(checks,'disabled_module_blocks_new_write_retains_receipt');
  execute 'reset role';update public.company_modules set is_enabled=true where company_id=c and module_key='jobs';execute 'set local role authenticated';

  -- Delete the same worker across root and children in one operation; replay survives deletion.
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  select (x->>'id')::uuid into assignment_id from jsonb_array_elements(workspace->'assignments') x where x->>'job_id'=j::text and x->>'profile_id'=w3::text;
  op:=gen_random_uuid();payload:=jsonb_build_object('actor_id',a,'operation_id',op,'kind','delete','scope_token',workspace->>'scope_token','assignment_id',assignment_id);
  cancel_payload:=payload||jsonb_build_object('operation_id',gen_random_uuid());cancellation:=public.cancel_job_assignment_batch_operation(c,j,cancel_payload);
  assert cancellation->>'cancelled'='true' and cancellation->>'kind'='delete';assert public.mutate_job_assignments_atomic(c,j,cancel_payload)=cancellation;
  execute 'reset role';assert (select count(*) from public.job_assignments where company_id=c and profile_id=w3)=3;execute 'set local role authenticated';checks:=array_append(checks,'cancelled_delete_preserves_root_and_children');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','cancelled delete','kind','outcome','data',cancellation,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',cancel_payload));
  receipt:=public.mutate_job_assignments_atomic(c,j,payload);
  assert jsonb_array_length(receipt->'deleted_ids')=3 and not exists(select 1 from jsonb_array_elements(receipt->'assignments') x where x->>'profile_id'=w3::text);
  execute 'reset role';assert not exists(select 1 from public.job_assignments where company_id=c and profile_id=w3);execute 'set local role authenticated';checks:=array_append(checks,'delete_root_child_worker_once');
  assert public.mutate_job_assignments_atomic(c,j,payload)=receipt;assert public.get_job_assignment_batch_receipt(c,j,op)=receipt;checks:=array_append(checks,'deleted_source_replay_and_lookup');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','delete receipt replay','kind','receipt','data',receipt,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',payload));

  -- A protected later row is created through the actual immutable labor review workflow.
  execute 'reset role';select id into protected_id from public.job_assignments where job_id=child2 and profile_id=w2;execute 'set local role authenticated';
  p:=public.set_company_worker_rate(c,jsonb_build_object('actor_profile_id',a,'profile_id',w2,'operation_id',gen_random_uuid(),'expected_schedule_revision',0,'effective_from','2026-10-01','amount','200.00','currency','CZK','unit','hour','worker_type','employee','billing_type','hourly','reason','Synthetic approved cost'));
  p:=public.save_labor_submission_draft(c,jsonb_build_object('actor_profile_id',a,'operation_id',gen_random_uuid(),'profile_id',w2,'job_id',child2,'expected_revision',0,
   'sources',jsonb_build_array(jsonb_build_object('kind','assignment','id',protected_id)),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-24','actual_hours','8','pay_hours','8','billed_hours','6'))));
  sid:=(p->>'id')::uuid;vid:=(p->>'current_version_id')::uuid;
  p:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'operation_id',gen_random_uuid(),'submission_id',sid,'version_id',vid,'expected_revision',1));
  preview:=public.get_labor_cost_preview(c,sid,vid);
  p:=public.review_labor_submission(c,jsonb_build_object('actor_profile_id',a,'operation_id',gen_random_uuid(),'submission_id',sid,'version_id',vid,'expected_revision',2,'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  execute 'reset role';select jsonb_agg(to_jsonb(x) order by id) into before_rows from public.job_assignments x where company_id=c;execute 'set local role authenticated';
  op:=gen_random_uuid();payload:=old_payload||jsonb_build_object('operation_id',op,'scope_token',workspace->>'scope_token');
  err:=pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'PT409','LABOR_APPROVED_SOURCE_IMMUTABLE');errors:=errors||jsonb_build_array(err);
  assert (err->>'details')::jsonb @> jsonb_build_object('assignment_id',protected_id,'profile_id',w2,'job_id',child2);
  execute 'reset role';assert (select jsonb_agg(to_jsonb(x) order by id) from public.job_assignments x where company_id=c)=before_rows;
  assert not exists(select 1 from private.job_assignment_batch_receipts where operation_id=op);execute 'set local role authenticated';
  checks:=checks||array['protected_later_row_rejected_with_exact_source','protected_row_rolls_back_prior_workers','protected_failure_creates_no_receipt'];
  select (x->>'id')::uuid into assignment_id from jsonb_array_elements(workspace->'assignments') x where x->>'job_id'=j::text and x->>'profile_id'=w2::text;
  op:=gen_random_uuid();payload:=jsonb_build_object('actor_id',a,'operation_id',op,'kind','delete','scope_token',workspace->>'scope_token','assignment_id',assignment_id);
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'PT409','LABOR_APPROVED_SOURCE_IMMUTABLE'));
  execute 'reset role';assert (select count(*) from public.job_assignments where company_id=c and profile_id=w2)=3;execute 'set local role authenticated';checks:=array_append(checks,'protected_child_blocks_entire_delete');

  -- The positive test-grant branch uses the real capability evaluator and immutable grant schema.
  begin
   execute 'reset role';
   insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
    values(c,'diriqo_core','batch-active-fixture','Synthetic active test licence',expiry_at,expiry_at+interval '2 days',expiry_at+interval '2 days',array['core.jobs.update','core.workers.manage']);
   insert into private.company_module_rollouts(company_id,product,livemode) values(c,'diriqo_core',false);
   execute 'set local role authenticated';workspace:=public.get_job_assignment_batch_workspace(c,j);
   payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',w,'labor_hours',3,'hourly_rate',101)));
   receipt:=public.mutate_job_assignments_atomic(c,j,payload);
   execute 'reset role';assert (select count(*) from public.job_assignments where company_id=c and profile_id=w and labor_hours=3 and hourly_rate=101)=3;
   assert exists(select 1 from private.job_assignment_batch_receipts where operation_id=(payload->>'operation_id')::uuid);
   checks:=array_append(checks,'active_test_grant_allows_atomic_write');
   raise exception 'BATCH_ACTIVE_GRANT_ROLLBACK';
  exception when raise_exception then if sqlerrm<>'BATCH_ACTIVE_GRANT_ROLLBACK' then raise;end if;
  end;
  execute 'reset role';assert not exists(select 1 from private.company_test_module_grants where company_id=c);execute 'set local role authenticated';

  -- Missing commercial authority blocks new effects, not an existing actor's historical receipt.
  execute 'reset role';
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(c,'diriqo_core','batch-expired-fixture','Synthetic already expired licence',expiry_at-interval '1 day',expiry_at,expiry_at,array['core.jobs.update','core.workers.manage']);
  insert into private.company_module_rollouts(company_id,product,livemode) values(c,'diriqo_core',false);
  execute 'set local role authenticated';
  assert public.get_job_assignment_batch_receipt(c,j,(old_payload->>'operation_id')::uuid)=original_receipt;
  assert public.mutate_job_assignments_atomic(c,j,old_payload)=original_receipt;checks:=checks||array['expired_licence_retains_receipt_lookup','expired_licence_exact_replay_no_new_effect'];
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','expired licence historical receipt','kind','receipt','data',original_receipt,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',old_payload));
  workspace:=public.get_job_assignment_batch_workspace(c,j);
  payload:=old_payload||jsonb_build_object('operation_id',gen_random_uuid(),'scope_token',workspace->>'scope_token','assignments',jsonb_build_array(jsonb_build_object('profile_id',w,'labor_hours',2,'hourly_rate',100)));
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.mutate_job_assignments_atomic(%L,%L,%L::jsonb)',c,j,payload),'42501','JOB_ASSIGNMENT_MODULE_REQUIRED'));checks:=array_append(checks,'expired_licence_denies_new_write');
  execute 'reset role';select jsonb_agg(to_jsonb(x) order by id) into before_rows from public.job_assignments x where company_id=c;execute 'set local role authenticated';
  cancellation:=public.cancel_job_assignment_batch_operation(c,j,payload);
  assert cancellation->>'cancelled'='true';assert public.get_job_assignment_batch_receipt(c,j,(payload->>'operation_id')::uuid)=cancellation;
  assert public.cancel_job_assignment_batch_operation(c,j,payload)=cancellation;assert public.mutate_job_assignments_atomic(c,j,payload)=cancellation;
  assert public.cancel_job_assignment_batch_operation(c,j,old_payload)=original_receipt;
  execute 'reset role';assert (select jsonb_agg(to_jsonb(x) order by id) from public.job_assignments x where company_id=c)=before_rows;execute 'set local role authenticated';
  checks:=checks||array['expired_licence_cancel_and_lookup_allowed','expired_licence_cancel_blocks_late_business_write','expired_licence_cancel_returns_existing_applied_receipt'];
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','expired licence cancellation','kind','outcome','data',cancellation,'expected',jsonb_build_object('companyId',c,'actorId',a,'jobId',j),'input',payload));
  execute 'reset role';update public.company_members set is_active=false where company_id=c and profile_id=a;execute 'set local role authenticated';
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.get_job_assignment_batch_receipt(%L,%L,%L)',c,j,old_payload->>'operation_id'),'42501','JOB_ASSIGNMENT_FORBIDDEN'));checks:=array_append(checks,'revoked_actor_denied_historical_receipt');
  errors:=errors||jsonb_build_array(pg_temp.batch_expected_error(format('select public.cancel_job_assignment_batch_operation(%L,%L,%L::jsonb)',c,j,payload),'42501','JOB_ASSIGNMENT_FORBIDDEN'));checks:=array_append(checks,'revoked_actor_cannot_cancel_operation');
  execute 'reset role';
  assert not has_table_privilege('authenticated','private.job_assignment_batch_receipts','SELECT') and not has_table_privilege('authenticated','private.job_assignment_batch_receipts','INSERT');checks:=array_append(checks,'receipt_storage_not_client_accessible');
  assert not exists(select 1 from public.job_assignments where company_id=b);checks:=array_append(checks,'foreign_company_unchanged');
  raise exception '%',marker;
 exception when raise_exception then if sqlerrm<>marker then raise;end if;
 end;
 assert not exists(select 1 from public.companies where id in(c,b));
 assert not exists(select 1 from auth.users where id in(au,a2u,mu,wu,fu));
 assert not exists(select 1 from public.job_assignments where company_id=c);
 assert not exists(select 1 from private.job_assignment_batch_receipts where company_id=c);
 assert not exists(select 1 from public.labor_submissions where company_id=c);
 assert not exists(select 1 from pg_trigger where tgname='zz_batch_fixture_failure' and tgrelid='public.job_assignments'::regclass);
 perform set_config('diriqo.test_job_assignment_batch',jsonb_build_object('fixtures','rolled_back','count',cardinality(checks),'checks',checks,'cleanup_assertions',6,'contracts',contracts,'errors',errors)::text,false);
end $test$;
select current_setting('diriqo.test_job_assignment_batch')::jsonb result;
