-- Diriqo TEST only. Every synthetic row (including grants) is rolled back.
-- This file proves sequential database role/transaction behavior; concurrency has a separate harness.
do $test$
declare
  u uuid := gen_random_uuid(); other_u uuid := gen_random_uuid();
  p uuid := gen_random_uuid(); other_p uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  j1 uuid := gen_random_uuid(); j2 uuid := gen_random_uuid(); jb uuid := gen_random_uuid();
  aj uuid := gen_random_uuid(); grant_id uuid := gen_random_uuid();
  shift_id uuid; b_shift uuid; ended timestamptz; finished timestamptz;
  result jsonb; message text; passes text[] := '{}';
begin
  begin
    assert not has_function_privilege('anon','public.mutate_my_job_work(uuid,text,uuid,uuid)','EXECUTE'), 'anon_denied';
    assert not has_function_privilege('service_role','public.mutate_my_job_work(uuid,text,uuid,uuid)','EXECUTE'), 'service_role_denied';
    passes := passes || array['anon_denied','service_role_denied'];
    insert into auth.users(id,email,raw_user_meta_data) values
      (u,'atomic-work-'||u||'@example.invalid','{}'),(other_u,'atomic-work-'||other_u||'@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p,u,u,'Synthetic atomic worker'),(other_p,other_u,other_u,'Synthetic other worker');
    insert into public.companies(id,name,timezone) values
      (a,'Synthetic atomic work A','Pacific/Kiritimati'),(b,'Synthetic atomic work B','Europe/Prague');
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (a,p,'worker',true),(b,p,'manager',true),(b,other_p,'worker',true);
    insert into public.jobs(id,company_id,title,status) values
      (j1,a,'Synthetic A one','planned'),(j2,a,'Synthetic A two','planned'),(jb,b,'Synthetic B','planned');
    insert into public.job_assignments(id,company_id,job_id,profile_id) values
      (aj,a,j1,p),(gen_random_uuid(),a,j2,p),(gen_random_uuid(),b,jb,p);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u::text,true);
    execute 'set local role authenticated';

    message := null;
    begin perform public.mutate_my_job_work(a,'start',jb);
    exception when others then message := sqlerrm; end;
    assert message = 'WORK_JOB_NOT_ASSIGNED', 'foreign_job_denied';
    passes := passes || 'foreign_job_denied'::text;
    result := public.mutate_my_job_work(a,'start',j1);
    shift_id := (result->>'shift_id')::uuid;
    assert not (result->>'reused')::boolean and result->>'job_id'=j1::text, 'start_created';
    assert (select count(*)=1 from public.work_shifts where company_id=a and profile_id=p and ended_at is null), 'one_timer';
    assert (select status='in_progress' and work_started_at is not null from public.job_assignments where id=aj), 'assignment_started_atomically';
    assert (select shift_date=(started_at at time zone 'Pacific/Kiritimati')::date from public.work_shifts where id=shift_id), 'company_local_date';
    passes := passes || array['start_created','one_timer','assignment_started_atomically','company_local_date'];

    result := public.mutate_my_job_work(a,'start',j1);
    assert (result->>'reused')::boolean and (result->>'shift_id')::uuid=shift_id, 'start_retry_same_id';
    passes := passes || 'start_retry_same_id'::text;
    message := null;
    begin perform public.mutate_my_job_work(a,'start',j2);
    exception when others then message := sqlerrm; end;
    assert message = 'WORK_ANOTHER_SHIFT_RUNNING', 'different_job_timer_denied';
    passes := passes || 'different_job_timer_denied'::text;
    message := null;
    begin perform public.mutate_my_job_work(a,'complete',j1);
    exception when others then message := sqlerrm; end;
    assert message = 'WORK_SHIFT_STILL_RUNNING', 'complete_running_denied';
    passes := passes || 'complete_running_denied'::text;
    message := null;
    begin perform public.mutate_my_job_work(b,'stop',null,shift_id);
    exception when others then message := sqlerrm; end;
    assert message = 'WORK_SHIFT_NOT_FOUND', 'cross_company_stop_denied';
    passes := passes || 'cross_company_stop_denied'::text;

    result := public.mutate_my_job_work(a,'stop',null,shift_id);
    assert not (result->>'reused')::boolean, 'stop_created';
    select ended_at into ended from public.work_shifts where id=shift_id;
    result := public.mutate_my_job_work(a,'stop',null,shift_id);
    assert (result->>'reused')::boolean and (select ended_at=ended from public.work_shifts where id=shift_id), 'stop_retry_preserves_time';
    result := public.mutate_my_job_work(a,'complete',j1);
    assert not (result->>'reused')::boolean and (select status='waiting_check' from public.jobs where id=j1), 'complete_job_atomically';
    select completed_at into finished from public.job_assignments where id=aj;
    result := public.mutate_my_job_work(a,'complete',j1);
    assert (result->>'reused')::boolean and (select completed_at=finished from public.job_assignments where id=aj), 'complete_retry_preserves_time';
    passes := passes || array['stop_created','stop_retry_preserves_time','complete_job_atomically','complete_retry_preserves_time'];
    message := null;
    begin perform public.mutate_my_job_work(a,'start',j1);
    exception when others then message := sqlerrm; end;
    assert message = 'WORK_ALREADY_COMPLETED', 'completed_restart_denied';
    passes := passes || 'completed_restart_denied'::text;

    result := public.mutate_my_job_work(b,'start',jb);
    b_shift := (result->>'shift_id')::uuid;
    assert exists(select 1 from public.work_shifts where id=b_shift and company_id=b and profile_id=p)
      and (select count(*)=1 from public.work_shifts where company_id=a), 'roles_and_timers_company_scoped';
    passes := passes || 'roles_and_timers_company_scoped'::text;
    execute 'reset role';
    update public.company_members set is_active=false where company_id=b and profile_id=p;
    execute 'set local role authenticated';
    message := null;
    begin perform public.mutate_my_job_work(b,'stop',null,b_shift);
    exception when others then message := sqlerrm; end;
    assert message='WORK_FORBIDDEN', 'membership_revocation_denies_stale_identity';
    passes := passes || 'membership_revocation_denies_stale_identity'::text;
    execute 'reset role';
    update public.company_members set is_active=true where company_id=b and profile_id=p;
    insert into private.company_module_rollouts(company_id,product,livemode) values(a,'diriqo_core',false),(b,'diriqo_core',false);
    execute 'set local role authenticated';
    message := null;
    begin perform public.mutate_my_job_work(a,'start',j2);
    exception when others then message := sqlerrm; end;
    assert message='WORK_MODULE_REQUIRED', 'unpaid_start_denied';
    result := public.mutate_my_job_work(b,'stop',null,b_shift);
    assert not (result->>'reused')::boolean, 'stop_survives_license_loss';
    passes := passes || array['unpaid_start_denied','stop_survives_license_loss'];

    execute 'reset role';
    insert into private.company_test_module_grants(id,company_id,product,source_ref,reason,
      valid_from,valid_until,history_until,capabilities)
    values(grant_id,a,'diriqo_core','atomic-work-'||a,'Synthetic transaction test',
      clock_timestamp()-interval '1 hour',now()+interval '1 hour',now()+interval '1 hour',
      array['core.time.record','core.jobs.update']);
    insert into public.company_modules(company_id,module_key,is_enabled) values(a,'shifts',false);
    execute 'set local role authenticated';
    message := null;
    begin perform public.mutate_my_job_work(a,'start',j2);
    exception when others then message := sqlerrm; end;
    assert message='WORK_MODULE_DISABLED', 'disabled_module_denied';
    passes := passes || 'disabled_module_denied'::text;
    execute 'reset role';
    update public.company_modules set is_enabled=true where company_id=a and module_key='shifts';
    execute 'set local role authenticated';
    result := public.mutate_my_job_work(a,'start',j2);
    shift_id := (result->>'shift_id')::uuid;
    assert not (result->>'reused')::boolean, 'test_grant_allows_work';
    passes := passes || 'test_grant_allows_work'::text;

    execute 'reset role';
    message := null;
    begin insert into public.work_shifts(company_id,profile_id,job_id,started_at,status)
      values(a,p,j2,clock_timestamp(),'running');
    exception when unique_violation then message := 'duplicate_rejected'; end;
    assert message='duplicate_rejected', 'index_covers_privileged_writers';
    insert into public.work_shifts(company_id,profile_id,job_id,status) values(a,p,j2,'planned');
    assert (select count(*)=1 from public.work_shifts where company_id=a and profile_id=p and started_at is not null and ended_at is null),
      'planned_entry_is_not_timer';
    update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Synthetic revoke' where id=grant_id;
    update public.job_assignments set archived_at=clock_timestamp() where company_id=a and job_id=j2 and profile_id=p;
    execute 'set local role authenticated';
    message := null;
    begin perform public.mutate_my_job_work(a,'start',j2);
    exception when others then message := sqlerrm; end;
    assert message='WORK_MODULE_REQUIRED', 'revoked_grant_denied';
    result := public.mutate_my_job_work(a,'stop',null,shift_id);
    assert not (result->>'reused')::boolean, 'stop_after_revocation_and_unassignment';
    passes := passes || array['index_covers_privileged_writers','planned_entry_is_not_timer','revoked_grant_denied','stop_after_revocation_and_unassignment'];

    -- A different identity cannot stop another worker's row, even in its own company.
    perform set_config('request.jwt.claims',jsonb_build_object('sub',other_u,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',other_u::text,true);
    message := null;
    begin perform public.mutate_my_job_work(b,'stop',null,b_shift);
    exception when others then message := sqlerrm; end;
    assert message='WORK_SHIFT_NOT_FOUND', 'other_worker_stop_denied';
    passes := passes || 'other_worker_stop_denied'::text;
    execute 'reset role';
    raise exception 'rollback atomic work fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from public.companies where id in (a,b)), 'company_cleanup';
  assert not exists(select 1 from auth.users where id in (u,other_u)), 'auth_cleanup';
  assert not exists(select 1 from public.work_shifts where company_id in (a,b)), 'shift_cleanup';
  perform set_config('diriqo.atomic_work_result',jsonb_build_object('passed',passes,'count',cardinality(passes),
    'fixtures','rolled_back','cleanup_assertions',3,'concurrency','separate_harness')::text,true);
end;
$test$;
select current_setting('diriqo.atomic_work_result')::jsonb as result;
