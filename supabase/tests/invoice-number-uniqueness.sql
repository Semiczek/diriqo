-- Authorized Diriqo TEST project only, after the company/number unique constraint.
-- Synthetic Auth/company setup uses the owner; invoice writes use authenticated.
-- Legacy, unenrolled companies isolate numbering from paid-module authority.
-- No DDL, GRANT, disabled trigger, provider call or existing customer mutation.
-- All fixtures roll back. This suite does not prove simultaneous transactions.
do $test$
declare
  u_admin uuid:=gen_random_uuid(); u_worker uuid:=gen_random_uuid(); u_other uuid:=gen_random_uuid();
  p_admin uuid:=gen_random_uuid(); p_worker uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid();
  c_a uuid:=gen_random_uuid(); c_b uuid:=gen_random_uuid(); c_allocator uuid:=gen_random_uuid();
  cu_a uuid:=gen_random_uuid(); cu_b uuid:=gen_random_uuid(); cu_allocator uuid:=gen_random_uuid();
  i_reserved uuid:=gen_random_uuid(); i_edit uuid:=gen_random_uuid(); i_null uuid:=gen_random_uuid();
  i_cancelled uuid:=gen_random_uuid(); i_issued uuid:=gen_random_uuid(); i_foreign uuid:=gen_random_uuid();
  i_batch_a uuid:=gen_random_uuid(); i_batch_b uuid:=gen_random_uuid(); i_padded uuid:=gen_random_uuid();
  v_invoice uuid; v_second uuid; v_case record; v_rows integer;
  v_error text; v_constraint text; v_message text; v_number text;
  v_before jsonb; v_after jsonb; v_result jsonb; passed jsonb:='[]';
  v_year integer:=extract(year from current_date)::integer;
  v_companies uuid[]; v_invoices uuid[];
  marker text:='InvoiceNumber'||replace(gen_random_uuid()::text,'-','');
begin
  v_companies:=array[c_a,c_b,c_allocator];
  v_invoices:=array[i_reserved,i_edit,i_null,i_cancelled,i_issued,i_foreign,i_batch_a,i_batch_b,i_padded];
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),
      (u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-other@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic numbering admin'),
      (p_worker,u_worker,u_worker,'Synthetic numbering worker'),
      (p_other,u_other,u_other,'Synthetic numbering foreign admin');
    insert into public.companies(id,name) values
      (c_a,'Synthetic numbering company A'),(c_b,'Synthetic numbering company B'),
      (c_allocator,'Synthetic numbering allocator');
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (c_a,p_admin,'company_admin',true),(c_a,p_worker,'worker',true),
      (c_b,p_other,'company_admin',true),(c_allocator,p_admin,'company_admin',true);
    insert into public.customers(id,company_id,name) values
      (cu_a,c_a,'Synthetic numbering customer A'),(cu_b,c_b,'Synthetic numbering customer B'),
      (cu_allocator,c_allocator,'Synthetic numbering allocator customer');

    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
      customer_snapshot,supplier_snapshot) values
      (i_reserved,c_a,cu_a,v_year,'draft',marker||'-reserved','{}','{}'),
      (i_edit,c_a,cu_a,v_year,'draft',null,'{}','{}'),
      (i_null,c_a,cu_a,v_year,'draft',null,'{}','{}'),
      (i_cancelled,c_a,cu_a,v_year,'draft',marker||'-cancelled','{}','{}'),
      (i_issued,c_a,cu_a,v_year,'draft',marker||'-issued','{}','{}'),
      (i_batch_a,c_a,cu_a,v_year,'draft',marker||'-batch-a','{}','{}'),
      (i_batch_b,c_a,cu_a,v_year,'draft',marker||'-batch-b','{}','{}');
    assert (select count(*) from public.invoices where company_id=c_a and invoice_number is null)=2,
      'multiple_null_numbers_allowed';
    passed:=passed||jsonb_build_array('multiple_null_numbers_allowed');

    -- A supplied number reserves the same company-wide namespace in every year.
    for v_case in select * from (values
      ('same_year_draft_insert',v_year),('other_year_draft_insert',v_year+1)
    ) cases(label,invoice_year) loop
      v_invoice:=gen_random_uuid(); v_invoices:=array_append(v_invoices,v_invoice);
      v_error:=null; v_constraint:=null;
      begin
        insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
          customer_snapshot,supplier_snapshot)
        values(v_invoice,c_a,cu_a,v_case.invoice_year,'draft',marker||'-reserved','{}','{}');
      exception when others then
        get stacked diagnostics v_error=returned_sqlstate,v_constraint=constraint_name;
      end;
      assert v_error='23505' and v_constraint='invoices_company_number_uidx', v_case.label||'_constraint_denied';
      assert not exists(select 1 from public.invoices where id=v_invoice)
        and (select count(*) from public.invoices where company_id=c_a and invoice_number=marker||'-reserved')=1,
        v_case.label||'_preserves_original_only';
      passed:=passed||jsonb_build_array(v_case.label||'_constraint_denied_without_insert');
    end loop;

    select to_jsonb(i) into strict v_before from public.invoices i where id=i_edit;
    v_error:=null; v_constraint:=null;
    begin
      update public.invoices set invoice_number=marker||'-reserved',note='Must roll back' where id=i_edit;
    exception when others then
      get stacked diagnostics v_error=returned_sqlstate,v_constraint=constraint_name;
    end;
    assert v_error='23505' and v_constraint='invoices_company_number_uidx', 'duplicate_draft_update_constraint_denied';
    assert (select to_jsonb(i)=v_before from public.invoices i where id=i_edit), 'duplicate_draft_update_preserves_whole_row';
    passed:=passed||jsonb_build_array('duplicate_draft_update_preserves_whole_row');

    -- The cancellation early-return in the issue guard must not bypass uniqueness.
    v_error:=null; v_constraint:=null;
    begin
      update public.invoices set status='cancelled',invoice_number=marker||'-reserved',note='Must roll back'
        where id=i_edit;
    exception when others then
      get stacked diagnostics v_error=returned_sqlstate,v_constraint=constraint_name;
    end;
    assert v_error='23505' and v_constraint='invoices_company_number_uidx', 'draft_to_cancelled_conflict_constraint_denied';
    assert (select to_jsonb(i)=v_before from public.invoices i where id=i_edit), 'draft_to_cancelled_conflict_preserves_whole_row';
    passed:=passed||jsonb_build_array('draft_to_cancelled_conflict_preserves_whole_row');

    update public.invoices set invoice_number=marker||'-free',note='Allowed distinct number' where id=i_edit;
    assert (select invoice_number=marker||'-free' and note='Allowed distinct number' from public.invoices where id=i_edit),
      'nonconflicting_draft_update_allowed';
    update public.invoices set invoice_number=null where id=i_edit;
    assert (select count(*) from public.invoices where company_id=c_a and invoice_number is null)=2,
      'draft_number_can_return_to_null';
    passed:=passed||jsonb_build_array('nonconflicting_draft_update_allowed','draft_number_can_return_to_null');

    update public.invoices set status='cancelled' where id=i_cancelled;
    v_result:=public.issue_invoice_atomic(c_a,i_issued);
    assert (v_result->>'issued')::boolean and v_result->>'invoice_number'=marker||'-issued'
      and (select status='issued' and issued_at is not null from public.invoices where id=i_issued),
      'manual_number_issue_still_succeeds';
    passed:=passed||jsonb_build_array('manual_number_issue_still_succeeds');
    for v_case in select * from (values
      ('cancelled',marker||'-cancelled',i_cancelled),('issued',marker||'-issued',i_issued)
    ) cases(label,invoice_number,invoice_id) loop
      select to_jsonb(i) into strict v_before from public.invoices i where id=v_case.invoice_id;
      v_invoice:=gen_random_uuid(); v_invoices:=array_append(v_invoices,v_invoice);
      v_error:=null; v_constraint:=null;
      begin
        insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
          customer_snapshot,supplier_snapshot)
        values(v_invoice,c_a,cu_a,v_year,'draft',v_case.invoice_number,'{}','{}');
      exception when others then
        get stacked diagnostics v_error=returned_sqlstate,v_constraint=constraint_name;
      end;
      assert v_error='23505' and v_constraint='invoices_company_number_uidx', v_case.label||'_number_remains_reserved';
      assert not exists(select 1 from public.invoices where id=v_invoice)
        and (select to_jsonb(i)=v_before from public.invoices i where id=v_case.invoice_id),
        v_case.label||'_conflict_preserves_original';
      passed:=passed||jsonb_build_array(v_case.label||'_number_cannot_be_reused_by_draft');
      select to_jsonb(i) into strict v_before from public.invoices i where id=i_edit;
      v_error:=null; v_constraint:=null;
      begin
        update public.invoices set invoice_number=v_case.invoice_number,note='Must roll back' where id=i_edit;
      exception when others then
        get stacked diagnostics v_error=returned_sqlstate,v_constraint=constraint_name;
      end;
      assert v_error='23505' and v_constraint='invoices_company_number_uidx', v_case.label||'_number_update_constraint_denied';
      assert (select to_jsonb(i)=v_before from public.invoices i where id=i_edit),
        v_case.label||'_number_update_preserves_draft';
      passed:=passed||jsonb_build_array(v_case.label||'_number_cannot_be_taken_by_draft_update');
    end loop;

    -- A statement that has already touched a valid row still rolls back in full.
    v_invoice:=gen_random_uuid(); v_second:=gen_random_uuid();
    v_invoices:=v_invoices||array[v_invoice,v_second];
    v_error:=null; v_constraint:=null;
    begin
      insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
        customer_snapshot,supplier_snapshot) values
        (v_invoice,c_a,cu_a,v_year,'draft',marker||'-valid-batch-insert','{}','{}'),
        (v_second,c_a,cu_a,v_year,'draft',marker||'-reserved','{}','{}');
    exception when others then
      get stacked diagnostics v_error=returned_sqlstate,v_constraint=constraint_name;
    end;
    assert v_error='23505' and v_constraint='invoices_company_number_uidx', 'batch_insert_conflict_constraint_denied';
    assert not exists(select 1 from public.invoices where id in(v_invoice,v_second)), 'batch_insert_rolls_back_valid_row_too';
    passed:=passed||jsonb_build_array('batch_insert_rolls_back_valid_row_too');

    select jsonb_agg(to_jsonb(i) order by i.id) into v_before from public.invoices i where id in(i_batch_a,i_batch_b);
    v_error:=null; v_constraint:=null;
    begin
      update public.invoices set invoice_number=marker||'-batch-collision',note='Must roll back both rows'
        where id in(i_batch_a,i_batch_b);
    exception when others then
      get stacked diagnostics v_error=returned_sqlstate,v_constraint=constraint_name;
    end;
    assert v_error='23505' and v_constraint='invoices_company_number_uidx', 'batch_update_conflict_constraint_denied';
    select jsonb_agg(to_jsonb(i) order by i.id) into v_after from public.invoices i where id in(i_batch_a,i_batch_b);
    assert v_after=v_before, 'batch_update_rolls_back_both_whole_rows';
    passed:=passed||jsonb_build_array('batch_update_rolls_back_both_whole_rows');

    -- Exact stored values are unique. The existing issue guard additionally trims.
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
      customer_snapshot,supplier_snapshot)
    values(i_padded,c_a,cu_a,v_year,'draft',' '||marker||'-reserved ','{}','{}');
    select to_jsonb(i) into strict v_before from public.invoices i where id=i_padded;
    v_error:=null; v_message:=null;
    begin perform public.issue_invoice_atomic(c_a,i_padded);
    exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
    assert v_error='23514' and v_message='INVOICE_NUMBER_CONFLICT', 'normalized_manual_issue_conflict_guard_still_active';
    assert (select to_jsonb(i)=v_before from public.invoices i where id=i_padded),
      'normalized_manual_issue_conflict_preserves_draft';
    passed:=passed||jsonb_build_array('normalized_manual_issue_conflict_preserves_draft');

    -- Reserve 0001 in a draft and 0002 in a cancelled draft before any allocation.
    for v_case in select * from (values(1,'draft'),(2,'cancelled')) cases(number_suffix,final_status) loop
      v_invoice:=gen_random_uuid(); v_invoices:=array_append(v_invoices,v_invoice);
      insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
        customer_snapshot,supplier_snapshot)
      values(v_invoice,c_allocator,cu_allocator,v_year,'draft',v_year::text||'-000'||v_case.number_suffix::text,'{}','{}');
      if v_case.final_status='cancelled' then update public.invoices set status='cancelled' where id=v_invoice; end if;
    end loop;
    v_invoice:=gen_random_uuid(); v_invoices:=array_append(v_invoices,v_invoice);
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
      customer_snapshot,supplier_snapshot)
    values(v_invoice,c_allocator,cu_allocator,v_year,'draft',null,'{}','{}');
    v_result:=public.issue_invoice_atomic(c_allocator,v_invoice);
    assert (v_result->>'issued')::boolean and v_result->>'invoice_number'=v_year::text||'-0003',
      'automatic_issue_skips_draft_and_cancelled_reservations';
    passed:=passed||jsonb_build_array('automatic_issue_skips_draft_and_cancelled_reservations');

    v_invoice:=gen_random_uuid(); v_second:=gen_random_uuid(); v_invoices:=v_invoices||array[v_invoice,v_second];
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
      customer_snapshot,supplier_snapshot) values
      (v_invoice,c_allocator,cu_allocator,v_year,'draft',v_year::text||'-0004','{}','{}'),
      (v_second,c_allocator,cu_allocator,v_year,'draft',null,'{}','{}');
    v_result:=public.issue_invoice_atomic(c_allocator,v_invoice);
    assert (v_result->>'issued')::boolean and v_result->>'invoice_number'=v_year::text||'-0004',
      'manual_sequential_number_issue_allowed';
    v_result:=public.issue_invoice_atomic(c_allocator,v_second);
    assert (v_result->>'issued')::boolean and v_result->>'invoice_number'=v_year::text||'-0005',
      'automatic_issue_skips_manually_issued_number';
    passed:=passed||jsonb_build_array('manual_sequential_number_issue_allowed','automatic_issue_skips_manually_issued_number');

    v_invoice:=gen_random_uuid(); v_invoices:=array_append(v_invoices,v_invoice);
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
      customer_snapshot,supplier_snapshot)
    values(v_invoice,c_allocator,cu_allocator,v_year,'draft',v_year::text||'-0006','{}','{}');
    v_number:=public.next_invoice_number(c_allocator,v_year);
    assert v_number=v_year::text||'-0007', 'public_allocator_skips_reserved_draft_number';
    passed:=passed||jsonb_build_array('public_allocator_skips_reserved_draft_number');

    -- A different company's own administrator can use the same exact number.
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
      customer_snapshot,supplier_snapshot)
    values(i_foreign,c_b,cu_b,v_year,'draft',marker||'-reserved','{}','{}');
    assert (select invoice_number=marker||'-reserved' from public.invoices where id=i_foreign),
      'same_number_allowed_in_other_company';
    passed:=passed||jsonb_build_array('same_number_allowed_in_other_company');

    -- Uniqueness adds no write access. RLS can deny UPDATE by filtering all rows.
    execute 'reset role';
    select to_jsonb(i) into strict v_before from public.invoices i where id=i_edit;
    for v_case in select * from (values(u_worker,'worker'),(u_other,'foreign_admin')) cases(auth_user_id,label) loop
      perform set_config('request.jwt.claims',jsonb_build_object('sub',v_case.auth_user_id,'role','authenticated')::text,true);
      perform set_config('request.jwt.claim.sub',v_case.auth_user_id::text,true);
      execute 'set local role authenticated';
      update public.invoices set invoice_number=marker||'-unauthorized',note='Must not change' where id=i_edit;
      get diagnostics v_rows=row_count;
      assert v_rows=0, v_case.label||'_cannot_update_invoice_number';
      v_invoice:=gen_random_uuid(); v_invoices:=array_append(v_invoices,v_invoice);
      v_error:=null;
      begin
        insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
          customer_snapshot,supplier_snapshot)
        values(v_invoice,c_a,cu_a,v_year,'draft',marker||'-unauthorized-'||v_case.label,'{}','{}');
      exception when others then get stacked diagnostics v_error=returned_sqlstate; end;
      assert v_error='42501', v_case.label||'_cannot_insert_invoice_number';
      v_error:=null; v_message:=null;
      begin perform public.issue_invoice_atomic(c_a,i_edit);
      exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
      assert v_error='42501' and v_message='INVOICE_ISSUE_FORBIDDEN', v_case.label||'_cannot_issue_invoice';
      execute 'reset role';
      assert not exists(select 1 from public.invoices where id=v_invoice)
        and (select to_jsonb(i)=v_before from public.invoices i where id=i_edit),
        v_case.label||'_attempts_preserve_rows';
      passed:=passed||jsonb_build_array(v_case.label||'_cannot_update_invoice_number',
        v_case.label||'_cannot_insert_invoice_number',v_case.label||'_cannot_issue_invoice');
    end loop;

    assert not exists(select 1 from public.invoices where company_id=any(v_companies) and invoice_number is not null
      group by company_id,invoice_number having count(*)>1), 'all_fixture_company_number_pairs_unique';
    passed:=passed||jsonb_build_array('all_fixture_company_number_pairs_unique');
    raise exception 'ROLLBACK_ALL synthetic invoice number fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null;
  end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.profiles where id=any(array[p_admin,p_worker,p_other])), 'profile_fixture_cleanup';
  assert not exists(select 1 from public.companies where id=any(v_companies)), 'company_fixture_cleanup';
  assert not exists(select 1 from public.company_members where company_id=any(v_companies)), 'membership_fixture_cleanup';
  assert not exists(select 1 from public.customers where id in(cu_a,cu_b,cu_allocator)), 'customer_fixture_cleanup';
  assert not exists(select 1 from public.invoices where id=any(v_invoices) or company_id=any(v_companies)), 'invoice_fixture_cleanup';
  assert not exists(select 1 from public.invoice_number_sequences where company_id=any(v_companies)), 'sequence_fixture_cleanup';
  assert not exists(select 1 from private.invoice_issue_authorizations where invoice_id=any(v_invoices))
    and not exists(select 1 from private.invoice_test_issue_authorizations where invoice_id=any(v_invoices)), 'provenance_fixture_cleanup';
  perform set_config('diriqo.invoice_number_uniqueness_test_result',jsonb_build_object(
    'passed',passed,'count',jsonb_array_length(passed),'fixtures','rolled_back','cleanup_assertions',8,
    'duplicate_sqlstate','23505','duplicate_constraint','invoices_company_number_uidx',
    'licensing_scope','legacy_unenrolled_fixture_companies','concurrency','not_tested_single_session',
    'number_comparison','exact_stored_value; existing issue guard also trims')::text,true);
end;
$test$;
select current_setting('diriqo.invoice_number_uniqueness_test_result')::jsonb as result;
