-- C01-02: a completed receipt exists only with the complete job tree and accepted quote.
-- No historical jobs, quotes or customer records are rewritten by this migration.
-- Receipts deliberately retain identifiers after a source/job deletion: retries must
-- fail closed rather than manufacture a second tree. No customer data is copied back.
create table private.core_quote_conversions (
  company_id uuid not null references public.companies(id) on delete restrict,
  quote_id uuid not null,
  job_id uuid not null,
  child_job_ids uuid[] not null,
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  actor_id uuid not null,
  completed_at timestamptz not null default clock_timestamp(),
  created_xid xid8 not null default pg_current_xact_id(),
  primary key(company_id,quote_id),
  unique(job_id)
);
create table private.core_quote_conversion_requests (
  company_id uuid not null,
  operation_id uuid not null,
  quote_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(company_id,operation_id),
  foreign key(company_id,quote_id) references private.core_quote_conversions(company_id,quote_id) on delete restrict
);
create index core_quote_conversion_requests_quote_idx on private.core_quote_conversion_requests(company_id,quote_id);
alter table private.core_quote_conversions enable row level security;
alter table private.core_quote_conversion_requests enable row level security;
revoke all on private.core_quote_conversions,private.core_quote_conversion_requests from public,anon,authenticated,service_role;


-- No caller-controlled bypass switch: only a receipt preallocated in this very
-- transaction may authorize a new source link. Old clients fail before inserting
-- a parent; unrelated manually created jobs retain their existing write routes.
create function private.guard_core_quote_source_link()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if tg_op='UPDATE' and new.source_quote_id is not distinct from old.source_quote_id then return new; end if;
  if tg_op='UPDATE' and old.source_quote_id is not null then
    -- Preserve ON DELETE SET NULL only after the source quote has actually gone.
    -- A direct UPDATE cannot detach a surviving quote or reuse its conversion.
    if new.source_quote_id is null and not exists(select 1 from public.quotes where id=old.source_quote_id) then return new; end if;
    raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409';
  end if;
  if new.source_quote_id is not null and not exists(select 1 from private.core_quote_conversions r
    where r.company_id=new.company_id and r.quote_id=new.source_quote_id and r.job_id=new.id
      and r.created_xid=pg_current_xact_id()) then
    raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501';
  end if;
  return new;
end;
$f$;
revoke all on function private.guard_core_quote_source_link() from public,anon,authenticated,service_role;
create trigger guard_core_quote_source_link before insert or update of source_quote_id on public.jobs
  for each row execute function private.guard_core_quote_source_link();

-- Deferred verification also prevents a direct transaction from deleting a newly
-- created child between RPC completion and COMMIT. Later ordinary job edits are
-- not frozen: the receipt proves the complete original conversion, not its future state.
create function private.check_core_quote_conversion_complete()
returns trigger language plpgsql security definer set search_path='' as $f$
begin
  if not exists(select 1 from public.jobs j join public.quotes q on q.id=new.quote_id and q.company_id=new.company_id
      where j.id=new.job_id and j.company_id=new.company_id and j.source_quote_id=new.quote_id and j.parent_job_id is null
        and j.customer_id is not distinct from q.customer_id and j.price=q.total_price and j.currency=q.currency
        and q.status='accepted' and q.accepted_at is not null)
    or (select count(*) from public.jobs j where j.parent_job_id=new.job_id)<>cardinality(new.child_job_ids)
    or exists(select 1 from unnest(new.child_job_ids) child_id left join public.jobs j on j.id=child_id
      where j.id is null or j.company_id<>new.company_id or j.parent_job_id is distinct from new.job_id or j.source_quote_id is not null)
    or not exists(select 1 from private.core_quote_conversion_requests r where r.company_id=new.company_id and r.quote_id=new.quote_id) then
    raise exception 'CORE_QUOTE_RESULT_MISSING' using errcode='PT409';
  end if;
  return null;
end;
$f$;
revoke all on function private.check_core_quote_conversion_complete() from public,anon,authenticated,service_role;
create constraint trigger core_quote_conversion_complete after insert on private.core_quote_conversions
  deferrable initially deferred for each row execute function private.check_core_quote_conversion_complete();

create function private.core_quote_actor(p_company_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid;
begin
  if auth.uid() is null then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
  select p.id into v_actor from public.profiles p join public.company_members m on m.profile_id=p.id
  where p.auth_user_id=auth.uid() and (p.user_id is null or p.user_id=p.auth_user_id)
    and p.is_active and m.company_id=p_company_id and m.is_active and m.role in('company_admin','super_admin');
  if v_actor is null then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
  return v_actor;
end;
$f$;
revoke all on function private.core_quote_actor(uuid) from public,anon,authenticated,service_role;

-- Lock current authorization rows, then recheck with wall time after every possible
-- wait. The final invocation also catches expiry or authorization changes during DML.
create function private.assert_core_quote_conversion(p_company_id uuid)
returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid; v_access jsonb; v_paid public.company_module_entitlements%rowtype;
  v_test private.company_test_module_grants%rowtype; v_valid boolean; v_now timestamptz;
begin
  v_actor:=private.core_quote_actor(p_company_id);
  perform 1 from public.profiles where id=v_actor for share;
  perform 1 from public.company_members where company_id=p_company_id and profile_id=v_actor for share;
  perform 1 from public.company_modules where company_id=p_company_id and module_key in('jobs','quotes') order by module_key for share;
  perform private.core_quote_actor(p_company_id);
  if exists(select 1 from public.company_modules where company_id=p_company_id and module_key in('jobs','quotes') and not is_enabled) then
    raise exception 'CORE_QUOTE_MODULE_REQUIRED' using errcode='42501';
  end if;
  perform private.evaluate_company_capability_access(p_company_id,'core.jobs.create',clock_timestamp());
  v_access:=private.evaluate_company_capability_access(p_company_id,'core.jobs.create',clock_timestamp());
  if not coalesce((v_access->>'allowed')::boolean,false) then raise exception 'CORE_QUOTE_MODULE_REQUIRED' using errcode='42501'; end if;
  if v_access->>'reason'='paid' then
    select * into v_paid from public.company_module_entitlements where id=(v_access->>'entitlement_id')::uuid and company_id=p_company_id for share;
    if not found then raise exception 'CORE_QUOTE_MODULE_REQUIRED' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    v_valid:=v_paid.product='diriqo_core' and v_paid.register_id is null
      and v_paid.policy_version='diriqo-capabilities-v0.1' and v_paid.origin='paid' and v_paid.state='active' and not v_paid.revoked
      and v_paid.livemode=(v_access->>'livemode')::boolean and v_paid.valid_from<=v_now and v_now<v_paid.valid_until
      and 'core.jobs.create'=any(v_paid.capabilities);
  elsif v_access->>'reason'='test' then
    select * into v_test from private.company_test_module_grants where id=(v_access->>'test_grant_id')::uuid and company_id=p_company_id for share;
    if not found then raise exception 'CORE_QUOTE_MODULE_REQUIRED' using errcode='42501'; end if;
    v_now:=clock_timestamp();
    v_valid:=v_test.product='diriqo_core' and v_test.register_id is null
      and v_test.policy_version='diriqo-capabilities-v0.1' and v_test.origin='manual_grant' and v_test.state='active' and v_test.revoked_at is null
      and not v_test.livemode and (v_access->>'livemode')::boolean=false
      and v_test.valid_from<=v_now and v_now<v_test.valid_until and 'core.jobs.create'=any(v_test.capabilities);
  else
    v_valid:=v_access->>'reason'='legacy' and (v_access->>'enforced')::boolean=false;
  end if;
  if v_valid is distinct from true then raise exception 'CORE_QUOTE_MODULE_REQUIRED' using errcode='42501'; end if;
  perform private.core_quote_actor(p_company_id);
  if exists(select 1 from public.company_modules where company_id=p_company_id and module_key in('jobs','quotes') and not is_enabled) then
    raise exception 'CORE_QUOTE_MODULE_REQUIRED' using errcode='42501';
  end if;
  return v_actor;
exception when insufficient_privilege then
  if sqlerrm='MODULE_CAPABILITY_FORBIDDEN' then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
  raise;
end;
$f$;
revoke all on function private.assert_core_quote_conversion(uuid) from public,anon,authenticated,service_role;

create function private.core_quote_conversion_input(p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $f$
declare v_start timestamptz; v_end timestamptz; v_day_start timestamptz; v_day_end timestamptz;
  v_previous timestamptz; v_day jsonb; v_days jsonb:='[]'; v_sorted jsonb;
  v_pattern constant text:='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$';
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>250000 then
    raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in('title','description','address','start_at','end_at','split_days'))
    or jsonb_typeof(p_input->'title') is distinct from 'string' or length(btrim(p_input->>'title')) not between 1 and 300
    or (p_input ? 'description' and jsonb_typeof(p_input->'description') not in('string','null'))
    or (p_input ? 'address' and jsonb_typeof(p_input->'address') not in('string','null'))
    or length(coalesce(p_input->>'description',''))>10000 or length(coalesce(p_input->>'address',''))>2000
    or jsonb_typeof(p_input->'start_at') is distinct from 'string' or jsonb_typeof(p_input->'end_at') is distinct from 'string'
    or (p_input->>'start_at') !~ v_pattern or (p_input->>'end_at') !~ v_pattern
    or jsonb_typeof(p_input->'split_days') is distinct from 'array' then
    raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023';
  end if;
  if jsonb_array_length(p_input->'split_days')>366 then raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023'; end if;
  v_start:=(p_input->>'start_at')::timestamptz; v_end:=(p_input->>'end_at')::timestamptz;
  if not isfinite(v_start) or not isfinite(v_end) or v_start<'1900-01-01T00:00:00Z'::timestamptz
    or v_end>='10000-01-01T00:00:00Z'::timestamptz or v_end<=v_start then
    raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023';
  end if;
  for v_day in select value from jsonb_array_elements(p_input->'split_days') loop
    if jsonb_typeof(v_day) is distinct from 'object' then raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023'; end if;
    if exists(select 1 from jsonb_object_keys(v_day) k where k not in('label','start_at','end_at'))
      or jsonb_typeof(v_day->'label') is distinct from 'string' or length(btrim(v_day->>'label')) not between 1 and 200
      or jsonb_typeof(v_day->'start_at') is distinct from 'string' or jsonb_typeof(v_day->'end_at') is distinct from 'string'
      or (v_day->>'start_at') !~ v_pattern or (v_day->>'end_at') !~ v_pattern then
      raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023';
    end if;
    v_day_start:=(v_day->>'start_at')::timestamptz; v_day_end:=(v_day->>'end_at')::timestamptz;
    if not isfinite(v_day_start) or not isfinite(v_day_end) or v_day_start<v_start or v_day_end>v_end or v_day_end<=v_day_start then
      raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023';
    end if;
    v_days:=v_days||jsonb_build_array(jsonb_build_object('label',btrim(v_day->>'label'),
      'start_at',to_char(v_day_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'end_at',to_char(v_day_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end loop;
  select coalesce(jsonb_agg(value order by value->>'start_at',value->>'end_at',value->>'label'),'[]') into v_sorted from jsonb_array_elements(v_days);
  for v_day in select value from jsonb_array_elements(v_sorted) loop
    if v_previous>(v_day->>'start_at')::timestamptz then raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023'; end if;
    v_previous:=(v_day->>'end_at')::timestamptz;
  end loop;
  return jsonb_build_object('title',btrim(p_input->>'title'),'description',nullif(btrim(p_input->>'description'),''),
    'address',nullif(btrim(p_input->>'address'),''),
    'start_at',to_char(v_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'end_at',to_char(v_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'split_days',v_sorted);
exception when invalid_datetime_format or datetime_field_overflow then
  raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023';
end;
$f$;
revoke all on function private.core_quote_conversion_input(jsonb) from public,anon,authenticated,service_role;

create function private.convert_core_quote_to_job_atomic(p_company_id uuid,p_quote_id uuid,p_operation_id uuid,p_input jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare v_actor uuid; v_input jsonb; v_quote public.quotes%rowtype;
  v_receipt private.core_quote_conversions%rowtype; v_request private.core_quote_conversion_requests%rowtype;
  v_job uuid; v_child uuid; v_children uuid[]:='{}'; v_day jsonb; v_index integer:=0;
begin
  perform private.core_quote_actor(p_company_id);
  if p_company_id is null or p_quote_id is null or p_operation_id is null then raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023'; end if;
  v_input:=private.core_quote_conversion_input(p_input);
  -- Same-company operations serialize both quote identity and reuse of an operation
  -- ID across different quotes. The existing root unique index remains a second guard.
  perform 1 from public.companies where id=p_company_id for update;
  if not found then raise exception 'CORE_QUOTE_FORBIDDEN' using errcode='42501'; end if;
  v_actor:=private.assert_core_quote_conversion(p_company_id);
  select * into v_quote from public.quotes where id=p_quote_id and company_id=p_company_id for update;
  if not found then raise exception 'CORE_QUOTE_NOT_FOUND' using errcode='P0002'; end if;
  perform private.assert_core_quote_conversion(p_company_id);
  select * into v_request from private.core_quote_conversion_requests where company_id=p_company_id and operation_id=p_operation_id;
  if found and v_request.quote_id<>p_quote_id then raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409'; end if;
  select * into v_receipt from private.core_quote_conversions where company_id=p_company_id and quote_id=p_quote_id;
  if found then
    if v_receipt.payload<>v_input then
      if v_request.operation_id is not null then raise exception 'CORE_QUOTE_REQUEST_CONFLICT' using errcode='PT409'; end if;
      raise exception 'CORE_QUOTE_ALREADY_CONVERTED' using errcode='PT409';
    end if;
    perform 1 from public.jobs where id=v_receipt.job_id and company_id=p_company_id and source_quote_id=p_quote_id for share;
    if not found then raise exception 'CORE_QUOTE_RESULT_MISSING' using errcode='PT409'; end if;
    insert into private.core_quote_conversion_requests(company_id,operation_id,quote_id) values(p_company_id,p_operation_id,p_quote_id) on conflict do nothing;
    perform private.assert_core_quote_conversion(p_company_id);
    return jsonb_build_object('companyId',p_company_id,'quoteId',p_quote_id,'jobId',v_receipt.job_id,'created',false);
  end if;
  -- A historical parent can have been attached under another job. Any reference
  -- means uncertain legacy completion; never infer success from a surviving parent.
  if exists(select 1 from public.jobs where source_quote_id=p_quote_id) then
    raise exception 'CORE_QUOTE_LEGACY_CONVERSION' using errcode='PT409';
  end if;
  if v_quote.status not in('draft','ready','sent','viewed','waiting_followup','revision_requested','accepted') then
    raise exception 'CORE_QUOTE_STATUS_INVALID' using errcode='PT409';
  end if;
  if v_quote.customer_id is not null then
    perform 1 from public.customers where id=v_quote.customer_id and company_id=p_company_id for share;
    if not found then raise exception 'CORE_QUOTE_SCOPE_INVALID' using errcode='23514'; end if;
  end if;
  if v_quote.currency is null or v_quote.currency !~ '^[A-Z]{3}$' then raise exception 'CORE_QUOTE_CURRENCY_UNSUPPORTED' using errcode='22023'; end if;
  if v_quote.total_price is null or v_quote.total_price<0 or v_quote.total_price::text in('NaN','Infinity','-Infinity') then
    raise exception 'CORE_QUOTE_INPUT_INVALID' using errcode='22023';
  end if;
  perform private.assert_core_quote_conversion(p_company_id);
  v_job:=gen_random_uuid();
  select coalesce(array_agg(gen_random_uuid()),'{}'::uuid[]) into v_children from jsonb_array_elements(v_input->'split_days');
  insert into private.core_quote_conversions(company_id,quote_id,job_id,child_job_ids,payload,actor_id)
    values(p_company_id,p_quote_id,v_job,v_children,v_input,v_actor);
  insert into private.core_quote_conversion_requests(company_id,operation_id,quote_id) values(p_company_id,p_operation_id,p_quote_id);
  insert into public.jobs(id,company_id,customer_id,title,description,address,status,work_state,billing_status,billing_state,is_paid,
    price,currency,start_at,end_at,parent_job_id,source_quote_id)
  values(v_job,p_company_id,v_quote.customer_id,v_input->>'title',v_input->>'description',v_input->>'address','planned','not_started',
    'waiting_for_invoice','waiting_for_invoice',false,v_quote.total_price,v_quote.currency,
    (v_input->>'start_at')::timestamptz,(v_input->>'end_at')::timestamptz,null,p_quote_id) returning id into v_job;
  for v_day in select value from jsonb_array_elements(v_input->'split_days') loop
    v_index:=v_index+1; v_child:=v_children[v_index];
    insert into public.jobs(id,company_id,customer_id,title,description,address,status,work_state,billing_status,billing_state,is_paid,
      price,currency,start_at,end_at,parent_job_id,source_quote_id)
    values(v_child,p_company_id,v_quote.customer_id,(v_input->>'title')||' - '||(v_day->>'label'),v_input->>'description',v_input->>'address','planned','not_started',
      'waiting_for_invoice','waiting_for_invoice',false,0,v_quote.currency,
      (v_day->>'start_at')::timestamptz,(v_day->>'end_at')::timestamptz,v_job,null) returning id into v_child;
  end loop;
  update public.quotes set status='accepted',accepted_at=coalesce(accepted_at,clock_timestamp()),updated_at=clock_timestamp()
    where id=p_quote_id and company_id=p_company_id;

  perform private.assert_core_quote_conversion(p_company_id);
  return jsonb_build_object('companyId',p_company_id,'quoteId',p_quote_id,'jobId',v_job,'created',true);
end;
$f$;
revoke all on function private.convert_core_quote_to_job_atomic(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.convert_core_quote_to_job_atomic(uuid,uuid,uuid,jsonb) to authenticated;
create function public.convert_core_quote_to_job_atomic(p_company_id uuid,p_quote_id uuid,p_operation_id uuid,p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $f$
  select private.convert_core_quote_to_job_atomic(p_company_id,p_quote_id,p_operation_id,p_input);
$f$;
revoke all on function public.convert_core_quote_to_job_atomic(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.convert_core_quote_to_job_atomic(uuid,uuid,uuid,jsonb) to authenticated;
