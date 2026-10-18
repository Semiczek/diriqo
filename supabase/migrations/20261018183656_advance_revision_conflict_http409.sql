-- Forward-only fix for applied C08 business revision conflicts.
-- PostgREST/Hasql may retry SQLSTATE 40001 as a serialization failure; a stale
-- revision is a final business conflict and must return HTTP 409 immediately.
-- Only the two ADVANCE_STALE SQLSTATE values change. Signatures, authorization,
-- locks, idempotency, function ownership and existing EXECUTE ACLs are preserved.

create or replace function private.review_advance_request_atomic(target_company_id uuid,target_request_id uuid,
  expected_revision bigint,target_status text,approved_amount numeric,operation_id uuid,review_reason text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_actor uuid; v_request public.advance_requests%rowtype; v_other uuid; v_reason text:=nullif(btrim(review_reason),''); v_now timestamptz;
begin
  v_actor:=private.advance_actor(target_company_id,true);
  if operation_id is null or expected_revision is null or target_status not in ('approved','rejected') or target_status is null
    or approved_amount is null or approved_amount<0 or approved_amount>9999999999.99 or approved_amount='NaN'::numeric
    or approved_amount<>round(approved_amount,2) or (target_status='approved' and approved_amount<=0)
    or (target_status='rejected' and approved_amount<>0) or length(coalesce(v_reason,''))>2000 then
    raise exception 'ADVANCE_INVALID' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('advance-review:'||target_company_id||':'||operation_id,0));
  select id into v_other from public.advance_requests r where r.company_id=target_company_id and r.review_operation_id=operation_id;
  if found and v_other<>target_request_id then raise exception 'ADVANCE_OPERATION_CONFLICT' using errcode='23505'; end if;
  select * into v_request from public.advance_requests r where r.id=target_request_id and r.company_id=target_company_id;
  if not found then raise exception 'ADVANCE_NOT_FOUND' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('advance-worker:'||target_company_id||':'||v_request.profile_id,0));
  select * into v_request from public.advance_requests r where r.id=target_request_id and r.company_id=target_company_id for update;
  v_actor:=private.advance_actor(target_company_id,true);
  if v_request.review_operation_id=operation_id then
    if (case when v_request.status='paid' then 'approved' else v_request.status end)<>target_status
      or v_request.amount<>approved_amount or v_request.review_reason is distinct from v_reason then
      raise exception 'ADVANCE_OPERATION_CONFLICT' using errcode='23505';
    end if;
    return private.advance_request_result(target_request_id,false);
  end if;
  if v_request.revision<>expected_revision then raise exception 'ADVANCE_STALE' using errcode='PT409'; end if;
  if v_request.status<>'pending' then raise exception 'ADVANCE_INVALID_STATE' using errcode='23514'; end if;
  if not exists(select 1 from public.company_members cm join public.profiles p on p.id=cm.profile_id
    where cm.company_id=target_company_id and cm.profile_id=v_request.profile_id and cm.is_active and p.is_active) then
    raise exception 'ADVANCE_WORKER_UNAVAILABLE' using errcode='23514';
  end if;
  if target_status='approved' and v_request.requested_amount is null then
    raise exception 'ADVANCE_LEGACY_RECONCILIATION_REQUIRED' using errcode='23514';
  end if;
  if target_status='approved' and approved_amount<>v_request.requested_amount and v_reason is null then
    raise exception 'ADVANCE_REVIEW_REASON_REQUIRED' using errcode='22023';
  end if;
  v_now:=clock_timestamp();
  update public.advance_requests set status=target_status,amount=approved_amount,review_operation_id=operation_id,
    review_reason=v_reason,reviewed_by=v_actor,reviewed_at=v_now,updated_at=v_now,revision=revision+1,
    approved_by=case when target_status='approved' then v_actor else null end,
    approved_at=case when target_status='approved' then v_now else null end,
    rejected_at=case when target_status='rejected' then v_now else null end
  where id=target_request_id and company_id=target_company_id;
  return private.advance_request_result(target_request_id,true);
end;
$f$;


create or replace function private.pay_worker_advance_atomic(target_company_id uuid,target_profile_id uuid,target_request_id uuid,
  operation_id uuid,payment_amount numeric,issued_on date,payment_note text,expected_revision bigint,
  payment_method text,payment_reference text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare
  v_actor uuid; v_payment public.worker_advances%rowtype; v_request public.advance_requests%rowtype;
  v_profile public.profiles%rowtype; v_policy jsonb;
  v_note text:=nullif(btrim(payment_note),''); v_reference text:=nullif(btrim(payment_reference),'');
  v_timezone text; v_currency text; v_month date; v_now timestamptz; v_limit numeric;
  v_paid numeric; v_month_paid numeric; v_access jsonb; v_changed boolean:=false; v_result jsonb;
begin
  v_actor:=private.advance_actor(target_company_id,true);
  if target_profile_id is null or operation_id is null or payment_amount is null or payment_amount<=0
    or payment_amount>9999999999.99 or payment_amount='NaN'::numeric or payment_amount<>round(payment_amount,2)
    or issued_on is null or not isfinite(issued_on) or length(coalesce(v_note,''))>2000
    or payment_method is null or payment_method not in ('cash','bank_transfer') or length(coalesce(v_reference,''))>500
    or (payment_method='bank_transfer' and v_reference is null) then
    raise exception 'ADVANCE_INVALID' using errcode='22023';
  end if;
  -- Operation lock prevents same key with different workers from racing into UNIQUE.
  -- Worker lock serializes every request and manual payout against the shared limit.
  perform pg_advisory_xact_lock(hashtextextended('advance-payment:'||target_company_id||':'||operation_id,0));
  perform pg_advisory_xact_lock(hashtextextended('advance-worker:'||target_company_id||':'||target_profile_id,0));
  v_actor:=private.advance_actor(target_company_id,true);
  select * into v_payment from public.worker_advances w where w.company_id=target_company_id and w.operation_id=pay_worker_advance_atomic.operation_id;
  if found then
    if v_payment.profile_id<>target_profile_id or v_payment.advance_request_id is distinct from target_request_id
      or v_payment.amount<>payment_amount or v_payment.issued_at<>issued_on or v_payment.note is distinct from v_note
      or v_payment.payment_method<>payment_method or v_payment.payment_reference is distinct from v_reference then
      raise exception 'ADVANCE_OPERATION_CONFLICT' using errcode='23505';
    end if;
  else
    if not exists(select 1 from public.company_members cm where cm.company_id=target_company_id
      and cm.profile_id=target_profile_id and cm.is_active) then
      raise exception 'ADVANCE_WORKER_UNAVAILABLE' using errcode='23514';
    end if;
    select * into v_profile from public.profiles p where p.id=target_profile_id and p.is_active for share;
    if not found then raise exception 'ADVANCE_WORKER_UNAVAILABLE' using errcode='23514'; end if;
    if target_request_id is not null then
      select * into v_request from public.advance_requests r where r.id=target_request_id and r.company_id=target_company_id for update;
      if not found or v_request.profile_id<>target_profile_id then raise exception 'ADVANCE_NOT_FOUND' using errcode='P0002'; end if;
      if expected_revision is null or expected_revision<>v_request.revision then raise exception 'ADVANCE_STALE' using errcode='PT409'; end if;
      if v_request.status<>'approved' then raise exception 'ADVANCE_INVALID_STATE' using errcode='23514'; end if;
      select coalesce(sum(w.amount),0) into v_paid from public.worker_advances w where w.company_id=target_company_id and w.advance_request_id=target_request_id;
      if v_paid+payment_amount>v_request.amount then raise exception 'ADVANCE_BALANCE_EXCEEDED' using errcode='23514'; end if;
    end if;
    v_policy:=private.advance_settings(target_company_id,target_profile_id);
    if (v_policy->>'enabled')::boolean is distinct from true then
      raise exception 'ADVANCES_DISABLED' using errcode='23514';
    end if;
    -- Percentage-based earned wages are not implemented by the existing payroll
    -- calculation. Fail closed instead of pretending an amount limit covers them.
    if v_policy->>'limit_type'='percent_of_earned' then
      raise exception 'ADVANCE_SETTINGS_UNSUPPORTED' using errcode='23514';
    end if;
    if v_policy->>'limit_type' is distinct from 'monthly_amount' then
      raise exception 'ADVANCE_SETTINGS_INVALID' using errcode='23514';
    end if;
    v_limit:=(v_policy->>'limit_amount')::numeric;
    if v_limit is not null and (v_limit<0 or v_limit>9999999999.99 or v_limit='NaN'::numeric) then
      raise exception 'ADVANCE_SETTINGS_INVALID' using errcode='23514';
    end if;
    select coalesce(nullif(c.timezone,''),'Europe/Prague'),coalesce(nullif(c.default_currency,''),nullif(c.currency,''))
      into v_timezone,v_currency from public.companies c where c.id=target_company_id for share;
    if not exists(select 1 from pg_timezone_names t where t.name=v_timezone) or v_currency is null or v_currency !~ '^[A-Z]{3}$' then
      raise exception 'ADVANCE_SETTINGS_INVALID' using errcode='23514';
    end if;
    if target_request_id is not null and v_request.currency is distinct from v_currency then
      raise exception 'ADVANCE_CURRENCY_CONFLICT' using errcode='23514';
    end if;
    v_now:=clock_timestamp();
    if issued_on>(v_now at time zone v_timezone)::date then raise exception 'ADVANCE_INVALID_DATE' using errcode='22023'; end if;
    v_month:=private.advance_payroll_month(issued_on);
    if exists(select 1 from public.worker_advances w where w.company_id=target_company_id and w.profile_id=target_profile_id
      and (w.payroll_month is null or not isfinite(w.payroll_month) or extract(day from w.payroll_month)<>1)) then
      raise exception 'ADVANCE_LEGACY_RECONCILIATION_REQUIRED' using errcode='23514';
    end if;
    if exists(select 1 from public.worker_advances w where w.company_id=target_company_id and w.profile_id=target_profile_id
      and w.payroll_month=v_month
      and w.currency is distinct from v_currency) then
      raise exception 'ADVANCE_CURRENCY_CONFLICT' using errcode='23514';
    end if;
    select coalesce(sum(w.amount),0) into v_month_paid from public.worker_advances w
      where w.company_id=target_company_id and w.profile_id=target_profile_id
        and w.payroll_month=v_month;
    if v_limit is not null and v_month_paid+payment_amount>v_limit then raise exception 'ADVANCE_LIMIT_EXCEEDED' using errcode='23514'; end if;
    perform private.assert_advance_capability(target_company_id,'core.advances.pay');
    -- No authorization call below this point acquires a blocking row/advisory
    -- lock. Both actors must still be valid after every licence/settings wait.
    v_actor:=private.advance_actor(target_company_id,true);
    if not exists(select 1 from public.company_members cm join public.profiles p on p.id=cm.profile_id
      where cm.company_id=target_company_id and cm.profile_id=target_profile_id and cm.is_active and p.is_active) then
      raise exception 'ADVANCE_WORKER_UNAVAILABLE' using errcode='23514';
    end if;
    v_now:=clock_timestamp();
    insert into public.worker_advances(company_id,profile_id,advance_request_id,operation_id,amount,
      issued_at,payroll_month,paid_at,note,recorded_by,currency,payment_method,payment_reference,created_at,updated_at)
    values(target_company_id,target_profile_id,target_request_id,operation_id,payment_amount,issued_on,v_month,
      v_now,v_note,v_actor,v_currency,payment_method,v_reference,v_now,v_now) returning * into v_payment;
    if target_request_id is not null then
      update public.advance_requests set status=case when v_paid+payment_amount=amount then 'paid' else 'approved' end,
        paid_at=case when v_paid+payment_amount=amount then v_now else null end,
        updated_at=v_now,revision=revision+1
      where id=target_request_id and company_id=target_company_id;
    end if;
    v_changed:=true;
  end if;
  if target_request_id is not null then v_result:=private.advance_request_result(target_request_id,v_changed);
  else
    select jsonb_build_object('request',null,'paid_total',v_payment.amount,'remaining_amount',0,
      'settled_total',coalesce(sum(s.amount),0),'outstanding_amount',v_payment.amount-coalesce(sum(s.amount),0),'changed',v_changed)
    into v_result from public.worker_advance_settlements s where s.worker_advance_id=v_payment.id;
  end if;
  return v_result||jsonb_build_object('payment',to_jsonb(v_payment));
end;
$f$;

