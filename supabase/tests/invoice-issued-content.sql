-- Authorized Diriqo TEST project only, after lock_issued_invoice_accounting_content.
-- Owner-only synthetic setup; boundary checks run as real authenticated/service roles.
-- No DDL, provider calls or real customer data. Every fixture change rolls back.
-- This proves row-level invariants and compatibility, not simultaneous transactions.
do $test$
declare
  u_admin uuid := gen_random_uuid(); u_worker uuid := gen_random_uuid(); u_other uuid := gen_random_uuid();
  p_admin uuid := gen_random_uuid(); p_worker uuid := gen_random_uuid(); p_other uuid := gen_random_uuid();
  p_history uuid := gen_random_uuid();
  c_a uuid := gen_random_uuid(); c_b uuid := gen_random_uuid();
  customer_a uuid := gen_random_uuid(); customer_b uuid := gen_random_uuid();
  job_source uuid := gen_random_uuid(); job_other uuid := gen_random_uuid();
  invoice_main uuid := gen_random_uuid(); invoice_legacy uuid := gen_random_uuid();
  invoice_states uuid := gen_random_uuid(); invoice_cancelled_draft uuid := gen_random_uuid();
  export_a uuid := gen_random_uuid();
  marker text := 'InvoiceContent' || replace(gen_random_uuid()::text, '-', '');
  v_now timestamptz := date_trunc('second', clock_timestamp());
  v_year integer := extract(year from current_date)::integer;
  v_case record; v_state text; v_error text; v_message text; v_rows integer;
  v_before jsonb; v_after jsonb; v_mutations jsonb; v_result jsonb; passed jsonb := '[]';
  v_service_has_table_access boolean;
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),
      (u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-other@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic content admin'),
      (p_worker,u_worker,u_worker,'Synthetic content worker'),
      (p_other,u_other,u_other,'Synthetic foreign admin');
    insert into public.profiles(id,full_name) values(p_history,'Synthetic historic creator');
    insert into public.companies(id,name) values(c_a,'Synthetic invoice content A'),(c_b,'Synthetic invoice content B');
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (c_a,p_admin,'company_admin',true),(c_a,p_worker,'worker',true),(c_b,p_other,'company_admin',true);
    insert into public.customers(id,company_id,name) values
      (customer_a,c_a,'Synthetic invoice customer A'),(customer_b,c_b,'Synthetic invoice customer B');
    insert into public.jobs(id,company_id,customer_id,title,status,work_state,price) values
      (job_source,c_a,customer_a,'Synthetic historic source','done','done',100),
      (job_other,c_a,customer_a,'Synthetic alternative source','done','done',100);
    insert into public.pohoda_exports(id,company_id,status) values(export_a,c_a,'pending');

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';

    insert into public.invoices(id,company_id,customer_id,invoice_year,status,due_date,
      subtotal_without_vat,vat_total,total_with_vat,supplier_snapshot,customer_snapshot,
      is_vat_payer,vat_note,note,created_by,job_id,number,due_at,total_amount,total_without_vat,vat_amount)
    values(invoice_main,c_a,customer_a,v_year,'draft',current_date+14,
      100,21,121,'{"name":"Historic supplier","iban":"CZ0000000000000000000000"}',
      '{"name":"Historic customer"}',true,'Historic VAT note','Historic note',p_history,job_source,
      marker||'-alias',current_date+14,121,100,21);
    update public.invoices set note='Editable draft note',subtotal_without_vat=110,vat_total=23.1,total_with_vat=133.1
      where id=invoice_main;
    assert (select note='Editable draft note' and total_with_vat=133.1 from public.invoices where id=invoice_main),
      'draft_accounting_edit_still_allowed';
    passed := passed || jsonb_build_array('draft_accounting_edit_still_allowed');

    v_result := public.issue_invoice_atomic(c_a,invoice_main);
    assert (v_result->>'issued')::boolean and v_result->>'status'='issued'
      and (select total_with_vat=133.1 and issued_at is not null and invoice_number is not null
        and supplier_snapshot->>'name'='Historic supplier' from public.invoices where id=invoice_main),
      'first_issue_preserves_snapshot_and_existing_authority';
    passed := passed || jsonb_build_array('first_issue_preserves_snapshot_and_existing_authority');

    -- Legacy import/issue INSERT remains governed by the existing issue/licence trigger.
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,due_date,
      subtotal_without_vat,vat_total,total_with_vat,supplier_snapshot,customer_snapshot)
    values(invoice_legacy,c_a,customer_a,v_year,'issued',marker||'-legacy',current_date+14,
      100,21,121,'{"name":"Legacy supplier"}','{"name":"Legacy customer"}');
    assert (select status='issued' and issued_at is not null and total_with_vat=121
      from public.invoices where id=invoice_legacy), 'legacy_issued_insert_still_allowed';
    passed := passed || jsonb_build_array('legacy_issued_insert_still_allowed');

    insert into public.invoices(id,company_id,customer_id,invoice_year,status,due_date,customer_snapshot,supplier_snapshot,job_id)
      values(invoice_states,c_a,customer_a,v_year,'draft',current_date+14,'{}','{}',job_other),
        (invoice_cancelled_draft,c_a,customer_a,v_year,'draft',current_date+14,'{}','{}',null);
    perform public.issue_invoice_atomic(c_a,invoice_states);
    update public.invoices set status='cancelled',cancelled_at=v_now where id=invoice_cancelled_draft;

    select to_jsonb(i) into v_before from public.invoices i where id=invoice_main;
    v_mutations := jsonb_build_object(
      'id',gen_random_uuid(),'company_id',c_b,'customer_id',customer_b,
      'invoice_number',marker||'-rewritten','invoice_year',v_year+1,'variable_symbol','987654321',
      'currency','EUR','issue_date',current_date+1,'taxable_supply_date',current_date+1,'due_date',current_date+15,
      'subtotal_without_vat',999,'vat_total',999,'total_with_vat',999,
      'customer_snapshot',jsonb_build_object('name','Replacement customer'),
      'supplier_snapshot',jsonb_build_object('iban','ATTACKER-BANK'),
      'note','Replacement note','issued_at',v_now+interval '1 day','created_by',p_other,
      'created_at',v_now+interval '1 day','job_id',job_other,'number','REWRITTEN-ALIAS',
      'due_at',current_date+15,'total_amount',999,'total_without_vat',999,'vat_amount',999,
      'payment_method','cash','is_vat_payer',false,'vat_note','Replacement VAT note');
    for v_case in select key,value from jsonb_each(v_mutations) loop
      v_error := null; v_message := null;
      begin
        execute format('update public.invoices set %1$I = (jsonb_populate_record(null::public.invoices,$1)).%1$I where id=$2',
          v_case.key) using jsonb_build_object(v_case.key,v_case.value),invoice_main;
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text;
      end;
      assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE',
        'issued_'||v_case.key||'_change_rejected';
      select to_jsonb(i) into v_after from public.invoices i where id=invoice_main;
      assert v_after=v_before, 'issued_'||v_case.key||'_failure_preserves_full_row';
      passed := passed || jsonb_build_array('issued_'||v_case.key||'_change_rejected_without_change');
    end loop;

    -- A normal no-op does not falsely fail the immutable-value comparison.
    update public.invoices set total_with_vat=total_with_vat,supplier_snapshot=supplier_snapshot where id=invoice_main;
    get diagnostics v_rows=row_count;
    assert v_rows=1, 'unchanged_accounting_values_allowed';
    passed := passed || jsonb_build_array('unchanged_accounting_values_allowed');

    -- Existing operational writers must keep working; no licence gate is added here.
    update public.invoices set status='sent',sent_at=v_now,updated_at=v_now where id=invoice_main;
    update public.invoices set pohoda_export_status='exported',pohoda_exported_at=v_now,
      pohoda_last_error='Synthetic export diagnostic',pohoda_external_id='Synthetic external id',
      pohoda_last_export_id=export_a where id=invoice_main;
    update public.invoices set status='paid',paid_at=v_now where id=invoice_main;
    assert (select status='paid' and sent_at=v_now and paid_at=v_now and updated_at=v_now
      and pohoda_export_status='exported' and pohoda_exported_at=v_now
      and pohoda_last_error='Synthetic export diagnostic' and pohoda_external_id='Synthetic external id'
      and pohoda_last_export_id=export_a and total_with_vat=133.1
      and supplier_snapshot=v_before->'supplier_snapshot' from public.invoices where id=invoice_main),
      'sent_paid_export_metadata_preserves_accounting_snapshot';
    passed := passed || jsonb_build_array('sent_paid_export_metadata_preserves_accounting_snapshot');
    update public.invoices set status='cancelled',cancelled_at=v_now where id=invoice_legacy;
    assert (select status='cancelled' and cancelled_at=v_now and total_with_vat=121
      from public.invoices where id=invoice_legacy), 'existing_cancellation_writer_still_allowed';
    passed := passed || jsonb_build_array('existing_cancellation_writer_still_allowed');

    -- NEW status cannot bypass the lock; all post-draft states protect content.
    foreach v_state in array array['issued','sent','paid','overdue','cancelled'] loop
      update public.invoices set status=v_state where id=invoice_states;
      select to_jsonb(i) into v_before from public.invoices i where id=invoice_states;
      v_error := null; v_message := null;
      begin
        update public.invoices set status='cancelled',cancelled_at=v_now,total_with_vat=999
          where id=invoice_states;
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text;
      end;
      assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE', v_state||'_combined_status_amount_rejected';
      assert (select to_jsonb(i)=v_before from public.invoices i where id=invoice_states),
        v_state||'_combined_update_rolls_back';
      passed := passed || jsonb_build_array(v_state||'_combined_status_amount_rejected_without_change');
    end loop;
    v_error := null; v_message := null;
    begin update public.invoices set supplier_snapshot='{"name":"Replacement"}' where id=invoice_cancelled_draft;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE', 'cancelled_unissued_draft_is_not_editable';
    passed := passed || jsonb_build_array('cancelled_unissued_draft_is_not_editable');

    -- The detach exception must not become a content-mutation exception.
    select to_jsonb(i) into v_before from public.invoices i where id=invoice_main;
    v_error := null; v_message := null;
    begin update public.invoices set job_id=null,total_amount=999 where id=invoice_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE'
      and (select to_jsonb(i)=v_before from public.invoices i where id=invoice_main),
      'source_detach_cannot_rewrite_legacy_total';
    passed := passed || jsonb_build_array('source_detach_cannot_rewrite_legacy_total');
    v_error := null; v_message := null;
    begin update public.invoices set created_by=null,supplier_snapshot='{"iban":"REPLACEMENT"}' where id=invoice_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE'
      and (select to_jsonb(i)=v_before from public.invoices i where id=invoice_main),
      'creator_detach_cannot_rewrite_supplier';
    passed := passed || jsonb_build_array('creator_detach_cannot_rewrite_supplier');

    -- Exact explicit detachment while the source still exists supports delete_job_safe.
    update public.invoices set job_id=null where id=invoice_main;
    assert exists(select 1 from public.jobs where id=job_source)
      and (select job_id is null and (to_jsonb(i)-'job_id')=(v_before-'job_id')
        from public.invoices i where id=invoice_main), 'explicit_source_detach_preserves_snapshot';
    passed := passed || jsonb_build_array('explicit_source_detach_preserves_snapshot');
    v_error := null; v_message := null;
    begin update public.invoices set job_id=job_source where id=invoice_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE', 'detached_source_cannot_be_reattached';
    passed := passed || jsonb_build_array('detached_source_cannot_be_reattached');

    -- Real FK deletion of a historical creator uses the same exact NULL exception.
    select to_jsonb(i) into v_before from public.invoices i where id=invoice_main;
    execute 'reset role';
    delete from public.profiles where id=p_history;
    execute 'set local role authenticated';
    assert (select created_by is null and (to_jsonb(i)-'created_by')=(v_before-'created_by')
      from public.invoices i where id=invoice_main), 'creator_fk_set_null_preserves_snapshot';
    passed := passed || jsonb_build_array('creator_fk_set_null_preserves_snapshot');
    v_error := null; v_message := null;
    begin update public.invoices set created_by=p_admin where id=invoice_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE', 'detached_creator_cannot_be_reattached';
    passed := passed || jsonb_build_array('detached_creator_cannot_be_reattached');

    -- Exercise the actual job ON DELETE SET NULL path independently of explicit detach.
    select to_jsonb(i) into v_before from public.invoices i where id=invoice_states;
    delete from public.jobs where id=job_other;
    assert (select job_id is null and (to_jsonb(i)-'job_id')=(v_before-'job_id')
      from public.invoices i where id=invoice_states), 'source_fk_set_null_preserves_snapshot';
    passed := passed || jsonb_build_array('source_fk_set_null_preserves_snapshot');

    -- RLS authorization remains unchanged; the new trigger grants no access.
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_worker::text,true);
    update public.invoices set note='Worker rewrite' where id=invoice_main;
    get diagnostics v_rows=row_count;
    assert v_rows=0, 'worker_update_remains_denied';
    passed := passed || jsonb_build_array('worker_update_remains_denied');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    update public.invoices set note='Foreign rewrite' where id=invoice_main;
    get diagnostics v_rows=row_count;
    assert v_rows=0, 'foreign_admin_update_remains_denied';
    passed := passed || jsonb_build_array('foreign_admin_update_remains_denied');

    -- A service role without table grants must be denied before the trigger.
    -- When such grants exist, it must instead reach the same immutable boundary.
    -- Never grant permissions merely to make the regression scenario executable.
    execute 'reset role';
    v_service_has_table_access := has_table_privilege('service_role','public.invoices','SELECT')
      and has_table_privilege('service_role','public.invoices','UPDATE');
    select to_jsonb(i) into v_before from public.invoices i where id=invoice_main;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','service_role')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role service_role';
    v_error := null; v_message := null;
    begin update public.invoices set total_with_vat=999 where id=invoice_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    execute 'reset role';
    if v_service_has_table_access then
      assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE', 'service_role_content_guard_denied';
      passed := passed || jsonb_build_array('service_role_content_guard_denied');
    else
      assert v_error='42501', 'service_role_without_table_grants_denied';
      passed := passed || jsonb_build_array('service_role_without_table_grants_denied');
    end if;
    assert (select to_jsonb(i)=v_before from public.invoices i where id=invoice_main),
      'service_role_attempt_preserves_full_row';
    passed := passed || jsonb_build_array('service_role_attempt_preserves_full_row');

    -- The owner really bypasses RLS; this independently exercises the content
    -- trigger even on installations where service_role has no invoice grants.
    assert (select rolbypassrls or rolsuper from pg_roles where rolname=current_user),
      'owner_control_really_bypasses_rls';
    v_error := null; v_message := null;
    begin update public.invoices set total_with_vat=999 where id=invoice_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_CONTENT_IMMUTABLE', 'owner_cannot_rewrite_issued_content';
    assert (select to_jsonb(i)=v_before from public.invoices i where id=invoice_main),
      'owner_attempt_preserves_full_row';
    passed := passed || jsonb_build_array('owner_cannot_rewrite_issued_content','owner_attempt_preserves_full_row');
    assert not has_function_privilege('anon','private.guard_invoice_accounting_content()','EXECUTE')
      and not has_function_privilege('authenticated','private.guard_invoice_accounting_content()','EXECUTE')
      and not has_function_privilege('service_role','private.guard_invoice_accounting_content()','EXECUTE'),
      'no_new_public_executable_function';
    assert (select not prosecdef and proconfig=array['search_path=""']::text[]
      from pg_proc where oid='private.guard_invoice_accounting_content()'::regprocedure),
      'content_guard_has_no_privileged_execution';
    passed := passed || jsonb_build_array('no_new_public_executable_function','content_guard_has_no_privileged_execution');

    raise exception 'rollback synthetic invoice content fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.profiles where id=any(array[p_admin,p_worker,p_other,p_history])), 'profile_fixture_cleanup';
  assert not exists(select 1 from public.companies where id=any(array[c_a,c_b])), 'company_fixture_cleanup';
  assert not exists(select 1 from public.invoices where id=any(array[invoice_main,invoice_legacy,invoice_states,invoice_cancelled_draft])),
    'invoice_fixture_cleanup';
  assert not exists(select 1 from public.pohoda_exports where id=export_a), 'export_fixture_cleanup';
  perform set_config('diriqo.invoice_content_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),
    'fixtures','rolled_back','cleanup_assertions',5,'concurrency','not_tested_single_session')::text,true);
end;
$test$;
select current_setting('diriqo.invoice_content_test_result')::jsonb as result;