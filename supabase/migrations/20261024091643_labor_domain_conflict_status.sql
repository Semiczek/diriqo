-- Deterministic labor domain conflicts use PostgREST's explicit HTTP 409 status.
-- SQLSTATE 40001 is reserved for genuine serialization failures, not stale user input.
-- https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes
-- Preserve the applied foundation, function identities/ACLs, SECURITY DEFINER and empty search_path.
-- These exact replacements change only eight explicit domain error SQLSTATEs; no data is rewritten.

create or replace function private.labor_sources_validate(c uuid,sid uuid) returns void language plpgsql security definer set search_path='' as $f$
declare s public.labor_submissions%rowtype; x record; d jsonb;
begin
 select * into s from public.labor_submissions where id=sid and company_id=c;
 for x in select * from public.labor_submission_sources where submission_id=sid order by source_kind,source_id loop
  d:=private.labor_source_document(c,s.profile_id,s.job_id,x.source_kind,x.source_id);
  if encode(sha256(convert_to(d::text,'UTF8')),'hex')<>x.source_hash then raise exception 'LABOR_SOURCE_CHANGED' using errcode='PT409';end if;
  if x.source_kind='assignment' and (exists(select 1 from public.work_shifts where company_id=c and profile_id=s.profile_id and job_id=s.job_id)
   or exists(select 1 from public.work_logs where company_id=c and profile_id=s.profile_id and job_id=s.job_id and archived_at is null)) then
    raise exception 'LABOR_SOURCE_CONFLICT' using errcode='23514';end if;
  if x.source_kind<>'assignment' and exists(select 1 from public.labor_submission_sources y join public.labor_submissions z on z.id=y.submission_id
   where y.company_id=c and y.source_kind='assignment' and z.profile_id=s.profile_id and z.job_id=s.job_id and z.id<>sid) then
    raise exception 'LABOR_SOURCE_CONFLICT' using errcode='23514';end if;
  if x.source_kind='log' and d->>'shift_id' is not null and exists(select 1 from public.labor_submission_sources y
   where y.company_id=c and y.source_kind='shift' and y.source_id=(d->>'shift_id')::uuid and y.submission_id<>sid) then
    raise exception 'LABOR_SOURCE_CONFLICT' using errcode='23514';end if;
  if x.source_kind='shift' and exists(select 1 from public.labor_submission_sources y join public.work_logs w on w.id=y.source_id
   where y.company_id=c and y.source_kind='log' and w.shift_id=x.source_id and y.submission_id<>sid) then
    raise exception 'LABOR_SOURCE_CONFLICT' using errcode='23514';end if;
 end loop;
end $f$;

create or replace function private.labor_mutate(c uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
<<mutation>>
declare a uuid; worker uuid; job uuid; sid uuid; vid uuid; operation_id uuid; expected bigint; request_hash text; old_receipt private.labor_operation_receipts%rowtype;
 schedule public.company_worker_rate_schedules%rowtype; rate public.company_worker_rate_versions%rowtype;
 s public.labor_submissions%rowtype; v public.labor_submission_versions%rowtype;
 result jsonb; item jsonb; d jsonb; preview jsonb; currency_value text; zone text; revision_of uuid; amount_value numeric; n integer:=0;
 started timestamptz; ended timestamptz; day_value date; actual numeric; pay numeric; bill numeric; source_kind text; source_id uuid;
begin
 if op not in ('rate','save','submit','review') or jsonb_typeof(p)<>'object' then raise exception 'LABOR_INVALID' using errcode='22023';end if;
 a:=private.labor_actor(c,case when op='rate' then 'finance' when op='review' then 'review' else 'member' end);
 if (p->>'actor_profile_id')::uuid is distinct from a then raise exception 'LABOR_ACTOR_CHANGED' using errcode='42501';end if;
 operation_id:=(p->>'operation_id')::uuid;
 if operation_id is null then raise exception 'LABOR_INVALID' using errcode='22023';end if;
 request_hash:=encode(sha256(convert_to(p::text,'UTF8')),'hex');
 -- Serialize the idempotency key before inspecting its receipt; same operation cannot race different workers.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('labor-op:'||c::text||':'||a::text||':'||operation_id::text,0));
 select * into old_receipt from private.labor_operation_receipts where company_id=c and actor_id=a and labor_operation_receipts.operation_id=mutation.operation_id;
 if found then
  perform 1 from public.company_members where company_id=c and profile_id=a for share;
  perform 1 from public.profiles where id=a for share;
  a:=private.labor_actor(c,case when op='rate' then 'finance' when op='review' then 'review' else 'member' end);
  if (p->>'actor_profile_id')::uuid is distinct from a then raise exception 'LABOR_ACTOR_CHANGED' using errcode='42501';end if;
  if old_receipt.operation<>op or old_receipt.request_hash<>request_hash then raise exception 'LABOR_OPERATION_CONFLICT' using errcode='PT409';end if;
  if op<>'rate' then perform private.labor_detail(c,(old_receipt.response->>'id')::uuid);end if;
  return private.labor_redact(old_receipt.response,c);
 end if;
 sid:=(p->>'submission_id')::uuid;
 if op in ('submit','review') or (op='save' and sid is not null) then
  select * into s from public.labor_submissions where id=sid and company_id=c;
  if not found then raise exception 'LABOR_NOT_FOUND' using errcode='42501';end if;worker:=s.profile_id;job:=s.job_id;
 else worker:=(p->>'profile_id')::uuid;job:=(p->>'job_id')::uuid;end if;
 if worker is null then raise exception 'LABOR_INVALID' using errcode='22023';end if;
 perform private.labor_lock(c,worker);
 -- Resolve current actor/role after any wait, and lock membership through commit.
 a:=private.labor_actor(c,case when op='rate' then 'finance' when op='review' then 'review' else 'member' end);
 perform 1 from public.company_members where company_id=c and profile_id=a and is_active for share;
 perform 1 from public.profiles where id=a for share;
 a:=private.labor_actor(c,case when op='rate' then 'finance' when op='review' then 'review' else 'member' end);
 if (p->>'actor_profile_id')::uuid is distinct from a then raise exception 'LABOR_ACTOR_CHANGED' using errcode='42501';end if;
 if op in ('save','submit') and worker<>a and not exists(select 1 from public.company_members where company_id=c and profile_id=a and role in ('company_admin','super_admin','manager') and is_active) then raise exception 'LABOR_FORBIDDEN' using errcode='42501';end if;
 perform private.labor_assert_scope(c,worker,job);
 perform private.labor_assert_capability(c,case op when 'rate' then 'core.rates.manage' when 'review' then 'core.time.approve' else 'core.time.record' end);
 if op='rate' then
  expected:=(p->>'expected_schedule_revision')::bigint;
  if expected is null or expected<0 or coalesce(p->>'effective_from','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or nullif(btrim(p->>'reason'),'') is null or length(p->>'reason')>2000
   or (p->>'amount') !~ '^[0-9]+(\.[0-9]{1,2})?$' or p->>'unit' not in ('hour','fixed')
   or p->>'worker_type' not in ('employee','contractor') or p->>'billing_type' not in ('hourly','fixed','invoice') then raise exception 'LABOR_INVALID' using errcode='22023';end if;
  amount_value:=(p->>'amount')::numeric;day_value:=(p->>'effective_from')::date;
  select coalesce(nullif(default_currency,''),currency) into currency_value from public.companies where id=c;
  if amount_value is null or amount_value<0 or amount_value>=10000000000 or day_value is null or not isfinite(day_value)
   or currency_value !~ '^[A-Z]{3}$' or p->>'currency' is distinct from currency_value then raise exception 'LABOR_INVALID' using errcode='22023';end if;
  insert into public.company_worker_rate_schedules(company_id,profile_id) values(c,worker) on conflict do nothing;
  select * into schedule from public.company_worker_rate_schedules where company_id=c and profile_id=worker for update;
  if schedule.revision<>expected then raise exception 'LABOR_REVISION_CONFLICT' using errcode='PT409';end if;
  if exists(select 1 from public.company_worker_rate_versions where company_id=c and profile_id=worker and effective_from=day_value) then raise exception 'LABOR_EFFECTIVE_DATE_CONFLICT' using errcode='PT409';end if;
  insert into public.company_worker_rate_versions(company_id,profile_id,effective_from,amount,currency,unit,worker_type,billing_type,reason,created_by)
   values(c,worker,day_value,amount_value,currency_value,p->>'unit',p->>'worker_type',p->>'billing_type',btrim(p->>'reason'),a) returning * into rate;
  update public.company_worker_rate_schedules set revision=revision+1 where company_id=c and profile_id=worker returning * into schedule;
  insert into public.labor_history_events(company_id,profile_id,actor_id,action,reason) values(c,worker,a,'rate_created',btrim(p->>'reason'));
  result:=jsonb_build_object('company_id',c,'profile_id',worker,'schedule_revision',schedule.revision,'rate',private.labor_rate_dto(rate));
 else
  expected:=(p->>'expected_revision')::bigint;
  if expected is null or expected<0 then raise exception 'LABOR_INVALID' using errcode='22023';end if;
  if sid is null then
   if op<>'save' or expected<>0 or job is null then raise exception 'LABOR_REVISION_CONFLICT' using errcode='PT409';end if;
   insert into public.labor_submissions(company_id,profile_id,job_id,created_by) values(c,worker,job,a) returning * into s;sid:=s.id;
  else
   select * into s from public.labor_submissions where id=sid and company_id=c for update;
   if s.revision<>expected then raise exception 'LABOR_REVISION_CONFLICT' using errcode='PT409';end if;
   if op='save' and ((p->>'profile_id')::uuid is distinct from s.profile_id or (p->>'job_id')::uuid is distinct from s.job_id) then raise exception 'LABOR_SOURCE_SCOPE' using errcode='42501';end if;
  end if;
  if op='save' then
   if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') not between 1 and 366
    or jsonb_typeof(p->'sources') is distinct from 'array' or jsonb_array_length(p->'sources') not between 1 and 100 then raise exception 'LABOR_INVALID' using errcode='22023';end if;
   if s.current_version_id is not null then select * into v from public.labor_submission_versions where id=s.current_version_id;end if;
   revision_of:=(p->>'revision_of')::uuid;
   if revision_of is not null and nullif(btrim(p->>'correction_reason'),'') is null then raise exception 'LABOR_CORRECTION_REASON_REQUIRED' using errcode='22023';end if;
   if v.id is not null and v.state='submitted' then raise exception 'LABOR_INVALID_STATE' using errcode='23514';end if;
   if v.id is not null and v.state in ('approved','returned') then
    if revision_of is distinct from v.id or nullif(btrim(p->>'correction_reason'),'') is null then raise exception 'LABOR_CORRECTION_REASON_REQUIRED' using errcode='22023';end if;
   elsif v.id is null and revision_of is not null then raise exception 'LABOR_INVALID' using errcode='22023';
   elsif v.state='draft' and revision_of is distinct from v.revision_of then raise exception 'LABOR_INVALID' using errcode='22023';end if;
   if v.id is null or v.state<>'draft' then
    insert into public.labor_submission_versions(submission_id,version,revision_of,correction_reason,created_by)
    values(sid,coalesce(v.version,0)+1,revision_of,nullif(btrim(p->>'correction_reason'),''),a) returning * into v;
   else
    delete from public.labor_submission_lines where version_id=v.id;
    update public.labor_submission_versions set correction_reason=nullif(btrim(p->>'correction_reason'),'') where id=v.id;
   end if;
   if s.approved_version_id is not null and (select coalesce(jsonb_agg(jsonb_build_object('kind',x.source_kind,'id',x.source_id) order by x.source_kind,x.source_id),'[]'::jsonb) from public.labor_submission_sources x where x.submission_id=sid)
     is distinct from (select jsonb_agg(x order by x->>'kind',x->>'id') from jsonb_array_elements(p->'sources') x) then raise exception 'LABOR_SOURCE_CONFLICT' using errcode='23514';end if;
   if s.approved_version_id is null then
    delete from public.labor_submission_sources where submission_id=sid;
    for item in select value from jsonb_array_elements(p->'sources') loop
     source_kind:=item->>'kind';source_id:=(item->>'id')::uuid;
     d:=private.labor_source_document(c,worker,job,source_kind,source_id);
     if exists(select 1 from public.labor_submission_sources where company_id=c and labor_submission_sources.source_kind=mutation.source_kind and labor_submission_sources.source_id=mutation.source_id) then raise exception 'LABOR_SOURCE_CONFLICT' using errcode='23514';end if;
     insert into public.labor_submission_sources values(c,sid,source_kind,source_id,encode(sha256(convert_to(d::text,'UTF8')),'hex'));
    end loop;
   end if;
   perform private.labor_sources_validate(c,sid);
   select timezone into zone from public.companies where id=c;
   if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'LABOR_TIMEZONE_INVALID' using errcode='22023';end if;
   for item in select value from jsonb_array_elements(p->'lines') loop
    if coalesce(item->>'work_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'LABOR_INVALID' using errcode='22023';end if;
    n:=n+1;day_value:=(item->>'work_date')::date;started:=(item->>'started_at')::timestamptz;ended:=(item->>'ended_at')::timestamptz;
    if (item->>'actual_hours') !~ '^[0-9]+(\.[0-9]{1,4})?$' or (item->>'pay_hours') !~ '^[0-9]+(\.[0-9]{1,4})?$'
     or (item->>'billed_hours') !~ '^[0-9]+(\.[0-9]{1,4})?$' then raise exception 'LABOR_INVALID' using errcode='22023';end if;
    actual:=(item->>'actual_hours')::numeric;pay:=(item->>'pay_hours')::numeric;bill:=(item->>'billed_hours')::numeric;
    if actual>extract(epoch from (((day_value+1)::timestamp at time zone zone)-(day_value::timestamp at time zone zone)))/3600 then raise exception 'LABOR_DATE_HOURS_MISMATCH' using errcode='22023';end if;
    if (started is null)<>(ended is null) or (started is not null and (not isfinite(started) or not isfinite(ended))) then raise exception 'LABOR_INVALID' using errcode='22023';end if;
    if started is not null and ((started at time zone zone)::date<>day_value or ((ended-interval '1 microsecond') at time zone zone)::date<>day_value
      or actual<>round(extract(epoch from ended-started)/3600,4)) then raise exception 'LABOR_DATE_HOURS_MISMATCH' using errcode='22023';end if;
    insert into public.labor_submission_lines values(v.id,n,day_value,started,ended,actual,pay,bill);
   end loop;
   update public.labor_submissions set current_version_id=v.id,revision=revision+1 where id=sid returning * into s;
  else
   vid:=(p->>'version_id')::uuid;
   select * into v from public.labor_submission_versions where id=vid and submission_id=sid;
   if not found or s.current_version_id is distinct from vid then raise exception 'LABOR_REVISION_CONFLICT' using errcode='PT409';end if;
   perform private.labor_sources_validate(c,sid);
   if op='submit' then
    if v.state<>'draft' then raise exception 'LABOR_INVALID_STATE' using errcode='23514';end if;
    update public.labor_submission_versions set state='submitted',submitted_by=a,submitted_at=clock_timestamp() where id=vid;
   else
    if v.state<>'submitted' or p->>'decision' not in ('approve','return') or p->>'decision' is null then raise exception 'LABOR_INVALID_STATE' using errcode='23514';end if;
    if p->>'decision'='return' then
     if nullif(btrim(p->>'reason'),'') is null then raise exception 'LABOR_REVIEW_REASON_REQUIRED' using errcode='22023';end if;
     update public.labor_submission_versions set state='returned',reviewed_by=a,reviewed_at=clock_timestamp(),review_reason=btrim(p->>'reason') where id=vid;
    else
     preview:=private.labor_cost_preview(c,sid,vid);
     if preview->'reasons' ? 'missing_rate' then raise exception 'LABOR_MISSING_RATE' using errcode='23514';end if;
     if preview->>'completeness'<>'complete' then raise exception 'LABOR_COST_INCOMPLETE' using errcode='23514';end if;
     if preview->>'preview_hash' is distinct from p->>'expected_cost_preview_hash' then raise exception 'LABOR_PREVIEW_CONFLICT' using errcode='PT409';end if;
     if exists(select 1 from jsonb_array_elements(preview#>'{cost,lines}') x where x->>'unit'='fixed')
      and exists(select 1 from public.labor_submissions other_s join public.labor_cost_snapshots x on x.version_id=other_s.approved_version_id
        where other_s.company_id=c and other_s.profile_id=worker and other_s.job_id=job and other_s.id<>sid and x.unit='fixed') then
       raise exception 'LABOR_FIXED_SOURCE_CONFLICT' using errcode='23514';end if;
     insert into public.labor_cost_snapshots select vid,(x->>'line_no')::integer,(x->>'rate_version_id')::uuid,(x->>'rate_amount')::numeric,
       x->>'currency',x->>'unit',x->>'worker_type',x->>'billing_type',(x->>'cost_quantity')::numeric,(x->>'cost_amount')::numeric
       from jsonb_array_elements(preview#>'{cost,lines}') x;
     update public.labor_submission_versions set state='approved',reviewed_by=a,reviewed_at=clock_timestamp(),review_reason=nullif(btrim(p->>'reason'),'') where id=vid;
     update public.labor_submissions set approved_version_id=vid where id=sid;
    end if;
   end if;
   update public.labor_submissions set revision=revision+1 where id=sid returning * into s;
  end if;
  insert into public.labor_history_events(company_id,profile_id,submission_id,version_id,actor_id,action,reason)
   values(c,worker,sid,v.id,a,case when op='review' then p->>'decision' else op end,coalesce(p->>'reason',p->>'correction_reason'));
  result:=private.labor_detail(c,sid);
 end if;
 result:=result||jsonb_build_object('operation_id',operation_id,'actor_profile_id',a);
 insert into private.labor_operation_receipts values(c,a,operation_id,op,request_hash,result);
 return result;
end $f$;
