-- Authorized Diriqo TEST project only, after guard_invoice_delete is installed.
-- Owner-only synthetic setup; application mutations use actual database roles.
-- No DDL, GRANT, provider calls or real customer rows. All fixtures roll back.
-- Single-session evidence; concurrent issue-versus-delete needs a separate test.
do $test$
declare
  u_admin uuid:=gen_random_uuid(); u_worker uuid:=gen_random_uuid(); u_other uuid:=gen_random_uuid();
  p_admin uuid:=gen_random_uuid(); p_worker uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid();
  c_a uuid:=gen_random_uuid(); c_b uuid:=gen_random_uuid(); c_paid uuid:=gen_random_uuid();
  c_test uuid:=gen_random_uuid(); c_expired uuid:=gen_random_uuid(); c_cascade uuid:=gen_random_uuid();
  cu_a uuid:=gen_random_uuid(); cu_b uuid:=gen_random_uuid(); cu_paid uuid:=gen_random_uuid();
  cu_test uuid:=gen_random_uuid(); cu_expired uuid:=gen_random_uuid(); cu_cascade uuid:=gen_random_uuid();
  offer_core uuid:=gen_random_uuid(); offer_invoice uuid:=gen_random_uuid();
  request_rpc uuid:=gen_random_uuid(); v_order uuid; v_grant uuid;
  v_invoice uuid; v_job uuid; v_item uuid; v_target uuid; v_request uuid;
  v_case record; v_fixture record; v_label text; v_error text; v_message text; v_rows integer;
  v_result jsonb; v_before jsonb; v_after jsonb; v_map jsonb:='{}'; passed jsonb:='[]';
  v_now timestamptz:=date_trunc('second',clock_timestamp()); v_year integer:=extract(year from current_date)::integer;
  v_companies uuid[]; v_invoices uuid[]:='{}'; v_jobs uuid[]:='{}';
  v_service_has_access boolean; v_company_fk_action text; v_company_denial text; v_null_status_not_null boolean;
  marker text:='InvoiceDelete'||replace(gen_random_uuid()::text,'-','');
  v_snapshot_sql constant text:=$snapshot$
    select jsonb_build_object(
      'invoice',(select to_jsonb(i) from public.invoices i where i.id=$1),
      'items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.invoice_items x where x.invoice_id=$1),
      'links',(select jsonb_agg(to_jsonb(x) order by x.job_id) from public.invoice_jobs x where x.invoice_id=$1),
      'jobs',(select jsonb_agg(to_jsonb(j) order by j.id) from public.jobs j
        where j.id in(select ij.job_id from public.invoice_jobs ij where ij.invoice_id=$1)))
  $snapshot$;
begin
  v_companies:=array[c_a,c_b,c_paid,c_test,c_expired,c_cascade];
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),(u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-other@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic delete admin'),(p_worker,u_worker,u_worker,'Synthetic delete worker'),
      (p_other,u_other,u_other,'Synthetic delete foreign admin');
    insert into public.companies(id,name) values
      (c_a,'Synthetic delete legacy'),(c_b,'Synthetic delete foreign'),(c_paid,'Synthetic delete paid'),
      (c_test,'Synthetic delete test'),(c_expired,'Synthetic delete expired'),(c_cascade,'Synthetic delete cascade');
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (c_a,p_admin,'company_admin',true),(c_a,p_worker,'worker',true),(c_b,p_other,'company_admin',true),
      (c_paid,p_admin,'company_admin',true),(c_test,p_admin,'company_admin',true),
      (c_expired,p_admin,'company_admin',true),(c_cascade,p_admin,'company_admin',true);
    insert into public.customers(id,company_id,name) values
      (cu_a,c_a,'Synthetic legacy customer'),(cu_b,c_b,'Synthetic foreign customer'),
      (cu_paid,c_paid,'Synthetic paid customer'),(cu_test,c_test,'Synthetic test customer'),
      (cu_expired,c_expired,'Synthetic expired customer'),(cu_cascade,c_cascade,'Synthetic cascade customer');

    -- Owner-created immutable receipt fixtures, never a Stripe API/payment operation.
    insert into public.module_offers(id,offer_key,product,stripe_price_id,livemode,currency,unit_amount,
      capabilities,policy_version,history_days,is_published) values
      (offer_core,marker||'-core','diriqo_core','price_'||marker||'Core',false,'czk',1000,
        array['core.jobs.create'],'diriqo-capabilities-v0.1',90,true),
      (offer_invoice,marker||'-invoice','invoicing','price_'||marker||'Invoice',false,'czk',1000,
        array['invoicing.invoice.issue','invoicing.history.read','invoicing.history.export'],'diriqo-capabilities-v0.1',90,true);
    for v_fixture in select * from (values(offer_core,'core'),(offer_invoice,'invoice')) f(offer_id,label) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_paid,v_fixture.offer_id,'cus_'||marker||v_fixture.label) returning id into v_order;
      insert into public.company_module_entitlements(company_id,product,policy_version,source_ref,
        valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
      select c_paid,o.product,o.policy_version,marker||v_fixture.label,v_now-interval '1 day',
        v_now+interval '1 day',v_now+interval '91 days',o.capabilities,
        'in_'||marker||v_fixture.label,'il_'||marker||v_fixture.label,o.livemode,v_order
      from public.module_offers o where o.id=v_fixture.offer_id;
    end loop;
    insert into private.company_test_module_grants(company_id,product,source_ref,reason,
      valid_from,valid_until,history_until,capabilities) values
      (c_test,'diriqo_core',marker||'-test-core','Synthetic DELETE regression',
        v_now-interval '1 day',v_now+interval '1 day',v_now+interval '1 day',array['core.jobs.create']),
      (c_test,'invoicing',marker||'-test-invoice','Synthetic DELETE regression',
        v_now-interval '1 day',v_now+interval '1 day',v_now+interval '1 day',array['invoicing.invoice.issue']);
    insert into private.invoice_module_rollouts(company_id,livemode) values(c_paid,false),(c_test,false);

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    for v_case in select * from (values
      ('issued',c_a,cu_a,'issued',true,false),('sent',c_a,cu_a,'sent',true,false),
      ('paid',c_a,cu_a,'paid',true,false),('overdue',c_a,cu_a,'overdue',true,false),
      ('cancelled',c_a,cu_a,'cancelled',true,false),('cancelled_draft',c_a,cu_a,'cancelled',false,false),
      ('exported_draft',c_a,cu_a,'draft',false,true),('draft_direct',c_a,cu_a,'draft',false,false),
      ('draft_rpc',c_a,cu_a,'draft',false,false),('draft_mixed',c_a,cu_a,'draft',false,false),
      ('draft_paid',c_paid,cu_paid,'draft',false,false),('draft_test',c_test,cu_test,'draft',false,false),
      ('draft_expired_direct',c_expired,cu_expired,'draft',false,false),
      ('draft_expired_rpc',c_expired,cu_expired,'draft',false,false),
      ('history_paid',c_paid,cu_paid,'issued',true,false),('history_test',c_test,cu_test,'issued',true,false),
      ('company_cascade',c_cascade,cu_cascade,'issued',true,false)
    ) cases(label,company_id,customer_id,final_status,issue_first,exported) loop
      v_job:=gen_random_uuid(); v_item:=gen_random_uuid(); v_invoice:=gen_random_uuid();
      insert into public.jobs(id,company_id,customer_id,title,status,work_state,price,billing_status)
        values(v_job,v_case.company_id,v_case.customer_id,'Synthetic delete '||v_case.label,
          'done','done',100,'not_invoiced');
      if v_case.label='draft_rpc' then
        v_result:=public.create_invoice_from_jobs_atomic(c_a,cu_a,array[v_job],
          current_date,current_date,current_date+14,0,'Synthetic delete request',request_rpc);
        v_invoice:=(v_result->>'invoice_id')::uuid;
        select id into strict v_item from public.invoice_items where invoice_id=v_invoice;
      else
        insert into public.invoices(id,company_id,customer_id,invoice_year,status,issue_date,taxable_supply_date,
          due_date,subtotal_without_vat,vat_total,total_with_vat,is_vat_payer,supplier_snapshot,customer_snapshot,created_by)
        values(v_invoice,v_case.company_id,v_case.customer_id,v_year,'draft',current_date,current_date,current_date+14,
          100,0,100,false,'{"name":"Synthetic supplier"}','{"name":"Synthetic customer"}',p_admin);
        insert into public.invoice_items(id,invoice_id,company_id,sort_order,source_job_id,item_name,quantity,unit,
          unit_price_without_vat,vat_rate,vat_amount,total_without_vat,total_with_vat,source_snapshot)
        values(v_item,v_invoice,v_case.company_id,1,v_job,'Synthetic retained line',1,'ks',
          100,0,0,100,100,'{"title":"Synthetic retained source"}');
        insert into public.invoice_jobs(invoice_id,job_id,company_id,customer_id)
          values(v_invoice,v_job,v_case.company_id,v_case.customer_id);
      end if;
      if v_case.issue_first then
        v_result:=public.issue_invoice_atomic(v_case.company_id,v_invoice);
        assert (v_result->>'issued')::boolean, v_case.label||'_issue_fixture';
      end if;
      if v_case.final_status<>'draft' then update public.invoices set status=v_case.final_status where id=v_invoice; end if;
      if v_case.exported then update public.invoices set pohoda_export_status='exported',pohoda_exported_at=v_now where id=v_invoice; end if;
      v_map:=v_map||jsonb_build_object(v_case.label,jsonb_build_object('invoice',v_invoice,'job',v_job,'item',v_item));
      v_invoices:=array_append(v_invoices,v_invoice); v_jobs:=array_append(v_jobs,v_job);
    end loop;

    -- Verify that paid/test cases really carry their respective restrictive FK.
    execute 'reset role';
    assert exists(select 1 from private.invoice_issue_authorizations
      where invoice_id=(v_map->'history_paid'->>'invoice')::uuid), 'paid_history_has_paid_provenance';
    assert exists(select 1 from private.invoice_test_issue_authorizations
      where invoice_id=(v_map->'history_test'->>'invoice')::uuid), 'test_history_has_test_provenance';
    assert not exists(select 1 from private.invoice_issue_authorizations
      where invoice_id=(v_map->'issued'->>'invoice')::uuid)
      and not exists(select 1 from private.invoice_test_issue_authorizations
        where invoice_id=(v_map->'issued'->>'invoice')::uuid), 'legacy_history_has_no_provenance_safety_net';
    passed:=passed||jsonb_build_array('paid_history_has_paid_provenance','test_history_has_test_provenance',
      'legacy_history_has_no_provenance_safety_net');
    execute 'set local role authenticated';

    foreach v_label in array array['issued','sent','paid','overdue','cancelled','cancelled_draft','exported_draft','history_paid','history_test'] loop
      v_target:=(v_map->v_label->>'invoice')::uuid;
      execute v_snapshot_sql into v_before using v_target;
      v_error:=null; v_message:=null;
      begin delete from public.invoices where id=v_target;
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='42501' and v_message='INVOICE_DELETE_FORBIDDEN', v_label||'_direct_delete_guard_denied';
      execute v_snapshot_sql into v_after using v_target;
      assert v_after=v_before, v_label||'_delete_preserves_invoice_items_links_and_job';
      passed:=passed||jsonb_build_array(v_label||'_direct_delete_guard_denied_without_partial_state');
    end loop;

    -- A single DELETE containing both removable and historical rows is all-or-nothing.
    v_target:=(v_map->'draft_mixed'->>'invoice')::uuid;
    execute v_snapshot_sql into v_before using v_target;
    v_error:=null; v_message:=null;
    begin delete from public.invoices where id in(v_target,(v_map->'issued'->>'invoice')::uuid);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_DELETE_FORBIDDEN', 'mixed_delete_rejected';
    execute v_snapshot_sql into v_after using v_target;
    assert v_after=v_before and exists(select 1 from public.invoices where id=(v_map->'issued'->>'invoice')::uuid),
      'mixed_delete_rolls_back_removable_draft_too';
    passed:=passed||jsonb_build_array('mixed_delete_rolls_back_removable_draft_too');

    -- Role boundaries stay in RLS and RPC authority; the new trigger grants no access.
    v_target:=(v_map->'issued'->>'invoice')::uuid;
    execute v_snapshot_sql into v_before using v_target;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_worker::text,true);
    delete from public.invoices where id=v_target;
    get diagnostics v_rows=row_count;
    assert v_rows=0, 'worker_delete_remains_denied';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    delete from public.invoices where id=v_target;
    get diagnostics v_rows=row_count;
    assert v_rows=0, 'foreign_admin_delete_remains_denied';
    execute 'reset role';
    execute v_snapshot_sql into v_after using v_target;
    assert v_after=v_before, 'unauthorized_roles_preserve_complete_history';
    passed:=passed||jsonb_build_array('worker_delete_remains_denied','foreign_admin_delete_remains_denied',
      'unauthorized_roles_preserve_complete_history');

    v_service_has_access:=has_table_privilege('service_role','public.invoices','SELECT')
      and has_table_privilege('service_role','public.invoices','DELETE');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','service_role')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role service_role';
    v_error:=null; v_message:=null;
    begin delete from public.invoices where id=v_target;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    execute 'reset role';
    if v_service_has_access then
      assert v_error='42501' and v_message='INVOICE_DELETE_FORBIDDEN', 'service_role_delete_guard_denied';
      passed:=passed||jsonb_build_array('service_role_delete_guard_denied');
    else
      assert v_error='42501' and v_message<>'INVOICE_DELETE_FORBIDDEN', 'service_role_without_table_grants_denied';
      passed:=passed||jsonb_build_array('service_role_without_table_grants_denied');
    end if;
    execute v_snapshot_sql into v_after using v_target;
    assert v_after=v_before, 'service_role_attempt_preserves_complete_history';
    passed:=passed||jsonb_build_array('service_role_attempt_preserves_complete_history');
    assert (select rolbypassrls or rolsuper from pg_roles where rolname=current_user), 'owner_control_bypasses_rls';
    v_error:=null; v_message:=null;
    begin delete from public.invoices where id=v_target;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_DELETE_FORBIDDEN', 'owner_delete_guard_denied';
    execute v_snapshot_sql into v_after using v_target;
    assert v_after=v_before, 'owner_attempt_preserves_complete_history';
    passed:=passed||jsonb_build_array('owner_delete_guard_denied','owner_attempt_preserves_complete_history');

    -- Actual company DELETE. Runtime schemas CASCADE invoices; canonical schemas
    -- RESTRICT. Another earlier FK may reject the statement before this guard.
    -- Record that distinction rather than pretending every rejection is our trigger.
    select confdeltype::text into v_company_fk_action from pg_constraint
      where contype='f' and conrelid='public.invoices'::regclass and confrelid='public.companies'::regclass;
    v_target:=(v_map->'company_cascade'->>'invoice')::uuid;
    execute v_snapshot_sql into v_before using v_target;
    v_error:=null; v_message:=null;
    begin delete from public.companies where id=c_cascade;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert (v_error='42501' and v_message='INVOICE_DELETE_FORBIDDEN') or v_error='23503',
      'company_delete_blocked_by_content_guard_or_existing_fk';
    v_company_denial:=case when v_message='INVOICE_DELETE_FORBIDDEN' then 'invoice_delete_guard' else 'existing_foreign_key' end;
    execute v_snapshot_sql into v_after using v_target;
    assert v_after=v_before and exists(select 1 from public.companies where id=c_cascade)
      and exists(select 1 from public.customers where id=cu_cascade)
      and exists(select 1 from public.company_members where company_id=c_cascade and profile_id=p_admin),
      'company_delete_rolls_back_all_fixture_rows';
    passed:=passed||jsonb_build_array('company_delete_rolls_back_all_fixture_rows');

    -- NULL status is not representable on the real schema; do not disable a constraint.
    select attnotnull into v_null_status_not_null from pg_attribute
      where attrelid='public.invoices'::regclass and attname='status' and not attisdropped;
    assert v_null_status_not_null, 'null_status_not_representable_by_schema';
    passed:=passed||jsonb_build_array('null_status_not_representable_by_schema');

    -- Turn the pre-existing expired-company drafts into a real expired test rollout.
    insert into private.company_test_module_grants(company_id,product,source_ref,reason,
      valid_from,valid_until,history_until,capabilities) values
      (c_expired,'diriqo_core',marker||'-expired-core','Synthetic expired DELETE regression',
        v_now-interval '2 days',v_now-interval '1 day',v_now-interval '1 day',array['core.jobs.create']),
      (c_expired,'invoicing',marker||'-expired-invoice','Synthetic expired DELETE regression',
        v_now-interval '2 days',v_now-interval '1 day',v_now-interval '1 day',array['invoicing.invoice.issue']);
    insert into private.invoice_module_rollouts(company_id,livemode) values(c_expired,false);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    v_error:=null; v_message:=null;
    begin perform public.issue_invoice_atomic(c_expired,(v_map->'draft_expired_rpc'->>'invoice')::uuid);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_MODULE_REQUIRED', 'expired_fixture_really_cannot_issue';
    passed:=passed||jsonb_build_array('expired_fixture_really_cannot_issue');

    foreach v_label in array array['draft_direct','draft_rpc','draft_paid','draft_test','draft_expired_direct','draft_expired_rpc'] loop
      v_target:=(v_map->v_label->>'invoice')::uuid; v_job:=(v_map->v_label->>'job')::uuid;
      select to_jsonb(j) into v_before from public.jobs j where id=v_job;
      if v_label in ('draft_rpc','draft_paid','draft_test','draft_expired_rpc') then
        v_result:=public.delete_invoice_draft_atomic(
          case when v_label='draft_paid' then c_paid when v_label='draft_test' then c_test
            when v_label='draft_expired_rpc' then c_expired else c_a end,v_target);
        assert (v_result->>'deleted')::boolean, v_label||'_rpc_reports_deleted';
      else
        delete from public.invoices where id=v_target;
        get diagnostics v_rows=row_count;
        assert v_rows=1, v_label||'_direct_delete_succeeds';
      end if;
      assert not exists(select 1 from public.invoices where id=v_target)
        and not exists(select 1 from public.invoice_items where invoice_id=v_target)
        and not exists(select 1 from public.invoice_jobs where invoice_id=v_target),
        v_label||'_delete_cascades_complete_draft';
      assert (select to_jsonb(j)=v_before from public.jobs j where id=v_job),
        v_label||'_delete_keeps_source_job_unchanged';
      passed:=passed||jsonb_build_array(v_label||'_delete_allowed_with_children_cleanup_and_unchanged_job');
    end loop;
    execute 'reset role';
    assert exists(select 1 from private.invoice_draft_requests
      where company_id=c_a and request_id=request_rpc and invoice_id=(v_map->'draft_rpc'->>'invoice')::uuid),
      'draft_request_tombstone_preserved';
    passed:=passed||jsonb_build_array('draft_request_tombstone_preserved');

    -- The previous issue/update protections remain active; DELETE has no downgrade route.
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    v_target:=(v_map->'issued'->>'invoice')::uuid;
    execute v_snapshot_sql into v_before using v_target;
    v_error:=null;
    begin update public.invoices set status='draft',issued_at=null where id=v_target;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'issued_history_cannot_downgrade_to_deletable_draft';
    execute v_snapshot_sql into v_after using v_target;
    assert v_after=v_before, 'failed_downgrade_preserves_complete_history';
    passed:=passed||jsonb_build_array('issued_history_cannot_downgrade_to_deletable_draft');
    execute 'reset role';

    assert not has_function_privilege('anon','private.guard_invoice_delete()','EXECUTE')
      and not has_function_privilege('authenticated','private.guard_invoice_delete()','EXECUTE')
      and not has_function_privilege('service_role','private.guard_invoice_delete()','EXECUTE'),
      'delete_guard_adds_no_callable_privilege';
    assert (select not prosecdef and proconfig=array['search_path=""']::text[]
      from pg_proc where oid='private.guard_invoice_delete()'::regprocedure), 'delete_guard_is_unprivileged';
    passed:=passed||jsonb_build_array('delete_guard_adds_no_callable_privilege','delete_guard_is_unprivileged');
    raise exception 'rollback synthetic invoice delete guard fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.profiles where id=any(array[p_admin,p_worker,p_other])), 'profile_fixture_cleanup';
  assert not exists(select 1 from public.companies where id=any(v_companies)), 'company_fixture_cleanup';
  assert not exists(select 1 from public.jobs where id=any(v_jobs)), 'job_fixture_cleanup';
  assert not exists(select 1 from public.invoices where id=any(v_invoices)), 'invoice_fixture_cleanup';
  assert not exists(select 1 from private.invoice_draft_requests where company_id=any(v_companies)), 'request_fixture_cleanup';
  assert not exists(select 1 from private.company_test_module_grants where company_id=any(v_companies)), 'test_grant_fixture_cleanup';
  assert not exists(select 1 from public.company_module_entitlements where company_id=any(v_companies)), 'paid_grant_fixture_cleanup';
  assert not exists(select 1 from public.module_offers where id in(offer_core,offer_invoice)), 'offer_fixture_cleanup';
  assert not exists(select 1 from private.invoice_issue_authorizations where invoice_id=any(v_invoices))
    and not exists(select 1 from private.invoice_test_issue_authorizations where invoice_id=any(v_invoices)), 'provenance_fixture_cleanup';
  perform set_config('diriqo.invoice_delete_guard_test_result',jsonb_build_object(
    'passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back','cleanup_assertions',10,
    'company_fk_action',v_company_fk_action,'company_delete_denial_boundary',v_company_denial,
    'null_status','not_representable_in_live_schema','concurrency','not_tested_single_session',
    'explicit_limits',jsonb_build_array('exported_draft_marker_can_still_be_reset_before_delete','no_truncate_claim'))::text,true);
end;
$test$;
select current_setting('diriqo.invoice_delete_guard_test_result')::jsonb as result;