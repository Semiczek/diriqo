-- C08: append-only evidence of advance payments and their settlement.
-- No transfers, payroll deductions or historical financial backfill are performed.
set local lock_timeout = '5s';

-- Preserve legacy anytime values while accepting the canonical settings choices.
-- This is a validation extension only: no existing settings or money are changed.
alter table public.company_payroll_settings drop constraint if exists company_payroll_settings_advance_frequency_check;
alter table public.company_payroll_settings add constraint company_payroll_settings_advance_frequency_check
  check (advance_frequency is null or advance_frequency in ('anytime','per_shift','weekly','biweekly','monthly')) not valid;

alter table public.advance_requests
  add column revision bigint not null default 0,
  add column review_operation_id uuid,
  add column review_reason text,
  add column currency text;
alter table public.worker_advances
  add column operation_id uuid,
  add column recorded_by uuid references public.profiles(id) on delete restrict,
  add column currency text,
  add column payment_method text,
  add column payment_reference text;

-- Old records retain their original values; NULL operation_id means legacy evidence.
alter table public.advance_requests add constraint advance_request_money_check check (
  amount >= 0 and amount < 'Infinity'::numeric and amount = round(amount,2)
  and (requested_amount is null or (requested_amount > 0 and requested_amount < 'Infinity'::numeric
    and requested_amount = round(requested_amount,2))) and revision >= 0
  and status in ('pending','approved','rejected','paid')
  and (currency is null or currency ~ '^[A-Z]{3}$')) not valid;
alter table public.worker_advances add constraint worker_advance_money_check check (
  amount > 0 and amount < 'Infinity'::numeric and amount = round(amount,2)) not valid;
alter table public.worker_advances add constraint worker_advance_operation_check check (
  operation_id is null or (recorded_by is not null and currency is not null and currency ~ '^[A-Z]{3}$'
    and payment_method is not null and payment_method in ('cash','bank_transfer') and issued_at is not null and isfinite(issued_at)
    and payroll_month is not null and extract(day from payroll_month)=1 and isfinite(paid_at)
    and (payment_method <> 'bank_transfer' or nullif(btrim(payment_reference),'') is not null))) not valid;
alter table public.worker_advances drop constraint if exists worker_advances_advance_request_id_key;
drop index if exists public.worker_advances_advance_request_id_uidx;
create index worker_advances_request_idx on public.worker_advances(advance_request_id) where advance_request_id is not null;
create unique index worker_advances_operation_uidx on public.worker_advances(company_id,operation_id) where operation_id is not null;
create unique index advance_requests_review_operation_uidx on public.advance_requests(company_id,review_operation_id) where review_operation_id is not null;
create index worker_advances_worker_month_idx on public.worker_advances(company_id,profile_id,payroll_month);

create table public.worker_advance_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  worker_advance_id uuid not null references public.worker_advances(id) on delete restrict,
  operation_id uuid not null,
  amount numeric(12,2) not null check (amount > 0 and amount < 'Infinity'::numeric),
  method text not null check (method in ('returned','payroll_offset')),
  reference text not null check (length(btrim(reference)) between 1 and 500),
  settled_on date not null check (isfinite(settled_on)),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(company_id,operation_id)
);
create index worker_advance_settlements_payment_idx on public.worker_advance_settlements(worker_advance_id);
create index worker_advance_settlements_worker_idx on public.worker_advance_settlements(company_id,profile_id);
alter table public.advance_requests enable row level security;
alter table public.worker_advances enable row level security;
alter table public.worker_advance_settlements enable row level security;

-- The only elevated write boundary is these narrow, tenant-authorized functions.
-- Public wrappers remain invokers. No client-settable GUC or trigger-depth bypass.
create function private.advance_actor(target_company_id uuid, require_admin boolean)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid;
begin
  if auth.uid() is null then raise exception 'ADVANCE_FORBIDDEN' using errcode='42501'; end if;
  select p.id into v_actor from public.company_members cm join public.profiles p on p.id=cm.profile_id
  where cm.company_id=target_company_id and cm.is_active and p.is_active and p.auth_user_id=auth.uid()
    and (not require_admin or cm.role in ('company_admin','super_admin'));
  if v_actor is null then raise exception 'ADVANCE_FORBIDDEN' using errcode='42501'; end if;
  return v_actor;
end;
$f$;
revoke all on function private.advance_actor(uuid,boolean) from public,anon,authenticated,service_role;

create function private.can_read_worker_advance(target_company_id uuid,target_profile_id uuid)
returns boolean language sql stable security definer set search_path='' as $f$
  select auth.uid() is not null and exists (
    select 1 from public.company_members cm join public.profiles p on p.id=cm.profile_id
    where cm.company_id=target_company_id and cm.is_active and p.is_active and p.auth_user_id=auth.uid()
      and (cm.role in ('company_admin','super_admin') or p.id=target_profile_id));
$f$;
revoke all on function private.can_read_worker_advance(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_read_worker_advance(uuid,uuid) to authenticated;

do $permissions$
declare t text; r record; cols text;
begin
  foreach t in array array['advance_requests','worker_advances','worker_advance_settlements'] loop
    for r in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',r.policyname,t);
    end loop;
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
    select string_agg(quote_ident(column_name),',') into cols from information_schema.columns
      where table_schema='public' and table_name=t;
    execute format('revoke all (%s) on table public.%I from public,anon,authenticated,service_role',cols,t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy advance_read_authorized on public.%I for select to authenticated using (private.can_read_worker_advance(company_id,profile_id))',t);
  end loop;
end;
$permissions$;

create function private.guard_advance_history()
returns trigger language plpgsql security invoker set search_path='' as $f$
begin
  raise exception 'ADVANCE_HISTORY_IMMUTABLE' using errcode='23514';
end;
$f$;
revoke all on function private.guard_advance_history() from public,anon,authenticated,service_role;
create trigger worker_advance_history before update or delete on public.worker_advances
  for each row execute function private.guard_advance_history();
create trigger worker_advance_no_truncate before truncate on public.worker_advances
  for each statement execute function private.guard_advance_history();
create trigger worker_advance_settlement_history before update or delete on public.worker_advance_settlements
  for each row execute function private.guard_advance_history();
create trigger worker_advance_settlement_no_truncate before truncate on public.worker_advance_settlements
  for each statement execute function private.guard_advance_history();
create trigger advance_request_no_truncate before truncate on public.advance_requests
  for each statement execute function private.guard_advance_history();

create function private.guard_advance_request_identity()
returns trigger language plpgsql security invoker set search_path='' as $f$
begin
  if tg_op='DELETE' then
    raise exception 'ADVANCE_HISTORY_IMMUTABLE' using errcode='23514';
  end if;
  if row(new.id,new.company_id,new.profile_id,new.requested_amount,new.requested_at,new.created_at,
    new.requested_for_month,new.reason,new.note,new.currency) is distinct from
    row(old.id,old.company_id,old.profile_id,old.requested_amount,old.requested_at,old.created_at,
    old.requested_for_month,old.reason,old.note,old.currency)
    or old.status in ('paid','rejected')
    or (old.status <> 'pending' and row(new.amount,new.approved_at,new.approved_by,new.reviewed_at,
      new.reviewed_by,new.review_operation_id,new.review_reason,new.rejected_at) is distinct from
      row(old.amount,old.approved_at,old.approved_by,old.reviewed_at,old.reviewed_by,
        old.review_operation_id,old.review_reason,old.rejected_at)) then
    raise exception 'ADVANCE_HISTORY_IMMUTABLE' using errcode='23514';
  end if;
  return new;
end;
$f$;
revoke all on function private.guard_advance_request_identity() from public,anon,authenticated,service_role;
create trigger advance_request_identity before update or delete on public.advance_requests
  for each row execute function private.guard_advance_request_identity();

create function private.advance_request_result(target_request_id uuid,changed boolean)
returns jsonb language sql stable security definer set search_path='' as $f$
  select jsonb_build_object('request',to_jsonb(r),'paid_total',coalesce(p.paid,0),
    'remaining_amount',case when r.status in ('approved','paid') then greatest(0,r.amount-coalesce(p.paid,0)) else 0 end,
    'settled_total',coalesce(s.settled,0),'outstanding_amount',coalesce(p.paid,0)-coalesce(s.settled,0),'changed',changed)
  from public.advance_requests r
  cross join lateral (select sum(w.amount) paid from public.worker_advances w where w.advance_request_id=r.id and w.company_id=r.company_id) p
  cross join lateral (select sum(x.amount) settled from public.worker_advance_settlements x
    join public.worker_advances w on w.id=x.worker_advance_id where w.advance_request_id=r.id and w.company_id=r.company_id) s
  where r.id=target_request_id;
$f$;
revoke all on function private.advance_request_result(uuid,boolean) from public,anon,authenticated,service_role;

-- Newly recorded payments belong to their calendar month, independently of the
-- configurable payday. Existing stored payroll_month values are never rewritten.
create function private.advance_payroll_month(issued_on date)
returns date language sql immutable security invoker set search_path='' as $f$
  select date_trunc('month',issued_on::timestamp)::date;
$f$;
revoke all on function private.advance_payroll_month(date) from public,anon,authenticated,service_role;

-- This resolver is the single policy used by request and payout writes. All
-- worker overrides are company-scoped. A NULL override inherits the canonical
-- company value; NULL company amount means no amount limit. Legacy profile and
-- company alias fields must not override explicit canonical false/NULL values.
create function private.advance_settings(target_company_id uuid,target_profile_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare
  v_company public.company_payroll_settings%rowtype;
  v_worker public.worker_payment_settings%rowtype;
  v_enabled boolean:=true; v_limit numeric; v_limit_type text:='monthly_amount';
begin
  select * into v_company from public.company_payroll_settings s where s.company_id=target_company_id for share;
  if found then
    v_enabled:=v_company.advances_enabled;
    v_limit:=v_company.advance_limit_amount;
    v_limit_type:=v_company.advance_limit_type;
  end if;
  select * into v_worker from public.worker_payment_settings s
    where s.company_id=target_company_id and s.profile_id=target_profile_id and s.is_active for share;
  if found then
    if v_worker.advances_enabled_override is not null then v_enabled:=v_worker.advances_enabled_override; end if;
    if v_worker.advance_limit_amount_override is not null then
      v_limit:=v_worker.advance_limit_amount_override;
      v_limit_type:='monthly_amount';
    end if;
  end if;
  return jsonb_build_object('enabled',v_enabled,'limit_amount',v_limit,'limit_type',v_limit_type);
end;
$f$;
revoke all on function private.advance_settings(uuid,uuid) from public,anon,authenticated,service_role;

create function private.request_advance_atomic(target_company_id uuid,target_request_id uuid,
  requested_amount numeric,request_reason text,requested_for_month date)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_actor uuid; v_existing public.advance_requests%rowtype; v_now timestamptz; v_reason text:=nullif(btrim(request_reason),''); v_access jsonb; v_currency text; v_policy jsonb;
begin
  v_actor:=private.advance_actor(target_company_id,false);
  if target_request_id is null or requested_amount is null or requested_amount<=0 or requested_amount>9999999999.99
    or requested_amount='NaN'::numeric or requested_amount<>round(requested_amount,2)
    or length(coalesce(v_reason,''))>2000
    or (requested_for_month is not null and (not isfinite(requested_for_month) or extract(day from requested_for_month)<>1)) then
    raise exception 'ADVANCE_INVALID' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('advance-request:'||target_request_id,0));
  v_actor:=private.advance_actor(target_company_id,false);
  select * into v_existing from public.advance_requests r where r.id=target_request_id;
  if found then
    if v_existing.company_id<>target_company_id or v_existing.profile_id<>v_actor
      or v_existing.requested_amount is distinct from requested_amount or v_existing.reason is distinct from v_reason
      or v_existing.requested_for_month is distinct from requested_for_month then
      raise exception 'ADVANCE_OPERATION_CONFLICT' using errcode='23505';
    end if;
    return private.advance_request_result(target_request_id,false);
  end if;
  v_access:=private.evaluate_company_capability_access(target_company_id,'core.advances.request',clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then raise exception 'ADVANCE_MODULE_REQUIRED' using errcode='42501'; end if;
  v_policy:=private.advance_settings(target_company_id,v_actor);
  if (v_policy->>'enabled')::boolean is distinct from true then
    raise exception 'ADVANCES_DISABLED' using errcode='23514';
  end if;
  select coalesce(nullif(c.default_currency,''),nullif(c.currency,'')) into v_currency
    from public.companies c where c.id=target_company_id for share;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then raise exception 'ADVANCE_SETTINGS_INVALID' using errcode='23514'; end if;
  -- Settings/company locks may have waited past a revocation or grant expiry.
  -- Keep the policy's original worker identity and revalidate at write time.
  if private.advance_actor(target_company_id,false) is distinct from v_actor then
    raise exception 'ADVANCE_FORBIDDEN' using errcode='42501';
  end if;
  v_access:=private.evaluate_company_capability_access(target_company_id,'core.advances.request',clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then raise exception 'ADVANCE_MODULE_REQUIRED' using errcode='42501'; end if;
  if private.advance_actor(target_company_id,false) is distinct from v_actor then
    raise exception 'ADVANCE_FORBIDDEN' using errcode='42501';
  end if;
  v_now:=clock_timestamp();
  insert into public.advance_requests(id,company_id,profile_id,requested_amount,amount,status,reason,
    requested_for_month,requested_at,created_at,updated_at,currency)
  values(target_request_id,target_company_id,v_actor,requested_amount,0,'pending',v_reason,
    requested_for_month,v_now,v_now,v_now,v_currency);
  return private.advance_request_result(target_request_id,true);
end;
$f$;

create function private.review_advance_request_atomic(target_company_id uuid,target_request_id uuid,
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
  if v_request.revision<>expected_revision then raise exception 'ADVANCE_STALE' using errcode='40001'; end if;
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

create function private.pay_worker_advance_atomic(target_company_id uuid,target_profile_id uuid,target_request_id uuid,
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
      if expected_revision is null or expected_revision<>v_request.revision then raise exception 'ADVANCE_STALE' using errcode='40001'; end if;
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
    v_actor:=private.advance_actor(target_company_id,true);
    if not exists(select 1 from public.company_members cm where cm.company_id=target_company_id
      and cm.profile_id=target_profile_id and cm.is_active) then raise exception 'ADVANCE_WORKER_UNAVAILABLE' using errcode='23514'; end if;
    v_access:=private.evaluate_company_capability_access(target_company_id,'core.advances.pay',clock_timestamp());
    if not coalesce((v_access->>'allowed')::boolean,false) then raise exception 'ADVANCE_MODULE_REQUIRED' using errcode='42501'; end if;
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

create function private.settle_worker_advance_atomic(target_company_id uuid,target_payment_id uuid,operation_id uuid,
  settlement_amount numeric,settlement_method text,settlement_reference text,settled_on date)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_actor uuid; v_payment public.worker_advances%rowtype; v_settlement public.worker_advance_settlements%rowtype;
  v_reference text:=nullif(btrim(settlement_reference),''); v_settled numeric; v_timezone text; v_changed boolean:=false;
begin
  v_actor:=private.advance_actor(target_company_id,true);
  if operation_id is null or settlement_amount is null or settlement_amount<=0 or settlement_amount>9999999999.99
    or settlement_amount='NaN'::numeric or settlement_amount<>round(settlement_amount,2)
    or settlement_method is null or settlement_method not in ('returned','payroll_offset') or v_reference is null
    or length(v_reference)>500 or settled_on is null or not isfinite(settled_on) then
    raise exception 'ADVANCE_INVALID' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('advance-settlement:'||target_company_id||':'||operation_id,0));
  select * into v_payment from public.worker_advances w where w.id=target_payment_id and w.company_id=target_company_id;
  if not found then raise exception 'ADVANCE_NOT_FOUND' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('advance-worker:'||target_company_id||':'||v_payment.profile_id,0));
  select * into v_payment from public.worker_advances w where w.id=target_payment_id and w.company_id=target_company_id for update;
  v_actor:=private.advance_actor(target_company_id,true);
  select * into v_settlement from public.worker_advance_settlements s where s.company_id=target_company_id and s.operation_id=settle_worker_advance_atomic.operation_id;
  if found then
    if v_settlement.worker_advance_id<>target_payment_id or v_settlement.amount<>settlement_amount
      or v_settlement.method<>settlement_method or v_settlement.reference<>v_reference or v_settlement.settled_on<>settled_on then
      raise exception 'ADVANCE_OPERATION_CONFLICT' using errcode='23505';
    end if;
  else
    -- Settlement is evidence for an existing payment, so expiry and worker
    -- deactivation cannot strand history. The recording administrator must be active.
    if v_payment.operation_id is null or v_payment.currency is null then
      raise exception 'ADVANCE_LEGACY_RECONCILIATION_REQUIRED' using errcode='23514';
    end if;
    select coalesce(nullif(c.timezone,''),'Europe/Prague') into v_timezone from public.companies c where c.id=target_company_id;
    if not exists(select 1 from pg_timezone_names t where t.name=v_timezone) then raise exception 'ADVANCE_SETTINGS_INVALID' using errcode='23514'; end if;
    if settled_on<v_payment.issued_at or settled_on>(clock_timestamp() at time zone v_timezone)::date then
      raise exception 'ADVANCE_INVALID_DATE' using errcode='22023';
    end if;
    select coalesce(sum(s.amount),0) into v_settled from public.worker_advance_settlements s where s.worker_advance_id=target_payment_id;
    if v_settled+settlement_amount>v_payment.amount then raise exception 'ADVANCE_SETTLEMENT_EXCEEDED' using errcode='23514'; end if;
    insert into public.worker_advance_settlements(company_id,profile_id,worker_advance_id,operation_id,amount,
      method,reference,settled_on,currency,recorded_by)
    values(target_company_id,v_payment.profile_id,target_payment_id,operation_id,settlement_amount,
      settlement_method,v_reference,settled_on,v_payment.currency,v_actor) returning * into v_settlement;
    v_changed:=true;
  end if;
  select coalesce(sum(s.amount),0) into v_settled from public.worker_advance_settlements s where s.worker_advance_id=target_payment_id;
  return jsonb_build_object('payment',to_jsonb(v_payment),'settlement',to_jsonb(v_settlement),
    'settled_total',v_settled,'outstanding_amount',v_payment.amount-v_settled,'changed',v_changed);
end;
$f$;

revoke all on function private.request_advance_atomic(uuid,uuid,numeric,text,date),
  private.review_advance_request_atomic(uuid,uuid,bigint,text,numeric,uuid,text),
  private.pay_worker_advance_atomic(uuid,uuid,uuid,uuid,numeric,date,text,bigint,text,text),
  private.settle_worker_advance_atomic(uuid,uuid,uuid,numeric,text,text,date) from public,anon,authenticated,service_role;
grant execute on function private.request_advance_atomic(uuid,uuid,numeric,text,date),
  private.review_advance_request_atomic(uuid,uuid,bigint,text,numeric,uuid,text),
  private.pay_worker_advance_atomic(uuid,uuid,uuid,uuid,numeric,date,text,bigint,text,text),
  private.settle_worker_advance_atomic(uuid,uuid,uuid,numeric,text,text,date) to authenticated;

create function public.request_advance_atomic(target_company_id uuid,target_request_id uuid,
  requested_amount numeric,request_reason text default null,requested_for_month date default null)
returns jsonb language sql security invoker set search_path='' as $f$
  select private.request_advance_atomic(target_company_id,target_request_id,requested_amount,request_reason,requested_for_month);
$f$;
create function public.review_advance_request_atomic(target_company_id uuid,target_request_id uuid,
  expected_revision bigint,target_status text,approved_amount numeric,operation_id uuid,review_reason text default null)
returns jsonb language sql security invoker set search_path='' as $f$
  select private.review_advance_request_atomic(target_company_id,target_request_id,expected_revision,target_status,approved_amount,operation_id,review_reason);
$f$;
create function public.pay_worker_advance_atomic(target_company_id uuid,target_profile_id uuid,target_request_id uuid,
  operation_id uuid,payment_amount numeric,issued_on date,payment_note text default null,expected_revision bigint default null,
  payment_method text default 'cash',payment_reference text default null)
returns jsonb language sql security invoker set search_path='' as $f$
  select private.pay_worker_advance_atomic(target_company_id,target_profile_id,target_request_id,operation_id,payment_amount,issued_on,
    payment_note,expected_revision,payment_method,payment_reference);
$f$;
create function public.settle_worker_advance_atomic(target_company_id uuid,target_payment_id uuid,operation_id uuid,
  settlement_amount numeric,settlement_method text,settlement_reference text,settled_on date)
returns jsonb language sql security invoker set search_path='' as $f$
  select private.settle_worker_advance_atomic(target_company_id,target_payment_id,operation_id,settlement_amount,settlement_method,settlement_reference,settled_on);
$f$;
revoke all on function public.request_advance_atomic(uuid,uuid,numeric,text,date),
  public.review_advance_request_atomic(uuid,uuid,bigint,text,numeric,uuid,text),
  public.pay_worker_advance_atomic(uuid,uuid,uuid,uuid,numeric,date,text,bigint,text,text),
  public.settle_worker_advance_atomic(uuid,uuid,uuid,numeric,text,text,date) from public,anon,authenticated,service_role;
grant execute on function public.request_advance_atomic(uuid,uuid,numeric,text,date),
  public.review_advance_request_atomic(uuid,uuid,bigint,text,numeric,uuid,text),
  public.pay_worker_advance_atomic(uuid,uuid,uuid,uuid,numeric,date,text,bigint,text,text),
  public.settle_worker_advance_atomic(uuid,uuid,uuid,numeric,text,text,date) to authenticated;
