-- Replace the application's independent invoice/job/link settlement writes with
-- one transaction. This is full-payment marking, not a bank/payment ledger, and
-- cancellation is not a credit note or a reversal of an exported/paid invoice.
-- Existing history/content guards, table grants, RLS and issue APIs are unchanged.
set local lock_timeout = '5s';

create function private.settle_invoice_atomic(
  target_company_id uuid, target_invoice_id uuid, expected_revision text, target_status text
)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_invoice public.invoices%rowtype;
  v_job public.jobs%rowtype;
  v_link record;
  v_items jsonb;
  v_job_ids uuid[] := '{}';
  v_job_id uuid;
  v_rows integer;
  v_at timestamptz;
begin
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_SETTLEMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision !~ '^[0-9a-f]{64}$'
    or target_status is null or target_status not in ('paid','cancelled') then
    raise exception 'INVOICE_SETTLEMENT_INPUT_INVALID' using errcode = '22023';
  end if;

  -- Same parent-first order as draft editing, issuing and deleting. Link/item
  -- triggers acquire this parent too; jobs below are acquired in UUID order.
  select * into v_invoice from public.invoices i
    where i.id = target_invoice_id and i.company_id = target_company_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_SETTLEMENT_FORBIDDEN' using errcode = '42501';
  end if;

  -- Existing product contract permits authorized historical settlement after
  -- expiry, including draft cancellation cleanup. No creation/first-issue or
  -- invoice.issue capability is granted by this function.
  -- A same-target retry is read-only, including the original timestamp. It is
  -- not a repair of legacy partial writes or independently changed job records.
  if v_invoice.status = target_status then
    if (target_status = 'paid' and (v_invoice.paid_at is null
          or v_invoice.issued_at is null or v_invoice.cancelled_at is not null
          or nullif(btrim(v_invoice.invoice_number),'') is null))
      or (target_status = 'cancelled' and (v_invoice.cancelled_at is null or v_invoice.paid_at is not null)) then
      raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
    end if;
    return jsonb_build_object('invoice_id',v_invoice.id,'status',target_status,'changed',false,
      'paid_at',v_invoice.paid_at,'cancelled_at',v_invoice.cancelled_at,'job_ids','[]'::jsonb);
  end if;

  if target_status = 'paid' then
    if v_invoice.status is null or v_invoice.status not in ('issued','sent','overdue')
      or v_invoice.issued_at is null or v_invoice.cancelled_at is not null or v_invoice.paid_at is not null
      or nullif(btrim(v_invoice.invoice_number),'') is null then
      raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
    end if;
  else
    if v_invoice.status = 'paid' or v_invoice.paid_at is not null then
      raise exception 'INVOICE_CANCEL_PAID' using errcode = '23514';
    end if;
    if v_invoice.status is null or v_invoice.status not in ('draft','issued','sent','overdue')
      or v_invoice.cancelled_at is not null
      or (v_invoice.status = 'draft' and v_invoice.issued_at is not null)
      or (v_invoice.status <> 'draft' and (v_invoice.issued_at is null
          or nullif(btrim(v_invoice.invoice_number),'') is null)) then
      raise exception 'INVOICE_INVALID_STATE' using errcode = '23514';
    end if;
    -- Any recorded export evidence needs the separate corrective-document flow.
    -- A failed/not_exported label must not hide an existing external document.
    if v_invoice.pohoda_export_status = 'exported' or v_invoice.pohoda_exported_at is not null
      or nullif(btrim(v_invoice.pohoda_external_id),'') is not null
      or exists (
        select 1 from public.pohoda_export_invoices ei
        left join public.pohoda_exports e on e.id = ei.export_id and e.company_id = ei.company_id
        where ei.invoice_id = v_invoice.id and ei.company_id = v_invoice.company_id
          and (ei.status = 'exported' or e.status = 'exported' or e.exported_at is not null)
      ) then
      raise exception 'INVOICE_CANCEL_EXPORTED' using errcode = '23514';
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order,x.created_at,x.id),'[]'::jsonb) into v_items
    from public.invoice_items x where x.invoice_id = v_invoice.id and x.company_id = v_invoice.company_id;
  if private.invoice_edit_revision(to_jsonb(v_invoice),v_items) <> expected_revision then
    raise exception 'INVOICE_SETTLEMENT_STALE' using errcode = '23514';
  end if;

  -- Read every visible active link for this parent, rather than filtering an
  -- inconsistent company/customer link out and silently reporting full success.
  for v_link in
    select ij.job_id,ij.company_id,ij.customer_id from public.invoice_jobs ij
    where ij.invoice_id = v_invoice.id and ij.is_active order by ij.job_id
  loop
    if v_link.company_id is distinct from v_invoice.company_id
      or v_link.customer_id is distinct from v_invoice.customer_id then
      raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514';
    end if;
    select * into v_job from public.jobs j where j.id = v_link.job_id
      and j.company_id = v_invoice.company_id and j.customer_id = v_invoice.customer_id for update;
    if not found then raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514'; end if;
    v_job_ids := array_append(v_job_ids,v_job.id);
  end loop;

  -- All jobs are locked before the links, matching issuance's parent -> jobs
  -- order. Concurrent new draft creation must wait for the same job rows.
  perform 1 from public.invoice_jobs ij where ij.invoice_id = v_invoice.id and ij.is_active
    order by ij.job_id for update;
  if auth.uid() is null or not public.is_company_admin(target_company_id) then
    raise exception 'INVOICE_SETTLEMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.invoice_jobs ij where ij.job_id = any(v_job_ids)
      and ij.is_active and ij.invoice_id <> v_invoice.id
  ) then
    raise exception 'INVOICE_LINK_CONFLICT' using errcode = '23514';
  end if;

  v_at := clock_timestamp();
  update public.invoices set status = target_status,
    paid_at = case when target_status = 'paid' then v_at else paid_at end,
    cancelled_at = case when target_status = 'cancelled' then v_at else cancelled_at end,
    updated_at = v_at
    where id = v_invoice.id and company_id = v_invoice.company_id and status = v_invoice.status;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'INVOICE_INVALID_STATE' using errcode = '23514'; end if;

  -- A draft has never projected invoice billing onto its jobs: cancellation only
  -- frees its links and preserves every existing job billing/payment field.
  if v_invoice.status <> 'draft' then
    foreach v_job_id in array v_job_ids loop
      select * into v_job from public.jobs j where j.id = v_job_id
        and j.company_id = v_invoice.company_id and j.customer_id = v_invoice.customer_id;
      if not found then raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514'; end if;
      -- Do not overwrite a separately recorded payment, a replacement invoice,
      -- or manual billing edits. This validation belongs to each job write; any
      -- later failure rolls back the header and all previously updated jobs.
      if v_job.billing_status is distinct from 'due'
        or v_job.invoiced_at is distinct from v_invoice.issued_at
        or v_job.due_date is distinct from v_invoice.due_date
        or coalesce(v_job.is_paid,false) or v_job.paid_at is not null then
        raise exception 'INVOICE_SETTLEMENT_JOB_CONFLICT' using errcode = '23514';
      end if;
      if target_status = 'paid' then
        update public.jobs set billing_status = 'paid',paid_at = v_at,is_paid = true
          where id = v_job_id and company_id = v_invoice.company_id and customer_id = v_invoice.customer_id;
      else
        update public.jobs set billing_status = 'waiting_for_invoice',invoiced_at = null,
          due_date = null,paid_at = null,is_paid = false
          where id = v_job_id and company_id = v_invoice.company_id and customer_id = v_invoice.customer_id;
      end if;
      get diagnostics v_rows = row_count;
      if v_rows <> 1 then raise exception 'INVOICE_SETTLEMENT_JOB_CONFLICT' using errcode = '23514'; end if;
    end loop;
  end if;

  if target_status = 'cancelled' then
    update public.invoice_jobs set is_active = false where invoice_id = v_invoice.id
      and company_id = v_invoice.company_id and customer_id = v_invoice.customer_id and is_active;
    get diagnostics v_rows = row_count;
    if v_rows <> cardinality(v_job_ids) then
      raise exception 'INVOICE_LINK_SCOPE_INVALID' using errcode = '23514';
    end if;
  end if;

  return jsonb_build_object('invoice_id',v_invoice.id,'status',target_status,'changed',true,
    'paid_at',case when target_status = 'paid' then v_at else v_invoice.paid_at end,
    'cancelled_at',case when target_status = 'cancelled' then v_at else v_invoice.cancelled_at end,
    'job_ids',to_jsonb(v_job_ids));
end;
$function$;
revoke all on function private.settle_invoice_atomic(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function private.settle_invoice_atomic(uuid,uuid,text,text) to authenticated;

create function public.mark_invoice_paid_atomic(target_company_id uuid,target_invoice_id uuid,expected_revision text)
returns jsonb language sql security invoker set search_path = '' as $function$
  select private.settle_invoice_atomic(target_company_id,target_invoice_id,expected_revision,'paid');
$function$;
revoke all on function public.mark_invoice_paid_atomic(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.mark_invoice_paid_atomic(uuid,uuid,text) to authenticated;

create function public.cancel_invoice_atomic(target_company_id uuid,target_invoice_id uuid,expected_revision text)
returns jsonb language sql security invoker set search_path = '' as $function$
  select private.settle_invoice_atomic(target_company_id,target_invoice_id,expected_revision,'cancelled');
$function$;
revoke all on function public.cancel_invoice_atomic(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.cancel_invoice_atomic(uuid,uuid,text) to authenticated;
