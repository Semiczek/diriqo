-- Authorized TEST project only, after the test-grant migration is installed.
-- Synthetic UUID-scoped fixtures, real database roles, no DDL or payment fixtures.
-- Every write is rolled back by the nested exception block, including immutable audit rows.
-- Single-session assertions do not prove concurrency or authenticated application E2E behavior.
do $test$
declare
  u_admin uuid:=gen_random_uuid(); u_worker uuid:=gen_random_uuid(); u_other uuid:=gen_random_uuid();
  p_admin uuid:=gen_random_uuid(); p_worker uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid();
  c_all uuid:=gen_random_uuid(); c_empty uuid:=gen_random_uuid(); c_other uuid:=gen_random_uuid();
  c_addon uuid:=gen_random_uuid(); c_pos uuid:=gen_random_uuid(); c_legacy uuid:=gen_random_uuid();
  c_narrow uuid:=gen_random_uuid(); c_old uuid:=gen_random_uuid(); c_case uuid;
  m_all uuid:=gen_random_uuid(); customer_all uuid:=gen_random_uuid(); customer_old uuid:=gen_random_uuid();
  job_all uuid:=gen_random_uuid(); invoice_all uuid; invoice_spare uuid; invoice_old uuid;
  core_grant uuid; invoice_grant uuid; grant_case uuid;
  fixture_companies uuid[];
  marker text:='TestGrant'||replace(gen_random_uuid()::text,'-','');
  v_now timestamptz:=date_trunc('second',clock_timestamp());
  v_result jsonb; v_before jsonb; v_case record; v_fixture record;
  v_candidate private.company_test_module_grants%rowtype;
  v_error text; v_message text; v_role text; v_capability text; v_operation text;
  passed jsonb:='[]';
  core_codes text[]:=array['core.jobs.create','core.jobs.update','core.jobs.close','core.customers.manage',
    'core.workers.manage','core.rates.manage','core.time.record','core.time.approve','core.quotes.create',
    'core.calendar.manage','core.absences.request','core.absences.approve','core.advances.request',
    'core.advances.pay','core.files.upload','core.handover.confirm','core.costs.record'];
begin
  fixture_companies:=array[c_all,c_empty,c_other,c_addon,c_pos,c_legacy,c_narrow,c_old];
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),(u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-other@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic test module admin'),(p_worker,u_worker,u_worker,'Synthetic test module worker'),
      (p_other,u_other,u_other,'Synthetic other admin');
    insert into public.companies(id,name) select id,'Synthetic test grant company' from unnest(fixture_companies) ids(id);
    insert into public.company_members(id,company_id,profile_id,role,is_active)
      select case when id=c_all then m_all else gen_random_uuid() end,id,
        case when id=c_other then p_other else p_admin end,'company_admin',true from unnest(fixture_companies) ids(id);
    insert into public.company_members(company_id,profile_id,role,is_active) values(c_all,p_worker,'worker',true);
    insert into public.customers(id,company_id,name) values(customer_all,c_all,'Synthetic invoice customer'),
      (customer_old,c_old,'Synthetic old pilot customer');
    insert into private.company_module_rollouts(company_id,product,livemode)
      select company_id,product,false from unnest(array[c_all,c_addon,c_pos,c_empty,c_other,c_narrow]) companies(company_id)
      cross join unnest(array['diriqo_core','inventory','invoicing','smart_quotes','fleet']) products(product);
    insert into private.invoice_module_rollouts(company_id,livemode) values(c_old,false);

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    assert public.get_company_test_module_entitlements(c_empty)='[]'::jsonb, 'empty_test_ledger_is_empty';
    passed:=passed||jsonb_build_array('empty_test_ledger_is_empty');
    v_result:=public.get_company_capability_access(c_empty,'core.jobs.create');
    assert not (v_result->>'allowed')::boolean and v_result->>'reason'='module_required', 'no_test_grant_means_no_access';
    passed:=passed||jsonb_build_array('no_test_grant_means_no_access');
    execute 'reset role';

    -- No paid ledger, purchase order, payment event or provider identifier is fabricated.
    for v_fixture in select company_id,product,capabilities,register_id from
      unnest(array[c_all,c_addon,c_pos]) companies(company_id)
      cross join (values
        ('diriqo_core',core_codes,null::uuid),
        ('inventory',array['inventory.receipt.post','inventory.movement.post'],null::uuid),
        ('invoicing',array['invoicing.invoice.issue','invoicing.history.read','invoicing.history.export'],null::uuid),
        ('smart_quotes',array['smart_quotes.template.manage'],null::uuid),
        ('fleet',array['fleet.vehicle.manage','fleet.trip.record'],null::uuid),
        ('ai_assistant',array['ai_assistant.conversation.run'],null::uuid),
        ('pos',array['pos.sale.create'],gen_random_uuid())
      ) products(product,capabilities,register_id)
      where company_id=c_all or (product<>'diriqo_core' and (product<>'pos' or company_id=c_pos))
      union all select c_narrow,'diriqo_core',array['core.jobs.create'],null::uuid
      union all select c_other,'diriqo_core',core_codes,null::uuid
      union all select c_legacy,'diriqo_core',core_codes,null::uuid
      union all select c_old,'diriqo_core',core_codes,null::uuid
      union all select c_old,'invoicing',array['invoicing.invoice.issue'],null::uuid
    loop
      insert into private.company_test_module_grants(company_id,product,register_id,source_ref,reason,
        valid_from,valid_until,history_until,capabilities)
      values(v_fixture.company_id,v_fixture.product,v_fixture.register_id,marker||'-initial','Synthetic rollback test',
        v_now-interval '1 day',v_now+interval '1 day',v_now+interval '1 day',v_fixture.capabilities)
      returning id into grant_case;
      if v_fixture.company_id=c_all and v_fixture.product='diriqo_core' then core_grant:=grant_case; end if;
      if v_fixture.company_id=c_all and v_fixture.product='invoicing' then invoice_grant:=grant_case; end if;
    end loop;
    execute 'set local role authenticated';
    v_result:=public.get_company_test_module_entitlements(c_all);
    assert jsonb_array_length(v_result)=7 and not exists(select 1 from jsonb_array_elements(v_result) g
      where g->>'company_id'<>c_all::text or g->>'origin'<>'manual_grant' or (g->>'livemode')::boolean
        or g ? 'invoice_id' or g ? 'invoice_line_id' or g ? 'order_id' or g ? 'reason' or g ? 'created_by_db_role'),
      'test_snapshot_is_scoped_nonfinancial_and_omits_internal_audit_details';
    passed:=passed||jsonb_build_array('test_snapshot_is_scoped_nonfinancial_and_omits_internal_audit_details');
    foreach v_capability in array core_codes||array['inventory.receipt.post','inventory.movement.post',
      'invoicing.invoice.issue','smart_quotes.template.manage','fleet.vehicle.manage','fleet.trip.record'] loop
      v_result:=public.get_company_capability_access(c_all,v_capability);
      assert (v_result->>'allowed')::boolean and (v_result->>'enforced')::boolean
        and v_result->>'reason'='test' and not (v_result->>'livemode')::boolean
        and (v_result->>'company_id')::uuid=c_all and v_result->>'capability'=v_capability
        and (select count(*) from jsonb_object_keys(v_result))=6,
        'test_access_must_be_explicit_identifier_free_and_capability_scoped';
      passed:=passed||jsonb_build_array('test_access_'||v_capability);
    end loop;
    foreach v_capability in array array['pos.sale.create','ai_assistant.conversation.run','inventory.ocr.request','unknown.operation'] loop
      v_error:=null; v_message:=null;
      begin perform public.get_company_capability_access(c_all,v_capability);
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='22023' and v_message='MODULE_CAPABILITY_UNSUPPORTED', 'test_grant_does_not_bypass_unsupported_domain_boundary';
      passed:=passed||jsonb_build_array('unsupported_test_operation_'||v_capability);
    end loop;
    v_result:=public.get_company_capability_access(c_legacy,'core.jobs.create');
    assert v_result->>'reason'='legacy' and not (v_result->>'enforced')::boolean and v_result->'livemode'='null'::jsonb,
      'test_grant_does_not_enroll_legacy_company';
    passed:=passed||jsonb_build_array('test_grant_does_not_enroll_legacy_company');
    assert (public.get_company_capability_access(c_narrow,'core.jobs.create')->>'allowed')::boolean
      and not (public.get_company_capability_access(c_narrow,'core.jobs.close')->>'allowed')::boolean,
      'test_grant_only_authorizes_listed_capabilities';
    passed:=passed||jsonb_build_array('test_grant_only_authorizes_listed_capabilities');
    foreach v_capability in array array['inventory.receipt.post','invoicing.invoice.issue','smart_quotes.template.manage','fleet.trip.record'] loop
      assert not (public.get_company_capability_access(c_addon,v_capability)->>'allowed')::boolean,
        'test_addon_without_base_denied';
      passed:=passed||jsonb_build_array('test_addon_without_base_'||v_capability);
      assert (public.get_company_capability_access(c_pos,v_capability)->>'allowed')::boolean
        = (v_capability in ('inventory.receipt.post','invoicing.invoice.issue')), 'test_pos_dependency_matrix';
      passed:=passed||jsonb_build_array('test_pos_dependency_'||v_capability);
    end loop;
    assert not (public.get_company_capability_access(c_empty,'core.jobs.create')->>'allowed')::boolean,
      'other_company_test_grant_does_not_authorize';
    passed:=passed||jsonb_build_array('other_company_test_grant_does_not_authorize');
    perform set_config('diriqo.module_billing_mode','live',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated',
      'user_metadata',jsonb_build_object('test_grant',true,'paid',true,'livemode',true))::text,true);
    v_result:=public.get_company_capability_access(c_all,'core.jobs.create');
    assert v_result->>'reason'='test' and not (v_result->>'livemode')::boolean
      and not (public.get_company_capability_access(c_empty,'core.jobs.create')->>'allowed')::boolean,
      'settings_and_user_metadata_cannot_change_grant_mode_or_supply_access';
    passed:=passed||jsonb_build_array('settings_and_user_metadata_cannot_change_grant_mode_or_supply_access');
    v_error:=null;
    begin perform private.evaluate_company_capability_access(c_all,'core.jobs.create',v_now+interval '10 years');
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'tenant_cannot_forge_authority_clock';
    passed:=passed||jsonb_build_array('tenant_cannot_forge_authority_clock');
    execute 'reset role';

    -- Both the grant itself and its dependency must be current and unrevoked.
    for v_case in select * from (values
      ('expired_grant',false,v_now-interval '3 days',v_now-interval '1 day',false),
      ('future_grant',false,v_now+interval '1 day',v_now+interval '2 days',false),
      ('revoked_grant',false,v_now-interval '1 day',v_now+interval '1 day',true),
      ('expired_base',true,v_now-interval '3 days',v_now-interval '1 day',false),
      ('future_base',true,v_now+interval '1 day',v_now+interval '2 days',false),
      ('revoked_base',true,v_now-interval '1 day',v_now+interval '1 day',true)
    ) cases(label,is_base,valid_from,valid_until,revoke) loop
      c_case:=gen_random_uuid(); fixture_companies:=array_append(fixture_companies,c_case);
      insert into public.companies(id,name) values(c_case,'Synthetic '||v_case.label);
      insert into public.company_members(company_id,profile_id,role,is_active) values(c_case,p_admin,'company_admin',true);
      insert into private.company_module_rollouts(company_id,product,livemode)
        values(c_case,'diriqo_core',false),(c_case,'invoicing',false);
      insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
      values(c_case,'diriqo_core',marker||'-period','Synthetic period case',v_case.valid_from,v_case.valid_until,v_case.valid_until,
        array['core.jobs.create']) returning id into grant_case;
      if v_case.revoke then
        update private.company_test_module_grants set revoked_at=v_now-interval '1 hour',revocation_reason='Synthetic revocation' where id=grant_case;
        assert (select revoked_at>=v_now from private.company_test_module_grants where id=grant_case), 'revocation_uses_database_clock';
      end if;
      if v_case.is_base then
        insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
          values(c_case,'invoicing',marker||'-addon','Synthetic dependency case',v_now-interval '1 day',v_now+interval '1 day',
            v_now+interval '1 day',array['invoicing.invoice.issue']);
      end if;
      execute 'set local role authenticated';
      v_capability:=case when v_case.is_base then 'invoicing.invoice.issue' else 'core.jobs.create' end;
      v_result:=public.get_company_capability_access(c_case,v_capability);
      assert not (v_result->>'allowed')::boolean and v_result->>'reason'='module_required', 'ineligible_test_period_or_dependency_denied';
      v_error:=null; v_message:=null;
      begin insert into public.jobs(company_id,title) values(c_case,'Invalid period creation');
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='42501' and v_message='CORE_MODULE_REQUIRED', 'invalid_test_base_cannot_create_jobs';
      v_result:=public.get_company_test_module_entitlements(c_case);
      assert jsonb_array_length(v_result)=case when v_case.is_base then 2 else 1 end,
        'inactive_test_period_retained_in_snapshot';
      passed:=passed||jsonb_build_array(v_case.label||'_denied_history_preserved');
      execute 'reset role';
    end loop;

    -- Invalid grants cannot enter the authority store, even through owner fixtures.
    for v_case in select * from (values
      ('live',jsonb_build_object('livemode',true)),('paid_origin',jsonb_build_object('origin','paid')),
      ('unknown_product',jsonb_build_object('product','unknown')),('wrong_policy',jsonb_build_object('policy_version','future-policy')),
      ('wrong_capability',jsonb_build_object('capabilities',jsonb_build_array('invoicing.invoice.issue'))),
      ('duplicate_capability',jsonb_build_object('capabilities',jsonb_build_array('core.jobs.create','core.jobs.create'))),
      ('empty_capabilities',jsonb_build_object('capabilities','[]'::jsonb)),
      ('null_capability',jsonb_build_object('capabilities',jsonb_build_array(null))),
      ('company_register',jsonb_build_object('register_id',gen_random_uuid())),
      ('pos_without_register',jsonb_build_object('product','pos','capabilities',jsonb_build_array('pos.sale.create'))),
      ('over_30_days',jsonb_build_object('valid_until',v_now+interval '31 days','history_until',v_now+interval '31 days')),
      ('extended_history',jsonb_build_object('history_until',v_now+interval '2 days')),
      ('empty_period',jsonb_build_object('valid_until',v_now,'history_until',v_now)),
      ('infinite_period',jsonb_build_object('valid_until','infinity','history_until','infinity')),
      ('missing_reason',jsonb_build_object('reason',' ')),('missing_source',jsonb_build_object('source_ref',' ')),
      ('unreasoned_revocation',jsonb_build_object('revoked_at',v_now))
    ) cases(label,changes) loop
      v_candidate:=jsonb_populate_record(null::private.company_test_module_grants,jsonb_build_object(
        'company_id',c_empty,'product','diriqo_core','policy_version','diriqo-capabilities-v0.1',
        'source_ref',marker||'-invalid-'||v_case.label,'reason','Synthetic invalid case','origin','manual_grant',
        'state','active','livemode',false,'valid_from',v_now,'valid_until',v_now+interval '1 day',
        'history_until',v_now+interval '1 day','capabilities',jsonb_build_array('core.jobs.create'))||v_case.changes);
      v_error:=null;
      begin
        insert into private.company_test_module_grants(company_id,product,register_id,policy_version,source_ref,reason,
          origin,state,livemode,valid_from,valid_until,history_until,capabilities,revoked_at,revocation_reason)
        values(v_candidate.company_id,v_candidate.product,v_candidate.register_id,v_candidate.policy_version,v_candidate.source_ref,
          v_candidate.reason,v_candidate.origin,v_candidate.state,v_candidate.livemode,v_candidate.valid_from,v_candidate.valid_until,
          v_candidate.history_until,v_candidate.capabilities,v_candidate.revoked_at,v_candidate.revocation_reason);
      exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
      assert v_error='23514', 'invalid_test_grant_must_fail_check_constraint';
      passed:=passed||jsonb_build_array('invalid_test_grant_'||v_case.label);
    end loop;
    v_error:=null;
    begin insert into private.company_module_rollouts(company_id,product,livemode) values(c_legacy,'diriqo_core',true);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='23514', 'test_grant_cannot_be_evaluated_as_live_rollout';
    passed:=passed||jsonb_build_array('test_grant_cannot_be_evaluated_as_live_rollout');

    foreach v_role in array array['authenticated','service_role','anon'] loop
      execute format('set local role %I',v_role);
      foreach v_operation in array array['select','insert','update','delete'] loop
        v_error:=null;
        begin
          if v_operation='select' then perform 1 from private.company_test_module_grants where company_id=c_all;
          elsif v_operation='insert' then
            insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
              values(c_empty,'diriqo_core',marker||'-forged','Forged grant',v_now,v_now+interval '1 day',v_now+interval '1 day',array['core.jobs.create']);
          elsif v_operation='update' then
            update private.company_test_module_grants set revoked_at=v_now,revocation_reason='Forged revocation' where id=core_grant;
          else delete from private.company_test_module_grants where id=core_grant; end if;
        exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
        assert v_error='42501', 'untrusted_role_must_not_access_private_test_ledger';
        passed:=passed||jsonb_build_array(v_role||'_test_ledger_'||v_operation||'_denied');
      end loop;
      if v_role<>'authenticated' then
        v_error:=null;
        begin perform public.get_company_test_module_entitlements(c_all);
        exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
        assert v_error='42501', 'test_snapshot_is_authenticated_only';
        passed:=passed||jsonb_build_array(v_role||'_test_snapshot_denied');
      end if;
      execute 'reset role';
    end loop;

    -- Exercise existing domain triggers with test access, preserving separate provenance.
    execute 'set local role authenticated';
    insert into public.jobs(id,company_id,customer_id,title,status,work_state,price)
      values(job_all,c_all,customer_all,'Synthetic test invoice job','done','done',100);
    v_result:=public.create_invoice_from_jobs_atomic(c_all,customer_all,array[job_all],current_date,current_date,current_date+14,21,null,gen_random_uuid());
    invoice_all:=(v_result->>'invoice_id')::uuid;
    assert (v_result->>'created')::boolean and invoice_all is not null, 'test_core_and_invoice_allow_atomic_draft';
    passed:=passed||jsonb_build_array('test_core_and_invoice_allow_atomic_draft');
    v_result:=public.issue_invoice_atomic(c_all,invoice_all);
    assert (v_result->>'issued')::boolean and v_result->>'status'='issued'
      and (select billing_status='due' from public.jobs where id=job_all), 'test_invoice_issue_updates_linked_job';
    passed:=passed||jsonb_build_array('test_invoice_issue_updates_linked_job');
    v_before:=v_result;
    v_result:=public.issue_invoice_atomic(c_all,invoice_all);
    assert not (v_result->>'issued')::boolean and v_result->>'invoice_number'=v_before->>'invoice_number', 'test_issue_retry_is_idempotent';
    passed:=passed||jsonb_build_array('test_issue_retry_is_idempotent');
    insert into public.invoices(company_id,customer_id,invoice_year,customer_snapshot,supplier_snapshot)
      values(c_all,customer_all,extract(year from current_date)::integer,'{}','{}') returning id into invoice_spare;
    insert into public.invoices(company_id,customer_id,invoice_year,customer_snapshot,supplier_snapshot)
      values(c_old,customer_old,extract(year from current_date)::integer,'{}','{}') returning id into invoice_old;
    assert (public.issue_invoice_atomic(c_old,invoice_old)->>'issued')::boolean, 'old_invoice_pilot_accepts_test_authority';
    passed:=passed||jsonb_build_array('old_invoice_pilot_accepts_test_authority');
    execute 'reset role';
    assert (select company_id=c_all and test_grant_id=invoice_grant and actor_auth_user_id=u_admin
      and issued_at=(select issued_at from public.invoices where id=invoice_all)
      from private.invoice_test_issue_authorizations where invoice_id=invoice_all), 'issued_test_invoice_has_exact_test_provenance';
    assert not exists(select 1 from private.invoice_issue_authorizations where invoice_id=any(array[invoice_all,invoice_old])),
      'test_invoice_never_claims_paid_provenance';
    passed:=passed||jsonb_build_array('issued_test_invoice_has_exact_test_provenance','test_invoice_never_claims_paid_provenance');
    v_error:=null;
    begin insert into private.invoice_test_issue_authorizations(invoice_id,company_id,test_grant_id,issued_at,actor_auth_user_id)
      values(invoice_spare,c_other,invoice_grant,v_now,u_admin);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='23503', 'test_provenance_grant_company_fk_prevents_cross_company_reference';
    passed:=passed||jsonb_build_array('test_provenance_grant_company_fk_prevents_cross_company_reference');
    foreach v_operation in array array['update','delete'] loop
      v_error:=null; v_message:=null;
      begin
        if v_operation='update' then update private.invoice_test_issue_authorizations set issued_at=v_now where invoice_id=invoice_all;
        else delete from private.invoice_test_issue_authorizations where invoice_id=invoice_all; end if;
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='42501' and v_message='INVOICE_AUTHORIZATION_IMMUTABLE', 'test_invoice_provenance_is_immutable';
      passed:=passed||jsonb_build_array('test_invoice_provenance_'||v_operation||'_denied');
    end loop;
    foreach v_operation in array array['update','delete'] loop
      v_error:=null; v_message:=null;
      begin
        if v_operation='update' then update private.company_test_module_grants set valid_until=valid_until+interval '1 hour',history_until=history_until+interval '1 hour' where id=core_grant;
        else delete from private.company_test_module_grants where id=core_grant; end if;
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='42501' and v_message='TEST_MODULE_GRANT_IMMUTABLE', 'owner_cannot_rewrite_original_test_grant';
      passed:=passed||jsonb_build_array('owner_test_grant_'||v_operation||'_denied');
    end loop;

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_worker::text,true);
    execute 'set local role authenticated';
    assert jsonb_array_length(public.get_company_test_module_entitlements(c_all))=7
      and (public.get_company_capability_access(c_all,'core.jobs.create')->>'allowed')::boolean,
      'worker_can_inspect_test_access';
    v_error:=null; v_message:=null;
    begin insert into public.jobs(company_id,title) values(c_all,'Worker test-grant creation');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='CORE_JOB_CREATE_FORBIDDEN', 'test_grant_does_not_supply_worker_role';
    passed:=passed||jsonb_build_array('worker_can_inspect_test_access','test_grant_does_not_supply_worker_role');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    v_error:=null; v_message:=null;
    begin perform public.get_company_test_module_entitlements(c_all);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='TEST_MODULE_FORBIDDEN', 'foreign_company_admin_cannot_read_test_snapshot';
    passed:=passed||jsonb_build_array('foreign_company_admin_cannot_read_test_snapshot');
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    update public.company_members set is_active=false where id=m_all;
    execute 'set local role authenticated';
    v_error:=null; v_message:=null;
    begin perform public.get_company_test_module_entitlements(c_all);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='TEST_MODULE_FORBIDDEN', 'removed_membership_cannot_read_test_snapshot';
    passed:=passed||jsonb_build_array('removed_membership_cannot_read_test_snapshot');
    execute 'reset role';
    update public.company_members set is_active=true where id=m_all;
    update private.company_test_module_grants set revoked_at=v_now,revocation_reason='Synthetic core revocation' where id=core_grant;
    v_error:=null; v_message:=null;
    begin update private.company_test_module_grants set revoked_at=null,revocation_reason=null where id=core_grant;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='TEST_MODULE_GRANT_IMMUTABLE', 'revoked_test_grant_cannot_be_reactivated';
    passed:=passed||jsonb_build_array('revoked_test_grant_cannot_be_reactivated');
    -- The full fixture also has POS. Revoke it so no alternate base remains.
    update private.company_test_module_grants set revoked_at=v_now,revocation_reason='Synthetic POS revocation'
      where company_id=c_all and product='pos';
    execute 'set local role authenticated';
    assert not (public.get_company_capability_access(c_all,'core.jobs.create')->>'allowed')::boolean
      and not (public.get_company_capability_access(c_all,'invoicing.invoice.issue')->>'allowed')::boolean,
      'revoking_all_test_bases_immediately_denies_new_operations';
    passed:=passed||jsonb_build_array('revoking_all_test_bases_immediately_denies_new_operations');
    v_error:=null; v_message:=null;
    begin perform public.issue_invoice_atomic(c_all,invoice_spare);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_MODULE_REQUIRED'
      and (select status='draft' and issued_at is null from public.invoices where id=invoice_spare),
      'revoked_dependency_denies_issue_without_partial_header_write';
    passed:=passed||jsonb_build_array('revoked_dependency_denies_issue_without_partial_header_write');
    update public.invoices set pohoda_export_status='exported' where id=invoice_all;
    assert (select status='issued' and pohoda_export_status='exported' from public.invoices where id=invoice_all)
      and not (public.issue_invoice_atomic(c_all,invoice_all)->>'issued')::boolean,
      'test_revocation_preserves_invoice_history_export_metadata_and_retry';
    passed:=passed||jsonb_build_array('test_revocation_preserves_invoice_history_export_metadata_and_retry');
    execute 'reset role';
    assert exists(select 1 from private.invoice_test_issue_authorizations where invoice_id=invoice_all and test_grant_id=invoice_grant),
      'test_provenance_survives_dependency_revocation';
    assert not exists(select 1 from public.company_module_entitlements where company_id=any(fixture_companies))
      and not exists(select 1 from public.module_purchase_orders where company_id=any(fixture_companies)),
      'test_execution_creates_no_paid_grants_or_purchase_orders';
    passed:=passed||jsonb_build_array('test_provenance_survives_dependency_revocation','test_execution_creates_no_paid_grants_or_purchase_orders');
    raise exception 'rollback synthetic test grant fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.companies where id=any(fixture_companies)), 'company_fixture_cleanup';
  assert not exists(select 1 from private.company_test_module_grants where company_id=any(fixture_companies)), 'test_grant_fixture_cleanup';
  assert not exists(select 1 from private.invoice_test_issue_authorizations where company_id=any(fixture_companies)), 'test_provenance_fixture_cleanup';
  assert not exists(select 1 from public.invoices where company_id=any(fixture_companies)), 'invoice_fixture_cleanup';
  assert not exists(select 1 from public.jobs where company_id=any(fixture_companies)), 'job_fixture_cleanup';
  assert not exists(select 1 from private.company_module_rollouts where company_id=any(fixture_companies)), 'rollout_fixture_cleanup';
  perform set_config('diriqo.module_test_grants_result',jsonb_build_object('count',jsonb_array_length(passed),'passed',passed,
    'fixtures','rolled_back','cleanup_assertions',7,'concurrency','not_tested_single_session','paid_fixtures',0)::text,true);
end;
$test$;
select current_setting('diriqo.module_test_grants_result')::jsonb as result;
