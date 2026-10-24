-- Owner-run rollback regression of the real labor RPCs. Fixtures contain no real employee data.
-- Single-session CAS/idempotency evidence; overlapping hosted transactions require a separate test.
do $test$
declare
 c uuid:=gen_random_uuid();other_c uuid:=gen_random_uuid();a uuid:=gen_random_uuid();w uuid:=gen_random_uuid();m uuid:=gen_random_uuid();foreign_p uuid:=gen_random_uuid();unknown_w uuid:=gen_random_uuid();
 au uuid:=gen_random_uuid();wu uuid:=gen_random_uuid();mu uuid:=gen_random_uuid();fu uuid:=gen_random_uuid();job uuid:=gen_random_uuid();other_job uuid:=gen_random_uuid();
 sh uuid:=gen_random_uuid();sh2 uuid:=gen_random_uuid();sh3 uuid:=gen_random_uuid();unknown_sh uuid:=gen_random_uuid();log_id uuid:=gen_random_uuid();assignment uuid:=gen_random_uuid();
 sid uuid;vid uuid;original_vid uuid;sid2 uuid;vid2 uuid;sid3 uuid;vid3 uuid;unknown_sid uuid;unknown_vid uuid;
 contracts jsonb:='[]';domain_conflicts jsonb:='[]';p jsonb;r jsonb;before_r jsonb;preview jsonb;totals jsonb;rate_input jsonb;save_input jsonb;review_input jsonb;
 op uuid:=gen_random_uuid(); tests text[]:='{}';marker text:='LABOR_TEST_ROLLBACK_'||gen_random_uuid()::text;
 edge_job uuid:=gen_random_uuid();unauthorized_role_sh uuid:=gen_random_uuid();alias_sh uuid:=gen_random_uuid();alias_log uuid:=gen_random_uuid();alias_sid uuid;alias_vid uuid;bad_hours_sh uuid:=gen_random_uuid();running_sh uuid:=gen_random_uuid();negative_hours_sh uuid:=gen_random_uuid();bad_link_log uuid:=gen_random_uuid();
 dst_sh uuid:=gen_random_uuid();dst_sid uuid;dst_vid uuid;extra_fixed_sh uuid:=gen_random_uuid();extra_fixed_sid uuid;extra_fixed_vid uuid;fixed_job uuid:=gen_random_uuid();fixed_sh uuid:=gen_random_uuid();fixed_sh2 uuid:=gen_random_uuid();fixed_sid uuid;fixed_vid uuid;future_sh uuid:=gen_random_uuid();future_sid uuid;future_vid uuid;checked boolean;row_count_value integer;grant_id uuid:=gen_random_uuid();
begin
 if current_user<>'postgres' then raise exception 'RUN_AS_POSTGRES_ONLY';end if;
 begin
  insert into auth.users(id,email,raw_user_meta_data) values(au,'labor-admin@example.invalid','{}'),(wu,'labor-worker@example.invalid','{}'),(mu,'labor-manager@example.invalid','{}'),(fu,'labor-foreign@example.invalid','{}');
  insert into public.companies(id,name,currency,timezone) values(c,'Synthetic labor history','CZK','Europe/Prague'),(other_c,'Synthetic foreign labor','CZK','Europe/Prague');
  insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values(a,au,au,'Synthetic admin',true),(w,wu,wu,'Synthetic worker',true),(m,mu,mu,'Synthetic manager',true),(foreign_p,fu,fu,'Foreign',true),(unknown_w,null,null,'Worker without account',true);
  insert into public.company_members(company_id,profile_id,role,is_active) values(c,a,'company_admin',true),(c,w,'worker',true),(c,m,'manager',true),(other_c,foreign_p,'company_admin',true),(c,unknown_w,'worker',true);
  insert into public.jobs(id,company_id,title,currency) values(job,c,'Labor job','CZK'),(other_job,other_c,'Foreign job','CZK');
  insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,started_at,ended_at) values
   (sh,c,w,job,'2026-10-01','2026-10-01T06:00Z','2026-10-01T14:00Z'),
   (sh2,c,w,job,'2026-11-01','2026-11-01T07:00Z','2026-11-01T15:00Z'),
   (sh3,c,w,job,'2026-10-02','2026-10-02T06:00Z','2026-10-02T14:00Z'),
   (unknown_sh,c,unknown_w,job,'2026-10-01','2026-10-01T06:00Z','2026-10-01T14:00Z');
  perform set_config('request.jwt.claim.sub',au::text,true);execute 'set local role authenticated';
  r:=public.list_company_worker_rates(c,w);assert r->>'schedule_revision'='0' and r->'rates'='[]','new_schedule_empty';tests:=array_append(tests,'new_schedule_empty');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','rate list empty','kind','rate-list','data',r,'expected',jsonb_build_object('companyId',c,'profileId',w),'financial',true,'input',null));
  assert r->>'company_name'='Synthetic labor history' and r->>'profile_name'='Synthetic worker','rate_read_scoped_identity';tests:=array_append(tests,'rate_read_scoped_identity');
  rate_input:=jsonb_build_object('actor_profile_id',a,'profile_id',w,'effective_from','2026-10-01','amount','200.00','currency','CZK','unit','hour','worker_type','employee','billing_type','hourly','expected_schedule_revision',0,'reason','Agreed October cost','operation_id',op);
  r:=public.set_company_worker_rate(c,rate_input);assert r->>'schedule_revision'='1' and r#>>'{rate,amount}'='200.00','rate_version_created';tests:=array_append(tests,'rate_version_created');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','rate receipt','kind','rate-receipt','data',r,'expected',jsonb_build_object('companyId',c,'profileId',w),'financial',true,'input',rate_input));
  before_r:=r;r:=public.set_company_worker_rate(c,rate_input);assert r=before_r,'rate_retry_same_receipt';tests:=array_append(tests,'rate_retry_same_receipt');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','rate list populated','kind','rate-list','data',public.list_company_worker_rates(c,w),'expected',jsonb_build_object('companyId',c,'profileId',w),'financial',true,'input',null));
  begin perform public.set_company_worker_rate(c,rate_input||'{"amount":"201.00"}');raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_OPERATION_CONFLICT';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;tests:=array_append(tests,'operation_payload_conflict');
  begin perform public.set_company_worker_rate(c,rate_input||jsonb_build_object('operation_id',gen_random_uuid(),'effective_from','2026-11-01'));raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_REVISION_CONFLICT';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;tests:=array_append(tests,'rate_schedule_cas');
  -- A duplicate date with the current CAS must be a domain conflict, with no rate/receipt/event effect.
  begin perform public.set_company_worker_rate(c,rate_input||jsonb_build_object('operation_id',gen_random_uuid(),'expected_schedule_revision',1));raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_EFFECTIVE_DATE_CONFLICT';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;
  execute 'reset role';
  assert (select revision from public.company_worker_rate_schedules where company_id=c and profile_id=w)=1;
  assert (select count(*) from public.company_worker_rate_versions where company_id=c and profile_id=w)=1;
  assert (select count(*) from public.labor_history_events where company_id=c)=1;
  assert (select count(*) from private.labor_operation_receipts where company_id=c)=1;
  execute 'set local role authenticated';tests:=array_append(tests,'rate_effective_date_conflict');
  save_input:=jsonb_build_object('actor_profile_id',a,'profile_id',w,'job_id',job,'expected_revision',0,'operation_id',gen_random_uuid(),
   'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',sh)),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-01','actual_hours','8','pay_hours','8','billed_hours','6')));
  begin perform public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid(),'expected_revision',1));raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_REVISION_CONFLICT';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;
  execute 'reset role';assert not exists(select 1 from public.labor_submissions where company_id=c);assert (select count(*) from private.labor_operation_receipts where company_id=c)=1;execute 'set local role authenticated';tests:=array_append(tests,'new_draft_revision_conflict');
  r:=public.save_labor_submission_draft(c,save_input);sid:=(r->>'id')::uuid;vid:=(r->>'current_version_id')::uuid;original_vid:=vid;
  assert r->>'revision'='1' and r#>>'{versions,0,state}'='draft','save_distinct_hours';assert r#>>'{versions,0,lines,0,billed_hours}'='6.0000','billed_hours_distinct';tests:=tests||array['save_distinct_hours','billed_hours_distinct'];
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','draft receipt','kind','draft','data',r,'expected',jsonb_build_object('companyId',c),'financial',true,'input',save_input));
  before_r:=r;r:=public.save_labor_submission_draft(c,save_input);assert r=before_r,'save_replay';tests:=array_append(tests,'save_replay');
  p:=jsonb_build_object('actor_profile_id',a,'submission_id',sid,'version_id',vid,'expected_revision',1,'operation_id',gen_random_uuid());
  r:=public.submit_labor_submission(c,p);assert r->>'revision'='2' and r#>>'{versions,0,state}'='submitted','submit_transition';tests:=array_append(tests,'submit_transition');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','submit receipt','kind','submit','data',r,'expected',jsonb_build_object('companyId',c),'financial',true,'input',p));
  before_r:=public.get_labor_submission(c,sid);
  begin perform public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',sid,'version_id',gen_random_uuid(),'expected_revision',2,'operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_REVISION_CONFLICT';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;
  assert public.get_labor_submission(c,sid)=before_r;execute 'reset role';assert (select count(*) from private.labor_operation_receipts where company_id=c)=3;assert (select count(*) from public.labor_history_events where company_id=c)=3;execute 'set local role authenticated';tests:=array_append(tests,'wrong_current_version_conflict');
  preview:=public.get_labor_cost_preview(c,sid,vid);assert preview#>>'{cost,amount}'='1600.00','october_preview';tests:=array_append(tests,'october_preview');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','admin complete preview','kind','preview','data',preview,'expected',jsonb_build_object('companyId',c,'submissionId',sid,'versionId',vid),'financial',true,'input',null));
  review_input:=jsonb_build_object('actor_profile_id',a,'submission_id',sid,'version_id',vid,'expected_revision',2,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash');
  r:=public.review_labor_submission(c,review_input);assert r->>'approved_version_id'=vid::text and r->>'revision'='3' and r#>>'{versions,0,cost,amount}'='1600.00','october_approved_snapshot';tests:=array_append(tests,'october_approved_snapshot');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','approve receipt','kind','review','data',r,'expected',jsonb_build_object('companyId',c),'financial',true,'input',review_input));
  before_r:=r;r:=public.review_labor_submission(c,review_input);assert r=before_r,'approval_retry_no_second_cost';tests:=array_append(tests,'approval_retry_no_second_cost');
  begin perform public.review_labor_submission(c,review_input||jsonb_build_object('operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_REVISION_CONFLICT';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;tests:=array_append(tests,'stale_approval_cas');
  execute 'reset role';update public.profiles set default_hourly_rate=999,worker_type='contractor' where id=w;execute 'set local role authenticated';
  r:=public.set_company_worker_rate(c,rate_input||jsonb_build_object('expected_schedule_revision',1,'effective_from','2026-11-01','amount','250.00','operation_id',gen_random_uuid()));
  r:=public.get_labor_submission(c,sid);assert r#>>'{versions,0,cost,amount}'='1600.00' and r#>>'{versions,0,cost,lines,0,worker_type}'='employee','profile_and_future_rate_preserve_snapshot';tests:=array_append(tests,'profile_and_future_rate_preserve_snapshot');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','approved detail snapshot','kind','detail','data',r,'expected',jsonb_build_object('companyId',c,'submissionId',sid),'financial',true,'input',null));
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',sh2)),
    'lines',jsonb_build_array(jsonb_build_object('work_date','2026-11-01','actual_hours','8','pay_hours','8','billed_hours','8'))));sid2:=(r->>'id')::uuid;vid2:=(r->>'current_version_id')::uuid;
  preview:=public.get_labor_cost_preview(c,sid2,vid2);assert preview#>>'{cost,amount}'='2000.00','november_effective_rate';tests:=array_append(tests,'november_effective_rate');
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',sh3)),
    'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-02','actual_hours','8','pay_hours','8','billed_hours','8'))));sid3:=(r->>'id')::uuid;vid3:=(r->>'current_version_id')::uuid;
  preview:=public.get_labor_cost_preview(c,sid3,vid3);assert preview#>>'{cost,amount}'='1600.00','late_october_uses_october_rate';tests:=array_append(tests,'late_october_uses_october_rate');
  -- A correction leaves the original approved fact in force until another review.
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('submission_id',sid,'expected_revision',3,'revision_of',original_vid,'correction_reason','Corrected signed timesheet','operation_id',gen_random_uuid(),
    'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-01','actual_hours','7','pay_hours','7','billed_hours','6'))));vid:=(r->>'current_version_id')::uuid;
  assert r->>'approved_version_id'=original_vid::text and r#>>'{versions,0,cost,amount}'='1600.00','draft_correction_keeps_original';tests:=array_append(tests,'draft_correction_keeps_original');
  r:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',sid,'version_id',vid,'expected_revision',4,'operation_id',gen_random_uuid()));
  p:=jsonb_build_object('actor_profile_id',a,'submission_id',sid,'version_id',vid,'expected_revision',5,'operation_id',gen_random_uuid(),'decision','return','reason','Attach confirmation');r:=public.review_labor_submission(c,p);
  assert r->>'approved_version_id'=original_vid::text and r#>>'{versions,1,state}'='returned','returned_correction_keeps_original';tests:=array_append(tests,'returned_correction_keeps_original');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','return receipt with historical approval','kind','review','data',r,'expected',jsonb_build_object('companyId',c),'financial',true,'input',p));
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('submission_id',sid,'expected_revision',6,'revision_of',vid,'correction_reason','Confirmation attached','operation_id',gen_random_uuid(),
    'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-01','actual_hours','7','pay_hours','7','billed_hours','6'))));vid:=(r->>'current_version_id')::uuid;
  r:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',sid,'version_id',vid,'expected_revision',7,'operation_id',gen_random_uuid()));
  preview:=public.get_labor_cost_preview(c,sid,vid);
  r:=public.review_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',sid,'version_id',vid,'expected_revision',8,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));
  assert r->>'approved_version_id'=vid::text and r#>>'{versions,2,cost,amount}'='1400.00' and r#>>'{versions,0,cost,amount}'='1600.00','revision_replaces_current_cost_preserves_history';tests:=array_append(tests,'revision_replaces_current_cost_preserves_history');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','revision approved detail','kind','detail','data',public.get_labor_submission(c,sid),'expected',jsonb_build_object('companyId',c,'submissionId',sid),'financial',true,'input',null));
  totals:=public.get_job_labor_cost_totals(c,array[job]);assert totals#>>'{items,0,approved_cost}'='1400.00','one_current_approved_pointer';tests:=array_append(tests,'one_current_approved_pointer');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','provisional totals','kind','totals','data',totals,'expected',jsonb_build_object('companyId',c,'jobIds',array[job]),'financial',true,'input',null));
  begin update public.work_shifts set ended_at=ended_at+interval '1 hour' where id=sh;raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_APPROVED_SOURCE_IMMUTABLE';end;tests:=array_append(tests,'approved_source_edit_denied');
  begin delete from public.work_shifts where id=sh;raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_APPROVED_SOURCE_IMMUTABLE';end;tests:=array_append(tests,'approved_source_delete_denied');
  -- Unapproved legacy writes remain compatible, but invalidate a captured draft.
  update public.work_shifts set hours_override=9 where id=sh3;
  begin perform public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',sid3,'version_id',vid3,'expected_revision',1,'operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_SOURCE_CHANGED';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;tests:=array_append(tests,'unapproved_edit_allowed_stale_source_denied');
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('profile_id',unknown_w,'operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',unknown_sh))));unknown_sid:=(r->>'id')::uuid;unknown_vid:=(r->>'current_version_id')::uuid;
  r:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',unknown_sid,'version_id',unknown_vid,'expected_revision',1,'operation_id',gen_random_uuid()));
  preview:=public.get_labor_cost_preview(c,unknown_sid,unknown_vid);assert preview->>'completeness'='incomplete' and preview->'reasons' ? 'missing_rate','legacy_zero_is_unknown';tests:=array_append(tests,'legacy_zero_is_unknown');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','admin missing-rate preview','kind','preview','data',preview,'expected',jsonb_build_object('companyId',c,'submissionId',unknown_sid,'versionId',unknown_vid),'financial',true,'input',null));
  begin perform public.review_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',unknown_sid,'version_id',unknown_vid,'expected_revision',2,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_MISSING_RATE';end;tests:=array_append(tests,'missing_rate_approval_rejected');
  r:=public.get_labor_submission(c,unknown_sid);assert r#>>'{versions,0,state}'='submitted','missing_rate_does_not_approve';tests:=array_append(tests,'missing_rate_does_not_approve');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','partial known and missing totals','kind','totals','data',public.get_job_labor_cost_totals(c,array[job]),'expected',jsonb_build_object('companyId',c,'jobIds',array[job]),'financial',true,'input',null));
  r:=public.set_company_worker_rate(c,rate_input||jsonb_build_object('profile_id',unknown_w,'amount','0.00','operation_id',gen_random_uuid()));
  preview:=public.get_labor_cost_preview(c,unknown_sid,unknown_vid);assert preview->>'completeness'='complete' and preview#>>'{cost,amount}'='0.00','explicit_zero_known';tests:=array_append(tests,'explicit_zero_known');
  r:=public.review_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',unknown_sid,'version_id',unknown_vid,'expected_revision',2,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));
  assert r#>>'{versions,0,cost,amount}'='0.00','explicit_zero_can_approve';tests:=array_append(tests,'explicit_zero_can_approve');
  begin perform public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_SOURCE_CONFLICT';end;tests:=array_append(tests,'source_reuse_denied');
  execute 'reset role';insert into public.work_logs(id,company_id,profile_id,job_id,shift_id,hours) values(log_id,c,w,job,sh,8);execute 'set local role authenticated';
  begin perform public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','log','id',log_id))));raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_SOURCE_CONFLICT';end;tests:=array_append(tests,'shift_log_alias_double_cost_denied');
  begin perform public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid(),'job_id',other_job));raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_JOB_SCOPE';end;tests:=array_append(tests,'cross_tenant_job_denied');
  begin perform public.set_company_worker_rate(c,rate_input||jsonb_build_object('profile_id',foreign_p,'operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_WORKER_SCOPE';end;tests:=array_append(tests,'cross_tenant_worker_denied');
  begin perform public.set_company_worker_rate(c,rate_input||jsonb_build_object('actor_profile_id',m,'operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_ACTOR_CHANGED';end;tests:=array_append(tests,'actor_pin_denied');
  -- Changed effective schedule invalidates a submitted financial preview, without rewriting older approval.
  execute 'reset role';insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,hours_override) values(future_sh,c,w,job,'2026-11-02',8);execute 'set local role authenticated';
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',future_sh)),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-11-02','actual_hours','8','pay_hours','8','billed_hours','8'))));future_sid:=(r->>'id')::uuid;future_vid:=(r->>'current_version_id')::uuid;
  r:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',future_sid,'version_id',future_vid,'expected_revision',1,'operation_id',gen_random_uuid()));
  preview:=public.get_labor_cost_preview(c,future_sid,future_vid);
  r:=public.set_company_worker_rate(c,rate_input||jsonb_build_object('expected_schedule_revision',2,'effective_from','2026-11-02','amount','300.00','operation_id',gen_random_uuid()));
  begin perform public.review_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',future_sid,'version_id',future_vid,'expected_revision',2,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_PREVIEW_CONFLICT';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;tests:=array_append(tests,'stale_cost_preview_rejected');
  r:=public.get_labor_submission(c,future_sid);assert r#>>'{versions,0,state}'='submitted','preview_conflict_no_partial_approval';tests:=array_append(tests,'preview_conflict_no_partial_approval');
  preview:=public.get_labor_cost_preview(c,sid,original_vid);assert preview#>>'{cost,amount}'='1600.00','approved_preview_immutable';tests:=array_append(tests,'approved_preview_immutable');
  execute 'reset role';update public.jobs set currency='EUR' where id=job;execute 'set local role authenticated';
  preview:=public.get_labor_cost_preview(c,future_sid,future_vid);assert preview->'reasons' ? 'currency_mismatch','currency_mismatch_explicit';tests:=array_append(tests,'currency_mismatch_explicit');
  begin perform public.review_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',future_sid,'version_id',future_vid,'expected_revision',2,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_COST_INCOMPLETE';end;tests:=array_append(tests,'currency_mismatch_approval_denied');
  totals:=public.get_job_labor_cost_totals(c,array[job]);assert totals#>'{items,0,total_cost}'='null'::jsonb and totals#>'{items,0,reasons}' ? 'currency_mismatch','mixed_currency_total_not_complete';tests:=array_append(tests,'mixed_currency_total_not_complete');
  assert totals#>>'{items,0,approved_cost}'='0' and totals#>>'{items,0,unconverted_costs,0,currency}'='CZK' and totals#>>'{items,0,unconverted_costs,0,amount}'='1400.00','foreign_currency_never_added_to_local_subtotal';tests:=array_append(tests,'foreign_currency_never_added_to_local_subtotal');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','multi-currency totals','kind','totals','data',totals,'expected',jsonb_build_object('companyId',c,'jobIds',array[job]),'financial',true,'input',null));
  execute 'reset role';update public.jobs set currency='CZK' where id=job;
  insert into public.jobs(id,company_id,title,currency) values(fixed_job,c,'Fixed contractor job','CZK');
  insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,hours_override) values(fixed_sh,c,unknown_w,fixed_job,'2026-11-02',8),(fixed_sh2,c,unknown_w,fixed_job,'2026-11-03',8);execute 'set local role authenticated';
  r:=public.set_company_worker_rate(c,rate_input||jsonb_build_object('profile_id',unknown_w,'expected_schedule_revision',1,'effective_from','2026-11-01','amount','3000.00','unit','fixed','billing_type','fixed','worker_type','contractor','operation_id',gen_random_uuid()));
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('profile_id',unknown_w,'job_id',fixed_job,'operation_id',gen_random_uuid(),
   'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',fixed_sh),jsonb_build_object('kind','shift','id',fixed_sh2)),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-11-02','actual_hours','8','pay_hours','8','billed_hours','8'),jsonb_build_object('work_date','2026-11-03','actual_hours','8','pay_hours','8','billed_hours','8'))));fixed_sid:=(r->>'id')::uuid;fixed_vid:=(r->>'current_version_id')::uuid;
  preview:=public.get_labor_cost_preview(c,fixed_sid,fixed_vid);assert preview#>>'{cost,amount}'='3000.00','fixed_amount_once_per_submission';tests:=array_append(tests,'fixed_amount_once_per_submission');
  r:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',fixed_sid,'version_id',fixed_vid,'expected_revision',1,'operation_id',gen_random_uuid()));
  -- Manager can approve time using a preview hash without receiving internal costs.
  execute 'reset role';perform set_config('request.jwt.claim.sub',mu::text,true);execute 'set local role authenticated';
  preview:=public.get_labor_cost_preview(c,fixed_sid,fixed_vid);
  r:=public.review_labor_submission(c,jsonb_build_object('actor_profile_id',m,'submission_id',fixed_sid,'version_id',fixed_vid,'expected_revision',2,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));
  assert r#>>'{versions,0,state}'='approved' and not(r->'versions'->0 ? 'cost'),'manager_approves_without_rates';tests:=array_append(tests,'manager_approves_without_rates');
  execute 'reset role';perform set_config('request.jwt.claim.sub',au::text,true);execute 'set local role authenticated';
  totals:=public.get_job_labor_cost_totals(c,array[fixed_job]);assert totals#>>'{items,0,total_cost}'='3000.00' and totals#>>'{items,0,approved_external_cost}'='3000.00' and totals#>>'{items,0,completeness}'='complete','fixed_canonical_total_complete';tests:=array_append(tests,'fixed_canonical_total_complete');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','fixed approved totals','kind','totals','data',totals,'expected',jsonb_build_object('companyId',c,'jobIds',array[fixed_job]),'financial',true,'input',null));
  -- Unclaimed historic work is a visible gap even with today's nonzero profile default.
  execute 'reset role';insert into public.work_shifts(company_id,profile_id,job_id,shift_date,hours_override) values(c,w,job,'2026-09-01',1);execute 'set local role authenticated';
  totals:=public.get_job_labor_cost_totals(c,array[job]);assert totals#>'{items,0,reasons}' ? 'legacy_unverified' and totals#>'{items,0,total_cost}'='null'::jsonb,'legacy_work_never_promoted_from_profile';tests:=array_append(tests,'legacy_work_never_promoted_from_profile');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','legacy incomplete totals','kind','totals','data',totals,'expected',jsonb_build_object('companyId',c,'jobIds',array[job]),'financial',true,'input',null));
  execute 'reset role';perform set_config('request.jwt.claim.sub',mu::text,true);execute 'set local role authenticated';
  r:=public.get_labor_submission(c,sid);assert not(r->'versions'->0 ? 'cost'),'manager_detail_no_financial_fields';tests:=array_append(tests,'manager_detail_no_financial_fields');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','manager detail','kind','detail','data',r,'expected',jsonb_build_object('companyId',c,'submissionId',sid),'financial',false,'input',null));
  preview:=public.get_labor_cost_preview(c,sid2,vid2);assert not(preview ? 'cost') and preview->>'preview_hash' is not null,'manager_preview_redacted';tests:=array_append(tests,'manager_preview_redacted');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','manager preview','kind','preview','data',preview,'expected',jsonb_build_object('companyId',c,'submissionId',sid2,'versionId',vid2),'financial',false,'input',null));
  begin perform public.list_company_worker_rates(c,w);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'manager_rate_read_denied');
  begin perform public.set_company_worker_rate(c,rate_input||jsonb_build_object('actor_profile_id',m,'operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'manager_rate_write_denied');
  execute 'reset role';perform set_config('request.jwt.claim.sub',wu::text,true);execute 'set local role authenticated';
  r:=public.get_labor_submission(c,sid);assert not(r->'versions'->0 ? 'cost'),'worker_own_time_no_financial_fields';tests:=array_append(tests,'worker_own_time_no_financial_fields');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','worker detail','kind','detail','data',r,'expected',jsonb_build_object('companyId',c,'submissionId',sid),'financial',false,'input',null));
  begin perform public.get_labor_submission(c,unknown_sid);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'worker_other_time_denied');
  begin perform public.review_labor_submission(c,jsonb_build_object('actor_profile_id',w,'submission_id',sid2,'version_id',vid2,'expected_revision',1,'operation_id',gen_random_uuid(),'decision','approve'));raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'worker_review_denied');
  begin perform 1 from public.labor_cost_snapshots;raise exception 'unexpected_success';exception when insufficient_privilege then null;end;tests:=array_append(tests,'direct_financial_table_denied');
  execute 'reset role';perform set_config('request.jwt.claim.sub',au::text,true);execute 'set local role authenticated';
  begin perform public.save_labor_submission_draft(c,(save_input-'sources')||jsonb_build_object('operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when invalid_parameter_value then assert sqlerrm='LABOR_INVALID';end;tests:=array_append(tests,'raw_missing_sources_denied');
  begin perform public.save_labor_submission_draft(c,(save_input-'lines')||jsonb_build_object('operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when invalid_parameter_value then assert sqlerrm='LABOR_INVALID';end;tests:=array_append(tests,'raw_missing_lines_denied');
  begin perform public.save_labor_submission_draft(c,save_input||jsonb_build_object('submission_id',sid3,'expected_revision',1,'operation_id',gen_random_uuid(),
   'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',sh3)),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-02','started_at','2026-10-02T06:00Z','actual_hours','8','pay_hours','8','billed_hours','8'))));raise exception 'unexpected_success';exception when invalid_parameter_value then assert sqlerrm='LABOR_INVALID';end;tests:=array_append(tests,'raw_unpaired_timestamps_denied');
  -- A correction reason cannot be removed by a subsequent update of its draft.
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('submission_id',sid,'expected_revision',9,'revision_of',vid,'correction_reason','Review additional evidence','operation_id',gen_random_uuid()));
  begin perform public.save_labor_submission_draft(c,save_input||jsonb_build_object('submission_id',sid,'expected_revision',10,'revision_of',vid,'operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when invalid_parameter_value then assert sqlerrm='LABOR_CORRECTION_REASON_REQUIRED';end;tests:=array_append(tests,'correction_reason_cannot_be_removed');
  -- A previous administrator receipt is not a permanent entitlement to another worker's time.
  execute 'reset role';update public.company_members set role='worker' where company_id=c and profile_id=a;execute 'set local role authenticated';
  begin perform public.save_labor_submission_draft(c,save_input);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'receipt_replay_rechecks_time_scope');
  begin perform public.set_company_worker_rate(c,rate_input);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'receipt_replay_rechecks_finance_role');
  execute 'reset role';update public.company_members set role='company_admin' where company_id=c and profile_id=a;
  insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,started_at,ended_at) values(dst_sh,c,w,job,'2026-10-25','2026-10-24T22:00Z','2026-10-25T23:00Z');execute 'set local role authenticated';
  p:=save_input||jsonb_build_object('operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',dst_sh)),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-25','started_at','2026-10-24T22:00Z','ended_at','2026-10-25T23:00Z','actual_hours','25','pay_hours','25','billed_hours','20')));
  r:=public.save_labor_submission_draft(c,p);dst_sid:=(r->>'id')::uuid;dst_vid:=(r->>'current_version_id')::uuid;
  preview:=public.get_labor_cost_preview(c,dst_sid,dst_vid);assert preview#>>'{cost,amount}'='5000.00' and r#>>'{versions,0,lines,0,actual_hours}'='25.0000','dst_25_hour_day_supported';tests:=array_append(tests,'dst_25_hour_day_supported');
  begin perform public.save_labor_submission_draft(c,p||jsonb_build_object('submission_id',dst_sid,'expected_revision',1,'operation_id',gen_random_uuid(),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-24','actual_hours','25','pay_hours','25','billed_hours','20'))));raise exception 'unexpected_success';exception when invalid_parameter_value then assert sqlerrm='LABOR_DATE_HOURS_MISMATCH';end;tests:=array_append(tests,'ordinary_day_cannot_claim_25_actual_hours');
  begin perform public.save_labor_submission_draft(c,p||jsonb_build_object('submission_id',dst_sid,'expected_revision',1,'operation_id',gen_random_uuid(),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-03-29','actual_hours','24','pay_hours','24','billed_hours','20'))));raise exception 'unexpected_success';exception when invalid_parameter_value then assert sqlerrm='LABOR_DATE_HOURS_MISMATCH';end;tests:=array_append(tests,'spring_day_bounds_23_actual_hours');
  -- A second fixed submission for the same worker/job must revise the first, not charge twice.
  execute 'reset role';insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,hours_override) values(extra_fixed_sh,c,unknown_w,fixed_job,'2026-11-04',8);execute 'set local role authenticated';
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('profile_id',unknown_w,'job_id',fixed_job,'operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',extra_fixed_sh)),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-11-04','actual_hours','8','pay_hours','8','billed_hours','8'))));extra_fixed_sid:=(r->>'id')::uuid;extra_fixed_vid:=(r->>'current_version_id')::uuid;
  r:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',extra_fixed_sid,'version_id',extra_fixed_vid,'expected_revision',1,'operation_id',gen_random_uuid()));
  preview:=public.get_labor_cost_preview(c,extra_fixed_sid,extra_fixed_vid);
  begin perform public.review_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',extra_fixed_sid,'version_id',extra_fixed_vid,'expected_revision',2,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_FIXED_SOURCE_CONFLICT';end;tests:=array_append(tests,'fixed_cost_cannot_repeat_across_submissions');
  execute 'reset role';insert into public.work_logs(company_id,profile_id,job_id,hours,work_date) values(c,unknown_w,fixed_job,2,'2026-11-05');execute 'set local role authenticated';
  totals:=public.get_job_labor_cost_totals(c,array[fixed_job]);assert (totals#>>'{items,0,legacy_unverified_count}')::integer=1 and totals#>>'{items,0,completeness}'='incomplete','unrelated_log_not_hidden_by_claimed_shift';tests:=array_append(tests,'unrelated_log_not_hidden_by_claimed_shift');
  execute 'reset role';insert into public.job_assignments(id,company_id,profile_id,job_id,labor_hours) values(assignment,c,unknown_w,fixed_job,4);execute 'set local role authenticated';
  totals:=public.get_job_labor_cost_totals(c,array[fixed_job]);assert (totals#>>'{items,0,legacy_unverified_count}')::integer=2,'unproven_assignment_aggregate_not_hidden';tests:=array_append(tests,'unproven_assignment_aggregate_not_hidden');
  execute 'reset role';
  -- A log alias captures and protects its linked source shift; it is not a second cost source.
  execute 'reset role';
  insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,hours_override) values(alias_sh,c,w,job,'2026-10-05',8),(bad_hours_sh,c,w,job,'2026-10-06',30),(negative_hours_sh,c,w,job,'2026-10-07',-1);
  insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,started_at) values(running_sh,c,w,job,'2026-10-08','2026-10-08T06:00Z');
  insert into public.work_logs(id,company_id,profile_id,job_id,shift_id,hours,work_date) values(alias_log,c,w,job,alias_sh,8,'2026-10-05'),(bad_link_log,c,w,job,unknown_sh,8,'2026-10-05');
  execute 'set local role authenticated';
  begin perform public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','log','id',bad_link_log))));raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_SOURCE_SCOPE';end;tests:=array_append(tests,'log_linked_shift_scope_checked');
  r:=public.save_labor_submission_draft(c,save_input||jsonb_build_object('operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','log','id',alias_log)),
   'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-05','actual_hours','8','pay_hours','8','billed_hours','8'))));alias_sid:=(r->>'id')::uuid;alias_vid:=(r->>'current_version_id')::uuid;
  update public.work_shifts set hours_override=7 where id=alias_sh;
  begin perform public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',alias_sid,'version_id',alias_vid,'expected_revision',1,'operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when sqlstate 'PT409' then assert sqlerrm='LABOR_SOURCE_CHANGED';domain_conflicts:=domain_conflicts||jsonb_build_array(jsonb_build_object('code',sqlstate,'message',sqlerrm));end;tests:=array_append(tests,'log_alias_detects_linked_shift_change');
  update public.work_shifts set hours_override=8 where id=alias_sh;
  r:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',alias_sid,'version_id',alias_vid,'expected_revision',1,'operation_id',gen_random_uuid()));
  preview:=public.get_labor_cost_preview(c,alias_sid,alias_vid);
  r:=public.review_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',alias_sid,'version_id',alias_vid,'expected_revision',2,'operation_id',gen_random_uuid(),'decision','approve','expected_cost_preview_hash',preview->>'preview_hash'));
  begin update public.work_shifts set hours_override=7 where id=alias_sh;raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_APPROVED_SOURCE_IMMUTABLE';end;tests:=array_append(tests,'approved_log_alias_protects_linked_shift');
  begin delete from public.work_shifts where id=alias_sh;raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_APPROVED_SOURCE_IMMUTABLE';end;tests:=array_append(tests,'approved_log_alias_protects_linked_shift_delete');
  r:=public.list_labor_source_options(c);
  assert r->>'company_id'=c::text and r->>'company_name'='Synthetic labor history' and exists(select 1 from jsonb_array_elements(r->'items') x where x->>'id'=alias_sh::text and x->>'submission_id'=alias_sid::text) and exists(select 1 from jsonb_array_elements(r->'items') x where x->>'id'=alias_log::text and x->>'submission_id'=alias_sid::text),'picker_alias_claims_stable';tests:=array_append(tests,'picker_alias_claims_stable');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','admin source picker','kind','picker','data',r,'expected',jsonb_build_object('companyId',c),'financial',true,'input',null));
  assert not exists(select 1 from jsonb_array_elements(r->'items') x where x ? 'hourly_rate' or x ? 'cost' or x ? 'rate' or x ? 'amount'),'picker_time_only';tests:=array_append(tests,'picker_time_only');
  assert (select count(*) from jsonb_array_elements(r->'items') x where x->>'id' in(bad_hours_sh::text,negative_hours_sh::text,assignment::text) and x->'actual_hours'='null'::jsonb)=3,'picker_unknown_hours_are_null';tests:=array_append(tests,'picker_unknown_hours_are_null');
  assert not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'id'=running_sh::text),'picker_excludes_running_source';tests:=array_append(tests,'picker_excludes_running_source');
  assert exists(select 1 from jsonb_array_elements(r->'items') x where x->>'id'=sh::text and (x->>'actual_hours')::numeric=8 and x->>'profile_name'='Synthetic worker' and x->>'job_title'='Labor job'),'picker_scoped_labels_and_actual_elapsed';tests:=array_append(tests,'picker_scoped_labels_and_actual_elapsed');
  execute 'reset role';perform set_config('request.jwt.claim.sub',wu::text,true);execute 'set local role authenticated';
  r:=public.list_labor_source_options(c);assert jsonb_array_length(r->'items')>0 and not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'profile_id'<>w::text),'picker_worker_own_only';tests:=array_append(tests,'picker_worker_own_only');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','worker source picker','kind','picker','data',r,'expected',jsonb_build_object('companyId',c,'profileId',w),'financial',false,'input',null));
  begin perform public.list_labor_source_options(c,unknown_w);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'picker_worker_other_denied');
  execute 'reset role';perform set_config('request.jwt.claim.sub',mu::text,true);execute 'set local role authenticated';
  r:=public.list_labor_source_options(c,unknown_w);assert jsonb_array_length(r->'items')>0 and not exists(select 1 from jsonb_array_elements(r->'items') x where x->>'profile_id'<>unknown_w::text),'picker_manager_company_time_scope';tests:=array_append(tests,'picker_manager_company_time_scope');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','manager source picker','kind','picker','data',r,'expected',jsonb_build_object('companyId',c,'profileId',unknown_w),'financial',false,'input',null));
  begin perform public.list_labor_source_options(c,foreign_p);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_WORKER_SCOPE';end;tests:=array_append(tests,'picker_cross_company_worker_denied');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','manager submission list','kind','list','data',public.list_labor_submissions(c,null,null),'expected',jsonb_build_object('companyId',c),'financial',false,'input',null));
  execute 'reset role';perform set_config('request.jwt.claim.sub',au::text,true);execute 'set local role authenticated';
  begin
   execute 'reset role';insert into public.work_shifts(company_id,profile_id,job_id,shift_date,hours_override) select c,w,job,'2026-10-10'::date,1 from generate_series(1,2001);execute 'set local role authenticated';
   perform public.list_labor_source_options(c,w);raise exception 'unexpected_success';
  exception when program_limit_exceeded then assert sqlerrm='LABOR_SOURCE_OPTIONS_LIMIT';end;tests:=array_append(tests,'picker_overflow_fails_without_silent_truncation');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','admin submission list','kind','list','data',public.list_labor_submissions(c,null,null),'expected',jsonb_build_object('companyId',c),'financial',true,'input',null));
  execute 'reset role';
  -- Running work and fixed legacy amounts are evidence of an incomplete cost,
  -- even if there is no positive hours field. They are never silently priced at zero.
  execute 'reset role';insert into public.jobs(id,company_id,title,currency) values(edge_job,c,'Unverified legacy work','CZK');
  insert into public.work_shifts(company_id,profile_id,job_id,shift_date,started_at) values(c,unknown_w,edge_job,'2026-10-08','2026-10-08T06:00Z');execute 'set local role authenticated';
  totals:=public.get_job_labor_cost_totals(c,array[edge_job]);assert totals#>>'{items,0,legacy_unverified_count}'='1' and totals#>>'{items,0,completeness}'='incomplete' and totals#>'{items,0,total_cost}'='null'::jsonb,'running_shift_cost_incomplete';tests:=array_append(tests,'running_shift_cost_incomplete');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','running work incomplete totals','kind','totals','data',totals,'expected',jsonb_build_object('companyId',c,'jobIds',array[edge_job]),'financial',true,'input',null));
  execute 'reset role';insert into public.work_logs(company_id,profile_id,job_id,work_date,started_at) values(c,w,edge_job,'2026-10-08','2026-10-08T07:00Z');execute 'set local role authenticated';
  totals:=public.get_job_labor_cost_totals(c,array[edge_job]);assert totals#>>'{items,0,legacy_unverified_count}'='2' and totals#>'{items,0,total_cost}'='null'::jsonb,'running_log_cost_incomplete';tests:=array_append(tests,'running_log_cost_incomplete');
  execute 'reset role';insert into public.job_assignments(company_id,profile_id,job_id,labor_hours,labor_cost) values(c,w,edge_job,0,900);execute 'set local role authenticated';
  totals:=public.get_job_labor_cost_totals(c,array[edge_job]);assert totals#>>'{items,0,legacy_unverified_count}'='3' and totals#>'{items,0,total_cost}'='null'::jsonb,'legacy_fixed_cost_without_hours_incomplete';tests:=array_append(tests,'legacy_fixed_cost_without_hours_incomplete');
  execute 'reset role';insert into public.job_assignments(company_id,profile_id,job_id,labor_hours,external_amount) values(c,unknown_w,edge_job,0,700);execute 'set local role authenticated';
  totals:=public.get_job_labor_cost_totals(c,array[edge_job]);assert totals#>>'{items,0,legacy_unverified_count}'='4' and totals#>>'{items,0,approved_cost}'='0' and totals#>'{items,0,total_cost}'='null'::jsonb,'legacy_external_amount_without_hours_incomplete';tests:=array_append(tests,'legacy_external_amount_without_hours_incomplete');
  contracts:=contracts||jsonb_build_array(jsonb_build_object('name','legacy fixed incomplete totals','kind','totals','data',totals,'expected',jsonb_build_object('companyId',c,'jobIds',array[edge_job]),'financial',true,'input',null));
  -- Unknown membership roles cannot acquire member RPC rights. Production currently
  -- has role NOT NULL but no CHECK list; the NULL branch also guards older nullable schemas.
  execute 'reset role';
  insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,hours_override) values(unauthorized_role_sh,c,a,job,'2026-10-09',1);
  update public.company_members set role='observer' where company_id=c and profile_id=a;
  execute 'set local role authenticated';
  begin perform public.list_labor_submissions(c,a,null);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'unknown_membership_role_read_denied');
  begin perform public.save_labor_submission_draft(c,save_input||jsonb_build_object('profile_id',a,'operation_id',gen_random_uuid(),'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',unauthorized_role_sh))));raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'unknown_membership_role_own_write_denied');
  execute 'reset role';
  if not(select attnotnull from pg_attribute where attrelid='public.company_members'::regclass and attname='role') then
   update public.company_members set role=null where company_id=c and profile_id=a;execute 'set local role authenticated';
   begin perform public.list_labor_source_options(c,a);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;
   tests:=array_append(tests,'null_membership_role_read_denied');execute 'reset role';
  else
   begin update public.company_members set role=null where company_id=c and profile_id=a;raise exception 'unexpected_success';exception when not_null_violation then null;end;
   tests:=array_append(tests,'null_membership_role_constraint_denied');
  end if;
  update public.company_members set role='company_admin' where company_id=c and profile_id=a;
  assert (select count(*) from pg_class x join pg_namespace ns on ns.oid=x.relnamespace where ns.nspname='public' and x.relname in ('company_worker_rate_schedules','company_worker_rate_versions','labor_submissions','labor_submission_versions','labor_submission_lines','labor_submission_sources','labor_cost_snapshots','labor_history_events') and x.relrowsecurity)=8,'all_new_public_tables_rls';tests:=array_append(tests,'all_new_public_tables_rls');
  execute 'set local role authenticated';
  execute 'reset role';perform set_config('request.jwt.claim.sub',fu::text,true);execute 'set local role authenticated';
  begin perform public.get_labor_submission(c,sid);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'foreign_actor_denied');
  begin perform public.list_labor_source_options(c);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'picker_foreign_actor_denied');
  execute 'reset role';perform set_config('request.jwt.claim.sub','',true);execute 'set local role anon';
  begin perform public.get_labor_submission(c,sid);raise exception 'unexpected_success';exception when insufficient_privilege then null;end;tests:=array_append(tests,'anon_rpc_denied');
  begin perform public.list_labor_source_options(c);raise exception 'unexpected_success';exception when insufficient_privilege then null;end;tests:=array_append(tests,'picker_anon_denied');
  execute 'reset role';perform set_config('request.jwt.claim.sub',au::text,true);
  insert into private.company_module_rollouts(company_id,product,livemode) values(c,'diriqo_core',false);
  execute 'set local role authenticated';
  begin perform public.set_company_worker_rate(c,rate_input||jsonb_build_object('expected_schedule_revision',2,'effective_from','2026-12-01','operation_id',gen_random_uuid()));raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_MODULE_REQUIRED';end;tests:=array_append(tests,'disabled_capability_denies_new_rate');
  r:=public.get_labor_submission(c,sid);assert r#>>'{versions,0,cost,amount}'='1600.00','history_read_survives_license_loss';tests:=array_append(tests,'history_read_survives_license_loss');
  execute 'reset role';update public.company_members set is_active=false where company_id=c and profile_id=a;execute 'set local role authenticated';
  begin perform public.get_labor_submission(c,sid);raise exception 'unexpected_success';exception when insufficient_privilege then assert sqlerrm='LABOR_FORBIDDEN';end;tests:=array_append(tests,'revoked_membership_denied');
  execute 'reset role';
  begin update public.labor_cost_snapshots set cost_amount=999 where version_id=original_vid;raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_IMMUTABLE_HISTORY';end;tests:=array_append(tests,'snapshot_immutable_even_owner');
  begin update public.labor_submission_versions set state='draft' where id=original_vid;raise exception 'unexpected_success';exception when check_violation then assert sqlerrm='LABOR_IMMUTABLE_HISTORY';end;tests:=array_append(tests,'approved_version_immutable');
  raise exception '%',marker;
 exception when raise_exception then if sqlerrm<>marker then raise;end if;
 end;
 assert not exists(select 1 from public.companies where id in(c,other_c)),'cleanup_companies';
 assert not exists(select 1 from auth.users where id in(au,wu,mu,fu)),'cleanup_auth';
 assert not exists(select 1 from public.labor_submissions where company_id=c),'cleanup_submissions';
 assert not exists(select 1 from public.company_worker_rate_versions where company_id=c),'cleanup_rates';
 assert not exists(select 1 from private.labor_operation_receipts where company_id=c),'cleanup_receipts';
 perform set_config('diriqo.test_labor_history',jsonb_build_object('fixtures','rolled_back','count',cardinality(tests),'checks',tests,'cleanup_assertions',5,'contracts',contracts,'domain_conflicts',domain_conflicts)::text,false);
end $test$;
select current_setting('diriqo.test_labor_history')::jsonb result;
