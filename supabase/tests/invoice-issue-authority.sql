-- Run only in the authorized Diriqo TEST project after invoice issue authority is installed.
-- All companies, Auth users, grants, receipts and failure-injection rows roll back.
-- Fixtures are owner-only setup. Every permission/issue assertion uses the stated real role.
-- This suite proves sequential retry and transaction atomicity, not simultaneous transactions.
do $test$
declare
  u_admin uuid := gen_random_uuid(); u_worker uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  p_admin uuid := gen_random_uuid(); p_worker uuid := gen_random_uuid(); p_other uuid := gen_random_uuid();
  c_paid uuid := gen_random_uuid(); c_legacy uuid := gen_random_uuid(); c_other uuid := gen_random_uuid();
  c_history uuid := gen_random_uuid(); c_case uuid; customer_case uuid;
  member_paid uuid := gen_random_uuid();
  customer_paid uuid := gen_random_uuid(); customer_legacy uuid := gen_random_uuid();
  customer_other uuid := gen_random_uuid(); customer_history uuid := gen_random_uuid();
  invoice_paid uuid := gen_random_uuid(); invoice_direct uuid := gen_random_uuid();
  invoice_failure uuid := gen_random_uuid(); invoice_legacy uuid := gen_random_uuid();
  invoice_history uuid := gen_random_uuid(); invoice_case uuid; invoice_extra uuid;
  invoice_delete uuid := gen_random_uuid(); invoice_history_draft uuid := gen_random_uuid();
  invoice_exported_draft uuid := gen_random_uuid(); invoice_legacy_draft uuid := gen_random_uuid();
  job_paid uuid := gen_random_uuid(); job_direct uuid := gen_random_uuid(); job_failure uuid := gen_random_uuid();
  job_delete uuid := gen_random_uuid();
  offer_invoice uuid := gen_random_uuid(); offer_core uuid := gen_random_uuid();
  offer_history uuid := gen_random_uuid(); offer_live uuid := gen_random_uuid(); offer_pos uuid := gen_random_uuid();
  order_fixture uuid; order_paid uuid; grant_paid uuid; grant_core uuid; grant_fixture uuid;
  fixture_companies uuid[]; fixture_invoices uuid[];
  marker text := 'InvoiceIssue' || replace(gen_random_uuid()::text,'-','');
  v_now timestamptz := date_trunc('second',clock_timestamp());
  v_year integer := extract(year from current_date)::integer;
  v_error text; v_message text; v_result jsonb; v_retry jsonb; v_before jsonb;
  v_sequence integer; v_rows integer; v_case record; v_fixture record; v_status text; register_fixture uuid;
  passed jsonb := '[]';
begin
  fixture_companies := array[c_paid,c_legacy,c_other,c_history];
  fixture_invoices := array[invoice_paid,invoice_direct,invoice_failure,invoice_legacy,invoice_history,
    invoice_delete,invoice_history_draft,invoice_exported_draft,invoice_legacy_draft];
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),
      (u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-other@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic invoice admin'),
      (p_worker,u_worker,u_worker,'Synthetic invoice worker'),
      (p_other,u_other,u_other,'Synthetic invoice other admin');
    insert into public.companies(id,name) values
      (c_paid,'Synthetic invoice paid'),(c_legacy,'Synthetic invoice legacy'),
      (c_other,'Synthetic invoice other'),(c_history,'Synthetic invoice history');
    insert into public.company_members(id,company_id,profile_id,role,is_active) values
      (member_paid,c_paid,p_admin,'company_admin',true),
      (gen_random_uuid(),c_paid,p_worker,'worker',true),
      (gen_random_uuid(),c_legacy,p_admin,'company_admin',true),
      (gen_random_uuid(),c_history,p_admin,'company_admin',true),
      (gen_random_uuid(),c_other,p_other,'company_admin',true);
    insert into public.customers(id,company_id,name) values
      (customer_paid,c_paid,'Synthetic invoice customer'),
      (customer_legacy,c_legacy,'Synthetic legacy customer'),
      (customer_history,c_history,'Synthetic history customer'),
      (customer_other,c_other,'Synthetic other customer');
    insert into public.jobs(id,company_id,customer_id,title,status,work_state,price,billing_status) values
      (job_paid,c_paid,customer_paid,'Synthetic issue job','done','done',100,'not_invoiced'),
      (job_direct,c_paid,customer_paid,'Synthetic direct issue job','done','done',100,'not_invoiced'),
      (job_failure,c_paid,customer_paid,'Synthetic rollback issue job','done','done',100,'not_invoiced'),
      (job_delete,c_paid,customer_paid,'Synthetic draft delete job','done','done',100,'paid');
    update public.jobs set is_paid=true,paid_at=v_now where id=job_delete;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,due_date,customer_snapshot,supplier_snapshot) values
      (invoice_paid,c_paid,customer_paid,v_year,'draft',null,current_date+14,'{}','{}'),
      (invoice_direct,c_paid,customer_paid,v_year,'draft',null,current_date+14,'{}','{}'),
      (invoice_failure,c_paid,customer_paid,v_year,'draft',null,current_date+14,'{}','{}'),
      (invoice_legacy,c_legacy,customer_legacy,v_year,'draft',null,current_date+14,'{}','{}'),
      (invoice_history,c_history,customer_history,v_year,'issued',marker||'-historic',current_date+14,'{}','{}'),
      (invoice_delete,c_paid,customer_paid,v_year,'draft',null,current_date+14,'{}','{}'),
      (invoice_history_draft,c_history,customer_history,v_year,'draft',null,current_date+14,'{}','{}'),
      (invoice_exported_draft,c_history,customer_history,v_year,'draft',null,current_date+14,'{}','{}'),
      (invoice_legacy_draft,c_legacy,customer_legacy,v_year,'draft',null,current_date+14,'{}','{}');
    update public.invoices set pohoda_export_status='exported' where id=invoice_exported_draft;
    insert into public.invoice_jobs(invoice_id,job_id,company_id,customer_id) values
      (invoice_paid,job_paid,c_paid,customer_paid),
      (invoice_direct,job_direct,c_paid,customer_paid),
      (invoice_failure,job_failure,c_paid,customer_paid),
      (invoice_delete,job_delete,c_paid,customer_paid);
    insert into public.invoice_items(invoice_id,company_id,item_name) values(invoice_delete,c_paid,'Synthetic draft item');
    insert into public.module_offers(id,offer_key,product,stripe_price_id,livemode,currency,unit_amount,
      capabilities,policy_version,history_days,is_published) values
      (offer_invoice,marker||'-invoice','invoicing','price_'||marker||'Invoice',false,'czk',1000,
        array['invoicing.invoice.issue','invoicing.history.read','invoicing.history.export'],'diriqo-capabilities-v0.1',90,true),
      (offer_core,marker||'-core','diriqo_core','price_'||marker||'Core',false,'czk',1000,
        array['core.jobs.create'],'diriqo-capabilities-v0.1',90,true),
      (offer_history,marker||'-history','invoicing','price_'||marker||'History',false,'czk',1000,
        array['invoicing.history.read','invoicing.history.export'],'diriqo-capabilities-v0.1',90,true),
      (offer_live,marker||'-live','invoicing','price_'||marker||'Live',true,'czk',1000,
        array['invoicing.invoice.issue'],'diriqo-capabilities-v0.1',90,true),
      (offer_pos,marker||'-pos','pos','price_'||marker||'Pos',false,'czk',1000,
        array['pos.sale.create'],'diriqo-capabilities-v0.1',90,true);

    -- Historic owner fixtures use real immutable grant rows, never a client-supplied flag.
    for v_fixture in select * from (values
      (c_history,offer_core,v_now-interval '3 days',v_now-interval '1 day','history-core'),
      (c_history,offer_invoice,v_now-interval '3 days',v_now-interval '1 day','history-invoice'),
      (c_other,offer_core,v_now-interval '1 day',v_now+interval '1 day','other-core'),
      (c_other,offer_invoice,v_now-interval '1 day',v_now+interval '1 day','other-invoice')
    ) fixtures(company_id,offer_id,valid_from,valid_until,label) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(v_fixture.company_id,v_fixture.offer_id,'cus_'||marker||v_fixture.label) returning id into order_fixture;
      insert into public.company_module_entitlements(company_id,product,policy_version,source_ref,
        valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
      select v_fixture.company_id,o.product,o.policy_version,marker||v_fixture.label,
        v_fixture.valid_from,v_fixture.valid_until,v_fixture.valid_until+interval '90 days',o.capabilities,
        'in_'||marker||v_fixture.label,'il_'||marker||v_fixture.label,o.livemode,order_fixture
      from public.module_offers o where o.id=v_fixture.offer_id;
    end loop;
    insert into private.invoice_module_rollouts(company_id,livemode) values(c_paid,false),(c_history,false);

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    v_result := public.issue_invoice_atomic(c_legacy,invoice_legacy);
    assert v_result->>'status'='issued' and (v_result->>'issued')::boolean,
      'unenrolled_company_keeps_legacy_issue';
    passed := passed || jsonb_build_array('unenrolled_company_keeps_legacy_issue');

    v_error := null; v_message := null;
    begin perform public.issue_invoice_atomic(c_paid,invoice_paid);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_MODULE_REQUIRED', 'unpaid_rpc_issue_denied';
    passed := passed || jsonb_build_array('unpaid_rpc_issue_denied');
    v_error := null;
    begin update public.invoices set status='issued' where id=invoice_paid;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'unpaid_direct_issue_denied';
    passed := passed || jsonb_build_array('unpaid_direct_issue_denied');
    v_error := null;
    begin insert into public.invoices(company_id,customer_id,invoice_year,customer_snapshot,supplier_snapshot)
      values(c_paid,customer_paid,v_year,'{}','{}');
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'unpaid_draft_insert_denied';
    passed := passed || jsonb_build_array('unpaid_draft_insert_denied');
    v_error := null;
    begin perform public.next_invoice_number(c_paid,v_year);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'unpaid_invoice_number_allocation_denied';
    passed := passed || jsonb_build_array('unpaid_invoice_number_allocation_denied');
    v_error := null;
    begin insert into private.invoice_module_rollouts(company_id,livemode) values(c_legacy,false);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'tenant_cannot_change_rollout';
    passed := passed || jsonb_build_array('tenant_cannot_change_rollout');

    -- Every negative grant case has its own company, avoiding accidental authorization
    -- from an earlier valid period in this append-only model.
    execute 'reset role';
    for v_case in select * from (values
      ('expired',offer_invoice,v_now-interval '3 days',v_now-interval '1 day',true),
      ('future',offer_invoice,v_now+interval '1 day',v_now+interval '2 days',true),
      ('wrong_mode',offer_live,v_now-interval '1 day',v_now+interval '1 day',true),
      ('history_capability_only',offer_history,v_now-interval '1 day',v_now+interval '1 day',true),
      ('missing_base',offer_invoice,v_now-interval '1 day',v_now+interval '1 day',false)
    ) cases(label,offer_id,valid_from,valid_until,has_core) loop
      c_case := gen_random_uuid(); customer_case := gen_random_uuid(); invoice_case := gen_random_uuid();
      fixture_companies := array_append(fixture_companies,c_case);
      fixture_invoices := array_append(fixture_invoices,invoice_case);
      insert into public.companies(id,name) values(c_case,'Synthetic invoice '||v_case.label);
      insert into public.company_members(company_id,profile_id,role,is_active) values(c_case,p_admin,'company_admin',true);
      insert into public.customers(id,company_id,name) values(customer_case,c_case,'Synthetic customer');
      insert into public.invoices(id,company_id,customer_id,invoice_year,customer_snapshot,supplier_snapshot)
        values(invoice_case,c_case,customer_case,v_year,'{}','{}');
      for v_fixture in select * from (values
        (v_case.offer_id,v_case.valid_from,v_case.valid_until,v_case.label),
        (offer_core,v_now-interval '1 day',v_now+interval '1 day','core')
      ) fixtures(offer_id,valid_from,valid_until,label)
      where v_case.has_core or fixtures.offer_id<>offer_core loop
        insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
          values(c_case,v_fixture.offer_id,'cus_'||marker||c_case::text) returning id into order_fixture;
        insert into public.company_module_entitlements(company_id,product,policy_version,source_ref,
          valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
        select c_case,o.product,o.policy_version,marker||c_case::text||v_fixture.label,
          v_fixture.valid_from,v_fixture.valid_until,v_fixture.valid_until+interval '90 days',o.capabilities,
          'in_'||marker||c_case::text||v_fixture.label,'il_'||marker||c_case::text||v_fixture.label,o.livemode,order_fixture
        from public.module_offers o where o.id=v_fixture.offer_id;
      end loop;
      insert into private.invoice_module_rollouts(company_id,livemode) values(c_case,false);
      execute 'set local role authenticated';
      v_error := null; v_message := null;
      begin perform public.issue_invoice_atomic(c_case,invoice_case);
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='42501' and v_message='INVOICE_MODULE_REQUIRED', v_case.label||'_grant_does_not_authorize';
      passed := passed || jsonb_build_array(v_case.label||'_grant_does_not_authorize');
      assert (select status from public.invoices where id=invoice_case)='draft', 'failed_issue_keeps_draft';
      execute 'reset role';
      if v_case.label='missing_base' then
        register_fixture := gen_random_uuid();
        insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id,register_id)
          values(c_case,offer_pos,'cus_'||marker||'Pos',register_fixture) returning id into order_fixture;
        insert into public.company_module_entitlements(company_id,product,register_id,policy_version,source_ref,
          valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
        select c_case,o.product,register_fixture,o.policy_version,marker||'pos-base',
          v_now-interval '1 day',v_now+interval '1 day',v_now+interval '91 days',o.capabilities,
          'in_'||marker||'pos-base','il_'||marker||'pos-base',false,order_fixture
        from public.module_offers o where o.id=offer_pos;
        execute 'set local role authenticated';
        v_result := public.issue_invoice_atomic(c_case,invoice_case);
        assert (v_result->>'issued')::boolean, 'paid_pos_satisfies_invoicing_base_dependency';
        passed := passed || jsonb_build_array('paid_pos_satisfies_invoicing_base_dependency');
        execute 'reset role';
      end if;
    end loop;

    -- Payment authority is exercised as service_role; no provider call or charge occurs.
    for v_fixture in select * from (values(offer_core,'core'),(offer_invoice,'invoice')) fixtures(offer_id,label) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_paid,v_fixture.offer_id,'cus_'||marker||'Paid') returning id into order_fixture;
      if v_fixture.offer_id=offer_invoice then order_paid := order_fixture; end if;
      execute 'set local role service_role';
      grant_fixture := public.apply_paid_module_invoice(order_fixture,'evt_'||marker||v_fixture.label,false,
        'in_'||marker||v_fixture.label,'il_'||marker||v_fixture.label,'cus_'||marker||'Paid',
        'sub_'||marker||v_fixture.label,
        case when v_fixture.offer_id=offer_core then 'price_'||marker||'Core' else 'price_'||marker||'Invoice' end,
        'czk',1,1000,1000,1000,
        extract(epoch from v_now-interval '1 hour')::bigint,extract(epoch from v_now+interval '1 day')::bigint);
      if v_fixture.offer_id=offer_invoice then grant_paid := grant_fixture; else grant_core := grant_fixture; end if;
      execute 'reset role';
    end loop;
    assert grant_paid is not null and grant_core is not null, 'payment_receipts_create_paid_module_and_base';
    passed := passed || jsonb_build_array('payment_receipts_create_paid_module_and_base');

    execute 'set local role authenticated';
    v_result := public.issue_invoice_atomic(c_paid,invoice_paid);
    assert (v_result->>'invoice_id')::uuid=invoice_paid and v_result->>'status'='issued'
      and (v_result->>'issued')::boolean and length(v_result->>'invoice_number')>0, 'paid_invoice_issue_succeeds';
    passed := passed || jsonb_build_array('paid_invoice_issue_succeeds');
    assert (select billing_status='due' and invoiced_at is not null and due_date=current_date+14 and not is_paid
      from public.jobs where id=job_paid), 'invoice_issue_updates_linked_job';
    passed := passed || jsonb_build_array('invoice_issue_updates_linked_job');
    select last_number into v_sequence from public.invoice_number_sequences where company_id=c_paid and year=v_year;
    v_retry := public.issue_invoice_atomic(c_paid,invoice_paid);
    assert not (v_retry->>'issued')::boolean and v_retry->>'invoice_number'=v_result->>'invoice_number'
      and (select last_number from public.invoice_number_sequences where company_id=c_paid and year=v_year)=v_sequence,
      'retry_preserves_number_and_does_not_consume_sequence';
    passed := passed || jsonb_build_array('retry_preserves_number_and_does_not_consume_sequence');
    execute 'reset role';
    assert (select entitlement_id=grant_paid and actor_auth_user_id=u_admin and company_id=c_paid
      from private.invoice_issue_authorizations where invoice_id=invoice_paid), 'issue_records_persisted_paid_authority';
    passed := passed || jsonb_build_array('issue_records_persisted_paid_authority');

    execute 'set local role authenticated';
    update public.invoices set status='issued',issued_at=v_now-interval '30 days' where id=invoice_direct;
    assert (select status='issued' and invoice_number is not null and issued_at is not null
      and issued_at>=v_now
      from public.invoices where id=invoice_direct)
      and (select billing_status='due' and invoiced_at is not null from public.jobs where id=job_direct),
      'direct_issue_uses_same_atomic_number_and_job_path';
    passed := passed || jsonb_build_array('direct_issue_uses_same_atomic_number_and_job_path');
    invoice_extra := gen_random_uuid(); fixture_invoices := array_append(fixture_invoices,invoice_extra);
    insert into public.invoices(id,company_id,customer_id,invoice_year,customer_snapshot,supplier_snapshot)
      values(invoice_extra,c_paid,customer_paid,v_year,'{}','{}');
    passed := passed || jsonb_build_array('paid_draft_creation_allowed');
    foreach v_status in array array['paid','sent','overdue'] loop
      v_error := null;
      begin update public.invoices set status=v_status where id=invoice_extra;
      exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
      assert v_error='23514', 'direct_draft_to_'||v_status||'_cannot_skip_issue';
      passed := passed || jsonb_build_array('direct_draft_to_'||v_status||'_cannot_skip_issue');
    end loop;
    v_error := null;
    begin insert into public.invoices(company_id,customer_id,invoice_year,status,customer_snapshot,supplier_snapshot)
      values(c_paid,customer_paid,v_year,'issued','{}','{}');
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'non_draft_insert_cannot_skip_issue';
    passed := passed || jsonb_build_array('non_draft_insert_cannot_skip_issue');
    v_error := null;
    begin update public.invoices set company_id=c_other,customer_id=customer_other where id=invoice_extra;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'invoice_cannot_move_between_companies';
    passed := passed || jsonb_build_array('invoice_cannot_move_between_companies');
    v_error := null;
    begin update public.invoices set issued_at=v_now-interval '30 days' where id=invoice_paid;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='23514', 'issued_timestamp_cannot_be_backdated';
    passed := passed || jsonb_build_array('issued_timestamp_cannot_be_backdated');
    v_error := null;
    begin update public.invoices set status='draft' where id=invoice_paid;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='23514', 'issued_invoice_cannot_return_to_draft';
    passed := passed || jsonb_build_array('issued_invoice_cannot_return_to_draft');

    -- Recheck actual actor and current membership, never trust a stale application page.
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_worker::text,true);
    v_error := null;
    begin perform public.issue_invoice_atomic(c_paid,invoice_extra);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'worker_cannot_issue_paid_company_invoice';
    passed := passed || jsonb_build_array('worker_cannot_issue_paid_company_invoice');
    v_error := null;
    begin perform public.next_invoice_number(c_paid,v_year);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'worker_cannot_allocate_invoice_number';
    passed := passed || jsonb_build_array('worker_cannot_allocate_invoice_number');
    v_error := null;
    begin perform public.delete_invoice_draft_atomic(c_paid,invoice_delete);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'worker_cannot_delete_draft';
    passed := passed || jsonb_build_array('worker_cannot_delete_draft');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    v_error := null;
    begin perform public.issue_invoice_atomic(c_paid,invoice_extra);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'other_company_admin_cannot_issue';
    passed := passed || jsonb_build_array('other_company_admin_cannot_issue');
    v_error := null;
    begin perform public.issue_invoice_atomic(c_other,invoice_extra);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'own_company_parameter_cannot_rebind_foreign_invoice';
    passed := passed || jsonb_build_array('own_company_parameter_cannot_rebind_foreign_invoice');
    execute 'reset role';
    update public.company_members set is_active=false where id=member_paid;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    v_error := null;
    begin perform public.issue_invoice_atomic(c_paid,invoice_extra);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'removed_membership_denies_stale_auth_token';
    passed := passed || jsonb_build_array('removed_membership_denies_stale_auth_token');
    execute 'reset role';
    update public.company_members set is_active=true where id=member_paid;
    execute 'set local role authenticated';

    -- Issued history remains readable, and export metadata is usable after paid expiry.
    assert (select invoice_number from public.invoices where id=invoice_history)=marker||'-historic',
      'expired_module_preserves_invoice_history';
    passed := passed || jsonb_build_array('expired_module_preserves_invoice_history');
    update public.invoices set pohoda_export_status='exported',pohoda_exported_at=v_now,pohoda_last_error=null
      where id=invoice_history;
    get diagnostics v_rows=row_count;
    assert v_rows=1 and (select pohoda_export_status from public.invoices where id=invoice_history)='exported',
      'expired_module_allows_export_bookkeeping';
    passed := passed || jsonb_build_array('expired_module_allows_export_bookkeeping');
    update public.invoices set status='paid',paid_at=v_now where id=invoice_history;
    assert (select status from public.invoices where id=invoice_history)='paid', 'expired_module_allows_prior_invoice_settlement';
    passed := passed || jsonb_build_array('expired_module_allows_prior_invoice_settlement');
    v_retry := public.issue_invoice_atomic(c_history,invoice_history);
    assert not (v_retry->>'issued')::boolean and v_retry->>'status'='paid', 'historic_retry_is_not_new_issuance';
    passed := passed || jsonb_build_array('historic_retry_is_not_new_issuance');

    select jsonb_build_object('invoice',(select to_jsonb(i) from public.invoices i where id=invoice_paid),
      'job',(select to_jsonb(j) from public.jobs j where id=job_paid),
      'links',(select jsonb_agg(to_jsonb(l)) from public.invoice_jobs l where invoice_id=invoice_paid)) into v_before;
    v_error := null;
    begin perform public.delete_invoice_draft_atomic(c_paid,invoice_paid);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501' and v_before=jsonb_build_object(
      'invoice',(select to_jsonb(i) from public.invoices i where id=invoice_paid),
      'job',(select to_jsonb(j) from public.jobs j where id=job_paid),
      'links',(select jsonb_agg(to_jsonb(l)) from public.invoice_jobs l where invoice_id=invoice_paid)),
      'issued_delete_denied_before_job_or_link_mutation';
    passed := passed || jsonb_build_array('issued_delete_denied_before_job_or_link_mutation');
    v_error := null;
    begin perform public.delete_invoice_draft_atomic(c_history,invoice_exported_draft);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501' and exists(select 1 from public.invoices where id=invoice_exported_draft),
      'exported_draft_delete_denied';
    passed := passed || jsonb_build_array('exported_draft_delete_denied');
    v_result := public.delete_invoice_draft_atomic(c_legacy,invoice_legacy_draft);
    assert (v_result->>'deleted')::boolean and not exists(select 1 from public.invoices where id=invoice_legacy_draft),
      'unenrolled_draft_delete_allowed';
    passed := passed || jsonb_build_array('unenrolled_draft_delete_allowed');
    v_result := public.delete_invoice_draft_atomic(c_history,invoice_history_draft);
    assert (v_result->>'deleted')::boolean and not exists(select 1 from public.invoices where id=invoice_history_draft),
      'expired_pilot_draft_delete_allowed';
    passed := passed || jsonb_build_array('expired_pilot_draft_delete_allowed');
    select to_jsonb(j) into v_before from public.jobs j where id=job_delete;
    v_result := public.delete_invoice_draft_atomic(c_paid,invoice_delete);
    assert (v_result->>'deleted')::boolean and (v_result->>'invoice_id')::uuid=invoice_delete
      and not exists(select 1 from public.invoices where id=invoice_delete)
      and v_before=(select to_jsonb(j) from public.jobs j where id=job_delete), 'paid_draft_delete_keeps_job_state';
    passed := passed || jsonb_build_array('paid_draft_delete_keeps_job_state');
    execute 'reset role';
    assert not exists(select 1 from public.invoice_jobs where invoice_id=invoice_delete)
      and not exists(select 1 from public.invoice_items where invoice_id=invoice_delete),
      'draft_delete_cascades_links_and_items';
    passed := passed || jsonb_build_array('draft_delete_cascades_links_and_items');
    execute 'set local role authenticated';

    -- A final AFTER-trigger provenance conflict must undo invoice, sequence and linked-job writes.
    -- The synthetic owner-only duplicate proof is deliberately inconsistent with the draft.
    execute 'reset role';
    insert into private.invoice_issue_authorizations(invoice_id,company_id,entitlement_id,issued_at,actor_auth_user_id)
      values(invoice_failure,c_paid,grant_paid,v_now,u_admin);
    select jsonb_build_object('invoice',(select to_jsonb(i) from public.invoices i where id=invoice_failure),
      'job',(select to_jsonb(j) from public.jobs j where id=job_failure),
      'sequence',(select to_jsonb(s) from public.invoice_number_sequences s where company_id=c_paid and year=v_year),
      'authority',(select to_jsonb(a) from private.invoice_issue_authorizations a where invoice_id=invoice_failure))
      into v_before;
    execute 'set local role authenticated';
    v_error := null;
    begin perform public.issue_invoice_atomic(c_paid,invoice_failure);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='23505', 'provenance_write_failure_is_not_swallowed';
    passed := passed || jsonb_build_array('provenance_write_failure_is_not_swallowed');
    execute 'reset role';
    assert v_before=jsonb_build_object('invoice',(select to_jsonb(i) from public.invoices i where id=invoice_failure),
      'job',(select to_jsonb(j) from public.jobs j where id=job_failure),
      'sequence',(select to_jsonb(s) from public.invoice_number_sequences s where company_id=c_paid and year=v_year),
      'authority',(select to_jsonb(a) from private.invoice_issue_authorizations a where invoice_id=invoice_failure)),
      'provenance_failure_rolls_back_header_sequence_and_linked_job';
    passed := passed || jsonb_build_array('provenance_failure_rolls_back_header_sequence_and_linked_job');

    perform set_config('request.jwt.claims','{}',true);
    perform set_config('request.jwt.claim.sub','',true);
    execute 'set local role anon';
    v_error := null;
    begin perform public.issue_invoice_atomic(c_paid,invoice_extra);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'anonymous_rpc_denied';
    passed := passed || jsonb_build_array('anonymous_rpc_denied');
    execute 'reset role';
    raise exception 'rollback synthetic invoice fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.companies where id=any(fixture_companies)), 'company_fixture_cleanup';
  assert not exists(select 1 from public.invoices where id=any(fixture_invoices)), 'invoice_fixture_cleanup';
  assert not exists(select 1 from public.module_offers where offer_key like marker||'%'), 'offer_fixture_cleanup';
  assert not exists(select 1 from private.invoice_module_rollouts where company_id=any(fixture_companies)), 'rollout_fixture_cleanup';
  assert not exists(select 1 from private.invoice_issue_authorizations where invoice_id=any(fixture_invoices)), 'provenance_fixture_cleanup';
  perform set_config('diriqo.invoice_issue_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),
    'fixtures','rolled_back','cleanup_assertions',6,'concurrency','not_tested_single_session')::text,true);
end;
$test$;
select current_setting('diriqo.invoice_issue_test_result')::jsonb as result;
