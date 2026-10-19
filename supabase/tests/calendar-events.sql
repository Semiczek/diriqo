-- Rollback-only contract suite. It needs owner privileges in an isolated test DB.
-- This is NOT proof of overlapping HTTP sessions or the deployed Supabase schema.
do $test$
declare
  ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid();
  uw uuid:=gen_random_uuid(); um uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
  pw uuid:=gen_random_uuid(); pm uuid:=gen_random_uuid(); px uuid:=gen_random_uuid();
  ja uuid:=gen_random_uuid(); jb uuid:=gen_random_uuid(); ev uuid; retained uuid; legacy uuid; grant_id uuid:=gen_random_uuid();
  input jsonb; changed jsonb; result jsonb; snapshot jsonb; before_state jsonb; after_state jsonb;
  problem text; code text; c record; actor uuid; sql text; passed jsonb:='[]';
  rev bigint; prior_rev bigint; legacy_rev bigint; marker text:='CalendarTest'||replace(gen_random_uuid()::text,'-','');
  state_sql constant text:=$q$select jsonb_build_object(
    'events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.calendar_events e where company_id=$1),
    'assignments',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.calendar_event_assignments a where company_id=$1))$q$;
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (ua,marker||'a@example.invalid','{}'),(ub,marker||'b@example.invalid','{}'),
      (uw,marker||'w@example.invalid','{}'),(um,marker||'m@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values
      (pa,ua,ua,'Synthetic calendar admin',true),(pb,ub,ub,'Synthetic foreign admin',true),
      (pw,uw,uw,'Synthetic calendar worker',true),(pm,um,um,'Synthetic calendar manager',true),
      (px,null,null,'Synthetic inactive worker',false);
    insert into public.companies(id,name) values(ca,'Synthetic calendar A'),(cb,'Synthetic calendar B');
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (ca,pa,'company_admin',true),(ca,pw,'worker',true),(ca,pm,'manager',true),
      (ca,px,'worker',true),(cb,pb,'company_admin',true);
    insert into public.jobs(id,company_id,title) values(ja,ca,'Synthetic calendar job'),(jb,cb,'Foreign job');
    insert into public.company_modules(company_id,module_key,is_enabled) values(ca,'calendar',true);
    input:=jsonb_build_object('title','Initial event','description',null,
      'start_at','2026-11-01T10:00:00Z','end_at','2026-11-01T11:00:00Z','job_id',ja,'assigned_profile_ids',jsonb_build_array(pw));
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',ua::text,true);
    execute 'set local role authenticated';
    result:=public.create_calendar_event_atomic(ca,input); ev:=(result->'event'->>'id')::uuid; rev:=(result->'event'->>'revision')::bigint;
    assert (result->'event'->>'revision')::bigint>=0 and jsonb_typeof(result->'event'->'revision')='string'
      and result->'assigned_profile_ids'=jsonb_build_array(pw),'create_header_and_assignments_with_string_revision';
    snapshot:=public.get_calendar_event_snapshot(ca,ev);
    assert snapshot=result,'snapshot_consistent_with_write';
    execute 'reset role';
    select id into retained from public.calendar_event_assignments where event_id=ev and profile_id=pw;
    assert exists(select 1 from public.calendar_events where id=ev and start_at=starts_at and end_at=ends_at)
      and exists(select 1 from public.calendar_event_assignments where id=retained and event_id=calendar_event_id and company_id=ca),'all_new_aliases_consistent';
    passed:=passed||jsonb_build_array('create_header_and_assignments_with_string_revision','snapshot_consistent_with_write','all_new_aliases_consistent');

    execute 'set local role authenticated';
    result:=public.update_calendar_event_atomic(ca,ev,rev,input);
    assert result=snapshot,'noop_preserves_revision_and_snapshot';
    changed:=input||jsonb_build_object('title','Moved event','start_at','2026-11-01T12:00:00Z',
      'end_at','2026-11-01T13:00:00Z','assigned_profile_ids',jsonb_build_array(pw,pm));
    result:=public.update_calendar_event_atomic(ca,ev,rev,changed);
    assert (result->'event'->>'revision')::bigint>rev and jsonb_array_length(result->'assigned_profile_ids')=2
      and result->'event'->>'title'='Moved event','update_complete_header_and_set';
    rev:=(result->'event'->>'revision')::bigint;
    execute 'reset role';
    assert exists(select 1 from public.calendar_event_assignments where id=retained and event_id=ev and profile_id=pw),'retained_assignment_identity_preserved';
    passed:=passed||jsonb_build_array('noop_preserves_revision_and_snapshot','update_complete_header_and_set','retained_assignment_identity_preserved');
    execute state_sql into before_state using ca;
    execute 'set local role authenticated';
    for c in select * from(values
      (format('select public.update_calendar_event_atomic(%L,%L,%s,%L)',ca,ev,rev-1,changed),'CALENDAR_STALE','PT409'),
      (format('select public.delete_calendar_event_atomic(%L,%L,%s)',ca,ev,rev-1),'CALENDAR_STALE','PT409'),
      (format('select public.update_calendar_event_atomic(%L,%L,null,%L)',ca,ev,input),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.update_calendar_event_atomic(%L,%L,%s,%L)',ca,ev,rev,changed||jsonb_build_object('job_id',jb)),'CALENDAR_SCOPE_INVALID','23514'),
      (format('select public.update_calendar_event_atomic(%L,%L,%s,%L)',ca,ev,rev,changed||jsonb_build_object('assigned_profile_ids',jsonb_build_array(pb))),'CALENDAR_SCOPE_INVALID','23514'),
      (format('select public.update_calendar_event_atomic(%L,%L,%s,%L)',ca,ev,rev,changed||jsonb_build_object('assigned_profile_ids',jsonb_build_array(px))),'CALENDAR_SCOPE_INVALID','23514'),
      (format('select public.update_calendar_event_atomic(%L,%L,%s,%L)',ca,ev,rev,input||jsonb_build_object('end_at','2026-11-01T09:00:00Z')),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('title',' ')),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('title',repeat('a',301))),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('description',repeat('a',10001))),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('assigned_profile_ids',jsonb_build_array(pw,pw))),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('assigned_profile_ids',jsonb_build_array(null))),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('start_at','2026-11-01T10:00:00')),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('start_at','Infinity')),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('start_at','1899-11-01T10:00:00Z')),'CALENDAR_INPUT_INVALID','22023'),
      (format('select public.get_calendar_event_snapshot(%L,%L)',ca,gen_random_uuid()),'CALENDAR_NOT_FOUND','P0002'),
      (format('select public.get_calendar_event_snapshot(%L,%L)',cb,ev),'CALENDAR_FORBIDDEN','42501')
    ) cases(query,expected,expected_code) loop
      problem:=null; code:=null;
      begin execute c.query; exception when others then get stacked diagnostics problem=message_text,code=returned_sqlstate; end;
      assert problem=c.expected and code=c.expected_code,'negative_'||c.expected||'_got_'||coalesce(problem,'NO_ERROR');
      execute 'reset role'; execute state_sql into after_state using ca;
      assert before_state=after_state,'rejected_write_preserves_complete_state';
      execute 'set local role authenticated';
      passed:=passed||jsonb_build_array(c.expected||'_unchanged');
    end loop;

    -- Direct table writes, helper execution and all public RPCs by anonymous or
    -- service roles must fail independently of the application actions.
    for c in select * from(values
      ('insert into public.calendar_events(company_id,title) values('||quote_literal(ca)||',''Bypass'')'),
      ('update public.calendar_events set title=''Bypass'' where id='||quote_literal(ev)),
      ('delete from public.calendar_events where id='||quote_literal(ev)),
      ('truncate public.calendar_events cascade'),
      ('insert into public.calendar_event_assignments(company_id,event_id,profile_id) values('||quote_literal(ca)||','||quote_literal(ev)||','||quote_literal(pa)||')'),
      ('update public.calendar_event_assignments set profile_id='||quote_literal(pa)||' where id='||quote_literal(retained)),
      ('delete from public.calendar_event_assignments where id='||quote_literal(retained)),
      ('truncate public.calendar_event_assignments'),
      ('select * from public.calendar_event_assignments'),
      (format('select private.calendar_event_snapshot(%L,%L)',ca,ev)),
      (format('select private.assert_calendar_mutation(%L)',ca))
    ) cases(query) loop
      problem:=null; begin execute c.query; exception when insufficient_privilege then problem:='denied'; end;
      assert problem='denied','direct_mutation_or_helper_denied';
      passed:=passed||jsonb_build_array('direct_mutation_or_helper_denied');
    end loop;
    execute 'reset role';
    for c in select unnest(array['anon','service_role']) role_name loop
      execute format('set local role %I',c.role_name);
      problem:=null; begin perform public.create_calendar_event_atomic(ca,input); exception when insufficient_privilege then problem:='denied'; end;
      assert problem='denied',c.role_name||'_rpc_denied';
      problem:=null; begin execute 'truncate public.calendar_event_assignments'; exception when insufficient_privilege then problem:='denied'; end;
      assert problem='denied',c.role_name||'_truncate_denied';
      execute 'reset role'; passed:=passed||jsonb_build_array(c.role_name||'_rpc_and_truncate_denied');
    end loop;

    for actor in select unnest(array[uw,um,ub]) loop
      perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
      perform set_config('request.jwt.claim.sub',actor::text,true); execute 'set local role authenticated';
      problem:=null; begin perform public.update_calendar_event_atomic(ca,ev,rev,changed);
        exception when others then get stacked diagnostics problem=message_text; end;
      assert problem='CALENDAR_FORBIDDEN','non_admin_or_other_company_write_denied';
      problem:=null; begin perform public.get_calendar_event_snapshot(ca,ev);
        exception when others then get stacked diagnostics problem=message_text; end;
      assert problem='CALENDAR_FORBIDDEN','admin_snapshot_scope_enforced';
      if actor=uw then
        assert exists(select 1 from public.calendar_events where id=ev),'worker_retains_history_rls';
      elsif actor=ub then
        assert not exists(select 1 from public.calendar_events where id=ev),'foreign_history_rls_denied';
      end if;
      execute 'reset role'; passed:=passed||jsonb_build_array('non_admin_or_other_company_denied');
    end loop;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',ua::text,true);
    update public.company_members set is_active=false where company_id=ca and profile_id=pa;
    execute 'set local role authenticated'; problem:=null;
    begin perform public.delete_calendar_event_atomic(ca,ev,rev); exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_FORBIDDEN','revoked_admin_denied'; execute 'reset role';
    update public.company_members set is_active=true where company_id=ca and profile_id=pa;
    update public.profiles set is_active=false where id=pa;
    execute 'set local role authenticated'; problem:=null;
    begin perform public.get_calendar_event_snapshot(ca,ev); exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_FORBIDDEN','inactive_profile_denied'; execute 'reset role';
    update public.profiles set is_active=true where id=pa;
    passed:=passed||jsonb_build_array('revoked_admin_denied','inactive_profile_denied');

    -- Test-only AFTER trigger changes authorization after the command has done
    -- its header DML. The final guard must reject and roll back both changes.
    -- This proves guard placement, not separate-session lock-wait behavior.
    create function private.calendar_test_revoke_after_write() returns trigger
      language plpgsql security definer set search_path='' as $trigger$
    begin
      if new.title='Synthetic late authorization' then
        update public.company_members set is_active=false where company_id=new.company_id
          and profile_id=(select p.id from public.profiles p where p.auth_user_id=auth.uid());
      elsif new.title='Synthetic late module disable' then
        update public.company_modules set is_enabled=false where company_id=new.company_id and module_key='calendar';
      end if;
      return null;
    end;
    $trigger$;
    create trigger calendar_test_late_guard after insert on public.calendar_events
      for each row execute function private.calendar_test_revoke_after_write();
    execute state_sql into before_state using ca;
    execute 'set local role authenticated';
    for c in select * from(values
      ('Synthetic late authorization','CALENDAR_FORBIDDEN'),
      ('Synthetic late module disable','CALENDAR_DISABLED')
    ) cases(title,expected) loop
      problem:=null;
      begin perform public.create_calendar_event_atomic(ca,input||jsonb_build_object('title',c.title));
        exception when others then get stacked diagnostics problem=message_text; end;
      assert problem=c.expected,'final_guard_after_dml_'||c.expected;
      execute 'reset role'; execute state_sql into after_state using ca;
      assert before_state=after_state,'late_authorization_failure_rolls_back_whole_state';
      assert exists(select 1 from public.company_members where company_id=ca and profile_id=pa and is_active)
        and exists(select 1 from public.company_modules where company_id=ca and module_key='calendar' and is_enabled),
        'late_authorization_fixture_change_itself_rolled_back';
      passed:=passed||jsonb_build_array('final_guard_after_dml_'||c.expected);
      execute 'set local role authenticated';
    end loop;
    execute 'reset role'; drop trigger calendar_test_late_guard on public.calendar_events;
    drop function private.calendar_test_revoke_after_write();

    -- The same header/assignment pair survives both a late insert failure and a
    -- late delete failure; neither command is a sequence of independent writes.
    execute format('alter table public.calendar_event_assignments add constraint calendar_test_late_failure check(profile_id<>%L) not valid',pa);
    execute state_sql into before_state using ca; execute 'set local role authenticated';
    for c in select * from(values
      (format('select public.update_calendar_event_atomic(%L,%L,%s,%L)',ca,ev,rev,changed||jsonb_build_object('title','Must roll back','assigned_profile_ids',jsonb_build_array(pa)))),
      (format('select public.create_calendar_event_atomic(%L,%L)',ca,input||jsonb_build_object('assigned_profile_ids',jsonb_build_array(pa))))
    ) cases(query) loop
      problem:=null; begin execute c.query; exception when check_violation then problem:='late'; end;
      assert problem='late','late_assignment_failure_reached'; execute 'reset role';
      execute state_sql into after_state using ca; assert after_state=before_state,'late_assignment_failure_rolls_back_header_and_set';
      execute 'set local role authenticated'; passed:=passed||jsonb_build_array('late_assignment_failure_rolls_back_header_and_set');
    end loop;
    execute 'reset role'; alter table public.calendar_event_assignments drop constraint calendar_test_late_failure;
    create table private.calendar_test_delete_block(event_id uuid references public.calendar_events(id) on delete restrict);
    insert into private.calendar_test_delete_block values(ev);
    execute 'set local role authenticated'; problem:=null;
    begin perform public.delete_calendar_event_atomic(ca,ev,rev); exception when foreign_key_violation or restrict_violation then problem:='late'; end;
    assert problem='late','late_delete_failure_reached'; execute 'reset role';
    execute state_sql into after_state using ca; assert after_state=before_state,'late_delete_failure_rolls_back_assignment_removal';
    delete from private.calendar_test_delete_block;
    passed:=passed||jsonb_build_array('late_delete_failure_rolls_back_assignment_removal');

    -- Single legacy aliases remain readable without migration backfill. Editing
    -- the event fills the counterpart and retains existing assignment identity.
    insert into public.calendar_events(company_id,title,starts_at,ends_at) values(ca,'Legacy','2026-11-02T10:00:00Z','2026-11-02T11:00:00Z') returning id into legacy;
    insert into public.calendar_event_assignments(company_id,calendar_event_id,profile_id) values(ca,legacy,pw) returning id into retained;
    execute 'set local role authenticated'; result:=public.get_calendar_event_snapshot(ca,legacy); legacy_rev:=(result->'event'->>'revision')::bigint;
    assert (result->'event'->>'start_at')::timestamptz='2026-11-02T10:00:00Z'::timestamptz,'legacy_single_alias_readable';
    result:=public.update_calendar_event_atomic(ca,legacy,legacy_rev,input);
    execute 'reset role';
    assert exists(select 1 from public.calendar_event_assignments where id=retained and event_id=legacy and calendar_event_id=legacy),'legacy_assignment_identity_and_new_aliases';
    passed:=passed||jsonb_build_array('legacy_single_alias_readable','legacy_assignment_identity_and_new_aliases');

    -- Reconciliation is explicit. The runtime must not choose one conflicting
    -- historical alias, even if a privileged import bypassed the new constraint.
    alter table public.calendar_events drop constraint calendar_time_aliases_consistent;
    update public.calendar_events set starts_at=start_at+interval '1 hour' where id=legacy returning revision into legacy_rev;
    execute 'set local role authenticated'; problem:=null;
    begin perform public.update_calendar_event_atomic(ca,legacy,legacy_rev,input); exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_ALIAS_CONFLICT','conflicting_aliases_refused'; execute 'reset role';
    update public.calendar_events set starts_at=start_at where id=legacy;
    passed:=passed||jsonb_build_array('conflicting_aliases_refused');

    update public.company_modules set is_enabled=false where company_id=ca and module_key='calendar';
    execute 'set local role authenticated'; result:=public.get_calendar_event_snapshot(ca,ev);
    assert result->'event'->>'id'=ev::text,'disabled_module_history_available'; problem:=null;
    begin perform public.update_calendar_event_atomic(ca,ev,rev,changed); exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_DISABLED','disabled_module_noop_write_denied'; execute 'reset role';
    update public.company_modules set is_enabled=true where company_id=ca and module_key='calendar';
    insert into private.company_module_rollouts(company_id,product,livemode) values(ca,'diriqo_core',false);
    execute 'set local role authenticated'; problem:=null;
    begin perform public.create_calendar_event_atomic(ca,input); exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_MODULE_REQUIRED','enforced_without_entitlement_denied'; execute 'reset role';
    insert into private.company_test_module_grants(id,company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      values(grant_id,ca,'diriqo_core',marker,'Synthetic calendar test',now()-interval '1 minute',
        now()+interval '1 hour',now()+interval '1 hour',array['core.calendar.manage','core.jobs.create']);
    execute 'set local role authenticated'; result:=public.update_calendar_event_atomic(ca,ev,rev,changed||jsonb_build_object('title','Test licensed'));
    assert (result->'event'->>'revision')::bigint>rev,'test_capability_allows_write'; rev:=(result->'event'->>'revision')::bigint; execute 'reset role';
    update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Synthetic revocation' where id=grant_id;
    execute 'set local role authenticated'; result:=public.get_calendar_event_snapshot(ca,ev);
    assert (result->'event'->>'revision')::bigint=rev,'revoked_license_history_available'; problem:=null;
    begin perform public.delete_calendar_event_atomic(ca,ev,rev); exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_MODULE_REQUIRED','revoked_license_write_denied'; execute 'reset role';
    passed:=passed||jsonb_build_array('disabled_module_history_available','disabled_module_noop_write_denied',
      'enforced_without_entitlement_denied','test_capability_allows_write','revoked_license_history_available','revoked_license_write_denied');
    insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      values(ca,'diriqo_core',marker||'-expired','Synthetic expired calendar test',now()-interval '2 hours',
        now()-interval '1 hour',now()-interval '1 hour',array['core.calendar.manage']);
    execute 'set local role authenticated'; problem:=null;
    begin perform public.update_calendar_event_atomic(ca,ev,rev,changed); exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_MODULE_REQUIRED','expired_license_write_denied';
    result:=public.get_calendar_event_snapshot(ca,ev);
    assert (result->'event'->>'revision')::bigint=rev,'expired_license_history_available';
    execute 'reset role';
    passed:=passed||jsonb_build_array('expired_license_write_denied','expired_license_history_available');
    delete from private.company_module_rollouts where company_id=ca and product='diriqo_core';

    -- Existing FK writers are part of the aggregate revision. A job deletion
    -- nulls its header link; profile deletion removes its assignment. Both must
    -- invalidate a previously issued edit token instead of accepting a lost edit.
    prior_rev:=rev;
    delete from public.jobs where id=ja;
    execute 'set local role authenticated'; result:=public.get_calendar_event_snapshot(ca,ev);
    rev:=(result->'event'->>'revision')::bigint;
    assert rev>prior_rev and result->'event'->>'job_id' is null,'job_fk_set_null_advances_revision';
    problem:=null; begin perform public.update_calendar_event_atomic(ca,ev,prior_rev,changed||jsonb_build_object('job_id',null));
      exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_STALE','job_fk_change_rejects_stale_write';
    execute 'reset role';
    prior_rev:=rev;
    delete from public.company_members where profile_id=pm;
    delete from public.profiles where id=pm;
    execute 'set local role authenticated'; result:=public.get_calendar_event_snapshot(ca,ev);
    rev:=(result->'event'->>'revision')::bigint;
    assert rev>prior_rev and result->'assigned_profile_ids'=jsonb_build_array(pw),'profile_fk_cascade_advances_revision';
    problem:=null; begin perform public.delete_calendar_event_atomic(ca,ev,prior_rev);
      exception when others then get stacked diagnostics problem=message_text; end;
    assert problem='CALENDAR_STALE','profile_fk_change_rejects_stale_delete';
    passed:=passed||jsonb_build_array('job_fk_set_null_advances_revision','job_fk_change_rejects_stale_write',
      'profile_fk_cascade_advances_revision','profile_fk_change_rejects_stale_delete');
    -- Future not-found checks use currently valid scope, so a removed job cannot
    -- mask the fact that the event was deleted.
    changed:=changed||jsonb_build_object('job_id',null,'assigned_profile_ids',jsonb_build_array(pw));
    execute 'set local role authenticated'; result:=public.delete_calendar_event_atomic(ca,ev,rev);
    assert (result->>'deleted')::boolean and result->>'eventId'=ev::text,'delete_reports_original_identity';
    for c in select * from(values
      (format('select public.update_calendar_event_atomic(%L,%L,%s,%L)',ca,ev,rev,changed)),
      (format('select public.delete_calendar_event_atomic(%L,%L,%s)',ca,ev,rev)),
      (format('select public.get_calendar_event_snapshot(%L,%L)',ca,ev))
    ) cases(query) loop
      problem:=null; begin execute c.query; exception when others then get stacked diagnostics problem=message_text; end;
      assert problem='CALENDAR_NOT_FOUND','deleted_event_is_not_silent_success';
      passed:=passed||jsonb_build_array('deleted_event_is_not_silent_success');
    end loop;
    execute 'reset role';
    assert not exists(select 1 from public.calendar_event_assignments where event_id=ev or calendar_event_id=ev),'delete_removes_complete_assignment_set';
    passed:=passed||jsonb_build_array('delete_reports_original_identity','delete_removes_complete_assignment_set');
    raise exception 'rollback synthetic calendar fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null; end;
  assert not exists(select 1 from public.companies where id in(ca,cb)),'fixture_companies_rolled_back';
  assert not exists(select 1 from auth.users where id in(ua,ub,uw,um)),'fixture_auth_rolled_back';
  assert not exists(select 1 from public.calendar_events where company_id=ca),'fixture_events_rolled_back';
  assert not exists(select 1 from public.calendar_event_assignments where company_id=ca),'fixture_assignments_rolled_back';
  perform set_config('diriqo.calendar_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),
    'fixtures','rolled_back','cleanup_assertions',4,'concurrency','requires_separate_authenticated_sessions')::text,true);
end;
$test$;
select current_setting('diriqo.calendar_test_result')::jsonb as result;
