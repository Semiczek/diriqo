-- Authorized Diriqo TEST project only, after atomic_invoice_draft_updates.
-- Synthetic setup uses owner; calls use the actual authenticated role and JWT identity.
-- No DDL, GRANT, disabled trigger, provider operation or existing customer mutation.
-- The entire fixture subtransaction rolls back, including the successful issue control.
-- Sequential transactional proof; real edit/edit overlap belongs to the HTTP harness.
do $test$
declare
  u_admin uuid:=gen_random_uuid(); u_worker uuid:=gen_random_uuid(); u_other uuid:=gen_random_uuid();
  p_admin uuid:=gen_random_uuid(); p_worker uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid();
  c_a uuid:=gen_random_uuid(); c_b uuid:=gen_random_uuid(); c_expired uuid:=gen_random_uuid();
  cu_a uuid:=gen_random_uuid(); cu_b uuid:=gen_random_uuid(); cu_expired uuid:=gen_random_uuid(); cu_alternate uuid:=gen_random_uuid();
  j_a uuid:=gen_random_uuid(); j_b uuid:=gen_random_uuid(); j_last uuid:=gen_random_uuid();
  i_main uuid:=gen_random_uuid(); i_other uuid:=gen_random_uuid(); i_foreign uuid:=gen_random_uuid();
  i_expired uuid:=gen_random_uuid(); i_issue uuid:=gen_random_uuid();
  item_a uuid:=gen_random_uuid(); item_b uuid:=gen_random_uuid(); item_other uuid:=gen_random_uuid();
  item_foreign uuid:=gen_random_uuid(); item_expired uuid:=gen_random_uuid(); item_issue uuid:=gen_random_uuid();
  grant_invoice uuid:=gen_random_uuid();
  marker text:='InvoiceDraftUpdate'||replace(gen_random_uuid()::text,'-','');
  v_non_vat_note constant text:='Dodavatel není plátcem DPH.';
  v_year integer:=extract(year from current_date)::integer;
  v_now timestamptz:=date_trunc('second',clock_timestamp());
  v_header jsonb; v_items jsonb; v_bad_header jsonb; v_bad_items jsonb; v_ids uuid[];
  v_snapshot jsonb; v_before jsonb; v_after jsonb; v_result jsonb;
  v_metadata jsonb; v_revision text; v_old_revision text;
  v_error text; v_message text; v_case record; v_label text; v_action text;
  v_target uuid; v_company uuid; v_identity uuid; v_expected_ids uuid[];
  passed jsonb:='[]'; v_invoices uuid[]; v_companies uuid[];
  v_state_sql constant text:=$state$
    select jsonb_build_object('invoice',to_jsonb(i),
      'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order,x.created_at,x.id)
        from public.invoice_items x where x.invoice_id=i.id),'[]'::jsonb),
      'links',coalesce((select jsonb_agg(to_jsonb(x) order by x.job_id)
        from public.invoice_jobs x where x.invoice_id=i.id),'[]'::jsonb))
    from public.invoices i where i.id=$1
  $state$;
begin
  v_companies:=array[c_a,c_b,c_expired];
  v_invoices:=array[i_main,i_other,i_foreign,i_expired,i_issue];
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),(u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-foreign@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic draft admin'),(p_worker,u_worker,u_worker,'Synthetic draft worker'),
      (p_other,u_other,u_other,'Synthetic draft foreign admin');
    insert into public.companies(id,name,vat_number,logo_url) values
      (c_a,'Synthetic current supplier','CZ12345678','https://example.invalid/current-logo.png'),
      (c_b,'Synthetic foreign supplier',null,null),(c_expired,'Synthetic expired supplier',null,null);
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (c_a,p_admin,'company_admin',true),(c_a,p_worker,'worker',true),
      (c_b,p_other,'company_admin',true),(c_expired,p_admin,'company_admin',true);
    insert into public.customers(id,company_id,name) values
      (cu_a,c_a,'Synthetic draft customer'),(cu_b,c_b,'Synthetic foreign customer'),
      (cu_expired,c_expired,'Synthetic expired customer'),(cu_alternate,c_a,'Synthetic alternate source customer');
    insert into public.jobs(id,company_id,customer_id,title,status,work_state,price) values
      (j_a,c_a,cu_a,'Synthetic preserved source','done','done',100),
      (j_b,c_b,cu_b,'Synthetic foreign source','done','done',100),
      (j_last,c_a,cu_a,'Synthetic last-line failure source','done','done',50);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
      supplier_snapshot,customer_snapshot,subtotal_without_vat,vat_total,total_with_vat,is_vat_payer,note,created_by,
      issue_date,taxable_supply_date,due_date) values
      (i_main,c_a,cu_a,v_year,'draft',marker||'-main',
        jsonb_build_object('id',c_a,'name','Original supplier','vatNumber','CZ12345678',
          'logoUrl','https://example.invalid/historic-logo.png','preservedCustom','supplier metadata'),
        jsonb_build_object('id',cu_a,'name','Original customer','preservedCustom','customer metadata'),
        100,21,121,true,'Original manual note',p_admin,current_date,current_date,current_date+14),
      (i_other,c_a,cu_a,v_year,'draft',marker||'-reserved','{}','{}',1,0,1,false,null,p_admin,current_date,current_date,current_date+14),
      (i_expired,c_expired,cu_expired,v_year,'draft',null,'{}','{}',1,0,1,false,null,p_admin,current_date,current_date,current_date+14),
      (i_issue,c_a,cu_a,v_year,'draft',marker||'-issue','{}','{}',1,0,1,false,'Issue control',p_admin,current_date,current_date,current_date+14);
    insert into public.invoice_items(id,invoice_id,company_id,sort_order,source_job_id,item_name,
      quantity,unit,unit_price_without_vat,vat_rate,vat_amount,total_without_vat,total_with_vat,source_snapshot) values
      (item_a,i_main,c_a,1,j_a,'Original line A',1,'ks',50,21,10.5,50,60.5,'{"preserved":"source A"}'),
      (item_b,i_main,c_a,2,j_last,'Original line B',1,'ks',50,21,10.5,50,60.5,'{"preserved":"source B"}'),
      (item_other,i_other,c_a,1,null,'Other invoice line',1,'ks',1,0,0,1,1,'{}'),
      (item_expired,i_expired,c_expired,1,null,'Expired invoice line',1,'ks',1,0,0,1,1,'{}'),
      (item_issue,i_issue,c_a,1,null,'Issue control line',1,'ks',1,0,0,1,1,'{}');
    insert into public.invoice_jobs(invoice_id,job_id,company_id,customer_id) values(i_main,j_a,c_a,cu_a);
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    execute 'set local role authenticated';
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,supplier_snapshot,customer_snapshot,
      issue_date,taxable_supply_date,due_date)
      values(i_foreign,c_b,cu_b,v_year,'draft','{}','{}',current_date,current_date,current_date+14);
    insert into public.invoice_items(id,invoice_id,company_id,source_job_id,item_name)
      values(item_foreign,i_foreign,c_b,j_b,'Foreign invoice line');
    execute 'reset role';
    -- Separate nonfinancial test authority, not a payment or provider operation.
    insert into private.company_test_module_grants(id,company_id,product,source_ref,reason,
      valid_from,valid_until,history_until,capabilities) values
      (gen_random_uuid(),c_a,'diriqo_core',marker||'-core','Atomic draft regression',
        v_now-interval '1 day',v_now+interval '1 day',v_now+interval '1 day',array['core.jobs.create']),
      (grant_invoice,c_a,'invoicing',marker||'-invoice','Atomic draft regression',
        v_now-interval '1 day',v_now+interval '1 day',v_now+interval '1 day',array['invoicing.invoice.issue']),
      (gen_random_uuid(),c_expired,'diriqo_core',marker||'-expired-core','Atomic draft expired regression',
        v_now-interval '2 days',v_now-interval '1 day',v_now-interval '1 day',array['core.jobs.create']),
      (gen_random_uuid(),c_expired,'invoicing',marker||'-expired-invoice','Atomic draft expired regression',
        v_now-interval '2 days',v_now-interval '1 day',v_now-interval '1 day',array['invoicing.invoice.issue']);
    insert into private.invoice_module_rollouts(company_id,livemode) values(c_a,false),(c_expired,false);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';

    v_header:=jsonb_build_object('invoiceNumber',marker||'-edited','variableSymbol','123456',
      'issueDate',current_date::text,'taxableSupplyDate',current_date::text,'dueDate',(current_date+14)::text,
      'note','Manual note stays','supplier',jsonb_build_object('name','Edited supplier','vatNumber','CZ12345678'),
      'customer',jsonb_build_object('name','Edited customer','email','customer@example.invalid'));
    v_items:=jsonb_build_array(
      jsonb_build_object('id',item_a,'itemName','Edited A','description',null,'quantity','0.50','unit','ks','unitPriceWithoutVat','0.01','vatRate','21'),
      jsonb_build_object('id',item_b,'itemName','Edited B','description','Preserved input','quantity','1','unit','ks','unitPriceWithoutVat','0.50','vatRate','21'));
    v_ids:=array[item_a,item_b];
    v_snapshot:=public.get_invoice_edit_snapshot(c_a,i_main);
    assert v_snapshot->>'revision' ~ '^[0-9a-f]{64}$' and jsonb_array_length(v_snapshot->'items')=2,
      'snapshot_returns_complete_items_and_sha256_revision';
    execute v_state_sql into v_before using i_main;
    assert v_snapshot->'invoice'=v_before->'invoice' and v_snapshot->'items'=v_before->'items',
      'snapshot_matches_independent_whole_header_and_ordered_items';
    v_old_revision:=v_snapshot->>'revision';
    v_metadata:=jsonb_build_object('invoice_id',v_before->'invoice'->'id',
      'created_at',v_before->'invoice'->'created_at','created_by',v_before->'invoice'->'created_by',
      'links',v_before->'links');
    v_result:=public.update_invoice_draft_atomic(c_a,i_main,v_old_revision,v_ids,v_header,v_items);
    v_snapshot:=public.get_invoice_edit_snapshot(c_a,i_main);
    assert (v_result->>'updated')::boolean and v_result->>'revision'=v_snapshot->>'revision'
      and v_result->>'revision'<>v_old_revision, 'successful_atomic_update_returns_new_revision';
    assert (select subtotal_without_vat=0.51 and vat_total=0.11 and total_with_vat=0.62
      and invoice_number=marker||'-edited' and variable_symbol='123456' and note='Manual note stays'
      from public.invoices where id=i_main), 'decimal_half_ties_and_header_totals_computed_in_database';
    assert (select quantity=0.50 and total_without_vat=0.01 and vat_amount=0 and total_with_vat=0.01
      from public.invoice_items where id=item_a)
      and (select vat_amount=0.11 and total_with_vat=0.61 from public.invoice_items where id=item_b),
      'authoritative_item_rounding_uses_decimal_half_away_from_zero';
    assert (select supplier_snapshot->>'logoUrl'='https://example.invalid/historic-logo.png'
      and supplier_snapshot->>'preservedCustom'='supplier metadata' and supplier_snapshot->>'id'=c_a::text
      and customer_snapshot->>'preservedCustom'='customer metadata' and customer_snapshot->>'id'=cu_a::text
      from public.invoices where id=i_main), 'update_preserves_snapshot_identity_logo_and_unknown_metadata';
    assert (select source_job_id=j_a and source_snapshot='{"preserved":"source A"}'::jsonb from public.invoice_items where id=item_a)
      and (select source_job_id=j_last and source_snapshot='{"preserved":"source B"}'::jsonb from public.invoice_items where id=item_b),
      'update_preserves_item_source_metadata';
    execute v_state_sql into v_after using i_main;
    assert jsonb_build_object('invoice_id',v_after->'invoice'->'id','created_at',v_after->'invoice'->'created_at',
      'created_by',v_after->'invoice'->'created_by','links',v_after->'links')=v_metadata,
      'update_preserves_parent_identity_creation_and_job_links';
    passed:=passed||jsonb_build_array('snapshot_returns_complete_items_and_sha256_revision',
      'snapshot_matches_independent_whole_header_and_ordered_items','successful_atomic_update_returns_new_revision',
      'decimal_half_ties_and_header_totals_computed_in_database','authoritative_item_rounding_uses_decimal_half_away_from_zero',
      'update_preserves_snapshot_identity_logo_and_unknown_metadata','update_preserves_item_source_metadata',
      'update_preserves_parent_identity_creation_and_job_links');

    -- A member can still read; the snapshot cannot expose a different tenant.
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_worker,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_worker::text,true);
    assert public.get_invoice_edit_snapshot(c_a,i_main)->'invoice'->>'id'=i_main::text,
      'worker_member_snapshot_read_remains_allowed';
    v_error:=null; v_message:=null;
    begin perform public.get_invoice_edit_snapshot(c_b,i_foreign);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_DRAFT_FORBIDDEN', 'foreign_company_snapshot_denied';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    v_error:=null; v_message:=null;
    begin perform public.get_invoice_edit_snapshot(c_a,i_foreign);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='P0002' and v_message='INVOICE_NOT_FOUND', 'foreign_invoice_in_authorized_company_not_found';
    passed:=passed||jsonb_build_array('worker_member_snapshot_read_remains_allowed',
      'foreign_company_snapshot_denied','foreign_invoice_in_authorized_company_not_found');

    -- Every malformed call has an independently compared whole header/items/links snapshot.
    -- The first line and header request real changes even when the LAST line is invalid.
    for v_case in select * from (values
      ('forged_header_total','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('forged_header_company','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('forged_supplier_identity','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('forged_supplier_logo','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('forged_supplier_vat_boolean','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('forged_customer_identity','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('forged_line_total','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('forged_line_source','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('foreign_line_id','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('other_invoice_line_id','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('duplicate_line_id','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('missing_line','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('malformed_line_id','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('expected_ids_missing','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('expected_ids_duplicate','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('expected_ids_foreign','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('expected_ids_null','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('empty_items','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('too_many_items','23514','INVOICE_DRAFT_ITEMS_INVALID'),
      ('nonarray_items','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('nonobject_last_line','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('null_header','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('invalid_date_format','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('invalid_calendar_date','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('due_before_issue','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('numeric_json_instead_of_string','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('decimal_exponent','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('decimal_nan','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('decimal_excess_scale','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('zero_quantity','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('negative_price','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('vat_above_100','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('unit_price_overflow','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('line_total_overflow','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('malformed_revision','22023','INVOICE_DRAFT_INPUT_INVALID'),
      ('stale_revision','23514','INVOICE_DRAFT_STALE'),
      ('duplicate_invoice_number','23505',null)
    ) cases(label,error_code,error_message) loop
      v_bad_header:=v_header||jsonb_build_object('note','Must not partially commit');
      v_bad_items:=jsonb_set(v_items,'{0,itemName}','"First line must roll back"');
      v_expected_ids:=v_ids;
      v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
      case v_case.label
        when 'forged_header_total' then v_bad_header:=v_bad_header||'{"totalWithVat":"0.01"}';
        when 'forged_header_company' then v_bad_header:=v_bad_header||jsonb_build_object('companyId',c_b);
        when 'forged_supplier_identity' then v_bad_header:=jsonb_set(v_bad_header,'{supplier,id}',to_jsonb(c_b));
        when 'forged_supplier_logo' then v_bad_header:=jsonb_set(v_bad_header,'{supplier,logoUrl}','"https://example.invalid/forged.png"');
        when 'forged_supplier_vat_boolean' then v_bad_header:=jsonb_set(v_bad_header,'{supplier,isVatPayer}','false');
        when 'forged_customer_identity' then v_bad_header:=jsonb_set(v_bad_header,'{customer,id}',to_jsonb(cu_b));
        when 'forged_line_total' then v_bad_items:=jsonb_set(v_bad_items,'{1,totalWithVat}','"0.01"');
        when 'forged_line_source' then v_bad_items:=jsonb_set(v_bad_items,'{1,sourceJobId}',to_jsonb(j_b));
        when 'foreign_line_id' then v_bad_items:=jsonb_set(v_bad_items,'{1,id}',to_jsonb(item_foreign));
        when 'other_invoice_line_id' then v_bad_items:=jsonb_set(v_bad_items,'{1,id}',to_jsonb(item_other));
        when 'duplicate_line_id' then v_bad_items:=jsonb_set(v_bad_items,'{1,id}',to_jsonb(item_a));
        when 'missing_line' then v_bad_items:=jsonb_build_array(v_bad_items->0);
        when 'malformed_line_id' then v_bad_items:=jsonb_set(v_bad_items,'{1,id}','"not-a-uuid"');
        when 'expected_ids_missing' then v_expected_ids:=array[item_a];
        when 'expected_ids_duplicate' then v_expected_ids:=array[item_a,item_a];
        when 'expected_ids_foreign' then v_expected_ids:=array[item_a,item_foreign];
        when 'expected_ids_null' then v_expected_ids:=null;
        when 'empty_items' then v_bad_items:='[]';
        when 'too_many_items' then select jsonb_agg(v_bad_items->0) into v_bad_items from generate_series(1,201);
        when 'nonarray_items' then v_bad_items:='{}';
        when 'nonobject_last_line' then v_bad_items:=jsonb_set(v_bad_items,'{1}','"not-an-object"');
        when 'null_header' then v_bad_header:=null;
        when 'invalid_date_format' then v_bad_header:=jsonb_set(v_bad_header,'{issueDate}','"12.10.2026"');
        when 'invalid_calendar_date' then v_bad_header:=jsonb_set(v_bad_header,'{issueDate}','"2026-02-30"');
        when 'due_before_issue' then v_bad_header:=jsonb_set(v_bad_header,'{dueDate}',to_jsonb((current_date-1)::text));
        when 'numeric_json_instead_of_string' then v_bad_items:=jsonb_set(v_bad_items,'{1,quantity}','1');
        when 'decimal_exponent' then v_bad_items:=jsonb_set(v_bad_items,'{1,quantity}','"1e2"');
        when 'decimal_nan' then v_bad_items:=jsonb_set(v_bad_items,'{1,unitPriceWithoutVat}','"NaN"');
        when 'decimal_excess_scale' then v_bad_items:=jsonb_set(v_bad_items,'{1,unitPriceWithoutVat}','"0.001"');
        when 'zero_quantity' then v_bad_items:=jsonb_set(v_bad_items,'{1,quantity}','"0"');
        when 'negative_price' then v_bad_items:=jsonb_set(v_bad_items,'{1,unitPriceWithoutVat}','"-1"');
        when 'vat_above_100' then v_bad_items:=jsonb_set(v_bad_items,'{1,vatRate}','"100.01"');
        when 'unit_price_overflow' then v_bad_items:=jsonb_set(v_bad_items,'{1,unitPriceWithoutVat}','"10000000000.00"');
        when 'line_total_overflow' then v_bad_items:=jsonb_set(jsonb_set(v_bad_items,'{1,unitPriceWithoutVat}','"9999999999.99"'),'{1,quantity}','"2"');
        when 'malformed_revision' then v_revision:='not-a-sha256';
        when 'stale_revision' then v_revision:=repeat('0',64);
        when 'duplicate_invoice_number' then v_bad_header:=jsonb_set(v_bad_header,'{invoiceNumber}',to_jsonb(marker||'-reserved'));
      end case;
      execute v_state_sql into v_before using i_main;
      v_error:=null; v_message:=null;
      begin perform public.update_invoice_draft_atomic(c_a,i_main,v_revision,v_expected_ids,v_bad_header,v_bad_items);
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error=v_case.error_code and (v_case.error_message is null or v_message=v_case.error_message),
        v_case.label||'_correct_error: '||coalesce(v_error,'NO ERROR')||' / '||coalesce(v_message,'');
      execute v_state_sql into v_after using i_main;
      assert v_after=v_before, v_case.label||'_whole_header_items_links_unchanged';
      passed:=passed||jsonb_build_array(v_case.label||'_rejects_atomically');
    end loop;

    -- Genuine late-write failure: candidate writes header, then line A, then line B.
    -- Change only B's live source customer; this external state is outside the hash.
    -- The existing item-scope trigger therefore fails at the LAST UPDATE, after
    -- valid writes, and the enclosing RPC call must roll all of them back.
    v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
    execute 'reset role';
    update public.jobs set customer_id=cu_alternate where id=j_last;
    execute 'set local role authenticated';
    assert public.get_invoice_edit_snapshot(c_a,i_main)->>'revision'=v_revision,
      'external_source_change_does_not_fake_a_stale_input_failure';
    execute v_state_sql into v_before using i_main;
    v_bad_header:=v_header||jsonb_build_object('note','Header must roll back after last line');
    v_bad_items:=jsonb_set(v_items,'{0,itemName}','"Line A must roll back after line B"');
    v_error:=null; v_message:=null;
    begin perform public.update_invoice_draft_atomic(c_a,i_main,v_revision,v_ids,v_bad_header,v_bad_items);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_ITEM_SCOPE_INVALID', 'last_line_trigger_failure_reached';
    execute v_state_sql into v_after using i_main;
    assert v_after=v_before, 'last_line_failure_rolls_back_header_and_prior_line_writes';
    execute 'reset role';
    update public.jobs set customer_id=cu_a where id=j_last;
    execute 'set local role authenticated';
    passed:=passed||jsonb_build_array('last_line_trigger_failure_rolls_back_header_and_prior_line_writes');

    -- Direct legacy table paths remain available, but must invalidate the snapshot token.
    foreach v_label in array array['direct_header','direct_item'] loop
      v_old_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
      if v_label='direct_header' then update public.invoices set note='New direct header edit' where id=i_main;
      else update public.invoice_items set description='New direct child edit' where id=item_b; end if;
      v_snapshot:=public.get_invoice_edit_snapshot(c_a,i_main);
      assert v_snapshot->>'revision'<>v_old_revision, v_label||'_invalidates_revision';
      foreach v_action in array array['update','refresh','issue'] loop
        execute v_state_sql into v_before using i_main;
        v_error:=null; v_message:=null;
        begin
          if v_action='update' then perform public.update_invoice_draft_atomic(c_a,i_main,v_old_revision,v_ids,v_header,v_items);
          elsif v_action='refresh' then perform public.refresh_invoice_supplier_atomic(c_a,i_main,v_old_revision,v_ids);
          else perform public.issue_invoice_revision_atomic(c_a,i_main,v_old_revision); end if;
        exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
        assert v_error='23514' and v_message='INVOICE_DRAFT_STALE', v_label||'_'||v_action||'_stale_denied';
        execute v_state_sql into v_after using i_main;
        assert v_after=v_before, v_label||'_'||v_action||'_preserves_newer_state';
        passed:=passed||jsonb_build_array(v_label||'_'||v_action||'_rejects_stale_without_changes');
      end loop;
    end loop;

    -- Refresh updates the supplier and every financial line while preserving manual text.
    v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
    perform public.update_invoice_draft_atomic(c_a,i_main,v_revision,v_ids,v_header,v_items);
    execute 'reset role';
    update public.companies set vat_number=null,logo_url='https://example.invalid/nonpayer-logo.png' where id=c_a;
    execute 'set local role authenticated';
    v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
    v_result:=public.refresh_invoice_supplier_atomic(c_a,i_main,v_revision,v_ids);
    assert (v_result->>'updated')::boolean and v_result->>'revision'<>v_revision, 'supplier_refresh_returns_new_revision';
    assert (select not is_vat_payer and vat_total=0 and subtotal_without_vat=0.51 and total_with_vat=0.51
      and vat_note=v_non_vat_note and supplier_snapshot->>'logoUrl'='https://example.invalid/nonpayer-logo.png'
      and position('Manual note stays' in note)>0 from public.invoices where id=i_main),
      'payer_to_nonpayer_refresh_preserves_manual_note_logo_and_recomputes_header';
    assert not exists(select 1 from public.invoice_items where invoice_id=i_main
      and (vat_rate<>0 or vat_amount<>0 or total_with_vat<>total_without_vat)),
      'payer_to_nonpayer_refresh_recomputes_every_line';
    passed:=passed||jsonb_build_array('supplier_refresh_returns_new_revision',
      'payer_to_nonpayer_refresh_preserves_manual_note_logo_and_recomputes_header',
      'payer_to_nonpayer_refresh_recomputes_every_line');
    execute 'reset role';
    update public.companies set vat_number='CZ12345678',logo_url='https://example.invalid/payer-logo.png' where id=c_a;
    execute 'set local role authenticated';
    v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
    perform public.refresh_invoice_supplier_atomic(c_a,i_main,v_revision,v_ids);
    assert (select is_vat_payer and vat_total=0 and total_with_vat=0.51 and vat_note is null
      and note='Manual note stays' and supplier_snapshot->>'logoUrl'='https://example.invalid/payer-logo.png'
      from public.invoices where id=i_main), 'nonpayer_to_payer_refresh_keeps_manual_note_and_does_not_invent_tax_rate';
    assert not exists(select 1 from public.invoice_items where invoice_id=i_main and vat_rate<>0),
      'nonpayer_to_payer_refresh_preserves_explicit_zero_rates';
    passed:=passed||jsonb_build_array('nonpayer_to_payer_refresh_keeps_manual_note_and_does_not_invent_tax_rate',
      'nonpayer_to_payer_refresh_preserves_explicit_zero_rates');

    -- Current revision issues atomically; the fixture is ultimately rolled back.
    v_revision:=public.get_invoice_edit_snapshot(c_a,i_issue)->>'revision';
    v_result:=public.issue_invoice_revision_atomic(c_a,i_issue,v_revision);
    assert (v_result->>'issued')::boolean and v_result->>'status'='issued', 'current_revision_can_issue';
    execute v_state_sql into v_before using i_issue;
    v_result:=public.issue_invoice_revision_atomic(c_a,i_issue,v_revision);
    execute v_state_sql into v_after using i_issue;
    assert not (v_result->>'issued')::boolean and v_after=v_before,
      'already_issued_retry_with_prior_revision_has_no_new_financial_write';
    passed:=passed||jsonb_build_array('already_issued_retry_with_prior_revision_has_no_new_financial_write');
    v_snapshot:=public.get_invoice_edit_snapshot(c_a,i_issue);
    foreach v_action in array array['update','refresh'] loop
      execute v_state_sql into v_before using i_issue;
      v_error:=null; v_message:=null;
      begin
        if v_action='update' then perform public.update_invoice_draft_atomic(c_a,i_issue,v_snapshot->>'revision',array[item_issue],
          v_header,jsonb_build_array(jsonb_set(v_items->0,'{id}',to_jsonb(item_issue))));
        else perform public.refresh_invoice_supplier_atomic(c_a,i_issue,v_snapshot->>'revision',array[item_issue]); end if;
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='23514' and v_message='INVOICE_INVALID_STATE', 'issued_'||v_action||'_denied';
      execute v_state_sql into v_after using i_issue;
      assert v_after=v_before, 'issued_'||v_action||'_preserves_whole_history';
      passed:=passed||jsonb_build_array('issued_'||v_action||'_denied_without_changes');
    end loop;
    passed:=passed||jsonb_build_array('current_revision_can_issue');

    -- All write RPCs re-check current authority, not merely the form's earlier access.
    v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
    execute 'reset role';
    for v_case in select * from (values
      ('worker',u_worker,false),('foreign_admin',u_other,false),('revoked_member',u_admin,true)
    ) cases(label,identity_id,revoke_member) loop
      if v_case.revoke_member then update public.company_members set is_active=false where company_id=c_a and profile_id=p_admin; end if;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',v_case.identity_id,'role','authenticated')::text,true);
      perform set_config('request.jwt.claim.sub',v_case.identity_id::text,true);
      foreach v_action in array array['update','refresh','issue'] loop
        execute v_state_sql into v_before using i_main;
        execute 'set local role authenticated';
        v_error:=null; v_message:=null;
        begin
          if v_action='update' then perform public.update_invoice_draft_atomic(c_a,i_main,v_revision,v_ids,v_header,v_items);
          elsif v_action='refresh' then perform public.refresh_invoice_supplier_atomic(c_a,i_main,v_revision,v_ids);
          else perform public.issue_invoice_revision_atomic(c_a,i_main,v_revision); end if;
        exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
        execute 'reset role';
        assert v_error='42501' and v_message=case when v_action='issue' then 'INVOICE_ISSUE_FORBIDDEN'
          else 'INVOICE_DRAFT_FORBIDDEN' end, v_case.label||'_'||v_action||'_fresh_authority';
        execute v_state_sql into v_after using i_main;
        assert v_after=v_before, v_case.label||'_'||v_action||'_preserves_whole_state';
        passed:=passed||jsonb_build_array(v_case.label||'_'||v_action||'_fresh_authority');
      end loop;
      if v_case.revoke_member then update public.company_members set is_active=true where company_id=c_a and profile_id=p_admin; end if;
    end loop;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    v_revision:=public.get_invoice_edit_snapshot(c_expired,i_expired)->>'revision';
    foreach v_action in array array['update','refresh','issue'] loop
      execute v_state_sql into v_before using i_expired;
      v_error:=null; v_message:=null;
      begin
        if v_action='update' then perform public.update_invoice_draft_atomic(c_expired,i_expired,v_revision,array[item_expired],
          v_header,jsonb_build_array(jsonb_set(v_items->0,'{id}',to_jsonb(item_expired))));
        elsif v_action='refresh' then perform public.refresh_invoice_supplier_atomic(c_expired,i_expired,v_revision,array[item_expired]);
        else perform public.issue_invoice_revision_atomic(c_expired,i_expired,v_revision); end if;
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='42501' and v_message='INVOICE_MODULE_REQUIRED', 'expired_module_'||v_action||'_denied';
      execute v_state_sql into v_after using i_expired;
      assert v_after=v_before, 'expired_module_'||v_action||'_preserves_whole_state';
      passed:=passed||jsonb_build_array('expired_module_'||v_action||'_denied');
    end loop;
    v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
    execute 'reset role';
    update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Synthetic regression revocation'
      where id=grant_invoice;
    execute 'set local role authenticated';
    execute v_state_sql into v_before using i_main;
    v_error:=null; v_message:=null;
    begin perform public.update_invoice_draft_atomic(c_a,i_main,v_revision,v_ids,v_header,v_items);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='42501' and v_message='INVOICE_MODULE_REQUIRED', 'revoked_module_is_checked_after_snapshot';
    execute v_state_sql into v_after using i_main;
    assert v_after=v_before, 'revoked_module_preserves_whole_state';
    passed:=passed||jsonb_build_array('revoked_module_is_checked_after_snapshot');
    execute 'reset role';
    raise exception 'rollback synthetic atomic invoice draft fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.profiles where id=any(array[p_admin,p_worker,p_other])), 'profile_fixture_cleanup';
  assert not exists(select 1 from public.companies where id=any(v_companies)), 'company_fixture_cleanup';
  assert not exists(select 1 from public.invoices where id=any(v_invoices)), 'invoice_fixture_cleanup';
  assert not exists(select 1 from public.invoice_items where invoice_id=any(v_invoices)), 'item_fixture_cleanup';
  assert not exists(select 1 from public.jobs where id in(j_a,j_b,j_last)), 'job_fixture_cleanup';
  assert not exists(select 1 from private.company_test_module_grants where company_id=any(v_companies)), 'grant_fixture_cleanup';
  assert not exists(select 1 from private.invoice_module_rollouts where company_id=any(v_companies)), 'rollout_fixture_cleanup';
  assert not exists(select 1 from private.invoice_test_issue_authorizations where invoice_id=any(v_invoices)), 'issue_provenance_cleanup';
  perform set_config('diriqo.invoice_draft_updates_test_result',jsonb_build_object(
    'passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back','cleanup_assertions',9,
    'scope','new_revision_aware_RPC_paths','concurrency','not_tested_single_session',
    'direct_table_writes','remain_legacy_paths_but_invalidate_revisions')::text,true);
end;
$test$;
select current_setting('diriqo.invoice_draft_updates_test_result')::jsonb as result;
