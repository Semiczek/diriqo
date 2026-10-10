-- Authorized Diriqo TEST project only, after module capability authority is installed.
-- Genuine database roles, synthetic UUID-scoped data and rollback only; no DDL/provider calls.
-- The inspected database has no job-creation SECURITY DEFINER RPC. Owner/service inserts
-- exercise bypass-RLS contexts without inventing such an endpoint or claiming its coverage.
-- Sequential tests do not establish simultaneous-transaction behavior.
do $test$
declare
  u_admin uuid:=gen_random_uuid(); u_worker uuid:=gen_random_uuid(); u_other uuid:=gen_random_uuid(); u_manager uuid:=gen_random_uuid();
  p_admin uuid:=gen_random_uuid(); p_worker uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid(); p_manager uuid:=gen_random_uuid();
  c_paid uuid:=gen_random_uuid(); c_legacy uuid:=gen_random_uuid(); c_unpaid uuid:=gen_random_uuid();
  c_other uuid:=gen_random_uuid(); c_addon uuid:=gen_random_uuid(); c_pos uuid:=gen_random_uuid();
  c_old_invoice uuid:=gen_random_uuid(); c_narrow uuid:=gen_random_uuid(); c_case uuid;
  m_paid uuid:=gen_random_uuid();
  customer_paid uuid:=gen_random_uuid(); customer_unpaid uuid:=gen_random_uuid(); customer_old uuid:=gen_random_uuid();
  job_paid uuid:=gen_random_uuid(); job_legacy uuid:=gen_random_uuid(); job_mixed uuid:=gen_random_uuid();
  job_existing uuid; invoice_paid uuid; invoice_old uuid;
  offer_core uuid:=gen_random_uuid(); offer_inventory uuid:=gen_random_uuid(); offer_invoice uuid:=gen_random_uuid();
  offer_quotes uuid:=gen_random_uuid(); offer_fleet uuid:=gen_random_uuid(); offer_pos uuid:=gen_random_uuid();
  offer_core_live uuid:=gen_random_uuid(); offer_core_history uuid:=gen_random_uuid(); offer_core_create uuid:=gen_random_uuid();
  order_fixture uuid; grant_fixture uuid; grant_invoice uuid; register_fixture uuid;
  fixture_companies uuid[];
  marker text:='Capability'||replace(gen_random_uuid()::text,'-','');
  v_now timestamptz:=date_trunc('second',clock_timestamp());
  v_result jsonb; v_before jsonb; v_error text; v_message text; v_case record; v_fixture record;
  v_capability text; v_product text; passed jsonb:='[]';
  core_codes text[]:=array['core.jobs.create','core.jobs.update','core.jobs.close','core.customers.manage',
    'core.workers.manage','core.rates.manage','core.time.record','core.time.approve','core.quotes.create',
    'core.calendar.manage','core.absences.request','core.absences.approve','core.advances.request','core.advances.pay',
    'core.files.upload','core.handover.confirm','core.costs.record'];
begin
  fixture_companies:=array[c_paid,c_legacy,c_unpaid,c_other,c_addon,c_pos,c_old_invoice,c_narrow];
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),(u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-other@example.invalid','{}'),(u_manager,marker||'-manager@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic capability admin'),(p_worker,u_worker,u_worker,'Synthetic capability worker'),
      (p_other,u_other,u_other,'Synthetic capability other'),(p_manager,u_manager,u_manager,'Synthetic capability manager');
    insert into public.companies(id,name) values(c_paid,'Synthetic paid company'),(c_legacy,'Synthetic legacy company'),
      (c_unpaid,'Synthetic unpaid company'),(c_other,'Synthetic other company'),(c_addon,'Synthetic addon without base'),
      (c_pos,'Synthetic POS base'),(c_old_invoice,'Synthetic old invoice rollout'),(c_narrow,'Synthetic narrow core grant');
    insert into public.company_members(id,company_id,profile_id,role,is_active) values
      (m_paid,c_paid,p_admin,'company_admin',true),(gen_random_uuid(),c_paid,p_worker,'worker',true),
      (gen_random_uuid(),c_paid,p_manager,'manager',true),
      (gen_random_uuid(),c_legacy,p_admin,'company_admin',true),(gen_random_uuid(),c_unpaid,p_admin,'company_admin',true),
      (gen_random_uuid(),c_other,p_other,'company_admin',true),(gen_random_uuid(),c_addon,p_admin,'company_admin',true),
      (gen_random_uuid(),c_pos,p_admin,'company_admin',true),(gen_random_uuid(),c_old_invoice,p_admin,'company_admin',true),
      (gen_random_uuid(),c_narrow,p_admin,'company_admin',true);
    insert into public.customers(id,company_id,name) values(customer_paid,c_paid,'Synthetic paid customer'),
      (customer_unpaid,c_unpaid,'Synthetic unpaid customer'),(customer_old,c_old_invoice,'Synthetic old customer');
    insert into private.company_module_rollouts(company_id,product,livemode)
      select c_paid,product,false from unnest(array['diriqo_core','inventory','invoicing','smart_quotes','fleet']) products(product);
    insert into private.company_module_rollouts(company_id,product,livemode)
      select company_id,product,false from unnest(array[c_addon,c_pos]) companies(company_id)
      cross join unnest(array['inventory','invoicing','smart_quotes','fleet']) products(product);
    insert into private.company_module_rollouts(company_id,product,livemode)
      values(c_unpaid,'diriqo_core',false),(c_unpaid,'invoicing',false),(c_narrow,'diriqo_core',false);
    insert into private.invoice_module_rollouts(company_id,livemode) values(c_old_invoice,false);
    insert into public.module_offers(id,offer_key,product,stripe_price_id,livemode,currency,unit_amount,
      capabilities,policy_version,history_days,is_published) values
      (offer_core,marker||'-core','diriqo_core','price_'||marker||'Core',false,'czk',1000,core_codes,'diriqo-capabilities-v0.1',90,true),
      (offer_inventory,marker||'-inventory','inventory','price_'||marker||'Inventory',false,'czk',1000,
        array['inventory.receipt.post','inventory.movement.post'],'diriqo-capabilities-v0.1',90,true),
      (offer_invoice,marker||'-invoice','invoicing','price_'||marker||'Invoice',false,'czk',1000,
        array['invoicing.invoice.issue'],'diriqo-capabilities-v0.1',90,true),
      (offer_quotes,marker||'-quotes','smart_quotes','price_'||marker||'Quotes',false,'czk',1000,
        array['smart_quotes.template.manage'],'diriqo-capabilities-v0.1',90,true),
      (offer_fleet,marker||'-fleet','fleet','price_'||marker||'Fleet',false,'czk',1000,
        array['fleet.vehicle.manage','fleet.trip.record'],'diriqo-capabilities-v0.1',90,true),
      (offer_pos,marker||'-pos','pos','price_'||marker||'Pos',false,'czk',1000,
        array['pos.sale.create'],'diriqo-capabilities-v0.1',90,true),
      (offer_core_live,marker||'-live','diriqo_core','price_'||marker||'Live',true,'czk',1000,core_codes,'diriqo-capabilities-v0.1',90,true),
      (offer_core_history,marker||'-history','diriqo_core','price_'||marker||'History',false,'czk',1000,
        array['core.history.read'],'diriqo-capabilities-v0.1',90,true),
      (offer_core_create,marker||'-create-only','diriqo_core','price_'||marker||'CreateOnly',false,'czk',1000,
        array['core.jobs.create'],'diriqo-capabilities-v0.1',90,true);

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    v_result:=public.get_company_capability_access(c_legacy,'core.jobs.create');
    assert v_result->>'reason'='legacy' and (v_result->>'allowed')::boolean and not (v_result->>'enforced')::boolean
      and v_result->'livemode'='null'::jsonb and (v_result->>'company_id')::uuid=c_legacy,
      'unenrolled_known_capability_retains_legacy_access';
    passed:=passed||jsonb_build_array('unenrolled_known_capability_retains_legacy_access');
    insert into public.jobs(id,company_id,title) values(job_legacy,c_legacy,'Synthetic legacy creation');
    assert exists(select 1 from public.jobs where id=job_legacy), 'unenrolled_job_creation_unchanged';
    passed:=passed||jsonb_build_array('unenrolled_job_creation_unchanged');
    foreach v_capability in array array['unknown.operation','core.history.read','core.economics.read',
      'invoicing.history.export','invoicing.payment.settle','inventory.ocr.request','ai_assistant.conversation.run','pos.sale.create','',null] loop
      v_error:=null; v_message:=null;
      begin perform public.get_company_capability_access(c_legacy,v_capability);
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='22023' and v_message='MODULE_CAPABILITY_UNSUPPORTED', 'unsupported_capability_must_fail_even_in_legacy';
      passed:=passed||jsonb_build_array('unsupported_legacy_capability_'||coalesce(nullif(v_capability,''),'empty_or_null'));
    end loop;
    v_result:=public.get_company_capability_access(c_paid,'core.jobs.create');
    assert (v_result->>'enforced')::boolean and not (v_result->>'allowed')::boolean
      and v_result->>'reason'='module_required' and not (v_result->>'livemode')::boolean,
      'enrolled_without_payment_is_denied';
    passed:=passed||jsonb_build_array('enrolled_without_payment_is_denied');
    assert not (v_result ? 'entitlement_id') and (select count(*) from jsonb_object_keys(v_result))=6,
      'public_decision_exposes_only_six_documented_fields';
    passed:=passed||jsonb_build_array('public_decision_exposes_only_six_documented_fields');
    v_error:=null;
    begin perform private.evaluate_company_capability_access(c_paid,'core.jobs.create',v_now+interval '10 years');
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'tenant_cannot_supply_time_to_private_evaluator';
    passed:=passed||jsonb_build_array('tenant_cannot_supply_time_to_private_evaluator');
    assert private.get_company_capability_access(c_paid,'core.jobs.create')=v_result,
      'authenticated_private_wrapper_is_clock_bound_and_identifier_free';
    passed:=passed||jsonb_build_array('authenticated_private_wrapper_is_clock_bound_and_identifier_free');
    v_error:=null; v_message:=null;
    begin insert into public.jobs(company_id,title) values(c_paid,'Unpaid direct creation');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='CORE_MODULE_REQUIRED', 'direct_job_insert_requires_paid_core';
    passed:=passed||jsonb_build_array('direct_job_insert_requires_paid_core');
    v_error:=null;
    begin insert into private.company_module_rollouts(company_id,product,livemode) values(c_legacy,'diriqo_core',false);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'tenant_cannot_enroll_or_disable_paid_rollout';
    passed:=passed||jsonb_build_array('tenant_cannot_enroll_or_disable_paid_rollout');
    perform set_config('diriqo.modules.enabled','true',true);
    perform set_config('diriqo.module_billing_mode','live',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated',
      'user_metadata',jsonb_build_object('paid',true,'core_enabled',true))::text,true);
    v_result:=public.get_company_capability_access(c_paid,'core.jobs.create');
    assert not (v_result->>'allowed')::boolean and not (v_result->>'livemode')::boolean,
      'session_flags_and_user_metadata_cannot_supply_payment_or_mode';
    passed:=passed||jsonb_build_array('session_flags_and_user_metadata_cannot_supply_payment_or_mode');

    -- Service table privileges may reject before the trigger; owner insertion below
    -- specifically proves the trigger still rejects an RLS-bypassing execution context.
    execute 'set local role service_role';
    v_error:=null; v_message:=null;
    begin insert into public.jobs(company_id,title) values(c_paid,'Service bypass attempt');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501', 'service_direct_job_insert_denied';
    passed:=passed||jsonb_build_array('service_direct_job_insert_denied');
    v_error:=null;
    begin insert into private.company_module_rollouts(company_id,product,livemode) values(c_legacy,'diriqo_core',false);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'service_role_cannot_change_rollout';
    passed:=passed||jsonb_build_array('service_role_cannot_change_rollout');
    execute 'reset role';
    v_error:=null; v_message:=null;
    begin insert into public.jobs(company_id,title) values(c_paid,'Owner bypass attempt');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='CORE_MODULE_REQUIRED', 'owner_insert_with_actor_still_enforces_core_licence';
    passed:=passed||jsonb_build_array('owner_insert_with_actor_still_enforces_core_licence');
    perform set_config('request.jwt.claims','{}',true);
    perform set_config('request.jwt.claim.sub','',true);
    v_error:=null; v_message:=null;
    begin insert into public.jobs(company_id,title) values(c_paid,'Owner missing actor attempt');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='CORE_JOB_CREATE_FORBIDDEN', 'owner_insert_requires_fresh_authenticated_actor';
    passed:=passed||jsonb_build_array('owner_insert_requires_fresh_authenticated_actor');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    v_error:=null;
    begin insert into private.company_module_rollouts(company_id,product,livemode) values(c_legacy,'diriqo_core',true);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='23514', 'rollout_cannot_select_live_billing_mode';
    passed:=passed||jsonb_build_array('rollout_cannot_select_live_billing_mode');

    -- These malformed states are impossible in the immutable paid-authority store.
    insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
      values(c_paid,offer_core,'cus_'||marker||'Malformed') returning id into order_fixture;
    for v_case in select * from (values('revoked',true,'diriqo-capabilities-v0.1',null::uuid),
      ('wrong_policy',false,'unknown-policy',null::uuid),('wrong_register',false,'diriqo-capabilities-v0.1',gen_random_uuid()))
      cases(label,revoked,policy_version,register_id) loop
      v_error:=null;
      begin
        insert into public.company_module_entitlements(company_id,product,register_id,policy_version,source_ref,revoked,
          valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
        values(c_paid,'diriqo_core',v_case.register_id,v_case.policy_version,marker||v_case.label,v_case.revoked,
          v_now-interval '1 day',v_now+interval '1 day',v_now+interval '91 days',core_codes,
          'in_'||marker||v_case.label,'il_'||marker||v_case.label,false,order_fixture);
      exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
      assert v_error='23514', v_case.label||'_grant_cannot_enter_authority_store';
      passed:=passed||jsonb_build_array(v_case.label||'_grant_cannot_enter_authority_store');
    end loop;

    -- Current, expired, future and wrong-mode periods are separate append-only fixtures.
    for v_case in select * from (values
      ('expired',offer_core,v_now-interval '3 days',v_now-interval '1 day'),
      ('future',offer_core,v_now+interval '1 day',v_now+interval '2 days'),
      ('wrong_mode',offer_core_live,v_now-interval '1 day',v_now+interval '1 day'),
      ('missing_capability',offer_core_history,v_now-interval '1 day',v_now+interval '1 day')
    ) cases(label,offer_id,valid_from,valid_until) loop
      c_case:=gen_random_uuid(); job_existing:=gen_random_uuid(); fixture_companies:=array_append(fixture_companies,c_case);
      insert into public.companies(id,name) values(c_case,'Synthetic capability '||v_case.label);
      insert into public.company_members(company_id,profile_id,role,is_active) values(c_case,p_admin,'company_admin',true);
      insert into public.jobs(id,company_id,title,billing_status,is_paid) values(job_existing,c_case,'Synthetic prior job','due',false);
      insert into private.company_module_rollouts(company_id,product,livemode) values(c_case,'diriqo_core',false);
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_case,v_case.offer_id,'cus_'||marker||v_case.label) returning id into order_fixture;
      insert into public.company_module_entitlements(company_id,product,policy_version,source_ref,
        valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
      select c_case,o.product,o.policy_version,marker||v_case.label,v_case.valid_from,v_case.valid_until,
        v_case.valid_until+interval '90 days',o.capabilities,'in_'||marker||v_case.label,'il_'||marker||v_case.label,o.livemode,order_fixture
      from public.module_offers o where o.id=v_case.offer_id;
      execute 'set local role authenticated';
      v_result:=public.get_company_capability_access(c_case,'core.jobs.create');
      assert not (v_result->>'allowed')::boolean and v_result->>'reason'='module_required', v_case.label||'_does_not_authorize_core';
      v_error:=null;
      begin insert into public.jobs(company_id,title) values(c_case,'Invalid grant creation');
      exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
      assert v_error='42501', v_case.label||'_direct_insert_denied';
      passed:=passed||jsonb_build_array(v_case.label||'_introspection_and_insert_denied');
      update public.jobs set billing_status='paid',is_paid=true,paid_at=v_now where id=job_existing;
      assert (select billing_status='paid' and is_paid from public.jobs where id=job_existing), 'existing_job_billing_updates_remain_available';
      passed:=passed||jsonb_build_array(v_case.label||'_prior_job_settlement_preserved');
      execute 'reset role';
    end loop;

    -- Owner fixture grants for dependency/company isolation; service receipt activation below is separate.
    for v_fixture in select company_id,offer_id from unnest(array[c_addon,c_pos]) companies(company_id)
      cross join unnest(array[offer_inventory,offer_invoice,offer_quotes,offer_fleet]) offers(offer_id)
      union all select c_pos,offer_pos union all select c_other,offer_core
      union all select c_old_invoice,offer_core union all select c_old_invoice,offer_invoice
      union all select c_narrow,offer_core_create
    loop
      register_fixture:=case when v_fixture.offer_id=offer_pos then gen_random_uuid() else null end;
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id,register_id)
        values(v_fixture.company_id,v_fixture.offer_id,'cus_'||marker||v_fixture.company_id::text,register_fixture) returning id into order_fixture;
      insert into public.company_module_entitlements(company_id,product,register_id,policy_version,source_ref,
        valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
      select v_fixture.company_id,o.product,register_fixture,o.policy_version,marker||order_fixture::text,
        v_now-interval '1 day',v_now+interval '1 day',v_now+interval '91 days',o.capabilities,
        'in_'||marker||order_fixture::text,'il_'||marker||order_fixture::text,false,order_fixture
      from public.module_offers o where o.id=v_fixture.offer_id;
    end loop;
    execute 'set local role authenticated';
    v_result:=public.get_company_capability_access(c_narrow,'core.jobs.create');
    assert (v_result->>'enforced')::boolean and (v_result->>'allowed')::boolean and v_result->>'reason'='paid',
      'narrow_create_grant_authorizes_exact_purchased_capability';
    passed:=passed||jsonb_build_array('narrow_create_grant_authorizes_exact_purchased_capability');
    v_result:=public.get_company_capability_access(c_narrow,'core.jobs.close');
    assert (v_result->>'enforced')::boolean and not (v_result->>'allowed')::boolean and v_result->>'reason'='module_required',
      'narrow_create_grant_cannot_authorize_job_close';
    passed:=passed||jsonb_build_array('narrow_create_grant_cannot_authorize_job_close');
    foreach v_capability in array array['inventory.receipt.post','invoicing.invoice.issue','smart_quotes.template.manage','fleet.trip.record'] loop
      v_result:=public.get_company_capability_access(c_addon,v_capability);
      assert not (v_result->>'allowed')::boolean and v_result->>'reason'='module_required', 'addon_without_paid_base_denied';
      passed:=passed||jsonb_build_array('addon_without_base_denied_'||v_capability);
      v_result:=public.get_company_capability_access(c_pos,v_capability);
      assert (v_result->>'allowed')::boolean=(v_capability in('inventory.receipt.post','invoicing.invoice.issue')),
        'pos_dependency_only_authorizes_inventory_and_invoicing';
      passed:=passed||jsonb_build_array('pos_dependency_matrix_'||v_capability);
    end loop;
    v_result:=public.get_company_capability_access(c_unpaid,'core.jobs.create');
    assert not (v_result->>'allowed')::boolean, 'other_company_paid_grant_does_not_authorize';
    passed:=passed||jsonb_build_array('other_company_paid_grant_does_not_authorize');
    v_result:=public.get_company_capability_access(c_old_invoice,'invoicing.invoice.issue');
    assert (v_result->>'enforced')::boolean and (v_result->>'allowed')::boolean and v_result->>'reason'='paid',
      'legacy_invoice_rollout_bridges_to_general_introspection';
    passed:=passed||jsonb_build_array('legacy_invoice_rollout_bridges_to_general_introspection');
    v_error:=null; v_message:=null;
    begin insert into public.invoices(company_id,customer_id,invoice_year,customer_snapshot,supplier_snapshot)
      values(c_unpaid,customer_unpaid,extract(year from current_date)::integer,'{}','{}');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_MODULE_REQUIRED', 'general_invoice_rollout_guards_direct_draft_insert';
    passed:=passed||jsonb_build_array('general_invoice_rollout_guards_direct_draft_insert');
    insert into public.invoices(company_id,customer_id,invoice_year,customer_snapshot,supplier_snapshot)
      values(c_old_invoice,customer_old,extract(year from current_date)::integer,'{}','{}') returning id into invoice_old;
    v_result:=public.issue_invoice_atomic(c_old_invoice,invoice_old);
    assert (v_result->>'issued')::boolean, 'old_invoice_rollout_paid_issue_still_works';
    passed:=passed||jsonb_build_array('old_invoice_rollout_paid_issue_still_works');

    execute 'reset role';
    for v_fixture in select * from (values
      ('expired-base',offer_core,v_now-interval '3 days',v_now-interval '1 day'),
      ('future-base',offer_core,v_now+interval '1 day',v_now+interval '2 days'),
      ('other-mode-base',offer_core_live,v_now-interval '1 day',v_now+interval '1 day'),
      ('history-only-base',offer_core_history,v_now-interval '1 day',v_now+interval '1 day')
    ) fixtures(label,offer_id,valid_from,valid_until) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_addon,v_fixture.offer_id,'cus_'||marker||'InvalidBase') returning id into order_fixture;
      insert into public.company_module_entitlements(company_id,product,policy_version,source_ref,
        valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
      select c_addon,o.product,o.policy_version,marker||v_fixture.label,v_fixture.valid_from,v_fixture.valid_until,
        v_fixture.valid_until+interval '90 days',o.capabilities,
        'in_'||marker||v_fixture.label,'il_'||marker||v_fixture.label,o.livemode,order_fixture
      from public.module_offers o where o.id=v_fixture.offer_id;
    end loop;
    execute 'set local role authenticated';
    foreach v_capability in array array['inventory.receipt.post','invoicing.invoice.issue','smart_quotes.template.manage','fleet.trip.record'] loop
      v_result:=public.get_company_capability_access(c_addon,v_capability);
      assert not (v_result->>'allowed')::boolean, 'ineligible_base_periods_cannot_enable_addon';
      passed:=passed||jsonb_build_array('ineligible_base_periods_denied_'||v_capability);
    end loop;
    execute 'reset role';
    for v_fixture in select * from (values(offer_core,'Core'),(offer_inventory,'Inventory'),(offer_invoice,'Invoice'),
      (offer_quotes,'Quotes'),(offer_fleet,'Fleet')) fixtures(offer_id,label) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_paid,v_fixture.offer_id,'cus_'||marker||'Paid') returning id into order_fixture;
      execute 'set local role service_role';
      grant_fixture:=public.apply_paid_module_invoice(order_fixture,'evt_'||marker||v_fixture.label,false,
        'in_'||marker||v_fixture.label,'il_'||marker||v_fixture.label,'cus_'||marker||'Paid','sub_'||marker||v_fixture.label,
        'price_'||marker||v_fixture.label,'czk',1,1000,1000,1000,
        extract(epoch from v_now-interval '1 hour')::bigint,extract(epoch from v_now+interval '1 day')::bigint);
      assert grant_fixture is not null, 'verified_payment_receipt_did_not_create_grant';
      if v_fixture.offer_id=offer_invoice then grant_invoice:=grant_fixture; end if;
      execute 'reset role';
    end loop;
    execute 'set local role authenticated';
    foreach v_capability in array core_codes||array['inventory.receipt.post','inventory.movement.post','invoicing.invoice.issue',
      'smart_quotes.template.manage','fleet.vehicle.manage','fleet.trip.record'] loop
      v_result:=public.get_company_capability_access(c_paid,v_capability);
      assert (v_result->>'enforced')::boolean and (v_result->>'allowed')::boolean and v_result->>'reason'='paid'
        and v_result->>'capability'=v_capability and (v_result->>'company_id')::uuid=c_paid and not (v_result->>'livemode')::boolean,
        'paid_capability_contract_mismatch';
      passed:=passed||jsonb_build_array('paid_capability_'||v_capability);
    end loop;
    insert into public.jobs(id,company_id,customer_id,title,status,work_state,price)
      values(job_paid,c_paid,customer_paid,'Synthetic paid invoice job','done','done',100);
    passed:=passed||jsonb_build_array('verified_paid_core_allows_job_insert');
    v_error:=null; v_message:=null;
    begin insert into public.invoices(company_id,customer_id,invoice_year,status,customer_snapshot,supplier_snapshot)
      values(c_paid,customer_paid,extract(year from current_date)::integer,'issued','{}','{}');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_INVALID_STATE', 'general_invoice_rollout_cannot_insert_already_issued';
    passed:=passed||jsonb_build_array('general_invoice_rollout_cannot_insert_already_issued');
    v_result:=public.create_invoice_from_jobs_atomic(c_paid,customer_paid,array[job_paid],current_date,current_date,current_date+14,21,null,gen_random_uuid());
    invoice_paid:=(v_result->>'invoice_id')::uuid;
    assert invoice_paid is not null and (v_result->>'created')::boolean, 'general_core_and_invoice_rollouts_allow_atomic_draft';
    passed:=passed||jsonb_build_array('general_core_and_invoice_rollouts_allow_atomic_draft');
    v_result:=public.issue_invoice_atomic(c_paid,invoice_paid);
    assert (v_result->>'issued')::boolean and (select billing_status='due' from public.jobs where id=job_paid),
      'general_paid_invoice_issue_updates_existing_job';
    passed:=passed||jsonb_build_array('general_paid_invoice_issue_updates_existing_job');
    execute 'reset role';
    assert (select company_id=c_paid and entitlement_id=grant_invoice and actor_auth_user_id=u_admin
      from private.invoice_issue_authorizations where invoice_id=invoice_paid),
      'general_paid_invoice_issue_preserves_persisted_entitlement_provenance';
    passed:=passed||jsonb_build_array('general_paid_invoice_issue_preserves_persisted_entitlement_provenance');
    execute 'set local role authenticated';

    -- One failed row rolls back the whole INSERT...SELECT statement, including the eligible row.
    v_error:=null;
    begin insert into public.jobs(id,company_id,title)
      select id,company_id,'Synthetic mixed licence statement'
      from (values(job_mixed,c_paid,1),(gen_random_uuid(),c_unpaid,2)) candidates(id,company_id,sequence_number)
      order by sequence_number;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501' and not exists(select 1 from public.jobs where id=job_mixed), 'mixed_company_insert_select_rolls_back_every_row';
    passed:=passed||jsonb_build_array('mixed_company_insert_select_rolls_back_every_row');
    v_error:=null; v_message:=null;
    begin update public.jobs set company_id=c_unpaid where id=job_legacy;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='CORE_JOB_SCOPE_IMMUTABLE', 'legacy_insert_cannot_be_moved_into_enforced_company';
    passed:=passed||jsonb_build_array('legacy_insert_cannot_be_moved_into_enforced_company');

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_worker::text,true);
    v_result:=public.get_company_capability_access(c_paid,'core.jobs.create');
    assert (v_result->>'allowed')::boolean, 'active_worker_can_inspect_licence_without_write_authority';
    passed:=passed||jsonb_build_array('active_worker_can_inspect_licence_without_write_authority');
    v_error:=null; v_message:=null;
    begin insert into public.jobs(company_id,title) values(c_paid,'Worker paid job creation');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='CORE_JOB_CREATE_FORBIDDEN', 'paid_licence_does_not_grant_worker_job_creation';
    passed:=passed||jsonb_build_array('paid_licence_does_not_grant_worker_job_creation');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_manager,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_manager::text,true);
    v_result:=public.get_company_capability_access(c_paid,'core.jobs.create');
    assert (v_result->>'allowed')::boolean, 'manager_can_inspect_paid_core_without_create_authority';
    passed:=passed||jsonb_build_array('manager_can_inspect_paid_core_without_create_authority');
    v_error:=null; v_message:=null;
    begin insert into public.jobs(company_id,title) values(c_paid,'Manager paid job creation');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='CORE_JOB_CREATE_FORBIDDEN', 'paid_licence_does_not_grant_manager_job_creation';
    passed:=passed||jsonb_build_array('paid_licence_does_not_grant_manager_job_creation');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    v_error:=null; v_message:=null;
    begin perform public.get_company_capability_access(c_paid,'core.jobs.create');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='MODULE_CAPABILITY_FORBIDDEN', 'foreign_admin_cannot_inspect_company_licence';
    passed:=passed||jsonb_build_array('foreign_admin_cannot_inspect_company_licence');
    execute 'reset role';
    update public.company_members set is_active=false where id=m_paid;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    v_error:=null; v_message:=null;
    begin perform public.get_company_capability_access(c_paid,'core.jobs.create');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='MODULE_CAPABILITY_FORBIDDEN', 'membership_removal_is_effective_without_token_refresh';
    passed:=passed||jsonb_build_array('membership_removal_is_effective_without_token_refresh');
    perform set_config('request.jwt.claims','{}',true);
    perform set_config('request.jwt.claim.sub','',true);
    execute 'set local role anon';
    v_error:=null;
    begin perform public.get_company_capability_access(c_paid,'core.jobs.create');
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'anonymous_capability_inspection_denied';
    passed:=passed||jsonb_build_array('anonymous_capability_inspection_denied');
    execute 'reset role';
    raise exception 'rollback synthetic capability fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other,u_manager])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.companies where id=any(fixture_companies)), 'company_fixture_cleanup';
  assert not exists(select 1 from public.jobs where company_id=any(fixture_companies)), 'job_fixture_cleanup';
  assert not exists(select 1 from private.company_module_rollouts where company_id=any(fixture_companies)), 'rollout_fixture_cleanup';
  assert not exists(select 1 from public.module_offers where offer_key like marker||'%'), 'offer_fixture_cleanup';
  assert not exists(select 1 from private.invoice_draft_requests where company_id=any(fixture_companies)), 'request_fixture_cleanup';
  perform set_config('diriqo.module_capability_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),
    'fixtures','rolled_back','cleanup_assertions',6,'concurrency','not_tested_single_session',
    'job_creation_security_definer_rpc','absent_from_inspected_database')::text,true);
end;
$test$;
select current_setting('diriqo.module_capability_test_result')::jsonb as result;
