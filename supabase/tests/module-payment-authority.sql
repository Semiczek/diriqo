-- Run only in the authorized Diriqo TEST project after the pending migration is applied.
-- Actual authenticated/anon/service_role checks; all synthetic changes roll back.
-- This single-session suite proves retries and ordering, not simultaneous transactions.
-- After checkout reservations are installed, direct service order INSERT is revoked.
-- Owner-only order fixtures and order-shape checks below are explicit setup, not service authorization proof;
-- actual service receipt RPC and denial assertions still execute as service_role.
do $test$
declare
  u_a uuid := gen_random_uuid(); u_b uuid := gen_random_uuid();
  p_a uuid := gen_random_uuid(); p_b uuid := gen_random_uuid();
  c_a uuid := gen_random_uuid(); c_b uuid := gen_random_uuid();
  m_a uuid := gen_random_uuid();
  offer_inventory uuid := gen_random_uuid(); offer_pos uuid := gen_random_uuid();
  offer_core uuid := gen_random_uuid(); offer_extra uuid;
  order_a uuid := gen_random_uuid(); order_b uuid := gen_random_uuid();
  order_pos uuid := gen_random_uuid(); order_core uuid := gen_random_uuid();
  order_extra uuid; order_duplicate_subscription uuid := gen_random_uuid();
  register_a uuid := gen_random_uuid(); grant_a uuid; grant_b uuid; grant_pos uuid; result_id uuid;
  marker text := 'synthetic-' || gen_random_uuid()::text;
  legacy_before jsonb; legacy_after jsonb;
  passed jsonb := '[]'; denied boolean; v_base jsonb; v_case jsonb; v_body jsonb;
  v_extra record; v_count bigint;
  v_call text := $call$
    select public.apply_paid_module_invoice(
      ($1->>'order_id')::uuid, $1->>'event_id', ($1->>'livemode')::boolean,
      $1->>'invoice_id', $1->>'invoice_line_id', $1->>'customer_id',
      $1->>'subscription_id', $1->>'price_id', $1->>'currency',
      ($1->>'quantity')::integer, ($1->>'line_amount')::bigint,
      ($1->>'amount_paid')::bigint, ($1->>'amount_due')::bigint,
      ($1->>'period_start')::bigint, ($1->>'period_end')::bigint
    )
  $call$;
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_a, marker || '-a@example.invalid','{}'), (u_b, marker || '-b@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_a,u_a,u_a,'Synthetic module A'), (p_b,u_b,u_b,'Synthetic module B');
    insert into public.companies(id,name) values (c_a,'Synthetic module A'),(c_b,'Synthetic module B');
    insert into public.company_members(id,company_id,profile_id,role,is_active) values
      (m_a,c_a,p_a,'company_admin',true),(gen_random_uuid(),c_b,p_b,'worker',true);
    insert into public.company_subscriptions(company_id,plan_key,status,current_period_start,current_period_end)
      values(c_a,'starter','active',to_timestamp(1797408000),to_timestamp(1800000000))
      on conflict(company_id) do update set plan_key='starter',status='active',
        current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end;
    insert into public.company_modules(company_id,module_key,is_enabled) values(c_a,'invoices',false)
      on conflict(company_id,module_key) do update set is_enabled=false;
    select jsonb_build_object(
      'subscription',(select to_jsonb(s) from public.company_subscriptions s where company_id=c_a),
      'modules',(select jsonb_agg(to_jsonb(m) order by m.module_key) from public.company_modules m where company_id=c_a)
    ) into legacy_before;

    execute 'set local role service_role';
    insert into public.module_offers(id,offer_key,product,stripe_price_id,livemode,currency,unit_amount,capabilities,policy_version,history_days,is_published) values
      (offer_inventory,marker||'-inventory','inventory',marker||'-price-inventory',false,'czk',29900,
        array['inventory.receipt.post','inventory.history.read','inventory.history.export'],'diriqo-capabilities-v0.1',90,true),
      (offer_pos,marker||'-pos','pos',marker||'-price-pos',false,'czk',10000,
        array['pos.sale.create','pos.sale.settle','pos.history.read'],'diriqo-capabilities-v0.1',90,true),
      (offer_core,marker||'-core','diriqo_core',marker||'-price-core',false,'czk',29900,
        array['core.jobs.create','core.history.read'],'diriqo-capabilities-v0.1',90,false);
    passed := passed || jsonb_build_array('service_can_create_immutable_offer_snapshots');

    denied := false;
    begin
      insert into public.module_offers(offer_key,product,stripe_price_id,livemode,currency,unit_amount,capabilities,policy_version,history_days)
        values(marker||'-bad','inventory',marker||'-bad-price',false,'czk',1,array['core.jobs.create'],'diriqo-capabilities-v0.1',0);
    exception when check_violation then denied := true; end;
    assert denied, 'cross_product_capabilities_denied';
    passed := passed || jsonb_build_array('cross_product_capabilities_denied');

    denied := false;
    begin
      insert into public.module_offers(offer_key,product,stripe_price_id,livemode,currency,unit_amount,capabilities,policy_version,history_days)
        values(marker||'-bad-version','inventory',marker||'-bad-version-price',false,'czk',1,array['inventory.receipt.post'],'unknown-policy',0);
    exception when check_violation then denied := true; end;
    assert denied, 'unknown_offer_policy_denied';
    passed := passed || jsonb_build_array('unknown_offer_policy_denied');

    execute 'reset role'; -- Owner fixture/order-shape checks; checkout RPC now owns production order creation.
    denied := false;
    begin
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_a,offer_core,marker||'-customer-a');
    exception when invalid_parameter_value then denied := true; end;
    assert denied, 'unpublished_offer_cannot_create_order';
    passed := passed || jsonb_build_array('unpublished_offer_cannot_create_order');
    update public.module_offers set is_published=true where id=offer_core;
    insert into public.module_purchase_orders(id,company_id,offer_id,stripe_customer_id,register_id) values
      (order_a,c_a,offer_inventory,marker||'-customer-a',null),
      (order_b,c_b,offer_inventory,marker||'-customer-b',null),
      (order_pos,c_a,offer_pos,marker||'-customer-a',register_a),
      (order_core,c_a,offer_core,marker||'-customer-a',null),
      (order_duplicate_subscription,c_a,offer_inventory,marker||'-customer-a',null);
    assert not exists(select 1 from public.company_module_entitlements where company_id in(c_a,c_b)), 'unpaid_order_granted_access';
    passed := passed || jsonb_build_array('order_without_confirmed_payment_grants_nothing');

    denied := false;
    begin
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_a,offer_pos,marker||'-customer-a');
    exception when invalid_parameter_value then denied := true; end;
    assert denied, 'pos_requires_register';
    passed := passed || jsonb_build_array('pos_requires_register');
    denied := false;
    begin
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id,register_id)
        values(c_a,offer_inventory,marker||'-customer-a',register_a);
    exception when invalid_parameter_value then denied := true; end;
    assert denied, 'company_product_cannot_use_register_scope';
    passed := passed || jsonb_build_array('company_product_cannot_use_register_scope');
    execute 'set local role service_role';
    denied := false;
    begin
      update public.module_purchase_orders set stripe_subscription_id=marker||'-unauthorized' where id=order_a;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'direct_subscription_binding_denied';
    passed := passed || jsonb_build_array('direct_subscription_binding_denied');

    v_base := jsonb_build_object(
      'order_id',order_a,'event_id',marker||'-event-1','livemode',false,
      'invoice_id',marker||'-invoice-1','invoice_line_id',marker||'-line-1',
      'customer_id',marker||'-customer-a','subscription_id',marker||'-subscription-a',
      'price_id',marker||'-price-inventory','currency','czk','quantity',1,
      'line_amount',29900,'amount_paid',29900,'amount_due',29900,
      'period_start',1800000000,'period_end',1802592000
    );
    execute v_call into grant_a using v_base;
    assert grant_a is not null, 'paid_invoice_did_not_create_grant';
    assert exists(select 1 from public.company_module_entitlements where id=grant_a and company_id=c_a
      and product='inventory' and origin='paid' and state='active' and not revoked and register_id is null
      and valid_from=to_timestamp(1800000000) and valid_until=to_timestamp(1802592000)
      and history_until=to_timestamp(1802592000+90*86400)
      and capabilities=array['inventory.receipt.post','inventory.history.read','inventory.history.export']), 'grant_scope_or_snapshot_mismatch';
    assert not exists(select 1 from public.company_module_entitlements where company_id=c_a and product='diriqo_core'), 'independent_addon_requires_core';
    passed := passed || jsonb_build_array('paid_addon_activates_without_core_and_uses_stored_snapshot');
    assert (select stripe_subscription_id from public.module_purchase_orders where id=order_a)=marker||'-subscription-a', 'subscription_not_bound';
    passed := passed || jsonb_build_array('first_payment_binds_subscription_once');

    execute v_call into result_id using v_base;
    assert result_id=grant_a and (select count(*) from private.module_payment_events where order_id=order_a)=1, 'event_retry_not_idempotent';
    passed := passed || jsonb_build_array('same_event_retry_reuses_grant');
    execute v_call into result_id using v_base || jsonb_build_object('event_id',marker||'-event-2');
    assert result_id=grant_a and (select count(*) from public.company_module_entitlements where order_id=order_a)=1
      and (select count(*) from private.module_payment_events where order_id=order_a)=2, 'semantic_retry_not_idempotent';
    passed := passed || jsonb_build_array('different_event_same_invoice_line_reuses_grant');

    for v_case in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('name','wrong_customer','patch',jsonb_build_object('customer_id','other-customer')),
      jsonb_build_object('name','wrong_price','patch',jsonb_build_object('price_id','other-price')),
      jsonb_build_object('name','wrong_mode','patch',jsonb_build_object('livemode',true)),
      jsonb_build_object('name','wrong_currency','patch',jsonb_build_object('currency','eur')),
      jsonb_build_object('name','noncanonical_currency','patch',jsonb_build_object('currency','CZK')),
      jsonb_build_object('name','quantity_two','patch',jsonb_build_object('quantity',2)),
      jsonb_build_object('name','discounted_line','patch',jsonb_build_object('line_amount',29800)),
      jsonb_build_object('name','additional_tax_due','patch',jsonb_build_object('amount_due',30000,'amount_paid',30000)),
      jsonb_build_object('name','underpaid_invoice','patch',jsonb_build_object('amount_paid',29800)),
      jsonb_build_object('name','zero_invoice','patch',jsonb_build_object('amount_due',0,'amount_paid',0,'line_amount',0)),
      jsonb_build_object('name','null_payment','patch',jsonb_build_object('amount_paid',null)),
      jsonb_build_object('name','invalid_period','patch',jsonb_build_object('period_end',1800000000)),
      jsonb_build_object('name','negative_period','patch',jsonb_build_object('period_start',-1)),
      jsonb_build_object('name','oversized_period','patch',jsonb_build_object('period_end',253402300800::bigint)),
      jsonb_build_object('name','different_subscription','patch',jsonb_build_object('subscription_id','other-subscription'))
    )) loop
      denied := false;
      begin
        execute v_call into result_id using v_base || (v_case->'patch');
      exception when invalid_parameter_value then denied := true; end;
      assert denied, 'mismatched_receipt_accepted:' || (v_case->>'name');
      passed := passed || jsonb_build_array('reject_' || (v_case->>'name'));
    end loop;
    assert (select count(*) from public.company_module_entitlements where order_id=order_a)=1, 'invalid_receipts_created_grants';
    passed := passed || jsonb_build_array('invalid_receipts_have_no_grant_effect');

    denied := false;
    begin
      execute v_call into result_id using v_base || jsonb_build_object('period_end',1802592001);
    exception when unique_violation then denied := true; end;
    assert denied, 'event_content_conflict_accepted';
    passed := passed || jsonb_build_array('event_id_changed_receipt_conflicts');
    denied := false;
    begin
      execute v_call into result_id using v_base || jsonb_build_object('event_id',marker||'-conflict','period_end',1802592001);
    exception when unique_violation then denied := true; end;
    assert denied, 'invoice_content_conflict_accepted';
    passed := passed || jsonb_build_array('invoice_line_changed_receipt_conflicts');
    denied := false;
    begin
      execute v_call into result_id using v_base || jsonb_build_object('order_id',order_b,'event_id',marker||'-cross-order',
        'customer_id',marker||'-customer-b','subscription_id',marker||'-subscription-b');
    exception when unique_violation then denied := true; end;
    assert denied and not exists(select 1 from public.company_module_entitlements where company_id=c_b), 'receipt_retargeted_to_other_company';
    passed := passed || jsonb_build_array('same_invoice_line_cannot_retarget_company');

    denied := false;
    begin
      execute v_call into result_id using v_base || jsonb_build_object('order_id',order_duplicate_subscription,
        'event_id',marker||'-duplicate-sub','invoice_id',marker||'-duplicate-sub-invoice');
    exception when unique_violation then denied := true; end;
    assert denied and (select stripe_subscription_id from public.module_purchase_orders where id=order_duplicate_subscription) is null,
      'subscription_bound_to_second_order';
    passed := passed || jsonb_build_array('subscription_cannot_bind_second_order_atomic');

    update public.module_offers set is_published=false where id=offer_inventory;
    execute v_call into result_id using v_base || jsonb_build_object('event_id',marker||'-renew-later',
      'invoice_id',marker||'-invoice-later','period_start',1805184000,'period_end',1807776000);
    assert result_id<>grant_a, 'renewal_replaced_prior_grant';
    execute v_call into result_id using v_base || jsonb_build_object('event_id',marker||'-renew-older',
      'invoice_id',marker||'-invoice-older','period_start',1797408000,'period_end',1800000000);
    assert (select count(*) from public.company_module_entitlements where order_id=order_a)=3
      and (select max(valid_until) from public.company_module_entitlements where order_id=order_a)=to_timestamp(1807776000)
      and (select valid_until from public.company_module_entitlements where id=grant_a)=to_timestamp(1802592000), 'out_of_order_payment_rewrote_history';
    passed := passed || jsonb_build_array('unpublishing_preserves_existing_order_renewals','out_of_order_renewals_append_without_shortening');

    execute v_call into grant_b using v_base || jsonb_build_object('order_id',order_b,'event_id',marker||'-b-event',
      'invoice_id',marker||'-b-invoice','customer_id',marker||'-customer-b','subscription_id',marker||'-subscription-b');
    execute v_call into grant_pos using v_base || jsonb_build_object('order_id',order_pos,'event_id',marker||'-pos-event',
      'invoice_id',marker||'-pos-invoice','subscription_id',marker||'-subscription-pos','price_id',marker||'-price-pos',
      'line_amount',10000,'amount_paid',10000,'amount_due',10000);
    assert exists(select 1 from public.company_module_entitlements where id=grant_pos and product='pos' and register_id=register_a)
      and not exists(select 1 from public.company_module_entitlements where company_id=c_a and product='diriqo_core'), 'standalone_pos_scope_failure';
    passed := passed || jsonb_build_array('standalone_pos_has_only_its_register_scope');

    for v_extra in select * from (values
      ('invoicing','invoicing.invoice.issue'),('smart_quotes','smart_quotes.template.manage'),
      ('fleet','fleet.vehicle.manage'),('ai_assistant','ai_assistant.conversation.run')
    ) e(product,capability) loop
      offer_extra := gen_random_uuid(); order_extra := gen_random_uuid();
      insert into public.module_offers(id,offer_key,product,stripe_price_id,livemode,currency,unit_amount,capabilities,policy_version,history_days,is_published)
        values(offer_extra,marker||'-'||v_extra.product,v_extra.product,marker||'-price-'||v_extra.product,false,'czk',19900,
          array[v_extra.capability],'diriqo-capabilities-v0.1',90,true);
      execute 'reset role'; -- Owner fixture only; service direct order INSERT is intentionally denied.
      insert into public.module_purchase_orders(id,company_id,offer_id,stripe_customer_id)
        values(order_extra,c_a,offer_extra,marker||'-customer-a');
      execute 'set local role service_role';
      execute v_call into result_id using v_base || jsonb_build_object('order_id',order_extra,'event_id',marker||'-event-'||v_extra.product,
        'invoice_id',marker||'-invoice-'||v_extra.product,'subscription_id',marker||'-sub-'||v_extra.product,
        'price_id',marker||'-price-'||v_extra.product,'line_amount',19900,'amount_paid',19900,'amount_due',19900);
      assert exists(select 1 from public.company_module_entitlements where id=result_id and product=v_extra.product), 'independent_product_missing';
      passed := passed || jsonb_build_array('independent_'||v_extra.product||'_activation');
    end loop;
    execute v_call into result_id using v_base || jsonb_build_object('order_id',order_core,'event_id',marker||'-core-event',
      'invoice_id',marker||'-core-invoice','subscription_id',marker||'-subscription-core','price_id',marker||'-price-core');
    assert (select count(distinct product) from public.company_module_entitlements where company_id=c_a)=7, 'independent_products_not_preserved';
    passed := passed || jsonb_build_array('later_core_purchase_preserves_seven_independent_products');

    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_a,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_a::text,true);
    execute 'set local role authenticated';
    assert exists(select 1 from public.company_module_entitlements where id=grant_a)
      and not exists(select 1 from public.company_module_entitlements where id=grant_b), 'tenant_a_scope_failure';
    passed := passed || jsonb_build_array('authenticated_tenant_a_reads_own_grants_only');
    denied := false;
    begin execute v_call into result_id using v_base;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated_payment_rpc_callable';
    passed := passed || jsonb_build_array('authenticated_payment_rpc_denied');
    denied := false;
    begin perform * from public.module_offers;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated_offer_read'; passed := passed || jsonb_build_array('authenticated_offer_read_denied');
    denied := false;
    begin perform * from public.module_purchase_orders;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated_order_read'; passed := passed || jsonb_build_array('authenticated_order_read_denied');
    denied := false;
    begin perform * from private.module_payment_events;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated_event_read'; passed := passed || jsonb_build_array('authenticated_event_read_denied');
    denied := false;
    begin insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id) values(c_a,offer_core,'forged');
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated_order_write'; passed := passed || jsonb_build_array('authenticated_order_write_denied');
    denied := false;
    begin insert into public.company_module_entitlements select * from public.company_module_entitlements where id=grant_a;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated_grant_insert'; passed := passed || jsonb_build_array('authenticated_grant_insert_denied');
    denied := false;
    begin update public.company_module_entitlements set valid_until=valid_until+interval '1 day' where id=grant_a;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated_grant_update'; passed := passed || jsonb_build_array('authenticated_grant_update_denied');
    denied := false;
    begin delete from public.company_module_entitlements where id=grant_a;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated_grant_delete'; passed := passed || jsonb_build_array('authenticated_grant_delete_denied');

    execute 'reset role';
    update public.company_members set is_active=false where id=m_a;
    execute 'set local role authenticated';
    assert not exists(select 1 from public.company_module_entitlements where company_id=c_a), 'revoked_member_reads_grants';
    passed := passed || jsonb_build_array('membership_revocation_removes_grant_read');
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_b,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_b::text,true);
    execute 'set local role authenticated';
    assert exists(select 1 from public.company_module_entitlements where id=grant_b)
      and not exists(select 1 from public.company_module_entitlements where company_id=c_a), 'worker_tenant_b_scope_failure';
    passed := passed || jsonb_build_array('worker_tenant_b_reads_only_own_company');

    execute 'reset role';
    perform set_config('request.jwt.claims','{}',true);
    perform set_config('request.jwt.claim.sub','',true);
    execute 'set local role anon';
    denied := false;
    begin perform * from public.company_module_entitlements;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'anonymous_grants_read'; passed := passed || jsonb_build_array('anonymous_grants_read_denied');
    denied := false;
    begin execute v_call into result_id using v_base;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'anonymous_payment_rpc'; passed := passed || jsonb_build_array('anonymous_payment_rpc_denied');

    execute 'reset role';
    denied := false;
    begin update public.module_offers set unit_amount=unit_amount+1 where id=offer_inventory;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'offer_snapshot_mutable'; passed := passed || jsonb_build_array('offer_billing_snapshot_immutable');
    denied := false;
    begin update public.module_purchase_orders set company_id=c_b where id=order_a;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'order_scope_mutable'; passed := passed || jsonb_build_array('order_company_scope_immutable');
    denied := false;
    begin delete from public.company_module_entitlements where id=grant_a;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'grant_not_append_only'; passed := passed || jsonb_build_array('grant_records_append_only');
    denied := false;
    begin delete from private.module_payment_events where entitlement_id=grant_a;
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'events_not_append_only'; passed := passed || jsonb_build_array('event_records_append_only');

    select jsonb_build_object(
      'subscription',(select to_jsonb(s) from public.company_subscriptions s where company_id=c_a),
      'modules',(select jsonb_agg(to_jsonb(m) order by m.module_key) from public.company_modules m where company_id=c_a)
    ) into legacy_after;
    assert legacy_before=legacy_after, 'module_payment_rewrote_legacy_subscription_or_switches';
    passed := passed || jsonb_build_array('legacy_eur_subscription_and_module_switches_unchanged');
    select count(*) into v_count from private.module_payment_events where event_id like marker||'%';
    assert v_count=(select count(*) from public.company_module_entitlements where company_id in(c_a,c_b))+1,
      'receipt_event_atomic_counts';
    passed := passed || jsonb_build_array('every_payment_event_has_exactly_one_atomic_grant_reference');

    raise exception 'rollback synthetic module fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id in(u_a,u_b)), 'auth fixture cleanup';
  assert not exists(select 1 from public.companies where id in(c_a,c_b)), 'company fixture cleanup';
  assert not exists(select 1 from public.module_offers where offer_key like marker||'%'), 'offer fixture cleanup';
  assert not exists(select 1 from public.company_module_entitlements where company_id in(c_a,c_b)), 'grant fixture cleanup';
  assert not exists(select 1 from private.module_payment_events where event_id like marker||'%'), 'event fixture cleanup';
  perform set_config('diriqo.module_payment_test_result', jsonb_build_object(
    'passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back',
    'concurrency','not_tested_single_session','scope','payment_authority_only'
  )::text,true);
end;
$test$;
select current_setting('diriqo.module_payment_test_result')::jsonb as result;
