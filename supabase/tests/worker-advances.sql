-- Diriqo TEST only. All synthetic records roll back, including immutable history.
-- Real PostgreSQL roles/RLS. This is sequential proof; independent Auth/PostgREST
-- sessions and a verified lock barrier are required separately for concurrency.
do $test$
declare
  ua uuid:=gen_random_uuid(); uw uuid:=gen_random_uuid(); um uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid();
  pa uuid:=gen_random_uuid(); pw uuid:=gen_random_uuid(); pm uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
  ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); r1 uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid();
  r3 uuid:=gen_random_uuid(); rlate uuid:=gen_random_uuid(); opreview uuid:=gen_random_uuid();
  op1 uuid:=gen_random_uuid(); op2 uuid:=gen_random_uuid(); ops uuid:=gen_random_uuid();
  v_payment uuid; v_manual uuid; v_grant uuid; v_result jsonb; v_retry jsonb; v_before jsonb; v_after jsonb;
  v_error text; v_message text; v_case record; v_role uuid; v_query text; v_table text;
  passed jsonb:='[]'; marker text:='AdvanceTest'||replace(gen_random_uuid()::text,'-','');
  today date:=(clock_timestamp() at time zone 'Europe/Prague')::date;
  state_sql constant text:=$q$select jsonb_build_object(
    'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.advance_requests r where company_id=$1),
    'payments',(select coalesce(jsonb_agg(to_jsonb(w) order by id),'[]') from public.worker_advances w where company_id=$1),
    'settlements',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.worker_advance_settlements s where company_id=$1))$q$;
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (ua,marker||'a@example.invalid','{}'),(uw,marker||'w@example.invalid','{}'),
      (um,marker||'m@example.invalid','{}'),(ub,marker||'b@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (pa,ua,ua,'Synthetic advance admin'),(pw,uw,uw,'Synthetic advance worker'),
      (pm,um,um,'Synthetic advance manager'),(pb,ub,ub,'Synthetic foreign admin');
    insert into public.companies(id,name,timezone,currency) values
      (ca,'Synthetic advances A','Europe/Prague','CZK'),(cb,'Synthetic advances B','Europe/Prague','CZK');
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (ca,pa,'company_admin',true),(ca,pw,'worker',true),(ca,pm,'manager',true),(cb,pb,'company_admin',true);
    insert into public.company_payroll_settings(company_id,advances_enabled,allow_advances,advance_limit_amount) values(ca,true,true,10000);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',uw,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',uw::text,true);
    execute 'set local role authenticated';
    v_result:=public.request_advance_atomic(ca,r1,5000,'Synthetic request',null);
    assert v_result->'request'->>'profile_id'=pw::text and (v_result->'request'->>'requested_amount')::numeric=5000
      and (v_result->'request'->>'amount')::numeric=0 and v_result->'request'->>'status'='pending'
      and (v_result->'request'->>'revision')::bigint=0, 'worker_creates_own_request';
    v_retry:=public.request_advance_atomic(ca,r1,5000,'Synthetic request',null);
    assert not (v_retry->>'changed')::boolean and v_retry->'request'=v_result->'request','request_retry_preserves_original';
    perform public.request_advance_atomic(ca,r2,5000,'Synthetic second',null);
    perform public.request_advance_atomic(ca,r3,5000,'Synthetic reject',null);
    passed:=passed||jsonb_build_array('worker_creates_own_request','request_retry_preserves_original');
    for v_case in select * from (values
      (format('select public.request_advance_atomic(%L,%L,5001,%L,null)',ca,r1,'Synthetic request'),'ADVANCE_OPERATION_CONFLICT'),
      (format('select public.request_advance_atomic(%L,%L,5000,%L,null)',cb,gen_random_uuid(),'Foreign request'),'ADVANCE_FORBIDDEN'),
      (format('select public.request_advance_atomic(%L,%L,0,%L,null)',ca,gen_random_uuid(),'Zero request'),'ADVANCE_INVALID'),
      (format('select public.request_advance_atomic(%L,%L,1.001,%L,null)',ca,gen_random_uuid(),'Sub-cent request'),'ADVANCE_INVALID')
    ) x(query,expected) loop
      v_error:=null;
      begin execute v_case.query; exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error=v_case.expected,'request_negative_'||v_case.expected;
      passed:=passed||jsonb_build_array('request_'||v_case.expected);
    end loop;

    -- Fresh worker authorization is required for both a new request and an exact
    -- historical retry. This sequential check does not simulate a lock wait;
    -- the separate worker-session barrier harness covers in-flight revocation.
    execute 'reset role';
    execute state_sql into v_before using ca;
    update public.company_members set is_active=false where company_id=ca and profile_id=pw;
    execute 'set local role authenticated';
    for v_case in select * from (values
      (gen_random_uuid(),1::numeric,'Revoked new request','revoked_worker_new_request_denied'),
      (r1,5000::numeric,'Synthetic request','revoked_worker_request_retry_denied')
    ) x(request_id,amount,reason,label) loop
      v_error:=null;
      begin perform public.request_advance_atomic(ca,v_case.request_id,v_case.amount,v_case.reason,null);
      exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error='ADVANCE_FORBIDDEN',v_case.label;
      passed:=passed||jsonb_build_array(v_case.label);
    end loop;
    execute 'reset role';
    execute state_sql into v_after using ca;
    assert v_before=v_after,'revoked_worker_request_attempts_preserve_financial_state';
    update public.company_members set is_active=true where company_id=ca and profile_id=pw;

    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',ua::text,true);
    execute 'set local role authenticated';
    v_error:=null;
    begin perform public.review_advance_request_atomic(ca,r1,0,'approved',3000,opreview,null);
    exception when others then get stacked diagnostics v_error=message_text; end;
    assert v_error='ADVANCE_REVIEW_REASON_REQUIRED','reduced_approval_requires_reason';
    v_result:=public.review_advance_request_atomic(ca,r1,0,'approved',3000,opreview,'Synthetic lower approval');
    assert (v_result->'request'->>'amount')::numeric=3000 and (v_result->'request'->>'requested_amount')::numeric=5000
      and v_result->'request'->>'approved_by'=pa::text and (v_result->>'remaining_amount')::numeric=3000,'approval_preserves_requested_amount';
    v_retry:=public.review_advance_request_atomic(ca,r1,0,'approved',3000,opreview,'Synthetic lower approval');
    assert not (v_retry->>'changed')::boolean and v_retry->'request'=v_result->'request','approval_retry_preserves_timestamp';
    passed:=passed||jsonb_build_array('reduced_approval_requires_reason','approval_preserves_requested_amount','approval_retry_preserves_timestamp');

    v_result:=public.pay_worker_advance_atomic(ca,pw,r1,op1,1000,today,'Part one',1,'cash',null);
    v_payment:=(v_result->'payment'->>'id')::uuid;
    assert v_result->'request'->>'status'='approved' and v_result->'request'->>'paid_at' is null
      and (v_result->>'paid_total')::numeric=1000 and (v_result->>'remaining_amount')::numeric=2000
      and (v_result->>'outstanding_amount')::numeric=1000 and (v_result->'request'->>'revision')::bigint=2
      and v_result->'payment'->>'currency'='CZK' and v_result->'payment'->>'recorded_by'=pa::text,'partial_payment_has_two_correct_balances';
    execute state_sql into v_before using ca;
    v_retry:=public.pay_worker_advance_atomic(ca,pw,r1,op1,1000,today,'Part one',1,'cash',null);
    execute state_sql into v_after using ca;
    assert not (v_retry->>'changed')::boolean and v_retry->'payment'=v_result->'payment' and v_after=v_before,'lost_response_retry_is_noop';
    passed:=passed||jsonb_build_array('partial_payment_has_two_correct_balances','lost_response_retry_is_noop');

    for v_case in select * from (values
      (format('select public.pay_worker_advance_atomic(%L,%L,%L,%L,1001,%L,%L,2,%L,null)',ca,pw,r1,op1,today,'Part one','cash'),'ADVANCE_OPERATION_CONFLICT'),
      (format('select public.pay_worker_advance_atomic(%L,%L,%L,%L,1000,%L,%L,2,%L,null)',ca,pw,r2,op1,today,'Part one','cash'),'ADVANCE_OPERATION_CONFLICT'),
      (format('select public.pay_worker_advance_atomic(%L,%L,%L,%L,1000,%L,%L,2,%L,null)',ca,pw,r1,op1,today,'Different note','cash'),'ADVANCE_OPERATION_CONFLICT'),
      (format('select public.pay_worker_advance_atomic(%L,%L,%L,%L,2001,%L,null,2)',ca,pw,r1,gen_random_uuid(),today),'ADVANCE_BALANCE_EXCEEDED'),
      (format('select public.pay_worker_advance_atomic(%L,%L,%L,%L,2000,%L,null,1)',ca,pw,r1,gen_random_uuid(),today),'ADVANCE_STALE'),
      (format('select public.pay_worker_advance_atomic(%L,%L,%L,%L,2000,%L,null,2,%L,null)',ca,pw,r1,gen_random_uuid(),today,'bank_transfer'),'ADVANCE_INVALID'),
      (format('select public.review_advance_request_atomic(%L,%L,2,%L,0,%L,null)',ca,r1,'rejected',gen_random_uuid()),'ADVANCE_INVALID_STATE'),
      (format('select public.review_advance_request_atomic(%L,%L,0,%L,3001,%L,%L)',ca,r1,'approved',opreview,'Synthetic lower approval'),'ADVANCE_OPERATION_CONFLICT'),
      (format('select public.pay_worker_advance_atomic(%L,%L,null,%L,1,%L,null,null)',ca,pb,gen_random_uuid(),today),'ADVANCE_WORKER_UNAVAILABLE'),
      (format('select public.pay_worker_advance_atomic(%L,%L,null,%L,%L,%L,null,null)',ca,pw,gen_random_uuid(),'NaN',today),'ADVANCE_INVALID'),
      (format('select public.pay_worker_advance_atomic(%L,%L,null,%L,%L,%L,null,null)',ca,pw,gen_random_uuid(),'Infinity',today),'ADVANCE_INVALID'),
      (format('select public.pay_worker_advance_atomic(%L,%L,null,%L,0.001,%L,null,null)',ca,pw,gen_random_uuid(),today),'ADVANCE_INVALID')
    ) x(query,expected) loop
      v_error:=null;
      begin execute v_case.query; exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error=v_case.expected,'negative_case_'||v_case.expected||'_got_'||coalesce(v_error,'NO_ERROR');
      execute state_sql into v_after using ca;
      assert v_after=v_before,'negative_case_preserves_whole_state';
      passed:=passed||jsonb_build_array(v_case.expected||'_whole_state_unchanged');
    end loop;

    v_result:=public.pay_worker_advance_atomic(ca,pw,r1,op2,2000,today,'Part two',2,'bank_transfer','TEST-BANK-2');
    assert v_result->'request'->>'status'='paid' and v_result->'request'->>'paid_at' is not null
      and (v_result->>'paid_total')::numeric=3000 and (v_result->>'remaining_amount')::numeric=0
      and (v_result->>'outstanding_amount')::numeric=3000
      and (select count(*)=2 from public.worker_advances where advance_request_id=r1),'two_partial_payments_complete_original_approval';
    v_retry:=public.review_advance_request_atomic(ca,r1,0,'approved',3000,opreview,'Synthetic lower approval');
    assert not (v_retry->>'changed')::boolean and v_retry->'request'=v_result->'request','review_retry_after_payment_does_not_reopen_request';
    v_result:=public.settle_worker_advance_atomic(ca,v_payment,ops,400,'returned','RETURN-400',today);
    assert (v_result->>'settled_total')::numeric=400 and (v_result->>'outstanding_amount')::numeric=600,'partial_return_reduces_only_outstanding';
    v_retry:=public.settle_worker_advance_atomic(ca,v_payment,ops,400,'returned','RETURN-400',today);
    assert not (v_retry->>'changed')::boolean and v_retry->'settlement'=v_result->'settlement','settlement_retry_original_record';
    v_result:=public.settle_worker_advance_atomic(ca,v_payment,gen_random_uuid(),600,'payroll_offset','PAYROLL-EVIDENCE-600',today);
    assert (v_result->>'outstanding_amount')::numeric=0,'payroll_offset_is_separate_evidence';
    v_retry:=public.pay_worker_advance_atomic(ca,pw,r1,op1,1000,today,'Part one',1,'cash',null);
    assert (v_retry->>'paid_total')::numeric=3000 and (v_retry->>'remaining_amount')::numeric=0
      and (v_retry->>'settled_total')::numeric=1000 and (v_retry->>'outstanding_amount')::numeric=2000,'return_does_not_restore_approved_payment_limit';
    passed:=passed||jsonb_build_array('two_partial_payments_complete_original_approval','review_retry_after_payment_does_not_reopen_request',
      'partial_return_reduces_only_outstanding','settlement_retry_original_record','payroll_offset_is_separate_evidence','return_does_not_restore_approved_payment_limit');
    for v_case in select * from (values
      (format('select public.settle_worker_advance_atomic(%L,%L,%L,1,%L,%L,%L)',ca,v_payment,gen_random_uuid(),'returned','EXCESS',today),'ADVANCE_SETTLEMENT_EXCEEDED'),
      (format('select public.settle_worker_advance_atomic(%L,%L,%L,401,%L,%L,%L)',ca,v_payment,ops,'returned','RETURN-400',today),'ADVANCE_OPERATION_CONFLICT')
    ) x(query,expected) loop
      execute state_sql into v_before using ca;
      v_error:=null;
      begin execute v_case.query; exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error=v_case.expected,'settlement_'||v_case.expected;
      execute state_sql into v_after using ca;
      assert v_after=v_before,'settlement_error_rolls_back';
      passed:=passed||jsonb_build_array('settlement_'||v_case.expected||'_unchanged');
    end loop;

    -- Manual and request-led payments consume the same worker/month ceiling.
    execute 'reset role';
    update public.company_payroll_settings set advance_limit_amount=3500 where company_id=ca;
    execute 'set local role authenticated';
    v_error:=null;
    begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),501,today,'Manual excess');
    exception when others then get stacked diagnostics v_error=message_text; end;
    assert v_error='ADVANCE_LIMIT_EXCEEDED','manual_payment_shares_request_monthly_limit';
    v_result:=public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),500,today,'Manual balance');
    v_manual:=(v_result->'payment'->>'id')::uuid;
    assert v_result->'request'='null'::jsonb and (v_result->>'outstanding_amount')::numeric=500,'manual_payment_canonical_ledger';
    passed:=passed||jsonb_build_array('manual_payment_shares_request_monthly_limit','manual_payment_canonical_ledger');

    begin
      -- Rejection and changed (including higher) approval remain explicit decisions.
      v_result:=public.review_advance_request_atomic(ca,r3,0,'rejected',0,gen_random_uuid(),'Rejected with evidence');
      assert v_result->'request'->>'status'='rejected' and v_result->'request'->>'approved_at' is null
        and v_result->'request'->>'rejected_at' is not null and (v_result->>'remaining_amount')::numeric=0,'rejection_has_no_payment_authority';
      v_result:=public.review_advance_request_atomic(ca,r2,0,'approved',6000,gen_random_uuid(),'Additional amount explicitly approved');
      assert (v_result->'request'->>'amount')::numeric=6000 and (v_result->'request'->>'requested_amount')::numeric=5000,'changed_approval_with_reason_preserves_requested';
      execute 'reset role';
      update public.companies set default_currency='EUR' where id=ca;
      execute 'set local role authenticated';
      v_retry:=public.pay_worker_advance_atomic(ca,pw,r1,op1,1000,today,'Part one',1,'cash',null);
      assert v_retry->'payment'->>'currency'='CZK' and not (v_retry->>'changed')::boolean,'currency_change_preserves_historic_retry';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,r2,gen_random_uuid(),1,today,'Wrong currency',1);
      exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error='ADVANCE_CURRENCY_CONFLICT','request_currency_cannot_change_during_payment';
      passed:=passed||jsonb_build_array('rejection_has_no_payment_authority','changed_approval_with_reason_preserves_requested',
        'currency_change_preserves_historic_retry','request_currency_cannot_change_during_payment');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    begin
      execute 'reset role';
      insert into public.worker_payment_settings(company_id,profile_id,advances_enabled_override)
        values(ca,pw,false);
      execute 'set local role authenticated';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),1,today,'Disabled worker');
      exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error='ADVANCES_DISABLED','worker_override_denies_new_payment';
      v_retry:=public.pay_worker_advance_atomic(ca,pw,r1,op1,1000,today,'Part one',1,'cash',null);
      assert not (v_retry->>'changed')::boolean,'disabled_advances_do_not_hide_existing_payment';
      passed:=passed||jsonb_build_array('worker_override_denies_new_payment','disabled_advances_do_not_hide_existing_payment');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    begin
      -- One profile has two memberships: company-specific settings and money
      -- remain separate, even when the deprecated global profile says otherwise.
      execute 'reset role';
      insert into public.company_members(company_id,profile_id,role,is_active) values(cb,pw,'worker',true);
      insert into public.company_payroll_settings(company_id,advances_enabled,allow_advances,advance_limit_amount)
        values(cb,true,false,700);
      update public.company_payroll_settings set advances_enabled=false,allow_advances=true where company_id=ca;
      insert into public.worker_payment_settings(company_id,profile_id,advances_enabled_override,advance_limit_amount_override)
        values(ca,pw,false,null),(cb,pw,true,1000);
      update public.profiles set allow_advances_override=false,advance_limit_amount_override=1 where id=pw;
      execute 'set local role authenticated';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),1,today,'Canonical false');
      exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error='ADVANCES_DISABLED','canonical_false_not_replaced_by_legacy_true';
      execute 'reset role';
      perform set_config('request.jwt.claims',jsonb_build_object('sub',ub,'role','authenticated')::text,true);
      perform set_config('request.jwt.claim.sub',ub::text,true);
      execute 'set local role authenticated';
      v_result:=public.pay_worker_advance_atomic(cb,pw,null,gen_random_uuid(),900,today,'Other company override');
      assert v_result->'payment'->>'company_id'=cb::text and (v_result->>'paid_total')::numeric=900,
        'other_company_worker_override_ignores_global_profile_and_first_company';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(cb,pw,null,gen_random_uuid(),101,today,'Other company limit');
      exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error='ADVANCE_LIMIT_EXCEEDED','other_company_worker_limit_enforced';
      execute 'reset role';
      perform set_config('request.jwt.claims',jsonb_build_object('sub',uw,'role','authenticated')::text,true);
      perform set_config('request.jwt.claim.sub',uw::text,true);
      execute 'set local role authenticated';
      v_error:=null;
      begin perform public.request_advance_atomic(ca,gen_random_uuid(),5000,'Disabled in first company');
      exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error='ADVANCES_DISABLED','request_uses_same_canonical_company_worker_policy';
      v_result:=public.request_advance_atomic(cb,gen_random_uuid(),5000,'Allowed in second company');
      assert v_result->'request'->>'company_id'=cb::text,'request_other_company_not_disabled_by_global_profile';
      execute 'reset role';
      update public.company_members set is_active=false where company_id=ca and profile_id=pw;
      execute 'set local role authenticated';
      v_result:=public.request_advance_atomic(cb,gen_random_uuid(),5000,'Still active in second company');
      assert v_result->'request'->>'profile_id'=pw::text,'removing_membership_a_preserves_membership_b';
      passed:=passed||jsonb_build_array('canonical_false_not_replaced_by_legacy_true',
        'other_company_worker_override_ignores_global_profile_and_first_company','other_company_worker_limit_enforced',
        'request_uses_same_canonical_company_worker_policy','request_other_company_not_disabled_by_global_profile',
        'removing_membership_a_preserves_membership_b');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    begin
      execute 'reset role';
      update public.company_payroll_settings set advance_limit_amount=null,advances_enabled=true,allow_advances=false where company_id=ca;
      update public.profiles set allow_advances_override=false,advance_limit_amount_override=0 where id=pw;
      insert into public.worker_payment_settings(company_id,profile_id,advances_enabled_override,advance_limit_amount_override)
        values(ca,pw,null,null);
      execute 'set local role authenticated';
      v_result:=public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),20,today,'Canonical NULL amount');
      assert (v_result->>'paid_total')::numeric=20,'canonical_null_limit_does_not_restore_global_zero_limit';
      passed:=passed||jsonb_build_array('canonical_null_limit_does_not_restore_global_zero_limit');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    begin
      execute 'reset role';
      update public.company_payroll_settings set advance_limit_type='percent_of_earned' where company_id=ca;
      update public.profiles set advance_limit_amount_override=999999 where id=pw;
      execute 'set local role authenticated';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),10,'2020-06-01','Percent unsupported');
      exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error='ADVANCE_SETTINGS_UNSUPPORTED','global_profile_override_cannot_bypass_percent_policy';
      execute 'reset role';
      insert into public.worker_payment_settings(company_id,profile_id,advance_limit_amount_override) values(ca,pw,10);
      execute 'set local role authenticated';
      v_result:=public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),10,'2020-06-01','Explicit scoped amount override');
      assert (v_result->>'paid_total')::numeric=10,'explicit_scoped_amount_override_replaces_percent_policy';
      passed:=passed||jsonb_build_array('global_profile_override_cannot_bypass_percent_policy','explicit_scoped_amount_override_replaces_percent_policy');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    begin
      execute 'reset role';
      insert into public.worker_advances(company_id,profile_id,amount,issued_at,payroll_month,currency)
        values(ca,pw,1,today,null,'CZK');
      execute 'set local role authenticated';
      execute state_sql into v_before using ca;
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),1,today,'Unknown historic month');
      exception when others then get stacked diagnostics v_error=message_text; end;
      execute state_sql into v_after using ca;
      assert v_error='ADVANCE_LEGACY_RECONCILIATION_REQUIRED' and v_before=v_after,
        'historic_null_month_is_not_inferred_or_rewritten';
      passed:=passed||jsonb_build_array('historic_null_month_is_not_inferred_or_rewritten');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    begin
      execute 'reset role';
      update public.company_payroll_settings set advance_limit_amount=100 where company_id=ca;
      insert into public.worker_advances(company_id,profile_id,amount,issued_at,payroll_month,currency)
        values(ca,pw,100,'2020-09-19','2020-10-01','CZK');
      execute 'set local role authenticated';
      v_result:=public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),100,'2020-09-19','New calendar month');
      assert v_result->'payment'->>'payroll_month'='2020-09-01'
        and (select count(*)=1 from public.worker_advances where company_id=ca and issued_at='2020-09-19'
          and payroll_month='2020-10-01' and operation_id is null),
        'stored_historic_assignment_preserved_new_payment_uses_calendar_month';
      passed:=passed||jsonb_build_array('stored_historic_assignment_preserved_new_payment_uses_calendar_month');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    -- A natural error in the second write (revision overflow) proves rollback of
    -- the already-inserted payment. No test trigger, bypass or temporary DDL.
    execute 'reset role';
    update public.company_payroll_settings set advance_limit_amount=null where company_id=ca;
    insert into public.advance_requests(id,company_id,profile_id,amount,requested_amount,status,approved_at,revision,currency)
      values(rlate,ca,pw,10,10,'approved',clock_timestamp(),9223372036854775807,'CZK');
    execute 'set local role authenticated';
    execute state_sql into v_before using ca;
    v_error:=null;
    begin perform public.pay_worker_advance_atomic(ca,pw,rlate,gen_random_uuid(),10,today,'Late failure',9223372036854775807);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    execute state_sql into v_after using ca;
    assert v_error='22003' and v_before=v_after,'late_request_update_failure_rolls_back_inserted_payment';
    passed:=passed||jsonb_build_array('late_request_update_failure_rolls_back_inserted_payment');

    -- Real grant evaluator and C08 post-lock source validation. These sequential
    -- cases complement (not replace) the separate authenticated licence barriers.
    begin
      execute 'reset role';
      insert into private.company_module_rollouts(company_id,product,livemode) values(ca,'diriqo_core',false);
      insert into private.company_test_module_grants(company_id,product,source_ref,reason,
        valid_from,valid_until,history_until,capabilities)
      values(ca,'diriqo_core',marker||'-active','Synthetic C08 regression',
        now()-interval '1 hour',now()+interval '1 hour',now()+interval '1 hour',
        array['core.advances.request','core.advances.pay']) returning id into v_grant;
      execute 'set local role authenticated';
      v_result:=public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),1,today,'Active test grant');
      assert (v_result->>'changed')::boolean,'active_test_grant_allows_canonical_payment';
      passed:=passed||jsonb_build_array('active_test_grant_allows_canonical_payment');
      execute 'reset role';
      update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Synthetic C08 regression' where id=v_grant;
      execute state_sql into v_before using ca;
      execute 'set local role authenticated';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),1,today,'Revoked test grant');
      exception when others then get stacked diagnostics v_error=message_text; end;
      execute state_sql into v_after using ca;
      assert v_error='ADVANCE_MODULE_REQUIRED' and v_before=v_after,'revoked_test_grant_denies_new_payment_without_writes';
      passed:=passed||jsonb_build_array('revoked_test_grant_denies_new_payment_without_writes');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;
    begin
      execute 'reset role';
      insert into private.company_module_rollouts(company_id,product,livemode) values(ca,'diriqo_core',false);
      insert into private.company_test_module_grants(company_id,product,source_ref,reason,
        valid_from,valid_until,history_until,capabilities)
      values(ca,'diriqo_core',marker||'-expired','Synthetic C08 expired regression',
        now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour',array['core.advances.pay']);
      execute state_sql into v_before using ca;
      execute 'set local role authenticated';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),1,today,'Expired test grant');
      exception when others then get stacked diagnostics v_error=message_text; end;
      execute state_sql into v_after using ca;
      assert v_error='ADVANCE_MODULE_REQUIRED' and v_before=v_after,'expired_test_grant_denies_new_payment_without_writes';
      passed:=passed||jsonb_build_array('expired_test_grant_denies_new_payment_without_writes');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;
    foreach v_role in array array[pa,pw] loop
      execute 'reset role';
      execute state_sql into v_before using ca;
      update public.company_members set is_active=false where company_id=ca and profile_id=v_role;
      execute 'set local role authenticated';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),1,today,'Revoked actor');
      exception when others then get stacked diagnostics v_error=message_text; end;
      execute 'reset role';
      execute state_sql into v_after using ca;
      assert v_error=case when v_role=pa then 'ADVANCE_FORBIDDEN' else 'ADVANCE_WORKER_UNAVAILABLE' end and v_before=v_after,
        'revoked_payment_actor_preserves_financial_state';
      update public.company_members set is_active=true where company_id=ca and profile_id=v_role;
      passed:=passed||jsonb_build_array(case when v_role=pa then 'revoked_admin_new_payment_denied' else 'revoked_subject_new_payment_denied' end);
    end loop;
    execute 'set local role authenticated';

    -- No client API write can bypass amount, role, state, immutability or scope.
    foreach v_table in array array['advance_requests','worker_advances','worker_advance_settlements'] loop
      foreach v_query in array array[
        format('insert into public.%I default values',v_table),
        format('update public.%I set company_id=%L where company_id=%L',v_table,cb,ca),
        format('delete from public.%I where company_id=%L',v_table,ca),
        format('truncate public.%I',v_table)] loop
        v_error:=null;
        begin execute v_query; exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
        assert v_error='42501','direct_mutation_denied_'||v_table;
        passed:=passed||jsonb_build_array('direct_'||split_part(v_query,' ',1)||'_'||v_table||'_denied');
      end loop;
    end loop;

    -- RLS separates another company and non-financial manager from all-worker data.
    foreach v_role in array array[uw,um,ub] loop
      execute 'reset role';
      perform set_config('request.jwt.claims',jsonb_build_object('sub',v_role,'role','authenticated')::text,true);
      perform set_config('request.jwt.claim.sub',v_role::text,true);
      execute 'set local role authenticated';
      assert (select count(*) from public.worker_advances where company_id=ca)=case when v_role=uw then 3 else 0 end,'rls_own_or_admin_only';
      v_error:=null;
      begin perform public.pay_worker_advance_atomic(ca,pw,r1,op1,1000,today,'Part one',1,'cash',null);
      exception when others then get stacked diagnostics v_error=message_text; end;
      assert v_error='ADVANCE_FORBIDDEN','fresh_role_required_even_for_retry';
      passed:=passed||jsonb_build_array('rls_and_retry_role_'||case when v_role=uw then 'worker' when v_role=um then 'manager' else 'foreign' end);
    end loop;
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',ua,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',ua::text,true);
    update public.company_members set is_active=false where company_id=ca and profile_id=pa;
    execute 'set local role authenticated';
    v_error:=null;
    begin perform public.pay_worker_advance_atomic(ca,pw,r1,op1,1000,today,'Part one',1,'cash',null);
    exception when others then get stacked diagnostics v_error=message_text; end;
    assert v_error='ADVANCE_FORBIDDEN','revoked_admin_retry_denied';
    execute 'reset role';
    update public.company_members set is_active=true where company_id=ca and profile_id=pa;
    insert into private.company_module_rollouts(company_id,product,livemode) values(ca,'diriqo_core',false);
    execute 'set local role authenticated';
    v_retry:=public.pay_worker_advance_atomic(ca,pw,r1,op1,1000,today,'Part one',1,'cash',null);
    assert not (v_retry->>'changed')::boolean,'expired_module_exact_payment_retry_allowed';
    v_error:=null;
    begin perform public.pay_worker_advance_atomic(ca,pw,null,gen_random_uuid(),1,today,'Expired new payment');
    exception when others then get stacked diagnostics v_error=message_text; end;
    assert v_error='ADVANCE_MODULE_REQUIRED','expired_module_new_payment_denied';
    v_result:=public.settle_worker_advance_atomic(ca,v_manual,gen_random_uuid(),500,'returned','HISTORICAL-RETURN',today);
    assert (v_result->>'outstanding_amount')::numeric=0,'expired_module_historical_settlement_allowed';
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',uw,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',uw::text,true);
    execute 'set local role authenticated';
    v_retry:=public.request_advance_atomic(ca,r1,5000,'Synthetic request',null);
    assert not (v_retry->>'changed')::boolean,'expired_request_retry_allowed';
    v_error:=null;
    begin perform public.request_advance_atomic(ca,gen_random_uuid(),1,'Expired request',null);
    exception when others then get stacked diagnostics v_error=message_text; end;
    assert v_error='ADVANCE_MODULE_REQUIRED','expired_new_request_denied';
    passed:=passed||jsonb_build_array('revoked_admin_retry_denied','expired_module_exact_payment_retry_allowed',
      'expired_module_new_payment_denied','expired_module_historical_settlement_allowed','expired_request_retry_allowed','expired_new_request_denied');

    execute 'reset role';
    assert private.advance_payroll_month('2026-10-18')='2026-10-01'::date
      and private.advance_payroll_month('2026-10-19')='2026-10-01'::date
      and private.advance_payroll_month('2026-10-31')='2026-10-01'::date,'new_payments_use_calendar_month_without_payday_cutoff';
    passed:=passed||jsonb_build_array('new_payments_use_calendar_month_without_payday_cutoff');
    raise exception 'rollback synthetic advance fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null; end;
  assert not exists(select 1 from public.companies where id in(ca,cb)),'fixture_companies_rolled_back';
  assert not exists(select 1 from auth.users where id in(ua,uw,um,ub)),'fixture_auth_rolled_back';
  assert not exists(select 1 from public.advance_requests where company_id=ca),'fixture_requests_rolled_back';
  assert not exists(select 1 from public.worker_advances where company_id=ca),'fixture_payments_rolled_back';
  assert not exists(select 1 from public.worker_advance_settlements where company_id=ca),'fixture_settlements_rolled_back';
  perform set_config('diriqo.worker_advance_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),
    'fixtures','rolled_back','cleanup_assertions',5,'concurrency','requires_separate_authenticated_sessions',
    'late_failure','revision_overflow_after_payment_insert')::text,true);
end;
$test$;
select current_setting('diriqo.worker_advance_test_result')::jsonb as result;
