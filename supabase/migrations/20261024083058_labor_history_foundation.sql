-- C03/C04/C10 foundation: additive, no historical profile-rate backfill and no legacy view replacement.
-- All writes are scoped RPCs. Approved versions/snapshots/events are append-only.
create table public.company_worker_rate_schedules (
 company_id uuid not null references public.companies(id), profile_id uuid not null references public.profiles(id),
 revision bigint not null default 0 check(revision>=0), primary key(company_id,profile_id)
);
create table public.company_worker_rate_versions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, profile_id uuid not null,
 effective_from date not null check(isfinite(effective_from)), amount numeric(12,2) not null check(amount>=0 and amount<10000000000),
 currency text not null check(currency ~ '^[A-Z]{3}$'), unit text not null check(unit in ('hour','fixed')),
 worker_type text not null check(worker_type in ('employee','contractor')),
 billing_type text not null check(billing_type in ('hourly','fixed','invoice')),
 reason text not null check(length(btrim(reason)) between 1 and 2000), created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,profile_id) references public.company_worker_rate_schedules(company_id,profile_id),
 unique(company_id,profile_id,effective_from), check((unit='hour' and billing_type='hourly') or (unit='fixed' and billing_type in ('fixed','invoice')))
);
create table public.labor_submissions (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 profile_id uuid not null references public.profiles(id), job_id uuid not null references public.jobs(id),
 revision bigint not null default 0, current_version_id uuid, approved_version_id uuid,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp()
);
create table public.labor_submission_versions (
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.labor_submissions(id),
 version integer not null check(version>0), state text not null default 'draft' check(state in ('draft','submitted','approved','returned')),
 revision_of uuid references public.labor_submission_versions(id), correction_reason text,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(),
 submitted_by uuid references public.profiles(id), submitted_at timestamptz,
 reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_reason text,
 unique(submission_id,version), check(correction_reason is null or length(btrim(correction_reason)) between 1 and 2000)
);
alter table public.labor_submissions add constraint labor_current_version_fk foreign key(current_version_id) references public.labor_submission_versions(id);
alter table public.labor_submissions add constraint labor_approved_version_fk foreign key(approved_version_id) references public.labor_submission_versions(id);
create table public.labor_submission_lines (
 version_id uuid not null references public.labor_submission_versions(id), line_no integer not null,
 work_date date not null check(isfinite(work_date)), started_at timestamptz, ended_at timestamptz,
 actual_hours numeric(8,4) not null check(actual_hours between 0 and 25),
 pay_hours numeric(8,4) not null check(pay_hours between 0 and 25), billed_hours numeric(8,4) not null check(billed_hours between 0 and 25),
 primary key(version_id,line_no), unique(version_id,work_date),
 check((started_at is null and ended_at is null) or (started_at is not null and ended_at is not null and isfinite(started_at) and isfinite(ended_at) and ended_at>started_at))
);
create table public.labor_submission_sources (
 company_id uuid not null references public.companies(id), submission_id uuid not null references public.labor_submissions(id),
 source_kind text not null check(source_kind in ('shift','log','assignment')), source_id uuid not null,
 source_hash text not null, primary key(company_id,source_kind,source_id)
);
create index labor_sources_submission on public.labor_submission_sources(submission_id);
create table public.labor_cost_snapshots (
 version_id uuid not null, line_no integer not null, rate_version_id uuid not null references public.company_worker_rate_versions(id),
 rate_amount numeric(12,2) not null, currency text not null, unit text not null, worker_type text not null, billing_type text not null,
 cost_quantity numeric(8,4) not null, cost_amount numeric(18,2) not null, primary key(version_id,line_no),
 foreign key(version_id,line_no) references public.labor_submission_lines(version_id,line_no)
);
create table public.labor_history_events (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 profile_id uuid not null references public.profiles(id), submission_id uuid references public.labor_submissions(id),
 version_id uuid references public.labor_submission_versions(id), actor_id uuid not null references public.profiles(id),
 action text not null, reason text, created_at timestamptz not null default clock_timestamp()
);
create table private.labor_operation_receipts (
 company_id uuid not null, actor_id uuid not null, operation_id uuid not null, operation text not null,
 request_hash text not null, response jsonb not null, primary key(company_id,actor_id,operation_id)
);
create index labor_submissions_scope on public.labor_submissions(company_id,profile_id,job_id);

create function private.labor_actor(c uuid, required_access text default 'member') returns uuid
language plpgsql volatile security definer set search_path='' as $f$
declare a uuid; n integer;
begin
 if auth.uid() is null then raise exception 'LABOR_FORBIDDEN' using errcode='42501'; end if;
 select count(*),min(p.id::text)::uuid into n,a from public.company_members m join public.profiles p on p.id=m.profile_id
 where m.company_id=c and m.is_active and p.is_active and p.auth_user_id=auth.uid()
 and m.role in ('company_admin','super_admin','manager','worker')
 and (required_access='member' or (required_access='finance' and m.role in ('company_admin','super_admin'))
 or (required_access='review' and m.role in ('company_admin','super_admin','manager')));
 if n<>1 then raise exception 'LABOR_FORBIDDEN' using errcode='42501'; end if;
 return a;
end $f$;
create function private.labor_is_finance(c uuid) returns boolean language sql stable security definer set search_path='' as $f$
 select count(*)=1 from public.company_members m join public.profiles p on p.id=m.profile_id
 where m.company_id=c and m.is_active and p.is_active and p.auth_user_id=auth.uid() and m.role in ('company_admin','super_admin');
$f$;
create function private.labor_lock(c uuid,p uuid) returns void language plpgsql security definer set search_path='' as $f$
begin
 -- A stable transaction lock shared by rates, source edits and review. No profile rate is read.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('labor:'||c::text||':'||p::text,0));
end $f$;
create function private.labor_assert_scope(c uuid,p uuid,j uuid default null) returns void language plpgsql security definer set search_path='' as $f$
begin
 perform 1 from public.company_members where company_id=c and profile_id=p for share;
 perform 1 from public.profiles where id=p for share;
 if j is not null then perform 1 from public.jobs where id=j and company_id=c for share;end if;
 if not exists(select 1 from public.company_members m join public.profiles w on w.id=m.profile_id
  where m.company_id=c and m.profile_id=p and m.is_active and w.is_active) then
  raise exception 'LABOR_WORKER_SCOPE' using errcode='42501'; end if;
 if j is not null and not exists(select 1 from public.jobs where id=j and company_id=c) then
  raise exception 'LABOR_JOB_SCOPE' using errcode='42501'; end if;
end $f$;
create function private.labor_assert_capability(c uuid,cap text) returns void language plpgsql security definer set search_path='' as $f$
declare a jsonb; paid public.company_module_entitlements%rowtype; test private.company_test_module_grants%rowtype; valid boolean; t timestamptz;
begin
 if cap not in ('core.rates.manage','core.time.record','core.time.approve') then raise exception 'LABOR_INVALID' using errcode='22023'; end if;
 perform private.evaluate_company_capability_access(c,cap,clock_timestamp());
 a:=private.evaluate_company_capability_access(c,cap,clock_timestamp());
 if not coalesce((a->>'allowed')::boolean,false) then raise exception 'LABOR_MODULE_REQUIRED' using errcode='42501'; end if;
 if a->>'reason'='paid' then
  select * into paid from public.company_module_entitlements where id=(a->>'entitlement_id')::uuid and company_id=c for share;
  t:=clock_timestamp();valid:=found and paid.product='diriqo_core' and paid.register_id is null and paid.origin='paid'
   and paid.policy_version='diriqo-capabilities-v0.1' and paid.state='active' and not paid.revoked
   and paid.livemode=(a->>'livemode')::boolean and paid.valid_from<=t and t<paid.valid_until and cap=any(paid.capabilities);
 elsif a->>'reason'='test' then
  select * into test from private.company_test_module_grants where id=(a->>'test_grant_id')::uuid and company_id=c for share;
  t:=clock_timestamp();valid:=found and test.product='diriqo_core' and test.register_id is null and test.origin='manual_grant'
   and test.policy_version='diriqo-capabilities-v0.1' and test.state='active' and test.revoked_at is null and not test.livemode
   and (a->>'livemode')::boolean=false and test.valid_from<=t and t<test.valid_until and cap=any(test.capabilities);
 else valid:=a->>'reason'='legacy' and (a->>'enforced')::boolean=false;
 end if;
 if valid is distinct from true then raise exception 'LABOR_MODULE_REQUIRED' using errcode='42501';end if;
end $f$;
create function private.labor_immutable() returns trigger language plpgsql set search_path='' as $f$
begin raise exception 'LABOR_IMMUTABLE_HISTORY' using errcode='23514'; end $f$;
create function private.labor_version_guard() returns trigger language plpgsql set search_path='' as $f$
begin
 if tg_op='DELETE' or old.state in ('approved','returned') then raise exception 'LABOR_IMMUTABLE_HISTORY' using errcode='23514';end if;
 if old.state='submitted' and (new.state not in ('approved','returned') or
  (to_jsonb(new)-array['state','reviewed_by','reviewed_at','review_reason']) is distinct from
  (to_jsonb(old)-array['state','reviewed_by','reviewed_at','review_reason'])) then raise exception 'LABOR_IMMUTABLE_HISTORY' using errcode='23514';end if;
 return new;
end $f$;
create function private.labor_line_guard() returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if exists(select 1 from public.labor_submission_versions where id=old.version_id and state<>'draft') then
  raise exception 'LABOR_IMMUTABLE_HISTORY' using errcode='23514';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $f$;
create function private.labor_pointer_guard() returns trigger language plpgsql set search_path='' as $f$
begin
 if new.current_version_id is not null and not exists(select 1 from public.labor_submission_versions v where v.id=new.current_version_id and v.submission_id=new.id) then raise exception 'LABOR_VERSION_SCOPE' using errcode='23514';end if;
 if new.approved_version_id is not null and not exists(select 1 from public.labor_submission_versions v where v.id=new.approved_version_id and v.submission_id=new.id and v.state='approved') then raise exception 'LABOR_VERSION_SCOPE' using errcode='23514';end if;
 if old.approved_version_id is not null and new.approved_version_id is null then raise exception 'LABOR_IMMUTABLE_HISTORY' using errcode='23514';end if;
 return new;
end $f$;
create trigger labor_version_immutable before update or delete on public.labor_submission_versions for each row execute function private.labor_version_guard();
create trigger labor_line_immutable before update or delete on public.labor_submission_lines for each row execute function private.labor_line_guard();
create trigger labor_pointer_consistent before update on public.labor_submissions for each row execute function private.labor_pointer_guard();
create trigger labor_rate_immutable before update or delete on public.company_worker_rate_versions for each row execute function private.labor_immutable();
create trigger labor_snapshot_immutable before update or delete on public.labor_cost_snapshots for each row execute function private.labor_immutable();
create trigger labor_event_immutable before update or delete on public.labor_history_events for each row execute function private.labor_immutable();

create function private.labor_source_document(c uuid,p uuid,j uuid,k text,s uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare d jsonb; linked jsonb;
begin
 if k='shift' then select to_jsonb(w) into d from public.work_shifts w where w.id=s and w.company_id=c and w.profile_id=p and w.job_id=j for update;
 elsif k='log' then select to_jsonb(w) into d from public.work_logs w where w.id=s and w.company_id=c and w.profile_id=p and w.job_id=j and w.archived_at is null for update;
 elsif k='assignment' then select to_jsonb(w) into d from public.job_assignments w where w.id=s and w.company_id=c and w.profile_id=p and w.job_id=j and w.archived_at is null for update;
 else raise exception 'LABOR_INVALID' using errcode='22023';end if;
 if d is null then raise exception 'LABOR_SOURCE_SCOPE' using errcode='42501';end if;
 if k in ('shift','log') and d->>'started_at' is not null and d->>'ended_at' is null then raise exception 'LABOR_SOURCE_RUNNING' using errcode='23514';end if;
 if k='log' and d->>'shift_id' is not null then
  select to_jsonb(w)-array['note','updated_at'] into linked from public.work_shifts w
   where w.id=(d->>'shift_id')::uuid and w.company_id=c and w.profile_id=p and w.job_id=j for update;
  if linked is null then raise exception 'LABOR_SOURCE_SCOPE' using errcode='42501';end if;
  if linked->>'started_at' is not null and linked->>'ended_at' is null then raise exception 'LABOR_SOURCE_RUNNING' using errcode='23514';end if;
  d:=d||jsonb_build_object('linked_shift',linked);
 end if;
 return d-array['note','updated_at'];
end $f$;
create function private.labor_source_guard() returns trigger language plpgsql security definer set search_path='' as $f$
declare k text:=case tg_table_name when 'work_shifts' then 'shift' when 'work_logs' then 'log' else 'assignment' end;
begin
 perform private.labor_lock(old.company_id,old.profile_id);
 if exists(select 1 from public.labor_submission_sources x join public.labor_submissions s on s.id=x.submission_id
  where x.company_id=old.company_id and s.approved_version_id is not null
   and ((x.source_kind=k and x.source_id=old.id) or (k='shift' and x.source_kind='log' and exists(
    select 1 from public.work_logs z where z.id=x.source_id and z.company_id=old.company_id and z.shift_id=old.id))))
 and (tg_op='DELETE' or (to_jsonb(old)-array['note','updated_at']) is distinct from (to_jsonb(new)-array['note','updated_at'])) then
  raise exception 'LABOR_APPROVED_SOURCE_IMMUTABLE' using errcode='23514';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $f$;
create trigger labor_approved_shift_guard before update or delete on public.work_shifts for each row execute function private.labor_source_guard();
create trigger labor_approved_log_guard before update or delete on public.work_logs for each row execute function private.labor_source_guard();
create trigger labor_approved_assignment_guard before update or delete on public.job_assignments for each row execute function private.labor_source_guard();

create function private.labor_rate_dto(r public.company_worker_rate_versions) returns jsonb language sql immutable set search_path='' as $f$
 select jsonb_build_object('id',r.id,'effective_from',r.effective_from,'amount',r.amount::text,'currency',r.currency,'unit',r.unit,
 'worker_type',r.worker_type,'billing_type',r.billing_type,'reason',r.reason,'created_at',r.created_at);
$f$;
create function private.labor_redact(d jsonb,c uuid) returns jsonb language sql stable security definer set search_path='' as $f$
 select case when private.labor_is_finance(c) or not(d ? 'versions') then d else
 jsonb_set(d,'{versions}',coalesce((select jsonb_agg(v-'cost') from jsonb_array_elements(d->'versions') v),'[]'::jsonb)) end;
$f$;
create function private.labor_detail(c uuid,sid uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare s public.labor_submissions%rowtype; a uuid; manager boolean; result jsonb;
begin
 a:=private.labor_actor(c);select * into s from public.labor_submissions where id=sid and company_id=c;
 if not found then raise exception 'LABOR_NOT_FOUND' using errcode='42501';end if;
 select exists(select 1 from public.company_members where company_id=c and profile_id=a and is_active and role in ('company_admin','super_admin','manager')) into manager;
 if s.profile_id<>a and not manager then raise exception 'LABOR_FORBIDDEN' using errcode='42501';end if;
 select jsonb_build_object('id',s.id,'company_id',c,'profile_id',s.profile_id,'job_id',s.job_id,'revision',s.revision,
 'current_version_id',s.current_version_id,'approved_version_id',s.approved_version_id,
 'sources',coalesce((select jsonb_agg(jsonb_build_object('kind',x.source_kind,'id',x.source_id) order by x.source_kind,x.source_id) from public.labor_submission_sources x where x.submission_id=s.id),'[]'::jsonb),
 'versions',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'state',v.state,'revision_of',v.revision_of,
 'correction_reason',v.correction_reason,'created_at',v.created_at,'submitted_at',v.submitted_at,'reviewed_at',v.reviewed_at,'review_reason',v.review_reason,
 'lines',coalesce((select jsonb_agg(jsonb_build_object('line_no',l.line_no,'work_date',l.work_date,'started_at',l.started_at,'ended_at',l.ended_at,
 'actual_hours',l.actual_hours::text,'pay_hours',l.pay_hours::text,'billed_hours',l.billed_hours::text) order by l.line_no) from public.labor_submission_lines l where l.version_id=v.id),'[]'::jsonb),
 'cost',(select jsonb_build_object('currency',min(x.currency),'amount',sum(x.cost_amount)::text,'lines',jsonb_agg(jsonb_build_object(
 'line_no',x.line_no,'rate_version_id',x.rate_version_id,'rate_amount',x.rate_amount::text,'currency',x.currency,'unit',x.unit,
 'worker_type',x.worker_type,'billing_type',x.billing_type,'cost_quantity',x.cost_quantity::text,'cost_amount',x.cost_amount::text) order by x.line_no))
 from public.labor_cost_snapshots x where x.version_id=v.id having count(*)>0)) order by v.version) from public.labor_submission_versions v where v.submission_id=s.id),'[]'::jsonb)) into result;
 return private.labor_redact(result,c);
end $f$;
create function private.labor_cost_preview(c uuid,sid uuid,vid uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare s public.labor_submissions%rowtype; v public.labor_submission_versions%rowtype; l record; r public.company_worker_rate_versions%rowtype;
 currency_value text; reasons text[]:='{}'; costs jsonb:='[]'; total numeric:=0; q numeric; amount_value numeric; fixed_rate uuid; h text;
begin
 -- Internal financial calculation; caller wrappers enforce read access and redact it.
 select * into s from public.labor_submissions where id=sid and company_id=c;
 select * into v from public.labor_submission_versions where id=vid and submission_id=sid;
 if s.id is null or v.id is null then raise exception 'LABOR_NOT_FOUND' using errcode='42501';end if;
 select currency into currency_value from public.jobs where id=s.job_id and company_id=c;
 if v.state='approved' then
  select coalesce(jsonb_agg(jsonb_build_object('line_no',x.line_no,'rate_version_id',x.rate_version_id,'rate_amount',x.rate_amount::text,
    'currency',x.currency,'unit',x.unit,'worker_type',x.worker_type,'billing_type',x.billing_type,'cost_quantity',x.cost_quantity::text,'cost_amount',x.cost_amount::text) order by x.line_no),'[]'),
    coalesce(sum(x.cost_amount),0),min(x.currency) into costs,total,currency_value from public.labor_cost_snapshots x where x.version_id=vid;
  h:=encode(sha256(convert_to(jsonb_build_object('submission_id',sid,'version_id',vid,'costs',costs)::text,'UTF8')),'hex');
  return jsonb_build_object('company_id',c,'submission_id',sid,'version_id',vid,'preview_hash',h,'completeness','complete','reasons','[]'::jsonb,
    'cost',jsonb_build_object('currency',currency_value,'amount',total::text,'lines',costs));
 end if;
 for l in select * from public.labor_submission_lines where version_id=vid order by line_no loop
  select * into r from public.company_worker_rate_versions where company_id=c and profile_id=s.profile_id and effective_from<=l.work_date order by effective_from desc limit 1;
  if r.id is null then reasons:=array_append(reasons,'missing_rate');continue;end if;
  if r.currency is distinct from currency_value then reasons:=array_append(reasons,'currency_mismatch');continue;end if;
  if r.billing_type='invoice' then reasons:=array_append(reasons,'invoice_amount_required');continue;end if;
  if r.unit='fixed' then
   if fixed_rate is not null and fixed_rate<>r.id then reasons:=array_append(reasons,'mixed_fixed_rates');continue;end if;
   q:=case when fixed_rate is null then 1 else 0 end;fixed_rate:=r.id;
  else q:=l.pay_hours;end if;
  amount_value:=round(q*r.amount,2);total:=total+amount_value;
  costs:=costs||jsonb_build_array(jsonb_build_object('line_no',l.line_no,'rate_version_id',r.id,'rate_amount',r.amount::text,
   'currency',r.currency,'unit',r.unit,'worker_type',r.worker_type,'billing_type',r.billing_type,'cost_quantity',q::text,'cost_amount',amount_value::text));
 end loop;
 select coalesce(array_agg(distinct x order by x),'{}') into reasons from unnest(reasons) x;
 h:=encode(sha256(convert_to(jsonb_build_object('submission_id',sid,'version_id',vid,'revision',s.revision,'costs',costs,'reasons',reasons)::text,'UTF8')),'hex');
 return jsonb_build_object('company_id',c,'submission_id',sid,'version_id',vid,'preview_hash',h,
 'completeness',case when cardinality(reasons)=0 then 'complete' else 'incomplete' end,'reasons',to_jsonb(reasons),
 'cost',jsonb_build_object('currency',currency_value,'amount',total::text,'lines',costs));
end $f$;
create function private.labor_sources_validate(c uuid,sid uuid) returns void language plpgsql security definer set search_path='' as $f$
declare s public.labor_submissions%rowtype; x record; d jsonb;
begin
 select * into s from public.labor_submissions where id=sid and company_id=c;
 for x in select * from public.labor_submission_sources where submission_id=sid order by source_kind,source_id loop
  d:=private.labor_source_document(c,s.profile_id,s.job_id,x.source_kind,x.source_id);
  if encode(sha256(convert_to(d::text,'UTF8')),'hex')<>x.source_hash then raise exception 'LABOR_SOURCE_CHANGED' using errcode='40001';end if;
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

create function private.labor_mutate(c uuid,op text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $f$
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
  if old_receipt.operation<>op or old_receipt.request_hash<>request_hash then raise exception 'LABOR_OPERATION_CONFLICT' using errcode='40001';end if;
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
  if schedule.revision<>expected then raise exception 'LABOR_REVISION_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from public.company_worker_rate_versions where company_id=c and profile_id=worker and effective_from=day_value) then raise exception 'LABOR_EFFECTIVE_DATE_CONFLICT' using errcode='40001';end if;
  insert into public.company_worker_rate_versions(company_id,profile_id,effective_from,amount,currency,unit,worker_type,billing_type,reason,created_by)
   values(c,worker,day_value,amount_value,currency_value,p->>'unit',p->>'worker_type',p->>'billing_type',btrim(p->>'reason'),a) returning * into rate;
  update public.company_worker_rate_schedules set revision=revision+1 where company_id=c and profile_id=worker returning * into schedule;
  insert into public.labor_history_events(company_id,profile_id,actor_id,action,reason) values(c,worker,a,'rate_created',btrim(p->>'reason'));
  result:=jsonb_build_object('company_id',c,'profile_id',worker,'schedule_revision',schedule.revision,'rate',private.labor_rate_dto(rate));
 else
  expected:=(p->>'expected_revision')::bigint;
  if expected is null or expected<0 then raise exception 'LABOR_INVALID' using errcode='22023';end if;
  if sid is null then
   if op<>'save' or expected<>0 or job is null then raise exception 'LABOR_REVISION_CONFLICT' using errcode='40001';end if;
   insert into public.labor_submissions(company_id,profile_id,job_id,created_by) values(c,worker,job,a) returning * into s;sid:=s.id;
  else
   select * into s from public.labor_submissions where id=sid and company_id=c for update;
   if s.revision<>expected then raise exception 'LABOR_REVISION_CONFLICT' using errcode='40001';end if;
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
   if not found or s.current_version_id is distinct from vid then raise exception 'LABOR_REVISION_CONFLICT' using errcode='40001';end if;
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
     if preview->>'preview_hash' is distinct from p->>'expected_cost_preview_hash' then raise exception 'LABOR_PREVIEW_CONFLICT' using errcode='40001';end if;
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

create function private.list_company_worker_rates(c uuid,p uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare result jsonb;
begin
 perform private.labor_actor(c,'finance');
 if not exists(select 1 from public.company_members where company_id=c and profile_id=p) then raise exception 'LABOR_WORKER_SCOPE' using errcode='42501';end if;
 select jsonb_build_object('company_id',c,'profile_id',p,'schedule_revision',coalesce(s.revision,0),
 'company_name',co.name,'profile_name',(select w.full_name from public.profiles w where w.id=p),'currency',coalesce(nullif(co.default_currency,''),co.currency),'rates',coalesce((select jsonb_agg(private.labor_rate_dto(r) order by r.effective_from) from public.company_worker_rate_versions r where r.company_id=c and r.profile_id=p),'[]'::jsonb))
 into result from public.companies co left join public.company_worker_rate_schedules s on s.company_id=co.id and s.profile_id=p where co.id=c;
 return result;
end $f$;
-- Time-only selection; no mutable profile rate or ledger financial field is exposed.
create function private.list_labor_source_options(c uuid,p uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare a uuid; manager boolean; result jsonb; co_name text; zone text;
begin
 a:=private.labor_actor(c);
 select exists(select 1 from public.company_members where company_id=c and profile_id=a and is_active and role in ('company_admin','super_admin','manager')) into manager;
 if not manager and p is not null and p<>a then raise exception 'LABOR_FORBIDDEN' using errcode='42501';end if;
 if p is not null and not exists(select 1 from public.company_members where company_id=c and profile_id=p) then raise exception 'LABOR_WORKER_SCOPE' using errcode='42501';end if;
 select name,timezone into co_name,zone from public.companies where id=c;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'LABOR_TIMEZONE_INVALID' using errcode='22023';end if;
 with sources as (
  select 'shift'::text kind,w.id,w.profile_id,w.job_id,w.shift_date work_date,w.started_at,w.ended_at,w.hours_override manual_hours,null::uuid shift_id
   from public.work_shifts w where w.company_id=c and not(w.started_at is not null and w.ended_at is null)
  union all
  select 'log',w.id,w.profile_id,w.job_id,w.work_date,w.started_at,w.ended_at,nullif(w.hours,0),w.shift_id
   from public.work_logs w where w.company_id=c and w.archived_at is null and not(w.started_at is not null and w.ended_at is null)
  union all
  select 'assignment',w.id,w.profile_id,w.job_id,null::date,null::timestamptz,null::timestamptz,null::numeric,null::uuid
   from public.job_assignments w where w.company_id=c and w.archived_at is null
 ), scoped as (
  select z.*,j.title job_title,w.full_name profile_name,
   case when z.started_at is not null and z.ended_at is not null and isfinite(z.started_at) and isfinite(z.ended_at)
     and z.ended_at>z.started_at and z.ended_at-z.started_at<=interval '25 hours' then true else false end valid_times
   from sources z join public.jobs j on j.id=z.job_id and j.company_id=c join public.profiles w on w.id=z.profile_id
   where (manager or z.profile_id=a) and (p is null or z.profile_id=p)
    and exists(select 1 from public.company_members m where m.company_id=c and m.profile_id=z.profile_id)
   order by z.work_date desc nulls last,z.kind,z.id limit 2001
 ), normalized as (
  select z.*,case when isfinite(z.work_date) then z.work_date when valid_times then (z.started_at at time zone zone)::date else null end chosen_day,
   case when valid_times then round(extract(epoch from z.ended_at-z.started_at)/3600,4)
    when z.started_at is null and z.ended_at is null and z.manual_hours between 0 and 25 and z.manual_hours=round(z.manual_hours,4) then z.manual_hours else null end hours_value,
   (select distinct x.submission_id from public.labor_submission_sources x where x.company_id=c and (
     (x.source_kind=z.kind and x.source_id=z.id)
     or (z.kind='log' and x.source_kind='shift' and x.source_id=z.shift_id)
     or (z.kind='shift' and x.source_kind='log' and exists(select 1 from public.work_logs l where l.id=x.source_id and l.company_id=c and l.shift_id=z.id)))) claimed_submission
  from scoped z
 ) select coalesce(jsonb_agg(jsonb_build_object('kind',z.kind,'id',z.id,'profile_id',z.profile_id,'profile_name',z.profile_name,
   'job_id',z.job_id,'job_title',z.job_title,'work_date',z.chosen_day,
   'started_at',case when valid_times then z.started_at else null end,'ended_at',case when valid_times then z.ended_at else null end,
   'actual_hours',z.hours_value::text,'submission_id',z.claimed_submission) order by z.chosen_day desc nulls last,z.kind,z.id),'[]'::jsonb)
  into result from normalized z;
 if jsonb_array_length(result)>2000 then raise exception 'LABOR_SOURCE_OPTIONS_LIMIT' using errcode='54000';end if;
 return jsonb_build_object('company_id',c,'company_name',co_name,'items',result);
end $f$;
create function private.list_labor_submissions(c uuid,p uuid,j uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare a uuid; manager boolean;
begin
 a:=private.labor_actor(c);
 select exists(select 1 from public.company_members where company_id=c and profile_id=a and is_active and role in ('company_admin','super_admin','manager')) into manager;
 if not manager and p is not null and p<>a then raise exception 'LABOR_FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('company_id',c,'items',coalesce((select jsonb_agg(private.labor_detail(c,s.id) order by s.created_at,s.id)
 from public.labor_submissions s where s.company_id=c and (manager or s.profile_id=a) and (p is null or s.profile_id=p) and (j is null or s.job_id=j)),'[]'::jsonb));
end $f$;
create function private.get_labor_cost_preview(c uuid,s uuid,v uuid) returns jsonb language plpgsql security definer set search_path='' as $f$
declare result jsonb;
begin
 perform private.labor_actor(c,'review');perform private.labor_detail(c,s);
 result:=private.labor_cost_preview(c,s,v);
 if not private.labor_is_finance(c) then result:=result-'cost';end if;
 return result;
end $f$;
create function private.get_job_labor_cost_totals(c uuid,ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $f$
declare j record; result jsonb:='[]'; total numeric; internal_amount numeric; external_amount numeric; approved_hours numeric;
 missing_hours numeric; unapproved_hours numeric; pending integer; legacy_count integer; missing_count integer; reasons text[]; s record; prev jsonb; provisional numeric;
begin
 perform private.labor_actor(c,'finance');
 if ids is null or cardinality(ids)>500 then raise exception 'LABOR_INVALID' using errcode='22023';end if;
 if exists(select 1 from unnest(ids) x where not exists(select 1 from public.jobs where id=x and company_id=c)) then raise exception 'LABOR_JOB_SCOPE' using errcode='42501';end if;
 for j in select id,currency from public.jobs where company_id=c and id=any(ids) order by id loop
  select coalesce(sum(x.cost_amount) filter(where x.currency=j.currency),0),coalesce(sum(x.cost_amount) filter(where x.worker_type='employee' and x.currency=j.currency),0),coalesce(sum(x.cost_amount) filter(where x.worker_type='contractor' and x.currency=j.currency),0),coalesce(sum(l.actual_hours),0)
   into total,internal_amount,external_amount,approved_hours
   from public.labor_submissions a join public.labor_cost_snapshots x on x.version_id=a.approved_version_id join public.labor_submission_lines l on l.version_id=x.version_id and l.line_no=x.line_no
   where a.company_id=c and a.job_id=j.id;
  pending:=0;missing_count:=0;missing_hours:=0;unapproved_hours:=0;provisional:=0;reasons:='{}';
  for s in select * from public.labor_submissions where company_id=c and job_id=j.id and current_version_id is distinct from approved_version_id loop
   pending:=pending+1;prev:=private.labor_cost_preview(c,s.id,s.current_version_id);
   select unapproved_hours+coalesce(sum(actual_hours),0) into unapproved_hours from public.labor_submission_lines where version_id=s.current_version_id;
   provisional:=provisional+(prev#>>'{cost,amount}')::numeric;
   if prev->>'completeness'<>'complete' then
    missing_count:=missing_count+1;
    select missing_hours+coalesce(sum(l.pay_hours),0) into missing_hours from public.labor_submission_lines l where l.version_id=s.current_version_id
     and not exists(select 1 from public.company_worker_rate_versions r where r.company_id=c and r.profile_id=s.profile_id and r.effective_from<=l.work_date);
    select reasons||coalesce(array_agg(x),'{}') into reasons from jsonb_array_elements_text(prev->'reasons') x;
   end if;
  end loop;
  -- Legacy records are not promoted to approved facts. Unclaimed observed work, running
  -- time and existing financial amounts are incomplete; their amount is not inferred. Only an explicit shift_id alias can suppress an unclaimed log; unrelated work is never hidden by job/worker heuristics.
  select count(*) into legacy_count from (
   select w.id from public.work_shifts w where w.company_id=c and w.job_id=j.id
    and (w.started_at is not null or w.ended_at is not null or coalesce(w.job_hours_override,0)<>0 or coalesce(w.hours_override,0)<>0)
    and not exists(select 1 from public.labor_submission_sources x where x.company_id=c and ((x.source_kind='shift' and x.source_id=w.id)
      or (x.source_kind='log' and exists(select 1 from public.work_logs z where z.id=x.source_id and z.shift_id=w.id))))
   union all
   select w.id from public.work_logs w where w.company_id=c and w.job_id=j.id and w.archived_at is null
    and (w.started_at is not null or w.ended_at is not null or w.hours<>0)
    and not exists(select 1 from public.labor_submission_sources x where x.company_id=c and ((x.source_kind='log' and x.source_id=w.id) or (x.source_kind='shift' and x.source_id=w.shift_id)))
   union all
   select w.id from public.job_assignments w where w.company_id=c and w.job_id=j.id and w.archived_at is null
    and (w.labor_hours<>0 or w.labor_cost<>0 or coalesce(w.external_amount,0)<>0 or w.work_started_at is not null or w.work_completed_at is not null)
    and not exists(select 1 from public.labor_submission_sources x where x.company_id=c and x.source_kind='assignment' and x.source_id=w.id)
  ) legacy;
  if legacy_count>0 then reasons:=array_append(reasons,'legacy_unverified');end if;
  if pending>0 then reasons:=array_append(reasons,'unapproved_work');end if;
  if exists(select 1 from public.labor_submissions a join public.labor_cost_snapshots x on x.version_id=a.approved_version_id where a.company_id=c and a.job_id=j.id and x.currency<>j.currency) then reasons:=array_append(reasons,'currency_mismatch');end if;
  select coalesce(array_agg(distinct x order by x),'{}') into reasons from unnest(reasons) x;
  result:=result||jsonb_build_array(jsonb_build_object('job_id',j.id,'currency',j.currency,'approved_cost',total::text,
   'approved_internal_cost',internal_amount::text,'approved_external_cost',external_amount::text,'approved_hours',approved_hours::text,
   'unconverted_costs',coalesce((select jsonb_agg(jsonb_build_object('currency',u.currency,'amount',u.amount::text) order by u.currency) from (select x.currency,sum(x.cost_amount) amount from public.labor_submissions a join public.labor_cost_snapshots x on x.version_id=a.approved_version_id where a.company_id=c and a.job_id=j.id and x.currency<>j.currency group by x.currency) u),'[]'::jsonb),
   'provisional_known_cost',provisional::text,'missing_rate_hours',missing_hours::text,'unapproved_hours',unapproved_hours::text,
   'legacy_unverified_count',legacy_count,'completeness',case when legacy_count>0 or missing_count>0 or reasons @> array['currency_mismatch'] then 'incomplete' when pending>0 then 'provisional' else 'complete' end,
   'reasons',to_jsonb(reasons),'total_cost',case when cardinality(reasons)=0 then total::text else null end));
 end loop;
 return jsonb_build_object('company_id',c,'items',result);
end $f$;

create function public.set_company_worker_rate(target_company_id uuid,payload jsonb) returns jsonb language sql security invoker set search_path='' as $f$ select private.labor_mutate(target_company_id,'rate',payload); $f$;
create function public.save_labor_submission_draft(target_company_id uuid,payload jsonb) returns jsonb language sql security invoker set search_path='' as $f$ select private.labor_mutate(target_company_id,'save',payload); $f$;
create function public.submit_labor_submission(target_company_id uuid,payload jsonb) returns jsonb language sql security invoker set search_path='' as $f$ select private.labor_mutate(target_company_id,'submit',payload); $f$;
create function public.review_labor_submission(target_company_id uuid,payload jsonb) returns jsonb language sql security invoker set search_path='' as $f$ select private.labor_mutate(target_company_id,'review',payload); $f$;
create function public.list_company_worker_rates(target_company_id uuid,target_profile_id uuid) returns jsonb language sql security invoker set search_path='' as $f$ select private.list_company_worker_rates(target_company_id,target_profile_id); $f$;
create function public.get_labor_submission(target_company_id uuid,target_submission_id uuid) returns jsonb language sql security invoker set search_path='' as $f$ select private.labor_detail(target_company_id,target_submission_id); $f$;
create function public.list_labor_source_options(target_company_id uuid,target_profile_id uuid default null) returns jsonb language sql security invoker set search_path='' as $f$ select private.list_labor_source_options(target_company_id,target_profile_id); $f$;
create function public.list_labor_submissions(target_company_id uuid,target_profile_id uuid default null,target_job_id uuid default null) returns jsonb language sql security invoker set search_path='' as $f$ select private.list_labor_submissions(target_company_id,target_profile_id,target_job_id); $f$;
create function public.get_labor_cost_preview(target_company_id uuid,target_submission_id uuid,target_version_id uuid) returns jsonb language sql security invoker set search_path='' as $f$ select private.get_labor_cost_preview(target_company_id,target_submission_id,target_version_id); $f$;
create function public.get_job_labor_cost_totals(target_company_id uuid,job_ids uuid[]) returns jsonb language sql security invoker set search_path='' as $f$ select private.get_job_labor_cost_totals(target_company_id,job_ids); $f$;

-- RPC-only exposure. Financial fields never become worker-visible table columns.
do $acl$
declare t text; f record;
begin
 foreach t in array array['company_worker_rate_schedules','company_worker_rate_versions','labor_submissions','labor_submission_versions','labor_submission_lines','labor_submission_sources','labor_cost_snapshots','labor_history_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated,service_role',t);
  execute format('create trigger %I before truncate on public.%I for each statement execute function private.labor_immutable()',t||'_no_truncate',t);
 end loop;
 alter table private.labor_operation_receipts enable row level security;
 revoke all on private.labor_operation_receipts from public,anon,authenticated,service_role;
 for f in select p.oid::regprocedure::text signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname='private' and p.proname in ('labor_actor','labor_is_finance','labor_lock','labor_assert_scope','labor_assert_capability','labor_immutable','labor_version_guard','labor_line_guard','labor_pointer_guard','labor_source_document','labor_source_guard','labor_rate_dto','labor_redact','labor_detail','labor_cost_preview','labor_sources_validate','labor_mutate','list_company_worker_rates','list_labor_source_options','list_labor_submissions','get_labor_cost_preview','get_job_labor_cost_totals'))
  or (n.nspname='public' and p.proname in ('set_company_worker_rate','save_labor_submission_draft','submit_labor_submission','review_labor_submission','list_company_worker_rates','get_labor_submission','list_labor_source_options','list_labor_submissions','get_labor_cost_preview','get_job_labor_cost_totals')) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
   if f.nspname='public' or f.proname in ('labor_mutate','labor_detail','list_company_worker_rates','list_labor_source_options','list_labor_submissions','get_labor_cost_preview','get_job_labor_cost_totals') then
    execute format('grant execute on function %s to authenticated',f.signature);
   end if;
 end loop;
end $acl$;
