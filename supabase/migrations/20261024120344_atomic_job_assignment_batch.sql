-- Additive atomic assignment commands. Existing source rows, approvals, rates and grants are unchanged.
-- Direct REST writers and mobile row-before-worker locking remain separate release gates.
set local lock_timeout = '5s';
do $preflight$
begin
 if not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='public.jobs'::regclass
  and c.confrelid='public.jobs'::regclass and c.contype='f' and c.convalidated and not c.condeferrable
  and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid='public.jobs'::regclass and attname='parent_job_id')]::smallint[]
  and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid='public.jobs'::regclass and attname='id')]::smallint[]) then
  raise exception 'JOB_ASSIGNMENT_PARENT_FK_REQUIRED';
 end if;
 if not exists(select 1 from pg_catalog.pg_constraint c where c.conrelid='public.job_assignments'::regclass
  and c.confrelid='public.jobs'::regclass and c.contype='f' and c.convalidated and not c.condeferrable
  and c.conkey=array[(select attnum from pg_catalog.pg_attribute where attrelid='public.job_assignments'::regclass and attname='job_id')]::smallint[]
  and c.confkey=array[(select attnum from pg_catalog.pg_attribute where attrelid='public.jobs'::regclass and attname='id')]::smallint[]) then
  raise exception 'JOB_ASSIGNMENT_JOB_FK_REQUIRED';
 end if;
end $preflight$;

create table private.job_assignment_batch_receipts (
 company_id uuid not null, actor_id uuid not null, operation_id uuid not null, job_id uuid not null,
 kind text not null check(kind in ('upsert','delete')), request_hash text not null,
 response jsonb not null check(jsonb_typeof(response)='object'), created_at timestamptz not null default clock_timestamp(),
 primary key(company_id,actor_id,operation_id)
);
alter table private.job_assignment_batch_receipts enable row level security;
revoke all on private.job_assignment_batch_receipts from public,anon,authenticated,service_role;

create function private.job_assignment_batch_uuid(v jsonb) returns uuid language plpgsql immutable set search_path='' as $f$
begin
 if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
  raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 return (v#>>'{}')::uuid;
end $f$;
create function private.job_assignment_batch_number(v jsonb,required boolean) returns numeric language plpgsql immutable set search_path='' as $f$
declare t text; n numeric;
begin
 if v is null or v='null'::jsonb then
  if required then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;return null;
 end if;
 t:=btrim(v#>>'{}');
 if jsonb_typeof(v) not in ('number','string') or length(t)>32 or t !~ '^[0-9]+(\.[0-9]{1,2})?$' then
  raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 n:=t::numeric;if n<0 or n>9999999999.99 then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 return n;
end $f$;
create function private.job_assignment_batch_rows(input jsonb) returns jsonb language plpgsql immutable set search_path='' as $f$
declare r jsonb; result jsonb:='[]'; p uuid; rid uuid; seen uuid[]:='{}'; wt text; bt text; h numeric; rate numeric; amount numeric; hourly boolean; note_value text;
begin
 if jsonb_typeof(input) is distinct from 'array' or jsonb_array_length(input) not between 1 and 200 then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(input) loop
  if jsonb_typeof(r) is distinct from 'object' then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(r) k where k not in ('id','profile_id','labor_hours','hourly_rate','worker_type_snapshot','assignment_billing_type','external_amount','note')) then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
  p:=private.job_assignment_batch_uuid(r->'profile_id');
  if p=any(seen) then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;seen:=array_append(seen,p);
  rid:=null;if r?'id' and r->'id'<>'null'::jsonb then rid:=private.job_assignment_batch_uuid(r->'id');end if;
  wt:=coalesce(r->>'worker_type_snapshot','employee');bt:=case when wt='contractor' then r->>'assignment_billing_type' else null end;
  if wt not in ('employee','contractor') or (wt='contractor' and (bt is null or bt not in ('hourly','fixed','invoice'))) then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
  hourly:=wt='employee' or bt='hourly';
  h:=private.job_assignment_batch_number(r->'labor_hours',hourly);rate:=private.job_assignment_batch_number(r->'hourly_rate',hourly);
  amount:=private.job_assignment_batch_number(r->'external_amount',not hourly);
  if r?'note' and r->'note'<>'null'::jsonb and jsonb_typeof(r->'note')<>'string' then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
  note_value:=nullif(btrim(r->>'note'),'');if length(note_value)>4000 then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
  result:=result||jsonb_build_array(jsonb_build_object('profile_id',p,'worker_type_snapshot',wt,'assignment_billing_type',bt,
   'external_amount',case when hourly then null else amount end,'note',note_value)
   ||case when rid is null then '{}'::jsonb else jsonb_build_object('id',rid) end
   ||case when h is null then '{}'::jsonb else jsonb_build_object('labor_hours',h) end
   ||case when rate is null then '{}'::jsonb else jsonb_build_object('hourly_rate',rate) end);
 end loop;
 select jsonb_agg(value order by value->>'profile_id') into result from jsonb_array_elements(result);return result;
end $f$;

create function private.job_assignment_batch_access(c uuid,write_access boolean) returns uuid language plpgsql volatile security definer set search_path='' as $f$
declare a uuid; access jsonb; paid public.company_module_entitlements%rowtype; test private.company_test_module_grants%rowtype; valid boolean; t timestamptz;
begin
 a:=private.labor_actor(c,'finance');
 perform 1 from public.profiles where id=a for share;
 perform 1 from public.company_members where company_id=c and profile_id=a for share;
 if private.labor_actor(c,'finance') is distinct from a then raise exception 'JOB_ASSIGNMENT_ACTOR_CHANGED' using errcode='42501';end if;
 if not write_access then return a;end if;
 perform 1 from public.company_modules where company_id=c and module_key='jobs' for share;
 if exists(select 1 from public.company_modules where company_id=c and module_key='jobs' and not is_enabled) then raise exception 'JOB_ASSIGNMENT_MODULE_REQUIRED' using errcode='42501';end if;
 access:=private.evaluate_company_capability_access(c,'core.jobs.update',clock_timestamp());
 if not coalesce((access->>'allowed')::boolean,false) then raise exception 'JOB_ASSIGNMENT_MODULE_REQUIRED' using errcode='42501';end if;
 if access->>'reason'='paid' then
  select * into paid from public.company_module_entitlements where id=(access->>'entitlement_id')::uuid and company_id=c for share;
  t:=clock_timestamp();valid:=found and paid.product='diriqo_core' and paid.register_id is null and paid.origin='paid'
   and paid.policy_version='diriqo-capabilities-v0.1' and paid.state='active' and not paid.revoked
   and paid.livemode=(access->>'livemode')::boolean and paid.valid_from<=t and t<paid.valid_until and 'core.jobs.update'=any(paid.capabilities);
 elsif access->>'reason'='test' then
  select * into test from private.company_test_module_grants where id=(access->>'test_grant_id')::uuid and company_id=c for share;
  t:=clock_timestamp();valid:=found and test.product='diriqo_core' and test.register_id is null and test.origin='manual_grant'
   and test.policy_version='diriqo-capabilities-v0.1' and test.state='active' and test.revoked_at is null and not test.livemode
   and (access->>'livemode')::boolean=false and test.valid_from<=t and t<test.valid_until and 'core.jobs.update'=any(test.capabilities);
 else valid:=access->>'reason'='legacy' and (access->>'enforced')::boolean=false;
 end if;
 if valid is distinct from true then raise exception 'JOB_ASSIGNMENT_MODULE_REQUIRED' using errcode='42501';end if;
 if private.labor_actor(c,'finance') is distinct from a then raise exception 'JOB_ASSIGNMENT_ACTOR_CHANGED' using errcode='42501';end if;
 return a;
exception when insufficient_privilege then
 if sqlerrm in ('LABOR_FORBIDDEN','MODULE_CAPABILITY_FORBIDDEN') then raise exception 'JOB_ASSIGNMENT_FORBIDDEN' using errcode='42501';end if;raise;
end $f$;

create function private.job_assignment_batch_snapshot(c uuid,j uuid) returns jsonb language plpgsql volatile security definer set search_path='' set timezone='UTC' as $f$
declare result jsonb;
begin
 with root as (select id,parent_job_id from public.jobs where id=j and company_id=c),
 scope as (select id from root union select x.id from public.jobs x cross join root where root.parent_job_id is null and x.parent_job_id=root.id and x.company_id=c)
 select jsonb_build_object('company_id',c,'job_id',j,'parent_job_id',root.parent_job_id,
  'target_job_ids',(select jsonb_agg(id order by id) from scope),
  'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.job_assignments a where a.company_id=c and a.job_id in(select id from scope)),'[]'::jsonb))
 into result from root;
 if result is null then raise exception 'JOB_ASSIGNMENT_NOT_FOUND' using errcode='42501';end if;
 if jsonb_array_length(result->'target_job_ids')>1000 or jsonb_array_length(result->'assignments')>20000 then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 return result;
end $f$;
create function private.job_assignment_batch_token(d jsonb) returns text language sql immutable set search_path='' as $f$
 select encode(sha256(convert_to(d::text,'UTF8')),'hex');
$f$;
-- One canonical command/hash for apply and cancel: cancellation must reserve the
-- exact original operation, including its stale scope token and normalized rows.
create function private.job_assignment_batch_command(c uuid,j uuid,p jsonb) returns jsonb language plpgsql immutable set search_path='' as $f$
declare expected_actor uuid; op_id uuid; mode text; token text; normalized jsonb; source_id uuid; command jsonb;
begin
 if c is null or j is null or jsonb_typeof(p) is distinct from 'object' then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('actor_id','operation_id','scope_token','kind','assignments','assignment_id')) then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 expected_actor:=private.job_assignment_batch_uuid(p->'actor_id');op_id:=private.job_assignment_batch_uuid(p->'operation_id');mode:=p->>'kind';token:=p->>'scope_token';
 if mode is null or mode not in ('upsert','delete') or jsonb_typeof(p->'scope_token') is distinct from 'string' or token !~ '^[0-9a-f]{64}$' then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 if mode='upsert' then
  if p?'assignment_id' then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
  normalized:=private.job_assignment_batch_rows(p->'assignments');
 else
  if p?'assignments' then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
  source_id:=private.job_assignment_batch_uuid(p->'assignment_id');normalized:='[]';
 end if;
 command:=jsonb_build_object('company_id',c,'actor_id',expected_actor,'job_id',j,'kind',mode,'scope_token',token,'assignments',normalized,'assignment_id',source_id);
 return command||jsonb_build_object('operation_id',op_id,'request_hash',private.job_assignment_batch_token(command));
end $f$;
create function private.job_assignment_batch_project(r jsonb) returns jsonb language sql immutable set search_path='' as $f$
 select jsonb_build_object('id',r->'id','company_id',r->'company_id','job_id',r->'job_id','profile_id',r->'profile_id',
  'labor_hours',r->'labor_hours','hourly_rate',r->'hourly_rate','worker_type_snapshot',r->'worker_type_snapshot',
  'assignment_billing_type',r->'assignment_billing_type','external_amount',r->'external_amount','note',r->'note',
  'work_started_at',r->'work_started_at','work_completed_at',r->'work_completed_at','archived_at',r->'archived_at');
$f$;
create function private.get_job_assignment_batch_workspace(c uuid,j uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare a uuid; d jsonb; rows jsonb;
begin
 a:=private.job_assignment_batch_access(c,false);d:=private.job_assignment_batch_snapshot(c,j);
 select coalesce(jsonb_agg(private.job_assignment_batch_project(value) order by value->>'id'),'[]') into rows from jsonb_array_elements(d->'assignments');
 return jsonb_build_object('company_id',c,'actor_id',a,'job_id',j,'scope_token',private.job_assignment_batch_token(d),'target_job_ids',d->'target_job_ids','assignments',rows);
end $f$;
create function private.get_job_assignment_batch_receipt(c uuid,j uuid,op_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare a uuid; result jsonb;
begin
 a:=private.job_assignment_batch_access(c,false);
 if j is null or op_id is null then raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';end if;
 select response into result from private.job_assignment_batch_receipts where company_id=c and actor_id=a and operation_id=op_id and job_id=j;
 return result;
end $f$;

create function private.mutate_job_assignments_atomic(c uuid,j uuid,p jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare a uuid; expected_actor uuid; op_id uuid; mode text; token text; normalized jsonb; command jsonb; request_hash text; old_receipt private.job_assignment_batch_receipts%rowtype;
 before_doc jsonb; locked_doc jsonb; after_doc jsonb; before_workers uuid[]; after_workers uuid[]; target_ids uuid[]; worker uuid; root_parent uuid;
 source_id uuid; item jsonb; source_row public.job_assignments%rowtype; target_job uuid; update_values jsonb; result jsonb; root_rows jsonb; removed uuid[]:='{}';
begin
 command:=private.job_assignment_batch_command(c,j,p);
 expected_actor:=(command->>'actor_id')::uuid;op_id:=(command->>'operation_id')::uuid;mode:=command->>'kind';token:=command->>'scope_token';
 normalized:=command->'assignments';source_id:=(command->>'assignment_id')::uuid;request_hash:=command->>'request_hash';
 a:=private.labor_actor(c,'finance');if a<>expected_actor then raise exception 'JOB_ASSIGNMENT_ACTOR_CHANGED' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-assignment-op:'||c::text||':'||a::text||':'||op_id::text,0));
 select * into old_receipt from private.job_assignment_batch_receipts where company_id=c and actor_id=a and operation_id=op_id;
 if found then
  if private.job_assignment_batch_access(c,false)<>expected_actor then raise exception 'JOB_ASSIGNMENT_ACTOR_CHANGED' using errcode='42501';end if;
  if old_receipt.job_id<>j or old_receipt.kind<>mode or old_receipt.request_hash<>request_hash then raise exception 'JOB_ASSIGNMENT_OPERATION_CONFLICT' using errcode='PT409';end if;
  return old_receipt.response;
 end if;
 before_doc:=private.job_assignment_batch_snapshot(c,j);
 -- Conservative upper bound before locking/writing any worker batch: never loop
 -- over a potentially oversized Cartesian propagation only to roll it back later.
 if mode='upsert' and jsonb_array_length(before_doc->'assignments')
   +jsonb_array_length(before_doc->'target_job_ids')*jsonb_array_length(normalized)>20000 then
  raise exception 'JOB_ASSIGNMENT_INVALID' using errcode='22023';
 end if;
 select coalesce(array_agg(distinct (r->>'profile_id')::uuid order by (r->>'profile_id')::uuid),'{}'::uuid[]) into before_workers
 from (select value r from jsonb_array_elements(before_doc->'assignments') union all select value from jsonb_array_elements(normalized)) x where r->>'profile_id' is not null;
 foreach worker in array before_workers loop perform private.labor_lock(c,worker);end loop;
 if private.job_assignment_batch_access(c,true)<>expected_actor then raise exception 'JOB_ASSIGNMENT_ACTOR_CHANGED' using errcode='42501';end if;
 -- Immediate parent FK prevents a new child reference while the root is locked.
 -- Job locks also prevent a direct insert creating an unseen assignment via its job FK.
 select parent_job_id into root_parent from public.jobs where company_id=c and id=j for update;
 if not found then raise exception 'JOB_ASSIGNMENT_NOT_FOUND' using errcode='42501';end if;
 if root_parent is null then perform id from public.jobs where company_id=c and parent_job_id=j order by id for update;end if;
 locked_doc:=private.job_assignment_batch_snapshot(c,j);
 select coalesce(array_agg(distinct (r->>'profile_id')::uuid order by (r->>'profile_id')::uuid),'{}'::uuid[]) into after_workers
 from (select value r from jsonb_array_elements(locked_doc->'assignments') union all select value from jsonb_array_elements(normalized)) x where r->>'profile_id' is not null;
 if after_workers is distinct from before_workers or private.job_assignment_batch_token(locked_doc)<>token then raise exception 'JOB_ASSIGNMENT_SCOPE_CONFLICT' using errcode='PT409';end if;
 select array_agg(value::uuid order by value::uuid) into target_ids from jsonb_array_elements_text(locked_doc->'target_job_ids');
 perform id from public.job_assignments where company_id=c and job_id=any(target_ids) order by profile_id,id for update;
 locked_doc:=private.job_assignment_batch_snapshot(c,j);
 if private.job_assignment_batch_token(locked_doc)<>token then raise exception 'JOB_ASSIGNMENT_SCOPE_CONFLICT' using errcode='PT409';end if;
 if mode='upsert' then
  for item in select value from jsonb_array_elements(normalized) loop
   worker:=(item->>'profile_id')::uuid;perform private.labor_assert_scope(c,worker,j);
   if item?'id' and not exists(select 1 from public.job_assignments where id=(item->>'id')::uuid and company_id=c and job_id=any(target_ids) and profile_id=worker) then raise exception 'JOB_ASSIGNMENT_SCOPE_CONFLICT' using errcode='PT409';end if;
  end loop;
 else
  select * into source_row from public.job_assignments where id=source_id and company_id=c and job_id=any(target_ids);
  if not found or source_row.profile_id is null then raise exception 'JOB_ASSIGNMENT_NOT_FOUND' using errcode='42501';end if;worker:=source_row.profile_id;
 end if;
 -- Entire scope is protected before the first write. The original trigger remains the final guard.
 for source_row in select * from public.job_assignments where company_id=c and job_id=any(target_ids) order by profile_id,id loop
  if mode='delete' then
   if source_row.profile_id<>worker then continue;end if;
  else
   select value into item from jsonb_array_elements(normalized) where (value->>'profile_id')::uuid=source_row.profile_id;
   if not found then continue;end if;
   update_values:=item-array['id','profile_id'];
   if (to_jsonb(source_row)-array['note','updated_at']) is not distinct from ((to_jsonb(source_row)||update_values)-array['note','updated_at']) then continue;end if;
  end if;
  if exists(select 1 from public.labor_submission_sources x join public.labor_submissions s on s.id=x.submission_id
   where x.company_id=c and x.source_kind='assignment' and x.source_id=source_row.id and s.company_id=c and s.approved_version_id is not null) then
   raise exception 'LABOR_APPROVED_SOURCE_IMMUTABLE' using errcode='PT409',detail=jsonb_build_object('assignment_id',source_row.id,'profile_id',source_row.profile_id,'job_id',source_row.job_id)::text;
  end if;
 end loop;
 if mode='upsert' then
  for item in select value from jsonb_array_elements(normalized) loop
   worker:=(item->>'profile_id')::uuid;
   foreach target_job in array target_ids loop
    select * into source_row from public.job_assignments where company_id=c and job_id=target_job and profile_id=worker;
    if found then
     update public.job_assignments set labor_hours=case when item?'labor_hours' then (item->>'labor_hours')::numeric else labor_hours end,
      hourly_rate=case when item?'hourly_rate' then (item->>'hourly_rate')::numeric else hourly_rate end,
      worker_type_snapshot=item->>'worker_type_snapshot',assignment_billing_type=item->>'assignment_billing_type',external_amount=(item->>'external_amount')::numeric,note=item->>'note'
     where id=source_row.id and company_id=c;
    else
     -- NOT NULL legacy hourly defaults are technical values for nonhourly new rows; no approved time/cost is inferred.
     insert into public.job_assignments(company_id,job_id,profile_id,labor_hours,hourly_rate,worker_type_snapshot,assignment_billing_type,external_amount,note)
      values(c,target_job,worker,coalesce((item->>'labor_hours')::numeric,0),coalesce((item->>'hourly_rate')::numeric,0),item->>'worker_type_snapshot',item->>'assignment_billing_type',(item->>'external_amount')::numeric,item->>'note');
    end if;
   end loop;
  end loop;
 else
  with deleted as (delete from public.job_assignments where company_id=c and job_id=any(target_ids) and profile_id=worker returning id)
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into removed from deleted;
 end if;
 if private.job_assignment_batch_access(c,true)<>expected_actor then raise exception 'JOB_ASSIGNMENT_ACTOR_CHANGED' using errcode='42501';end if;
 after_doc:=private.job_assignment_batch_snapshot(c,j);
 select coalesce(jsonb_agg(private.job_assignment_batch_project(value) order by value->>'id'),'[]') into root_rows from jsonb_array_elements(after_doc->'assignments') where (value->>'job_id')::uuid=j;
 result:=jsonb_build_object('company_id',c,'actor_id',a,'job_id',j,'operation_id',op_id,'kind',mode,'scope_token',private.job_assignment_batch_token(after_doc),'target_job_ids',after_doc->'target_job_ids','assignments',root_rows,'deleted_ids',to_jsonb(removed));
 insert into private.job_assignment_batch_receipts(company_id,actor_id,operation_id,job_id,kind,request_hash,response) values(c,a,op_id,j,mode,request_hash,result);
 return result;
exception when insufficient_privilege then
 if sqlerrm in ('LABOR_FORBIDDEN','LABOR_WORKER_SCOPE','LABOR_JOB_SCOPE','MODULE_CAPABILITY_FORBIDDEN') then raise exception 'JOB_ASSIGNMENT_FORBIDDEN' using errcode='42501';end if;raise;
when check_violation then
 -- The enclosing exception block rolls back the entire command, including any
 -- earlier rows. Preserve unexpected constraints; map only the exact guard token.
 if sqlerrm='LABOR_APPROVED_SOURCE_IMMUTABLE' then raise exception 'LABOR_APPROVED_SOURCE_IMMUTABLE' using errcode='PT409';end if;raise;
end $f$;

-- A terminal cancellation shares the apply lock/receipt key. If apply won the
-- race, return its receipt. Otherwise even a delayed apply can only return this
-- tombstone; no timeout or missing-read assumption is used to abandon an intent.
create function private.cancel_job_assignment_batch_operation(c uuid,j uuid,p jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $f$
declare command jsonb; a uuid; expected_actor uuid; op_id uuid; mode text; request_hash text; old_receipt private.job_assignment_batch_receipts%rowtype; result jsonb;
begin
 command:=private.job_assignment_batch_command(c,j,p);
 expected_actor:=(command->>'actor_id')::uuid;op_id:=(command->>'operation_id')::uuid;mode:=command->>'kind';request_hash:=command->>'request_hash';
 a:=private.labor_actor(c,'finance');if a<>expected_actor then raise exception 'JOB_ASSIGNMENT_ACTOR_CHANGED' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-assignment-op:'||c::text||':'||a::text||':'||op_id::text,0));
 -- No business-write entitlement is required to settle an uncertain operation.
 -- Do not require its job/source to still exist; the receipt namespace is scoped
 -- to the freshly authorized company and actor and does not access job data.
 if private.job_assignment_batch_access(c,false)<>expected_actor then raise exception 'JOB_ASSIGNMENT_ACTOR_CHANGED' using errcode='42501';end if;
 select * into old_receipt from private.job_assignment_batch_receipts where company_id=c and actor_id=a and operation_id=op_id;
 if found then
  if old_receipt.job_id<>j or old_receipt.kind<>mode or old_receipt.request_hash<>request_hash then raise exception 'JOB_ASSIGNMENT_OPERATION_CONFLICT' using errcode='PT409';end if;
  return old_receipt.response;
 end if;
 result:=jsonb_build_object('company_id',c,'actor_id',a,'job_id',j,'operation_id',op_id,'kind',mode,'cancelled',true);
 insert into private.job_assignment_batch_receipts(company_id,actor_id,operation_id,job_id,kind,request_hash,response) values(c,a,op_id,j,mode,request_hash,result);
 return result;
exception when insufficient_privilege then
 if sqlerrm in ('LABOR_FORBIDDEN','MODULE_CAPABILITY_FORBIDDEN') then raise exception 'JOB_ASSIGNMENT_FORBIDDEN' using errcode='42501';end if;raise;
end $f$;

create function public.get_job_assignment_batch_workspace(target_company_id uuid,target_job_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.get_job_assignment_batch_workspace(target_company_id,target_job_id); $f$;
create function public.mutate_job_assignments_atomic(target_company_id uuid,target_job_id uuid,payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.mutate_job_assignments_atomic(target_company_id,target_job_id,payload); $f$;
create function public.get_job_assignment_batch_receipt(target_company_id uuid,target_job_id uuid,target_operation_id uuid) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.get_job_assignment_batch_receipt(target_company_id,target_job_id,target_operation_id); $f$;
create function public.cancel_job_assignment_batch_operation(target_company_id uuid,target_job_id uuid,payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $f$ select private.cancel_job_assignment_batch_operation(target_company_id,target_job_id,payload); $f$;
do $acl$
declare f record;
begin
 for f in select p.oid::regprocedure::text signature,n.nspname,p.proname from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and (p.proname like 'job_assignment_batch_%' or p.proname in ('get_job_assignment_batch_workspace','get_job_assignment_batch_receipt','mutate_job_assignments_atomic','cancel_job_assignment_batch_operation'))
   or n.nspname='public' and p.proname in ('get_job_assignment_batch_workspace','get_job_assignment_batch_receipt','mutate_job_assignments_atomic','cancel_job_assignment_batch_operation') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('get_job_assignment_batch_workspace','get_job_assignment_batch_receipt','mutate_job_assignments_atomic','cancel_job_assignment_batch_operation') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $acl$;
