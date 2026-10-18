-- Authorized Diriqo TEST only, after atomic_invoice_settlement.
-- Real authenticated roles, synthetic fixtures, no DDL or disabled guard.
-- Each scenario and the complete fixture roll back. This is sequential proof;
-- actual two-session overlap is covered separately by the HTTP/barrier harness.
do $test$
declare
  u_admin uuid:=gen_random_uuid(); u_worker uuid:=gen_random_uuid(); u_other uuid:=gen_random_uuid();
  p_admin uuid:=gen_random_uuid(); p_worker uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid();
  c_a uuid:=gen_random_uuid(); c_b uuid:=gen_random_uuid();
  cu_a uuid:=gen_random_uuid(); cu_b uuid:=gen_random_uuid(); cu_alt uuid:=gen_random_uuid();
  i_main uuid:=gen_random_uuid(); i_draft uuid:=gen_random_uuid(); i_empty uuid:=gen_random_uuid();
  i_foreign uuid:=gen_random_uuid(); i_replacement uuid:=gen_random_uuid();
  j_a uuid:=gen_random_uuid(); j_b uuid:=gen_random_uuid(); j_draft uuid:=gen_random_uuid();
  v_job_ids uuid[]; v_invoices uuid[]; v_job uuid; v_target uuid; v_company uuid;
  v_export uuid:=gen_random_uuid(); v_grant uuid:=gen_random_uuid();
  marker text:='InvoiceSettlement'||replace(gen_random_uuid()::text,'-','');
  v_now timestamptz:=date_trunc('second',clock_timestamp());
  v_action text; v_status text; v_label text; v_case record;
  v_revision text; v_old_revision text; v_error text; v_message text;
  v_before jsonb; v_after jsonb; v_result jsonb; v_retry jsonb; v_other_before jsonb;
  v_saved_jobs jsonb; v_paid_at timestamptz; v_cancelled_at timestamptz;
  passed jsonb:='[]';
  v_state_sql constant text:=$state$
    select jsonb_build_object('invoice',to_jsonb(i),
      'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order,x.created_at,x.id)
        from public.invoice_items x where x.invoice_id=i.id),'[]'::jsonb),
      'links',coalesce((select jsonb_agg(to_jsonb(x) order by x.job_id)
        from public.invoice_jobs x where x.invoice_id=i.id),'[]'::jsonb),
      'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by j.id) from public.jobs j
        where exists(select 1 from public.invoice_jobs l where l.invoice_id=i.id and l.job_id=j.id)),'[]'::jsonb))
    from public.invoices i where i.id=$1
  $state$;
begin
  v_invoices:=array[i_main,i_draft,i_empty,i_foreign,i_replacement];
  select array_agg(x order by x) into v_job_ids from unnest(array[j_a,j_b]) x;
  begin
    insert into auth.users(id,email,raw_user_meta_data) values
      (u_admin,marker||'-admin@example.invalid','{}'),(u_worker,marker||'-worker@example.invalid','{}'),
      (u_other,marker||'-foreign@example.invalid','{}');
    insert into public.profiles(id,auth_user_id,user_id,full_name) values
      (p_admin,u_admin,u_admin,'Synthetic settlement admin'),(p_worker,u_worker,u_worker,'Synthetic settlement worker'),
      (p_other,u_other,u_other,'Synthetic settlement foreign admin');
    insert into public.companies(id,name) values(c_a,'Synthetic settlement A'),(c_b,'Synthetic settlement B');
    insert into public.company_members(company_id,profile_id,role,is_active) values
      (c_a,p_admin,'company_admin',true),(c_a,p_worker,'worker',true),(c_b,p_other,'company_admin',true);
    insert into public.customers(id,company_id,name) values
      (cu_a,c_a,'Synthetic settlement customer'),(cu_b,c_b,'Synthetic foreign customer'),
      (cu_alt,c_a,'Synthetic alternative customer');
    insert into public.jobs(id,company_id,customer_id,title,status,work_state,price) values
      (j_a,c_a,cu_a,'Settlement job A','done','done',50),
      (j_b,c_a,cu_a,'Settlement job B','done','done',50),
      (j_draft,c_a,cu_a,'Draft externally paid job','done','done',10);
    update public.jobs set billing_status='paid',is_paid=true,paid_at=v_now-interval '1 day',
      invoiced_at=v_now-interval '2 days',due_date=current_date-1 where id=j_draft;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';
    foreach v_target in array array[i_main,i_draft,i_empty] loop
      insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,
        supplier_snapshot,customer_snapshot,subtotal_without_vat,vat_total,total_with_vat,is_vat_payer,
        note,created_by,issue_date,taxable_supply_date,due_date)
      values(v_target,c_a,cu_a,extract(year from current_date)::int,'draft',marker||'-'||v_target,
        jsonb_build_object('id',c_a,'name','Historic supplier','iban','CZ0000000000','preserved','supplier'),
        jsonb_build_object('id',cu_a,'name','Historic customer','preserved','customer'),
        100,21,121,true,'Historic manual note',p_admin,current_date,current_date,current_date+14);
      insert into public.invoice_items(invoice_id,company_id,sort_order,item_name,quantity,unit,
        unit_price_without_vat,vat_rate,vat_amount,total_without_vat,total_with_vat,source_snapshot)
      values(v_target,c_a,1,'Historic line A',1,'ks',50,21,10.5,50,60.5,'{"preserved":"A"}'),
        (v_target,c_a,2,'Historic line B',1,'ks',50,21,10.5,50,60.5,'{"preserved":"B"}');
    end loop;
    insert into public.invoice_jobs(invoice_id,job_id,company_id,customer_id)
      values(i_main,j_a,c_a,cu_a),(i_main,j_b,c_a,cu_a),(i_draft,j_draft,c_a,cu_a);
    perform public.issue_invoice_atomic(c_a,i_main);
    perform public.issue_invoice_atomic(c_a,i_empty);
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_other,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_other::text,true);
    execute 'set local role authenticated';
    insert into public.invoices(id,company_id,customer_id,invoice_year,status,supplier_snapshot,customer_snapshot,
      issue_date,taxable_supply_date,due_date)
      values(i_foreign,c_b,cu_b,extract(year from current_date)::int,'draft','{}','{}',current_date,current_date,current_date+14);
    execute 'reset role';
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute 'set local role authenticated';

    -- Complete transitions, immutable accounting content and idempotent retries.
    foreach v_action in array array['paid','cancelled'] loop
      foreach v_status in array array['issued','sent','overdue'] loop
        begin
          update public.invoices set status=v_status where id=i_main;
          v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
          execute v_state_sql into v_before using i_main;
          if v_action='paid' then v_result:=public.mark_invoice_paid_atomic(c_a,i_main,v_revision);
          else v_result:=public.cancel_invoice_atomic(c_a,i_main,v_revision); end if;
          v_label:=v_action||'_from_'||v_status;
          assert v_result->>'invoice_id'=i_main::text and v_result->>'status'=v_action
            and (v_result->>'changed')::boolean and v_result->'job_ids'=to_jsonb(v_job_ids), v_label||'_result';
          execute v_state_sql into v_after using i_main;
          assert v_after->'invoice'->>'status'=v_action and v_after->'items'=v_before->'items'
            and ((v_after->'invoice')-array['status','paid_at','cancelled_at','updated_at'])
              =((v_before->'invoice')-array['status','paid_at','cancelled_at','updated_at']), v_label||'_immutable_financial_snapshot';
          if v_action='paid' then
            assert (select count(*)=2 and bool_and(billing_status='paid' and is_paid and paid_at=(v_result->>'paid_at')::timestamptz
              and invoiced_at=(v_before->'invoice'->>'issued_at')::timestamptz and due_date=(v_before->'invoice'->>'due_date')::date)
              from public.jobs where id=any(v_job_ids)) and v_after->'links'=v_before->'links', v_label||'_all_jobs_same_timestamp';
          else
            assert (select count(*)=2 and bool_and(billing_status='waiting_for_invoice' and not is_paid
              and paid_at is null and invoiced_at is null and due_date is null) from public.jobs where id=any(v_job_ids))
              and not exists(select 1 from public.invoice_jobs where invoice_id=i_main and is_active), v_label||'_all_jobs_and_links_released';
          end if;
          passed:=passed||jsonb_build_array(v_label||'_result',v_label||'_immutable_financial_snapshot',v_label||'_complete_job_projection');
          v_before:=v_after;
          if v_action='paid' then v_retry:=public.mark_invoice_paid_atomic(c_a,i_main,v_revision);
          else v_retry:=public.cancel_invoice_atomic(c_a,i_main,v_revision); end if;
          execute v_state_sql into v_after using i_main;
          assert not (v_retry->>'changed')::boolean and v_retry->'job_ids'='[]'::jsonb
            and v_retry->'paid_at'=v_result->'paid_at' and v_retry->'cancelled_at'=v_result->'cancelled_at'
            and v_after=v_before, v_label||'_old_revision_retry_is_whole_state_noop';
          passed:=passed||jsonb_build_array(v_label||'_old_revision_retry_is_whole_state_noop');
          raise exception 'rollback scenario' using errcode='PT002';
        exception when sqlstate 'PT002' then null; end;
      end loop;
    end loop;

    -- An inactive historic link never authorizes modifying its externally paid job.
    foreach v_action in array array['paid','cancelled'] loop
      begin
        update public.invoice_jobs set is_active=false where invoice_id=i_main and job_id=v_job_ids[2];
        update public.jobs set billing_status='paid',is_paid=true,paid_at=v_now where id=v_job_ids[2];
        select to_jsonb(j) into v_saved_jobs from public.jobs j where id=v_job_ids[2];
        v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
        if v_action='paid' then v_result:=public.mark_invoice_paid_atomic(c_a,i_main,v_revision);
        else v_result:=public.cancel_invoice_atomic(c_a,i_main,v_revision); end if;
        assert v_result->'job_ids'=jsonb_build_array(v_job_ids[1])
          and (select to_jsonb(j)=v_saved_jobs from public.jobs j where id=v_job_ids[2]), v_action||'_inactive_link_job_untouched';
        passed:=passed||jsonb_build_array(v_action||'_inactive_link_job_untouched');
        raise exception 'rollback scenario' using errcode='PT002';
      exception when sqlstate 'PT002' then null; end;
    end loop;
    begin
      execute v_state_sql into v_before using i_draft;
      v_revision:=public.get_invoice_edit_snapshot(c_a,i_draft)->>'revision';
      v_result:=public.cancel_invoice_atomic(c_a,i_draft,v_revision);
      execute v_state_sql into v_after using i_draft;
      assert (v_result->>'changed')::boolean and v_after->'jobs'=v_before->'jobs'
        and v_after->'items'=v_before->'items' and v_after->'invoice'->>'issued_at' is null
        and not exists(select 1 from public.invoice_jobs where invoice_id=i_draft and is_active), 'draft_cancel_frees_links_without_touching_job_billing';
      passed:=passed||jsonb_build_array('draft_cancel_frees_links_without_touching_job_billing');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;
    foreach v_action in array array['paid','cancelled'] loop
      begin
        v_revision:=public.get_invoice_edit_snapshot(c_a,i_empty)->>'revision';
        if v_action='paid' then v_result:=public.mark_invoice_paid_atomic(c_a,i_empty,v_revision);
        else v_result:=public.cancel_invoice_atomic(c_a,i_empty,v_revision); end if;
        assert (v_result->>'changed')::boolean and v_result->'job_ids'='[]'::jsonb, v_action||'_invoice_without_jobs_supported';
        passed:=passed||jsonb_build_array(v_action||'_invoice_without_jobs_supported');
        raise exception 'rollback scenario' using errcode='PT002';
      exception when sqlstate 'PT002' then null; end;
    end loop;

    -- Failure occurs after header and lower-UUID job writes, not prevalidation.
    foreach v_action in array array['paid','cancelled'] loop
      begin
        v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
        update public.jobs set billing_status='paid',is_paid=true,paid_at=v_now where id=v_job_ids[2];
        assert public.get_invoice_edit_snapshot(c_a,i_main)->>'revision'=v_revision, 'external_job_payment_is_outside_invoice_revision';
        execute v_state_sql into v_before using i_main;
        v_error:=null; v_message:=null;
        begin
          if v_action='paid' then perform public.mark_invoice_paid_atomic(c_a,i_main,v_revision);
          else perform public.cancel_invoice_atomic(c_a,i_main,v_revision); end if;
        exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
        assert v_error='23514' and v_message='INVOICE_SETTLEMENT_JOB_CONFLICT', v_action||'_last_job_business_conflict';
        execute v_state_sql into v_after using i_main;
        assert v_after=v_before, v_action||'_late_failure_rolls_back_header_first_job_items_and_links';
        passed:=passed||jsonb_build_array(v_action||'_last_job_business_conflict',v_action||'_late_failure_rolls_back_whole_state');
        raise exception 'rollback scenario' using errcode='PT002';
      exception when sqlstate 'PT002' then null; end;
    end loop;

    -- Exact negative state/export signals; each starts from the same valid issue.
    for v_case in select * from (values
      ('draft_paid','paid','INVOICE_INVALID_STATE'),
      ('cancelled_paid','paid','INVOICE_INVALID_STATE'),
      ('paid_cancel','cancelled','INVOICE_CANCEL_PAID'),
      ('legacy_paid_at_cancel','cancelled','INVOICE_CANCEL_PAID'),
      ('legacy_paid_without_timestamp','paid','INVOICE_INVALID_STATE'),
      ('legacy_cancelled_without_timestamp','cancelled','INVOICE_INVALID_STATE'),
      ('legacy_cancelled_with_paid_at','cancelled','INVOICE_INVALID_STATE'),
      ('export_status','cancelled','INVOICE_CANCEL_EXPORTED'),
      ('export_timestamp','cancelled','INVOICE_CANCEL_EXPORTED'),
      ('export_external_id','cancelled','INVOICE_CANCEL_EXPORTED'),
      ('export_link_status','cancelled','INVOICE_CANCEL_EXPORTED'),
      ('export_batch_status','cancelled','INVOICE_CANCEL_EXPORTED'),
      ('export_batch_timestamp','cancelled','INVOICE_CANCEL_EXPORTED')
    ) x(label,action,message) loop
      begin
        v_target:=case when v_case.label='draft_paid' then i_draft else i_main end;
        if v_case.label in ('cancelled_paid','legacy_cancelled_with_paid_at') then
          update public.invoices set status='cancelled',cancelled_at=v_now,
            paid_at=case when v_case.label='legacy_cancelled_with_paid_at' then v_now else null end where id=v_target;
        elsif v_case.label in ('paid_cancel','legacy_paid_without_timestamp') then
          update public.invoices set status='paid',paid_at=case when v_case.label='paid_cancel' then v_now else null end where id=v_target;
        elsif v_case.label='legacy_cancelled_without_timestamp' then update public.invoices set status='cancelled',cancelled_at=null where id=v_target;
        elsif v_case.label='legacy_paid_at_cancel' then update public.invoices set paid_at=v_now where id=v_target;
        elsif v_case.label='export_status' then update public.invoices set pohoda_export_status='exported' where id=v_target;
        elsif v_case.label='export_timestamp' then update public.invoices set pohoda_export_status='failed',pohoda_exported_at=v_now where id=v_target;
        elsif v_case.label='export_external_id' then update public.invoices set pohoda_export_status='not_exported',pohoda_external_id='legacy-external' where id=v_target;
        elsif v_case.label in ('export_link_status','export_batch_status','export_batch_timestamp') then
          insert into public.pohoda_exports(id,company_id,status,exported_at) values(v_export,c_a,
            case when v_case.label='export_batch_status' then 'exported' else 'generated' end,
            case when v_case.label='export_batch_timestamp' then v_now else null end);
          insert into public.pohoda_export_invoices(export_id,invoice_id,company_id,status)
            values(v_export,v_target,c_a,case when v_case.label='export_link_status' then 'exported' else 'included' end);
        end if;
        v_revision:=public.get_invoice_edit_snapshot(c_a,v_target)->>'revision';
        execute v_state_sql into v_before using v_target;
        v_error:=null; v_message:=null;
        begin
          if v_case.action='paid' then perform public.mark_invoice_paid_atomic(c_a,v_target,v_revision);
          else perform public.cancel_invoice_atomic(c_a,v_target,v_revision); end if;
        exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
        assert v_error='23514' and v_message=v_case.message, v_case.label||'_denied';
        execute v_state_sql into v_after using v_target;
        assert v_after=v_before, v_case.label||'_whole_state_unchanged';
        passed:=passed||jsonb_build_array(v_case.label||'_denied_and_whole_state_unchanged');
        raise exception 'rollback scenario' using errcode='PT002';
      exception when sqlstate 'PT002' then null; end;
    end loop;
    begin
      insert into public.pohoda_exports(id,company_id,status) values(v_export,c_a,'failed');
      insert into public.pohoda_export_invoices(export_id,invoice_id,company_id,status) values(v_export,i_main,c_a,'failed');
      update public.invoices set pohoda_export_status='failed',pohoda_last_export_id=v_export where id=i_main;
      v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
      v_result:=public.cancel_invoice_atomic(c_a,i_main,v_revision);
      assert (v_result->>'changed')::boolean and v_result->>'status'='cancelled', 'failed_export_attempt_without_export_evidence_can_cancel';
      passed:=passed||jsonb_build_array('failed_export_attempt_without_export_evidence_can_cancel');
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    foreach v_action in array array['paid','cancelled'] loop
      foreach v_label in array array['null_revision','malformed_revision','stale_header','scope_drift'] loop
        begin
          v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
          if v_label='null_revision' then v_revision:=null;
          elsif v_label='malformed_revision' then v_revision:='not-a-revision';
          elsif v_label='stale_header' then update public.invoices set sent_at=v_now where id=i_main;
          else update public.jobs set customer_id=cu_alt where id=v_job_ids[2]; end if;
          execute v_state_sql into v_before using i_main;
          v_error:=null; v_message:=null;
          begin
            if v_action='paid' then perform public.mark_invoice_paid_atomic(c_a,i_main,v_revision);
            else perform public.cancel_invoice_atomic(c_a,i_main,v_revision); end if;
          exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
          assert v_error=case when v_label in ('null_revision','malformed_revision') then '22023' else '23514' end
            and v_message=case when v_label in ('null_revision','malformed_revision') then 'INVOICE_SETTLEMENT_INPUT_INVALID'
              when v_label='stale_header' then 'INVOICE_SETTLEMENT_STALE' else 'INVOICE_LINK_SCOPE_INVALID' end,
            v_action||'_'||v_label||'_denied';
          execute v_state_sql into v_after using i_main;
          assert v_after=v_before, v_action||'_'||v_label||'_whole_state_unchanged';
          passed:=passed||jsonb_build_array(v_action||'_'||v_label||'_denied_and_whole_state_unchanged');
          raise exception 'rollback scenario' using errcode='PT002';
        exception when sqlstate 'PT002' then null; end;
      end loop;
    end loop;

    -- Fresh actual-role authorization including terminal retries and revoked membership.
    execute 'reset role';
    for v_case in select * from (values ('worker',u_worker,false),('foreign_admin',u_other,false),
      ('revoked_admin',u_admin,true),('anonymous_identity',null::uuid,false)) x(label,identity,revoke_member) loop
      foreach v_action in array array['paid','cancelled'] loop
        begin
          perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
          perform set_config('request.jwt.claim.sub',u_admin::text,true);
          execute 'set local role authenticated';
          v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
          execute 'reset role';
          if v_case.revoke_member then update public.company_members set is_active=false where company_id=c_a and profile_id=p_admin; end if;
          execute v_state_sql into v_before using i_main;
          perform set_config('request.jwt.claims',jsonb_build_object('sub',v_case.identity,'role','authenticated')::text,true);
          perform set_config('request.jwt.claim.sub',coalesce(v_case.identity::text,''),true);
          execute 'set local role authenticated';
          v_error:=null; v_message:=null;
          begin
            if v_action='paid' then perform public.mark_invoice_paid_atomic(c_a,i_main,v_revision);
            else perform public.cancel_invoice_atomic(c_a,i_main,v_revision); end if;
          exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
          execute 'reset role';
          assert v_error='42501' and v_message='INVOICE_SETTLEMENT_FORBIDDEN', v_case.label||'_'||v_action||'_fresh_authority';
          execute v_state_sql into v_after using i_main;
          assert v_after=v_before, v_case.label||'_'||v_action||'_whole_state_unchanged';
          passed:=passed||jsonb_build_array(v_case.label||'_'||v_action||'_denied_and_whole_state_unchanged');
          raise exception 'rollback scenario' using errcode='PT002';
        exception when sqlstate 'PT002' then null; end;
      end loop;
    end loop;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u_admin,'role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',u_admin::text,true);
    execute v_state_sql into v_other_before using i_foreign;
    execute 'set local role authenticated';
    v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
    foreach v_action in array array['paid','cancelled'] loop
      for v_case in select * from (values ('foreign_company',c_b,i_foreign,'42501','INVOICE_SETTLEMENT_FORBIDDEN'),
        ('foreign_invoice',c_a,i_foreign,'P0002','INVOICE_NOT_FOUND'),
        ('missing_invoice',c_a,gen_random_uuid(),'P0002','INVOICE_NOT_FOUND')) x(label,company_id,invoice_id,code,message) loop
        v_error:=null; v_message:=null;
        begin
          if v_action='paid' then perform public.mark_invoice_paid_atomic(v_case.company_id,v_case.invoice_id,v_revision);
          else perform public.cancel_invoice_atomic(v_case.company_id,v_case.invoice_id,v_revision); end if;
        exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
        assert v_error=v_case.code and v_message=v_case.message, v_action||'_'||v_case.label||'_tenant_boundary';
        passed:=passed||jsonb_build_array(v_action||'_'||v_case.label||'_tenant_boundary');
      end loop;
    end loop;
    execute 'reset role';
    execute v_state_sql into v_after using i_foreign;
    assert v_after=v_other_before, 'foreign_invoice_whole_state_unchanged';
    passed:=passed||jsonb_build_array('foreign_invoice_whole_state_unchanged');

    -- Existing history remains settleable after module expiry or revocation.
    foreach v_label in array array['expired','revoked'] loop
      foreach v_action in array array['paid','cancelled'] loop
        begin
          insert into private.company_test_module_grants(id,company_id,product,source_ref,reason,
            valid_from,valid_until,history_until,capabilities) values(v_grant,c_a,'invoicing',marker||'-'||v_label,
            'Synthetic settlement historical access',v_now-interval '2 days',
            case when v_label='expired' then v_now-interval '1 day' else v_now+interval '1 day' end,
            case when v_label='expired' then v_now-interval '1 day' else v_now+interval '1 day' end,
            array['invoicing.invoice.issue']);
          if v_label='revoked' then update private.company_test_module_grants set revoked_at=v_now,revocation_reason='Synthetic test revocation' where id=v_grant; end if;
          insert into private.invoice_module_rollouts(company_id,livemode) values(c_a,false);
          execute 'set local role authenticated';
          v_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
          if v_action='paid' then v_result:=public.mark_invoice_paid_atomic(c_a,i_main,v_revision);
          else v_result:=public.cancel_invoice_atomic(c_a,i_main,v_revision); end if;
          assert (v_result->>'changed')::boolean and v_result->>'status'=v_action, v_label||'_module_preserves_historical_'||v_action;
          if v_action='paid' then v_retry:=public.mark_invoice_paid_atomic(c_a,i_main,v_revision);
          else v_retry:=public.cancel_invoice_atomic(c_a,i_main,v_revision); end if;
          assert not (v_retry->>'changed')::boolean and v_retry->'job_ids'='[]'::jsonb, v_label||'_module_historical_retry_noop';
          passed:=passed||jsonb_build_array(v_label||'_module_preserves_historical_'||v_action,v_label||'_module_'||v_action||'_retry_noop');
          execute 'reset role';
          raise exception 'rollback scenario' using errcode='PT002';
        exception when sqlstate 'PT002' then null; end;
      end loop;
    end loop;
    execute 'set local role authenticated';

    -- Retrying a cancelled invoice cannot undo a replacement invoice's payment.
    begin
      v_old_revision:=public.get_invoice_edit_snapshot(c_a,i_main)->>'revision';
      v_result:=public.cancel_invoice_atomic(c_a,i_main,v_old_revision);
      v_cancelled_at:=(v_result->>'cancelled_at')::timestamptz;
      insert into public.invoices(id,company_id,customer_id,invoice_year,status,invoice_number,supplier_snapshot,customer_snapshot,
        subtotal_without_vat,vat_total,total_with_vat,issue_date,taxable_supply_date,due_date)
        values(i_replacement,c_a,cu_a,extract(year from current_date)::int,'draft',marker||'-replacement','{}','{}',100,0,100,current_date,current_date,current_date+14);
      insert into public.invoice_items(invoice_id,company_id,item_name,quantity,unit_price_without_vat,vat_rate,vat_amount,total_without_vat,total_with_vat)
        values(i_replacement,c_a,'Replacement line',1,100,0,0,100,100);
      insert into public.invoice_jobs(invoice_id,job_id,company_id,customer_id)
        values(i_replacement,j_a,c_a,cu_a),(i_replacement,j_b,c_a,cu_a);
      perform public.issue_invoice_atomic(c_a,i_replacement);
      v_revision:=public.get_invoice_edit_snapshot(c_a,i_replacement)->>'revision';
      perform public.mark_invoice_paid_atomic(c_a,i_replacement,v_revision);
      execute v_state_sql into v_before using i_main;
      execute v_state_sql into v_other_before using i_replacement;
      v_retry:=public.cancel_invoice_atomic(c_a,i_main,v_old_revision);
      execute v_state_sql into v_after using i_main;
      assert v_after=v_before and not (v_retry->>'changed')::boolean and v_retry->'job_ids'='[]'::jsonb
        and (v_retry->>'cancelled_at')::timestamptz=v_cancelled_at, 'cancel_retry_never_resets_reused_jobs';
      execute v_state_sql into v_after using i_replacement;
      assert v_after=v_other_before, 'cancel_retry_preserves_replacement_paid_invoice_links_and_jobs';
      passed:=passed||jsonb_build_array('cancel_retry_never_resets_reused_jobs','cancel_retry_preserves_replacement_paid_invoice_links_and_jobs');
      execute 'reset role';
      update public.company_members set is_active=false where company_id=c_a and profile_id=p_admin;
      execute 'set local role authenticated';
      foreach v_action in array array['paid','cancelled'] loop
        v_error:=null; v_message:=null;
        begin
          if v_action='paid' then perform public.mark_invoice_paid_atomic(c_a,i_replacement,v_revision);
          else perform public.cancel_invoice_atomic(c_a,i_main,v_old_revision); end if;
        exception when others then get stacked diagnostics v_error=returned_sqlstate,v_message=message_text; end;
        assert v_error='42501' and v_message='INVOICE_SETTLEMENT_FORBIDDEN', 'revoked_member_'||v_action||'_terminal_retry_denied';
        passed:=passed||jsonb_build_array('revoked_member_'||v_action||'_terminal_retry_denied');
      end loop;
      execute 'reset role';
      raise exception 'rollback scenario' using errcode='PT002';
    exception when sqlstate 'PT002' then null; end;

    execute 'reset role';
    raise exception 'rollback all synthetic invoice settlement fixtures' using errcode='PT001';
  exception when sqlstate 'PT001' then null; end;
  assert not exists(select 1 from auth.users where id=any(array[u_admin,u_worker,u_other])), 'auth_fixture_cleanup';
  assert not exists(select 1 from public.profiles where id=any(array[p_admin,p_worker,p_other])), 'profile_fixture_cleanup';
  assert not exists(select 1 from public.companies where id in(c_a,c_b)), 'company_fixture_cleanup';
  assert not exists(select 1 from public.invoices where id=any(v_invoices)), 'invoice_fixture_cleanup';
  assert not exists(select 1 from public.invoice_items where invoice_id=any(v_invoices)), 'item_fixture_cleanup';
  assert not exists(select 1 from public.invoice_jobs where invoice_id=any(v_invoices)), 'link_fixture_cleanup';
  assert not exists(select 1 from public.jobs where id in(j_a,j_b,j_draft)), 'job_fixture_cleanup';
  assert not exists(select 1 from public.pohoda_exports where id=v_export), 'export_fixture_cleanup';
  assert not exists(select 1 from private.company_test_module_grants where company_id in(c_a,c_b)), 'grant_fixture_cleanup';
  assert not exists(select 1 from private.invoice_module_rollouts where company_id in(c_a,c_b)), 'rollout_fixture_cleanup';
  perform set_config('diriqo.invoice_settlement_test_result',jsonb_build_object('passed',passed,
    'count',jsonb_array_length(passed),'fixtures','rolled_back','cleanup_assertions',10,
    'late_failure','second_sorted_job_business_conflict_after_header_and_first_job_write',
    'concurrency','not_tested_single_session','scope','new_atomic_settlement_RPC_paths')::text,true);
end;
$test$;
select current_setting('diriqo.invoice_settlement_test_result')::jsonb as result;
