-- Authorized Diriqo TEST project only, after the atomic draft migration is installed.
-- Genuine authenticated/anon/service roles; owner statements are explicitly fixture setup.
-- No DDL, provider calls or real customer rows. Every synthetic change rolls back.
-- Sequential replay and rollback evidence only; simultaneous transactions are not tested here.
do $test$
declare
  u_admin uuid:=gen_random_uuid(); u_worker uuid:=gen_random_uuid(); u_other uuid:=gen_random_uuid();
  p_admin uuid:=gen_random_uuid(); p_worker uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid();
  c_a uuid:=gen_random_uuid(); c_b uuid:=gen_random_uuid(); c_paid uuid:=gen_random_uuid();
  m_admin uuid:=gen_random_uuid();
  customer_a uuid:=gen_random_uuid(); customer_a2 uuid:=gen_random_uuid();
  customer_b uuid:=gen_random_uuid(); customer_paid uuid:=gen_random_uuid();
  job_a uuid:=gen_random_uuid(); job_a2 uuid:=gen_random_uuid(); job_spare uuid:=gen_random_uuid();
  job_not_done uuid:=gen_random_uuid(); job_zero uuid:=gen_random_uuid(); job_negative uuid:=gen_random_uuid();
  job_customer uuid:=gen_random_uuid(); job_b uuid:=gen_random_uuid(); job_paid uuid:=gen_random_uuid();
  job_overflow uuid:=gen_random_uuid(); job_eur uuid:=gen_random_uuid();
  invoice_main uuid; invoice_b uuid; invoice_paid uuid; invoice_spare uuid; item_main uuid; item_b uuid;
  request_main uuid:=gen_random_uuid(); request_spare uuid:=gen_random_uuid(); request_case uuid;
  export_a uuid:=gen_random_uuid(); export_b uuid:=gen_random_uuid();
  offer_core uuid:=gen_random_uuid(); offer_invoice uuid:=gen_random_uuid(); order_fixture uuid; grant_fixture uuid;
  marker text:='InvoiceDraft'||replace(gen_random_uuid()::text,'-','');
  v_now timestamptz:=date_trunc('second',clock_timestamp());
  v_base jsonb; v_invalid_base jsonb; v_body jsonb; v_result jsonb; v_retry jsonb;
  v_before jsonb; v_item_before jsonb; v_error text; v_message text; v_rows integer;
  v_case record; v_fixture record; v_expected text; passed jsonb:='[]';
  v_call text:=$call$
    select public.create_invoice_from_jobs_atomic(
      ($1->>'company_id')::uuid,($1->>'customer_id')::uuid,
      case when $1->'job_ids'='null'::jsonb then null::uuid[]
        else array(select value::uuid from jsonb_array_elements_text($1->'job_ids')) end,
      ($1->>'issue_date')::date,($1->>'taxable_supply_date')::date,($1->>'due_date')::date,
      ($1->>'vat_rate')::numeric,$1->>'note',($1->>'request_id')::uuid
    )
  $call$;
begin
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),(u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-other@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic draft admin'),(p_worker,u_worker,u_worker,'Synthetic draft worker'),
      (p_other,u_other,u_other,'Synthetic draft other admin');
    insert into public.companies(id,name,billing_name,vat_number,billing_street,billing_city,
      billing_postal_code,billing_country,bank_account_number,bank_code) values
      (c_a,'Synthetic supplier','Synthetic legal supplier','CZ12345678','Supplier street 1','Olomouc','77900','CZ','123456789','0100'),
      (c_b,'Synthetic non-VAT supplier','Synthetic non-VAT legal',null,'Other street 2','Brno','60200','CZ',null,null),
      (c_paid,'Synthetic paid supplier','Synthetic paid legal','CZ87654321',null,null,null,'CZ',null,null);
    insert into public.company_members(id,company_id,profile_id,role,is_active) values
      (m_admin,c_a,p_admin,'company_admin',true),(gen_random_uuid(),c_a,p_worker,'worker',true),
      (gen_random_uuid(),c_paid,p_admin,'company_admin',true),(gen_random_uuid(),c_b,p_other,'company_admin',true);
    insert into public.customers(id,company_id,name,billing_name,billing_street,billing_city,billing_postal_code,billing_country,email) values
      (customer_a,c_a,'Synthetic customer','Synthetic legal customer','Customer street 3','Praha','11000','CZ',marker||'@example.invalid'),
      (customer_a2,c_a,'Synthetic second customer',null,null,null,null,'CZ',null),
      (customer_b,c_b,'Synthetic foreign customer',null,null,null,null,'CZ',null),
      (customer_paid,c_paid,'Synthetic paid customer',null,null,null,null,'CZ',null);
    insert into public.jobs(id,company_id,customer_id,title,description,status,work_state,price,start_at,end_at) values
      (job_a,c_a,customer_a,'Authoritative job A','Authoritative description A','done','not_started',10.05,v_now-interval '3 days',v_now-interval '2 days'),
      (job_a2,c_a,customer_a,'Authoritative job B','Authoritative description B','planned','done',20.05,v_now-interval '2 days',v_now-interval '1 day'),
      (job_spare,c_a,customer_a,'Spare completed job',null,'done','done',100,v_now-interval '1 day',v_now),
      (job_not_done,c_a,customer_a,'Incomplete job',null,'planned','not_started',100,null,null),
      (job_zero,c_a,customer_a,'Zero-price job',null,'done','done',0,null,null),
      (job_negative,c_a,customer_a,'Negative-price job',null,'done','done',-1,null,null),
      (job_customer,c_a,customer_a2,'Other customer job',null,'done','done',100,null,null),
      (job_b,c_b,customer_b,'Other company job',null,'done','done',12.34,null,null),
      (job_paid,c_paid,customer_paid,'Paid company job',null,'done','done',100,null,null),
      (job_overflow,c_a,customer_a,'Overflow total job',null,'done','done',9999999999.99,null,null),
      (job_eur,c_a,customer_a,'Foreign currency job',null,'done','done',10,null,null);
    update public.jobs set currency='EUR' where id=job_eur;
    insert into public.pohoda_exports(id,company_id,status) values(export_a,c_a,'pending'),(export_b,c_b,'pending');
    insert into private.invoice_module_rollouts(company_id,livemode) values(c_paid,false);

    v_base:=jsonb_build_object('company_id',c_a,'customer_id',customer_a,'job_ids',jsonb_build_array(job_a,job_a2),
      'issue_date',current_date,'taxable_supply_date',current_date,'due_date',current_date+14,
      'vat_rate',21,'note','Authoritative draft test','request_id',request_main);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    execute v_call into v_result using v_base;
    invoice_main:=(v_result->>'invoice_id')::uuid;
    assert invoice_main is not null and v_result->>'status'='draft' and (v_result->>'created')::boolean,
      'atomic_draft_returns_created_invoice';
    passed:=passed||jsonb_build_array('atomic_draft_returns_created_invoice');
    assert (select status='draft' and company_id=c_a and customer_id=customer_a and created_by=p_admin
      and subtotal_without_vat=30.10 and vat_total=6.32 and total_with_vat=36.42
      and invoice_number is null and issued_at is null from public.invoices where id=invoice_main),
      'server_computes_cent_totals_and_authoritative_actor';
    passed:=passed||jsonb_build_array('server_computes_cent_totals_and_authoritative_actor');
    assert (select count(*)=2 and sum(total_without_vat)=30.10 and sum(vat_amount)=6.32 and sum(total_with_vat)=36.42
      and bool_and(company_id=c_a and quantity=1 and vat_rate=21) from public.invoice_items where invoice_id=invoice_main)
      and (select count(*)=2 and bool_and(company_id=c_a and customer_id=customer_a and is_active)
        from public.invoice_jobs where invoice_id=invoice_main), 'header_items_and_links_are_complete';
    passed:=passed||jsonb_build_array('header_items_and_links_are_complete');
    assert (select supplier_snapshot->>'billingName'='Synthetic legal supplier'
      and supplier_snapshot->>'vatNumber'='CZ12345678' and (supplier_snapshot->>'isVatPayer')::boolean
      and supplier_snapshot->>'billingStreet'='Supplier street 1' and supplier_snapshot->>'bankAccountNumber'='123456789'
      and customer_snapshot->>'billingName'='Synthetic legal customer'
      and customer_snapshot->>'billingStreet'='Customer street 3' and customer_snapshot->>'email'=marker||'@example.invalid'
      from public.invoices where id=invoice_main), 'supplier_and_customer_snapshots_come_from_database';
    passed:=passed||jsonb_build_array('supplier_and_customer_snapshots_come_from_database');
    assert (select item_name='Authoritative job A' and unit_price_without_vat=10.05 and vat_amount=2.11
      and source_job_id=job_a from public.invoice_items where invoice_id=invoice_main and source_job_id=job_a)
      and (select item_name='Authoritative job B' and unit_price_without_vat=20.05 and vat_amount=4.21
      from public.invoice_items where invoice_id=invoice_main and source_job_id=job_a2), 'item_snapshot_and_per_line_rounding';
    passed:=passed||jsonb_build_array('item_snapshot_and_per_line_rounding');
    select id into item_main from public.invoice_items where invoice_id=invoice_main and source_job_id=job_a;
    execute v_call into v_retry using v_base||jsonb_build_object('job_ids',jsonb_build_array(job_a2,job_a));
    assert (v_retry->>'invoice_id')::uuid=invoice_main and not (v_retry->>'created')::boolean,
      'same_request_reordered_jobs_reuses_invoice';
    passed:=passed||jsonb_build_array('same_request_reordered_jobs_reuses_invoice');
    update public.invoice_items set description='Authorized draft clarification' where id=item_main;
    get diagnostics v_rows=row_count;
    assert v_rows=1, 'company_admin_can_edit_draft_item';
    passed:=passed||jsonb_build_array('company_admin_can_edit_draft_item');
    v_error:=null; v_message:=null;
    begin execute v_call into v_retry using v_base||jsonb_build_object('note','Changed request');
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_message='INVOICE_REQUEST_CONFLICT', 'same_request_changed_input_denied';
    passed:=passed||jsonb_build_array('same_request_changed_input_denied');
    execute 'reset role';
    assert (select count(*)=1 from private.invoice_draft_requests where company_id=c_a and request_id=request_main)
      and (select count(*)=1 from public.invoices where company_id=c_a)
      and (select count(*)=2 from public.invoice_items where invoice_id=invoice_main), 'replay_creates_no_duplicate_records';
    passed:=passed||jsonb_build_array('replay_creates_no_duplicate_records');
    update public.companies set billing_name='Changed current supplier name' where id=c_a;
    update public.jobs set title='Changed current job title',price=999 where id=job_a;
    execute 'set local role authenticated';
    execute v_call into v_retry using v_base;
    assert (v_retry->>'invoice_id')::uuid=invoice_main
      and (select supplier_snapshot->>'billingName'='Synthetic legal supplier' and subtotal_without_vat=30.10
        from public.invoices where id=invoice_main)
      and (select item_name='Authoritative job A' and unit_price_without_vat=10.05
        from public.invoice_items where id=item_main), 'replay_preserves_original_snapshot_after_source_changes';
    passed:=passed||jsonb_build_array('replay_preserves_original_snapshot_after_source_changes');
    execute 'reset role';

    -- Every failing call must leave header, items, links and private request ledger unchanged.
    select jsonb_build_object('invoices',(select count(*) from public.invoices where company_id=c_a),
      'items',(select count(*) from public.invoice_items where company_id=c_a),
      'links',(select count(*) from public.invoice_jobs where company_id=c_a),
      'requests',(select count(*) from private.invoice_draft_requests where company_id=c_a)) into v_before;
    v_invalid_base:=v_base||jsonb_build_object('job_ids',jsonb_build_array(job_spare));
    for v_case in select * from (values
      ('empty_jobs',jsonb_build_object('job_ids','[]'::jsonb),'INVOICE_CREATE_INVALID'),
      ('null_jobs',jsonb_build_object('job_ids',null),'INVOICE_CREATE_INVALID'),
      ('duplicate_jobs',jsonb_build_object('job_ids',jsonb_build_array(job_spare,job_spare)),'INVOICE_CREATE_INVALID'),
      ('null_job',jsonb_build_object('job_ids',jsonb_build_array(job_spare,null)),'INVOICE_CREATE_INVALID'),
      ('too_many_jobs',jsonb_build_object('job_ids',(select jsonb_agg(gen_random_uuid()) from generate_series(1,201))),'INVOICE_CREATE_INVALID'),
      ('incomplete_job',jsonb_build_object('job_ids',jsonb_build_array(job_not_done)),'INVOICE_JOBS_INVALID'),
      ('zero_price',jsonb_build_object('job_ids',jsonb_build_array(job_zero)),'INVOICE_JOBS_INVALID'),
      ('negative_price',jsonb_build_object('job_ids',jsonb_build_array(job_negative)),'INVOICE_JOBS_INVALID'),
      ('foreign_currency_job',jsonb_build_object('job_ids',jsonb_build_array(job_eur)),'INVOICE_JOBS_INVALID'),
      ('foreign_company_job',jsonb_build_object('job_ids',jsonb_build_array(job_b)),'INVOICE_JOBS_INVALID'),
      ('different_customer_job',jsonb_build_object('job_ids',jsonb_build_array(job_customer)),'INVOICE_JOBS_INVALID'),
      ('mixed_valid_invalid_jobs',jsonb_build_object('job_ids',jsonb_build_array(job_spare,job_not_done)),'INVOICE_JOBS_INVALID'),
      ('unknown_job',jsonb_build_object('job_ids',jsonb_build_array(gen_random_uuid())),'INVOICE_JOBS_INVALID'),
      ('foreign_customer',jsonb_build_object('customer_id',customer_b),'INVOICE_JOBS_INVALID'),
      ('missing_issue_date',jsonb_build_object('issue_date',null),'INVOICE_CREATE_INVALID'),
      ('missing_request_id',jsonb_build_object('request_id',null),'INVOICE_CREATE_INVALID'),
      ('due_before_issue',jsonb_build_object('due_date',current_date-1),'INVOICE_CREATE_INVALID'),
      ('infinite_issue_date',jsonb_build_object('issue_date','infinity'),'INVOICE_CREATE_INVALID'),
      ('out_of_range_year',jsonb_build_object('issue_date','10000-01-01','due_date','10000-01-02'),'INVOICE_CREATE_INVALID'),
      ('negative_vat',jsonb_build_object('vat_rate',-1),'INVOICE_CREATE_INVALID'),
      ('excess_vat',jsonb_build_object('vat_rate',101),'INVOICE_CREATE_INVALID'),
      ('vat_precision',jsonb_build_object('vat_rate',21.123),'INVOICE_CREATE_INVALID'),
      ('nonfinite_vat',jsonb_build_object('vat_rate','NaN'),'INVOICE_CREATE_INVALID'),
      ('active_job_link',jsonb_build_object('job_ids',jsonb_build_array(job_a)),'INVOICE_LINK_CONFLICT'),
      ('overflow_total',jsonb_build_object('job_ids',jsonb_build_array(job_overflow)),'numeric_overflow')
    ) cases(label,patch,expected) loop
      request_case:=gen_random_uuid();
      v_body:=v_invalid_base||jsonb_build_object('request_id',request_case)||v_case.patch;
      execute 'set local role authenticated';
      v_error:=null; v_message:=null;
      begin execute v_call into v_result using v_body;
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error is not null and (case when v_case.expected='numeric_overflow' then v_error='22003'
        else v_message=v_case.expected end), v_case.label||'_rejected_with_expected_reason';
      execute 'reset role';
      assert v_before=jsonb_build_object('invoices',(select count(*) from public.invoices where company_id=c_a),
        'items',(select count(*) from public.invoice_items where company_id=c_a),
        'links',(select count(*) from public.invoice_jobs where company_id=c_a),
        'requests',(select count(*) from private.invoice_draft_requests where company_id=c_a)),
        v_case.label||'_leaves_no_partial_draft';
      passed:=passed||jsonb_build_array(v_case.label||'_rejected_without_partial_state');
    end loop;

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_worker::text,true);
    execute 'set local role authenticated';
    assert (select count(*) from public.invoice_items where invoice_id=invoice_main)=2, 'company_worker_can_read_items';
    passed:=passed||jsonb_build_array('company_worker_can_read_items');
    v_error:=null;
    begin execute v_call into v_result using v_base;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'worker_cannot_create_or_replay_draft';
    passed:=passed||jsonb_build_array('worker_cannot_create_or_replay_draft');
    update public.invoice_items set item_name='Unauthorized worker edit' where id=item_main;
    get diagnostics v_rows=row_count;
    assert v_rows=0, 'worker_item_update_denied';
    passed:=passed||jsonb_build_array('worker_item_update_denied');

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    assert not exists(select 1 from public.invoice_items where invoice_id=invoice_main), 'foreign_company_cannot_read_items';
    passed:=passed||jsonb_build_array('foreign_company_cannot_read_items');
    v_error:=null;
    begin execute v_call into v_result using v_base;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'foreign_admin_cannot_replay_request';
    passed:=passed||jsonb_build_array('foreign_admin_cannot_replay_request');
    -- Same UUID request in a different authorized company has an independent namespace.
    execute v_call into v_result using v_base||jsonb_build_object('company_id',c_b,'customer_id',customer_b,
      'job_ids',jsonb_build_array(job_b));
    invoice_b:=(v_result->>'invoice_id')::uuid;
    assert invoice_b<>invoice_main and (v_result->>'created')::boolean
      and (select vat_total=0 and subtotal_without_vat=12.34 and total_with_vat=12.34
        and not (supplier_snapshot->>'isVatPayer')::boolean from public.invoices where id=invoice_b),
      'request_scope_independent_and_non_vat_supplier_forces_zero_tax';
    passed:=passed||jsonb_build_array('request_scope_independent_and_non_vat_supplier_forces_zero_tax');
    select id into item_b from public.invoice_items where invoice_id=invoice_b;

    execute 'reset role';
    update public.company_members set is_active=false where id=m_admin;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    v_error:=null;
    begin execute v_call into v_result using v_base;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'removed_admin_cannot_replay_saved_request';
    passed:=passed||jsonb_build_array('removed_admin_cannot_replay_saved_request');
    execute 'reset role';
    update public.company_members set is_active=true where id=m_admin;
    execute 'set local role authenticated';

    -- Header/source binding is immutable even when the caller administrates a different company.
    for v_case in select * from (values
      ('move_item_parent',jsonb_build_object('invoice_id',invoice_b)),
      ('move_item_company',jsonb_build_object('company_id',c_b)),
      ('foreign_source_job',jsonb_build_object('source_job_id',job_b)),
      ('other_customer_source_job',jsonb_build_object('source_job_id',job_customer))
    ) cases(label,patch) loop
      v_error:=null;
      begin
        if v_case.patch ? 'invoice_id' then update public.invoice_items set invoice_id=invoice_b where id=item_main;
        elsif v_case.patch ? 'company_id' then update public.invoice_items set company_id=c_b where id=item_main;
        else update public.invoice_items set source_job_id=(v_case.patch->>'source_job_id')::uuid where id=item_main; end if;
      exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
      assert v_error is not null, v_case.label||'_denied';
      passed:=passed||jsonb_build_array(v_case.label||'_denied');
    end loop;
    v_error:=null;
    begin insert into public.invoice_items(invoice_id,company_id,item_name,source_job_id)
      values(invoice_main,c_a,'Foreign source injection',job_b);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'insert_foreign_source_item_denied';
    passed:=passed||jsonb_build_array('insert_foreign_source_item_denied');
    v_error:=null;
    begin insert into public.invoice_items(invoice_id,company_id,item_name)
      values(invoice_b,c_a,'Foreign parent injection');
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'forged_item_company_cannot_access_foreign_parent';
    passed:=passed||jsonb_build_array('forged_item_company_cannot_access_foreign_parent');

    insert into public.pohoda_export_invoices(export_id,invoice_id,company_id) values(export_a,invoice_main,c_a);
    passed:=passed||jsonb_build_array('matching_export_and_invoice_company_allowed');
    v_error:=null;
    begin insert into public.pohoda_export_invoices(export_id,invoice_id,company_id) values(export_b,invoice_main,c_a);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'foreign_export_parent_denied';
    passed:=passed||jsonb_build_array('foreign_export_parent_denied');
    v_error:=null;
    begin insert into public.pohoda_export_invoices(export_id,invoice_id,company_id) values(export_a,invoice_b,c_a);
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'foreign_invoice_export_link_denied';
    passed:=passed||jsonb_build_array('foreign_invoice_export_link_denied');
    v_error:=null;
    begin update public.pohoda_export_invoices set export_id=export_b where export_id=export_a and invoice_id=invoice_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'export_link_parent_rebinding_denied';
    passed:=passed||jsonb_build_array('export_link_parent_rebinding_denied');

    -- A published paid module is still required for opted-in companies; legacy mode does not leak in.
    v_body:=v_base||jsonb_build_object('company_id',c_paid,'customer_id',customer_paid,'job_ids',jsonb_build_array(job_paid),
      'request_id',gen_random_uuid());
    v_error:=null; v_message:=null;
    begin execute v_call into v_result using v_body;
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_MODULE_REQUIRED', 'unpaid_pilot_draft_denied';
    passed:=passed||jsonb_build_array('unpaid_pilot_draft_denied');
    execute 'reset role';
    assert not exists(select 1 from public.invoices where company_id=c_paid)
      and not exists(select 1 from private.invoice_draft_requests where company_id=c_paid), 'unpaid_pilot_has_no_partial_state';
    passed:=passed||jsonb_build_array('unpaid_pilot_has_no_partial_state');
    insert into public.module_offers(id,offer_key,product,stripe_price_id,livemode,currency,unit_amount,
      capabilities,policy_version,history_days,is_published) values
      (offer_core,marker||'-core','diriqo_core','price_'||marker||'Core',false,'czk',1000,
        array['core.jobs.create'],'diriqo-capabilities-v0.1',90,true),
      (offer_invoice,marker||'-invoice','invoicing','price_'||marker||'Invoice',false,'czk',1000,
        array['invoicing.invoice.issue'],'diriqo-capabilities-v0.1',90,true);
    for v_fixture in select * from (values(offer_core,'Core'),(offer_invoice,'Invoice')) fixtures(offer_id,label) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_paid,v_fixture.offer_id,'cus_'||marker) returning id into order_fixture;
      execute 'set local role service_role';
      grant_fixture:=public.apply_paid_module_invoice(order_fixture,'evt_'||marker||v_fixture.label,false,
        'in_'||marker||v_fixture.label,'il_'||marker||v_fixture.label,'cus_'||marker,'sub_'||marker||v_fixture.label,
        'price_'||marker||v_fixture.label,'czk',1,1000,1000,1000,
        extract(epoch from v_now-interval '1 hour')::bigint,extract(epoch from v_now+interval '1 day')::bigint);
      assert grant_fixture is not null, 'paid_fixture_receipt_failed';
      execute 'reset role';
    end loop;
    execute 'set local role authenticated';
    execute v_call into v_result using v_body;
    invoice_paid:=(v_result->>'invoice_id')::uuid;
    assert (v_result->>'created')::boolean and exists(select 1 from public.invoice_items where invoice_id=invoice_paid),
      'verified_payment_enables_atomic_pilot_draft';
    passed:=passed||jsonb_build_array('verified_payment_enables_atomic_pilot_draft');

    -- Historical source detachment cannot mutate the preserved financial/snapshot content.
    perform public.issue_invoice_atomic(c_a,invoice_main);
    execute v_call into v_retry using v_base;
    assert (v_retry->>'invoice_id')::uuid=invoice_main and v_retry->>'status'='issued' and not (v_retry->>'created')::boolean,
      'replay_after_issue_returns_existing_invoice_state';
    passed:=passed||jsonb_build_array('replay_after_issue_returns_existing_invoice_state');
    select to_jsonb(i) into v_item_before from public.invoice_items i where id=item_main;
    v_error:=null;
    begin update public.invoice_items set source_job_id=null,total_with_vat=0 where id=item_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'historical_detach_cannot_change_amounts';
    passed:=passed||jsonb_build_array('historical_detach_cannot_change_amounts');
    update public.invoice_items set source_job_id=null where id=item_main;
    assert (select source_job_id is null and (to_jsonb(i)-'source_job_id'-'updated_at')=(v_item_before-'source_job_id'-'updated_at')
      from public.invoice_items i where id=item_main), 'exact_historical_source_detach_preserves_snapshot';
    passed:=passed||jsonb_build_array('exact_historical_source_detach_preserves_snapshot');
    v_error:=null;
    begin update public.invoice_items set item_name='Rewrite history' where id=item_main;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error is not null, 'issued_item_content_immutable';
    passed:=passed||jsonb_build_array('issued_item_content_immutable');

    execute v_call into v_result using v_invalid_base||jsonb_build_object('request_id',request_spare);
    invoice_spare:=(v_result->>'invoice_id')::uuid;
    perform public.delete_invoice_draft_atomic(c_a,invoice_spare);
    v_error:=null; v_message:=null;
    begin execute v_call into v_retry using v_invalid_base||jsonb_build_object('request_id',request_spare);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_message='INVOICE_DRAFT_REQUEST_GONE', 'deleted_draft_request_cannot_create_replacement';
    passed:=passed||jsonb_build_array('deleted_draft_request_cannot_create_replacement');
    execute 'reset role';
    assert exists(select 1 from private.invoice_draft_requests where company_id=c_a and request_id=request_spare)
      and not exists(select 1 from public.invoices where id=invoice_spare), 'deleted_request_tombstone_retained';
    passed:=passed||jsonb_build_array('deleted_request_tombstone_retained');

    -- Historic source unlink remains possible after the company moves to an expired pilot licence.
    insert into private.invoice_module_rollouts(company_id,livemode) values(c_a,false);
    for v_fixture in select * from (values(offer_core,'Core'),(offer_invoice,'Invoice')) fixtures(offer_id,label) loop
      insert into public.module_purchase_orders(company_id,offer_id,stripe_customer_id)
        values(c_a,v_fixture.offer_id,'cus_'||marker||'Expired') returning id into order_fixture;
      insert into public.company_module_entitlements(company_id,product,policy_version,source_ref,
        valid_from,valid_until,history_until,capabilities,invoice_id,invoice_line_id,livemode,order_id)
      select c_a,o.product,o.policy_version,marker||'Expired'||v_fixture.label,
        v_now-interval '3 days',v_now-interval '1 day',v_now+interval '89 days',o.capabilities,
        'in_'||marker||'Expired'||v_fixture.label,'il_'||marker||'Expired'||v_fixture.label,false,order_fixture
      from public.module_offers o where o.id=v_fixture.offer_id;
    end loop;
    execute 'set local role authenticated';
    select id,to_jsonb(i) into item_main,v_item_before from public.invoice_items i
      where invoice_id=invoice_main and source_job_id=job_a2;
    update public.invoice_items set source_job_id=null where id=item_main;
    assert (select source_job_id is null and (to_jsonb(i)-'source_job_id'-'updated_at')=(v_item_before-'source_job_id'-'updated_at')
      from public.invoice_items i where id=item_main), 'expired_pilot_historical_detach_preserves_snapshot';
    passed:=passed||jsonb_build_array('expired_pilot_historical_detach_preserves_snapshot');
    execute 'reset role';

    perform set_config('request.jwt.claims','{}',true);
    perform set_config('request.jwt.claim.sub','',true);
    execute 'set local role anon';
    v_error:=null;
    begin execute v_call into v_result using v_base;
    exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
    assert v_error='42501', 'anonymous_draft_rpc_denied';
    passed:=passed||jsonb_build_array('anonymous_draft_rpc_denied');
    execute 'reset role';
    raise exception 'rollback synthetic atomic draft fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.companies where id=any(array[c_a,c_b,c_paid])), 'company_fixture_cleanup';
  assert not exists(select 1 from public.invoices where company_id=any(array[c_a,c_b,c_paid])), 'invoice_fixture_cleanup';
  assert not exists(select 1 from private.invoice_draft_requests where company_id=any(array[c_a,c_b,c_paid])), 'request_fixture_cleanup';
  assert not exists(select 1 from public.module_offers where offer_key like marker||'%'), 'offer_fixture_cleanup';
  assert not exists(select 1 from private.invoice_module_rollouts where company_id in(c_a,c_paid)), 'rollout_fixture_cleanup';
  perform set_config('diriqo.invoice_draft_test_result',jsonb_build_object('passed',passed,'count',jsonb_array_length(passed),
    'fixtures','rolled_back','cleanup_assertions',6,'concurrency','not_tested_single_session')::text,true);
end;
$test$;
select current_setting('diriqo.invoice_draft_test_result')::jsonb as result;
