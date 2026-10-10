-- Run only in the authorized TEST database after the checkout draft is reviewed/applied.
-- All synthetic fixtures, including owner-only paid-period fixtures, roll back.
-- This single-session suite checks real DB roles, sequential replay and invariants.
-- It does NOT prove simultaneous transaction behavior or create any Stripe resources.
do $test$
declare
  u_a uuid := gen_random_uuid(); u_a2 uuid := gen_random_uuid(); u_b uuid := gen_random_uuid();
  u_worker uuid := gen_random_uuid(); u_inactive uuid := gen_random_uuid(); u_legacy uuid := gen_random_uuid();
  u_conflict uuid := gen_random_uuid();
  p_a uuid := gen_random_uuid(); p_a2 uuid := gen_random_uuid(); p_b uuid := gen_random_uuid();
  p_worker uuid := gen_random_uuid(); p_inactive uuid := gen_random_uuid(); p_legacy uuid := gen_random_uuid();
  p_conflict uuid := gen_random_uuid();
  c_a uuid := gen_random_uuid(); c_b uuid := gen_random_uuid(); c_dep uuid := gen_random_uuid();
  c_pos uuid := gen_random_uuid(); c_legacy uuid := gen_random_uuid(); c_unmapped uuid := gen_random_uuid();
  offer_core uuid := gen_random_uuid(); offer_core2 uuid := gen_random_uuid(); offer_live uuid := gen_random_uuid();
  offer_inventory uuid := gen_random_uuid(); offer_invoicing uuid := gen_random_uuid();
  offer_quotes uuid := gen_random_uuid(); offer_fleet uuid := gen_random_uuid();
  offer_pos uuid := gen_random_uuid(); offer_ai uuid := gen_random_uuid(); offer_hidden uuid := gen_random_uuid();
  v_now timestamptz := date_trunc('second', clock_timestamp());
  marker text := 'Checkout' || replace(gen_random_uuid()::text, '-', '');
  attempt_a jsonb; attempt_b jsonb; attempt_replay jsonb; attempt_json jsonb;
  order_a uuid; order_b uuid; order_fixture uuid; expires_a bigint; expires_b bigint;
  customer_a text; customer_b text; session_a text; session_b text; url_a text; url_b text;
  passed jsonb := '[]'; v_case record; v_error text; v_actor uuid; v_offer uuid; v_company uuid;
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_a,marker||'-a@example.invalid','{}'),(u_a2,marker||'-a2@example.invalid','{}'),
      (u_b,marker||'-b@example.invalid','{}'),(u_worker,marker||'-worker@example.invalid','{}'),
      (u_inactive,marker||'-inactive@example.invalid','{}'),(u_legacy,marker||'-legacy@example.invalid','{}'),
      (u_conflict,marker||'-conflict@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_a,u_a,u_a,'Synthetic checkout A'),(p_a2,u_a2,u_a2,'Synthetic checkout A2'),
      (p_b,u_b,u_b,'Synthetic checkout B'),(p_worker,u_worker,u_worker,'Synthetic checkout worker'),
      (p_inactive,u_inactive,u_inactive,'Synthetic checkout inactive'),
      (p_legacy,u_legacy,u_legacy,'Synthetic checkout legacy role'),
      (p_conflict,u_conflict,u_b,'Synthetic conflicting Auth links');
    insert into public.companies(id,name) values
      (c_a,'Synthetic checkout A'),(c_b,'Synthetic checkout B'),(c_dep,'Synthetic checkout dependencies'),
      (c_pos,'Synthetic checkout POS dependencies'),(c_legacy,'Synthetic checkout legacy admin'),
      (c_unmapped,'Synthetic checkout unmapped');
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (c_a,p_a,'company_admin',true),(c_a,p_a2,'company_admin',true),(c_b,p_b,'company_admin',true),
      (c_a,p_worker,'worker',true),(c_a,p_inactive,'company_admin',false),(c_a,p_conflict,'company_admin',true),
      (c_dep,p_a,'company_admin',true),(c_pos,p_a,'company_admin',true),(c_unmapped,p_a,'company_admin',true),
      (c_legacy,p_legacy,'super_admin',true);
    insert into public.module_offers(id,offer_key,product,stripe_price_id,livemode,currency,unit_amount,capabilities,policy_version,history_days,is_published) values
      (offer_core,marker||'core','diriqo_core','price_'||marker||'core',false,'czk',1000,array['core.jobs.create'],'diriqo-capabilities-v0.1',30,true),
      (offer_core2,marker||'core2','diriqo_core','price_'||marker||'core2',false,'czk',2000,array['core.jobs.create'],'diriqo-capabilities-v0.1',30,true),
      (offer_live,marker||'live','diriqo_core','price_'||marker||'live',true,'czk',1000,array['core.jobs.create'],'diriqo-capabilities-v0.1',30,true),
      (offer_inventory,marker||'inventory','inventory','price_'||marker||'inventory',false,'czk',1000,array['inventory.receipt.post'],'diriqo-capabilities-v0.1',30,true),
      (offer_invoicing,marker||'invoicing','invoicing','price_'||marker||'invoicing',false,'czk',1000,array['invoicing.invoice.issue'],'diriqo-capabilities-v0.1',30,true),
      (offer_quotes,marker||'quotes','smart_quotes','price_'||marker||'quotes',false,'czk',1000,array['smart_quotes.template.manage'],'diriqo-capabilities-v0.1',30,true),
      (offer_fleet,marker||'fleet','fleet','price_'||marker||'fleet',false,'czk',1000,array['fleet.vehicle.manage'],'diriqo-capabilities-v0.1',30,true),
      (offer_pos,marker||'pos','pos','price_'||marker||'pos',false,'czk',1000,array['pos.sale.create'],'diriqo-capabilities-v0.1',30,true),
      (offer_ai,marker||'ai','ai_assistant','price_'||marker||'ai',false,'czk',1000,array['ai_assistant.conversation.run'],'diriqo-capabilities-v0.1',30,true),
      (offer_hidden,marker||'hidden','diriqo_core','price_'||marker||'hidden',false,'czk',1000,array['core.jobs.create'],'diriqo-capabilities-v0.1',30,false);
    insert into public.company_subscriptions(company_id,plan_key,status,current_period_start,current_period_end)
      values(c_dep,'scale','active',v_now-interval '1 day',v_now+interval '1 day')
      on conflict(company_id) do update set plan_key='scale',status='active',
        current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;

    execute 'set local role service_role';
    customer_a := public.bind_module_billing_customer(c_a,false,'cus_'||marker||'A');
    assert customer_a = 'cus_'||marker||'A', 'customer_first_binding';
    passed := passed || jsonb_build_array('customer_first_binding');
    assert public.bind_module_billing_customer(c_a,false,'cus_'||marker||'Loser') = customer_a, 'customer_first_writer_wins';
    passed := passed || jsonb_build_array('customer_first_writer_wins');
    assert public.bind_module_billing_customer(c_a,true,'cus_'||marker||'Live') <> customer_a, 'customer_mode_isolation';
    passed := passed || jsonb_build_array('customer_mode_isolation');
    customer_b := public.bind_module_billing_customer(c_b,false,'cus_'||marker||'B');
    perform public.bind_module_billing_customer(c_dep,false,'cus_'||marker||'Dep');
    perform public.bind_module_billing_customer(c_dep,true,'cus_'||marker||'DepLive');
    perform public.bind_module_billing_customer(c_pos,false,'cus_'||marker||'Pos');
    perform public.bind_module_billing_customer(c_legacy,false,'cus_'||marker||'Legacy');

    attempt_a := public.reserve_module_checkout(c_a,offer_core,null,false,u_a);
    order_a := (attempt_a->>'order_id')::uuid;
    expires_a := extract(epoch from (attempt_a->>'expires_at')::timestamptz)::bigint;
    assert attempt_a->>'state' = 'preparing' and attempt_a->>'stripe_session_id' is null
      and (attempt_a->>'company_id')::uuid = c_a and (attempt_a->>'offer_id')::uuid = offer_core
      and attempt_a->>'product' = 'diriqo_core' and attempt_a->>'stripe_customer_id' = customer_a
      and (attempt_a->>'actor_auth_user_id')::uuid = u_a, 'reservation_immutable_scope';
    passed := passed || jsonb_build_array('reservation_immutable_scope');
    assert (attempt_a->>'expires_at')::timestamptz - (attempt_a->>'created_at')::timestamptz = interval '60 minutes'
      and (attempt_a->>'created_at')::timestamptz = date_trunc('second',(attempt_a->>'created_at')::timestamptz), 'reservation_expiry_whole_seconds';
    passed := passed || jsonb_build_array('reservation_expiry_whole_seconds');
    assert public.reserve_module_checkout(c_a,offer_core,null,false,u_a) = attempt_a, 'reservation_replay_same_order';
    passed := passed || jsonb_build_array('reservation_replay_same_order');
    assert public.reserve_module_checkout(c_a,offer_core,null,false,u_a2) = attempt_a, 'second_admin_resumes_same_company_order';
    passed := passed || jsonb_build_array('second_admin_resumes_same_company_order');
    assert (select count(*) from public.module_purchase_orders where company_id=c_a)=1, 'replay_did_not_create_second_order';
    passed := passed || jsonb_build_array('replay_did_not_create_second_order');
    assert not exists(select 1 from public.company_module_entitlements where company_id=c_a), 'reservation_granted_nothing';
    passed := passed || jsonb_build_array('reservation_granted_nothing');
    attempt_b := public.reserve_module_checkout(c_b,offer_core,null,false,u_b);
    order_b := (attempt_b->>'order_id')::uuid;
    expires_b := extract(epoch from (attempt_b->>'expires_at')::timestamptz)::bigint;
    assert order_b <> order_a, 'company_scope_independent';
    passed := passed || jsonb_build_array('company_scope_independent');
    attempt_json := public.reserve_module_checkout(c_a,offer_live,null,true,u_a);
    assert (attempt_json->>'order_id')::uuid <> order_a and (attempt_json->>'livemode')::boolean, 'checkout_mode_independent';
    passed := passed || jsonb_build_array('checkout_mode_independent');
    assert (public.reserve_module_checkout(c_legacy,offer_core,null,false,u_legacy)->>'company_id')::uuid=c_legacy, 'legacy_company_admin_label_allowed';
    passed := passed || jsonb_build_array('legacy_company_admin_label_allowed');

    foreach v_actor in array array[u_worker,u_inactive,u_b,u_conflict] loop
      v_error := null;
      begin perform public.reserve_module_checkout(c_a,offer_core,null,false,v_actor);
      exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
      assert v_error = '42501', 'unauthorized_actor_denied';
      passed := passed || jsonb_build_array('unauthorized_actor_'||v_actor::text||'_denied');
    end loop;
    for v_case in select * from (values
      ('different_offer_conflict', format('select public.reserve_module_checkout(%L,%L,null,false,%L)',c_a,offer_core2,u_a),'23505'),
      ('unpublished_offer_denied', format('select public.reserve_module_checkout(%L,%L,null,false,%L)',c_a,offer_hidden,u_a),'22023'),
      ('offer_mode_mismatch_denied', format('select public.reserve_module_checkout(%L,%L,null,false,%L)',c_a,offer_live,u_a),'22023'),
      ('unmapped_customer_denied', format('select public.reserve_module_checkout(%L,%L,null,false,%L)',c_unmapped,offer_core,u_a),'22023'),
      ('pos_checkout_denied', format('select public.reserve_module_checkout(%L,%L,%L,false,%L)',c_a,offer_pos,gen_random_uuid(),u_a),'22023'),
      ('ai_checkout_denied', format('select public.reserve_module_checkout(%L,%L,null,false,%L)',c_a,offer_ai,u_a),'22023'),
      ('register_on_core_denied', format('select public.reserve_module_checkout(%L,%L,%L,false,%L)',c_a,offer_core,gen_random_uuid(),u_a),'22023'),
      ('missing_actor_denied', format('select public.reserve_module_checkout(%L,%L,null,false,null)',c_a,offer_core),'22023'),
      ('missing_company_denied', format('select public.reserve_module_checkout(%L,%L,null,false,%L)',gen_random_uuid(),offer_core,u_a),'22023'),
      ('cross_company_customer_reuse_denied',format('select public.bind_module_billing_customer(%L,false,%L)',c_unmapped,customer_a),'23505'),
      ('service_customer_insert_denied',format('insert into public.module_billing_customers(company_id,livemode,stripe_customer_id) values(%L,false,%L)',c_unmapped,'cus_'||marker||'Direct'),'42501'),
      ('service_customer_update_denied',format('update public.module_billing_customers set stripe_customer_id=%L where company_id=%L','cus_'||marker||'Rewrite',c_a),'42501'),
      ('service_order_insert_denied',format('insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id) values(%L,%L,%L)',c_a,offer_core,customer_a),'42501'),
      ('service_session_update_denied',format('update public.module_checkout_sessions set state=''expired'' where order_id=%L',order_a),'42501'),
      ('service_session_delete_denied',format('delete from public.module_checkout_sessions where order_id=%L',order_a),'42501')
    ) cases(label,statement,expected) loop
      v_error := null;
      begin execute v_case.statement;
      exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
      assert v_error = v_case.expected, format('%s: expected %s, got %s',v_case.label,v_case.expected,v_error);
      passed := passed || jsonb_build_array(v_case.label);
    end loop;

    -- An active legacy plan is deliberately insufficient for new paid-module dependencies.
    foreach v_offer in array array[offer_inventory,offer_invoicing,offer_quotes,offer_fleet] loop
      v_error := null;
      begin perform public.reserve_module_checkout(c_dep,v_offer,null,false,u_a);
      exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
      assert v_error = '22023', 'legacy_plan_not_module_dependency';
      passed := passed || jsonb_build_array('legacy_plan_not_dependency_'||v_offer::text);
    end loop;

    session_a := 'cs_test_'||marker||'A'; session_b := 'cs_test_'||marker||'B';
    url_a := 'https://checkout.stripe.com/c/pay/'||session_a;
    url_b := 'https://checkout.stripe.com/c/pay/'||session_b;
    for v_case in select * from (values
      ('session_wrong_expiry_denied',format('select public.record_module_checkout_session(%L,%L,%L,%s)',order_a,session_a,url_a,expires_a+1),'22023'),
      ('session_external_host_denied',format('select public.record_module_checkout_session(%L,%L,%L,%s)',order_a,session_a,'https://checkout.stripe.com.evil.invalid/c/pay/'||session_a,expires_a),'22023'),
      ('session_url_userinfo_denied',format('select public.record_module_checkout_session(%L,%L,%L,%s)',order_a,session_a,'https://checkout.stripe.com@evil.invalid/c/pay/'||session_a,expires_a),'22023'),
      ('session_http_denied',format('select public.record_module_checkout_session(%L,%L,%L,%s)',order_a,session_a,'http://checkout.stripe.com/c/pay/'||session_a,expires_a),'22023'),
      ('session_url_id_mismatch_denied',format('select public.record_module_checkout_session(%L,%L,%L,%s)',order_a,session_a,url_b,expires_a),'22023')
    ) cases(label,statement,expected) loop
      v_error := null;
      begin execute v_case.statement;
      exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
      assert v_error = v_case.expected, v_case.label;
      passed := passed || jsonb_build_array(v_case.label);
    end loop;
    attempt_json := public.record_module_checkout_session(order_a,session_a,url_a,expires_a);
    assert attempt_json->>'state'='open' and attempt_json->>'stripe_session_id'=session_a, 'session_attached_once';
    passed := passed || jsonb_build_array('session_attached_once');
    assert public.record_module_checkout_session(order_a,session_a,url_a,expires_a)=attempt_json, 'session_record_replay';
    passed := passed || jsonb_build_array('session_record_replay');
    v_error := null;
    begin perform public.record_module_checkout_session(order_a,session_b,url_b,expires_a);
    exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
    assert v_error='23505', 'session_binding_rewrite_denied';
    passed := passed || jsonb_build_array('session_binding_rewrite_denied');
    v_error := null;
    begin perform public.close_module_checkout_session(order_a,session_b,'complete');
    exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
    assert v_error='23505', 'close_wrong_session_denied';
    passed := passed || jsonb_build_array('close_wrong_session_denied');
    attempt_json := public.close_module_checkout_session(order_a,session_a,'complete');
    assert attempt_json->>'state'='complete', 'canonical_complete_recorded';
    passed := passed || jsonb_build_array('canonical_complete_recorded');
    assert public.close_module_checkout_session(order_a,session_a,'complete')=attempt_json, 'complete_replay_idempotent';
    passed := passed || jsonb_build_array('complete_replay_idempotent');
    v_error := null;
    begin perform public.close_module_checkout_session(order_a,session_a,'expired');
    exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
    assert v_error='22023', 'complete_cannot_downgrade_to_expired';
    passed := passed || jsonb_build_array('complete_cannot_downgrade_to_expired');
    assert public.reserve_module_checkout(c_a,offer_core,null,false,u_a)=attempt_json, 'complete_scope_stays_reserved';
    passed := passed || jsonb_build_array('complete_scope_stays_reserved');
    assert not exists(select 1 from public.company_module_entitlements where company_id=c_a), 'checkout_complete_grants_nothing';
    passed := passed || jsonb_build_array('checkout_complete_grants_nothing');
    perform public.record_module_checkout_session(order_b,session_b,url_b,expires_b);
    attempt_json := public.close_module_checkout_session(order_b,session_b,'expired');
    assert attempt_json->>'state'='expired' and public.close_module_checkout_session(order_b,session_b,'expired')=attempt_json, 'canonical_expiry_replay';
    passed := passed || jsonb_build_array('canonical_expiry_replay');
    attempt_replay := public.reserve_module_checkout(c_b,offer_core,null,false,u_b);
    assert (attempt_replay->>'order_id')::uuid<>order_b, 'canonical_expiry_allows_new_order';
    passed := passed || jsonb_build_array('canonical_expiry_allows_new_order');
    v_error := null;
    begin perform public.close_module_checkout_session(order_b,session_b,'complete');
    exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
    assert v_error='22023', 'expired_session_cannot_reopen_scope';
    passed := passed || jsonb_build_array('expired_session_cannot_reopen_scope');

    execute 'reset role'; -- Owner-only synthetic historic/paid fixtures; no Stripe payment is simulated as real.
    for v_case in select * from (values
      (c_dep,offer_core,false,null::uuid,v_now-interval '2 days',v_now-interval '1 day','expired'),
      (c_dep,offer_core,false,null::uuid,v_now+interval '1 day',v_now+interval '2 days','future'),
      (c_dep,offer_live,true,null::uuid,v_now-interval '1 day',v_now+interval '1 day','wrongmode')
    ) fixtures(company_id,offer_id,livemode,register_id,valid_from,valid_until,label) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id,register_id)
        values(v_case.company_id,v_case.offer_id,'cus_'||marker||'Dep',v_case.register_id) returning id into order_fixture;
      insert into public.company_module_entitlements(company_id,product,register_id,policy_version,source_ref,valid_from,valid_until,
        history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
      select v_case.company_id,o.product,v_case.register_id,o.policy_version,marker||v_case.label,v_case.valid_from,v_case.valid_until,
        v_case.valid_until+interval '30 days',o.capabilities,marker||v_case.label,'il_'||marker||v_case.label,v_case.livemode,order_fixture
      from public.module_offers o where o.id=v_case.offer_id;
    end loop;
    execute 'set local role service_role';
    v_error := null;
    begin perform public.reserve_module_checkout(c_dep,offer_inventory,null,false,u_a);
    exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
    assert v_error='22023', 'expired_future_other_mode_grants_not_dependencies';
    passed := passed || jsonb_build_array('expired_future_other_mode_grants_not_dependencies');
    execute 'reset role';
    for v_case in select * from (values
      (c_dep,offer_core,null::uuid,'depactive'),(c_pos,offer_pos,gen_random_uuid(),'posactive'),(c_a,offer_core,null::uuid,'alreadyactive')
    ) fixtures(company_id,offer_id,register_id,label) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id,register_id)
        values(v_case.company_id,v_case.offer_id,'cus_'||marker||v_case.label,v_case.register_id) returning id into order_fixture;
      insert into public.company_module_entitlements(company_id,product,register_id,policy_version,source_ref,valid_from,valid_until,
        history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
      select v_case.company_id,o.product,v_case.register_id,o.policy_version,marker||v_case.label,v_now-interval '1 day',v_now+interval '1 day',
        v_now+interval '31 days',o.capabilities,marker||v_case.label,'il_'||marker||v_case.label,false,order_fixture
      from public.module_offers o where o.id=v_case.offer_id;
    end loop;
    execute 'set local role service_role';
    foreach v_offer in array array[offer_inventory,offer_invoicing,offer_quotes,offer_fleet] loop
      assert (public.reserve_module_checkout(c_dep,v_offer,null,false,u_a)->>'offer_id')::uuid=v_offer, 'paid_core_dependency_allows_module';
      passed := passed || jsonb_build_array('paid_core_allows_'||v_offer::text);
    end loop;
    foreach v_offer in array array[offer_inventory,offer_invoicing] loop
      assert (public.reserve_module_checkout(c_pos,v_offer,null,false,u_a)->>'offer_id')::uuid=v_offer, 'paid_pos_dependency_allows_inventory_or_invoicing';
      passed := passed || jsonb_build_array('paid_pos_allows_'||v_offer::text);
    end loop;
    foreach v_offer in array array[offer_quotes,offer_fleet] loop
      v_error := null;
      begin perform public.reserve_module_checkout(c_pos,v_offer,null,false,u_a);
      exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
      assert v_error='22023', 'paid_pos_not_core_dependency';
      passed := passed || jsonb_build_array('paid_pos_does_not_allow_'||v_offer::text);
    end loop;
    v_error := null;
    begin perform public.reserve_module_checkout(c_a,offer_core,null,false,u_a);
    exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
    assert v_error='23505', 'active_paid_module_prevents_duplicate_purchase';
    passed := passed || jsonb_build_array('active_paid_module_prevents_duplicate_purchase');

    execute 'reset role';
    for v_case in select * from (values
      ('owner_scope_rewrite_denied',format('update public.module_checkout_sessions set company_id=%L where order_id=%L',c_b,order_a),'42501'),
      ('owner_creator_rewrite_denied',format('update public.module_checkout_sessions set actor_auth_user_id=%L where order_id=%L',u_a2,order_a),'42501'),
      ('owner_expiry_rewrite_denied',format('update public.module_checkout_sessions set expires_at=expires_at+interval ''1 hour'' where order_id=%L',order_a),'42501'),
      ('owner_customer_rewrite_denied',format('update public.module_billing_customers set stripe_customer_id=%L where company_id=%L','cus_'||marker||'Rewrite',c_a),'42501')
    ) cases(label,statement,expected) loop
      v_error := null;
      begin execute v_case.statement;
      exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
      assert v_error=v_case.expected, v_case.label;
      passed := passed || jsonb_build_array(v_case.label);
    end loop;

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_a,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_a::text,true);
    execute 'set local role authenticated';
    for v_case in select * from (values
      ('authenticated_customer_rpc_denied',format('select public.bind_module_billing_customer(%L,false,%L)',c_a,customer_a)),
      ('authenticated_reserve_rpc_denied',format('select public.reserve_module_checkout(%L,%L,null,false,%L)',c_a,offer_core,u_a)),
      ('authenticated_record_rpc_denied',format('select public.record_module_checkout_session(%L,%L,%L,%s)',order_a,session_a,url_a,expires_a)),
      ('authenticated_close_rpc_denied',format('select public.close_module_checkout_session(%L,%L,''complete'')',order_a,session_a)),
      ('authenticated_customer_table_denied','select * from public.module_billing_customers'),
      ('authenticated_checkout_table_denied','select * from public.module_checkout_sessions')
    ) cases(label,statement) loop
      v_error := null;
      begin execute v_case.statement;
      exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
      assert v_error='42501', v_case.label;
      passed := passed || jsonb_build_array(v_case.label);
    end loop;
    execute 'reset role';
    execute 'set local role anon';
    v_error := null;
    begin perform public.reserve_module_checkout(c_a,offer_core,null,false,u_a);
    exception when others then get stacked diagnostics v_error = returned_sqlstate; end;
    assert v_error='42501', 'anonymous_checkout_rpc_denied';
    passed := passed || jsonb_build_array('anonymous_checkout_rpc_denied');
    execute 'reset role';
    raise exception 'rollback synthetic checkout fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id in(u_a,u_a2,u_b,u_worker,u_inactive,u_legacy,u_conflict)), 'user_fixture_cleanup';
  assert not exists(select 1 from public.module_checkout_sessions where company_id in(c_a,c_b,c_dep,c_pos,c_legacy,c_unmapped)), 'checkout_fixture_cleanup';
  assert not exists(select 1 from public.module_purchase_orders where company_id in(c_a,c_b,c_dep,c_pos,c_legacy,c_unmapped)), 'order_fixture_cleanup';
  assert not exists(select 1 from public.module_billing_customers where company_id in(c_a,c_b,c_dep,c_pos,c_legacy,c_unmapped)), 'customer_fixture_cleanup';
  assert not exists(select 1 from public.module_offers where id in(offer_core,offer_core2,offer_live,offer_inventory,offer_invoicing,offer_quotes,offer_fleet,offer_pos,offer_ai,offer_hidden)), 'offer_fixture_cleanup';
  perform set_config('diriqo.module_checkout_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),
    'fixtures','rolled_back','concurrency','single_session_replay_only','stripe','no_provider_calls')::text,true);
end;
$test$;
select current_setting('diriqo.module_checkout_test_result')::jsonb as result;
