-- Owner-only TEST concurrency evidence v2. No DDL or business-data writes.
-- Project: wfcpfraxiuhuglnuaxqj. Run this DO + SELECT as ONE owner query.
-- Replace __COMPANY_ID__, __RUN_ID__, __ROUND__=1, __SCENARIO__, __OPERATION_ID__,
-- __OTHER_OPERATION_ID__ (nil UUID unless update-race), __CALCULATION_ID__ (nil for create), __RPC_NAME__.
-- Use a NEW runId/operationId and new output/barrier files after ANY attempted run.
-- 1. Start client with --request-delay-ms=15000. runId is its exclusive, one-time invocation nonce.
-- 2. During its delay start this HOLD. Both RPCs must start after the owner acquired its exact lock.
-- 3. Observe two real lock-correlated RPC backends, then immediately release via subtransaction rollback.
-- 4. Atomically write only the returned JSON to that run's observation path. Ensure the writing tool has ACL access.
-- All acquisition/query/observation/release timestamps use the database clock.
-- HTTP overlap uses only the client's monotonic clock; these two clock domains are NEVER compared.
-- Distinct Auth sessions are proved by the client. No Auth-session-to-PID mapping is claimed.
-- No query text, JWT, email, password or customer data is returned.

do $hold$
declare
 v_deadline timestamptz:=clock_timestamp()+interval '45 seconds';
 v_waiters jsonb; v_evidence jsonb; v_keys jsonb; v_acquired timestamptz;
 v_company uuid:='__COMPANY_ID__'; v_operation uuid:='__OPERATION_ID__';
 v_other uuid:='__OTHER_OPERATION_ID__'; v_calculation uuid:='__CALCULATION_ID__';
 v_scenario text:='__SCENARIO__'; v_rpc text:='__RPC_NAME__'; v_ops uuid[];
 v_db oid:=(select oid from pg_database where datname=current_database());
 v_parent_found boolean:=false; v_owner_advisory boolean:=false; v_key bigint;
begin
 begin
 perform set_config('statement_timeout','55s',true);
 perform set_config('lock_timeout','5s',true);
 perform set_config('application_name','corecalc:__RUN_ID__:__ROUND__',true);
 if v_scenario not in('create-retry','create-conflict','update-retry','update-race')
  or v_rpc<>(case when v_scenario like 'update-%' then 'update_core_calculation_atomic' else 'create_core_calculation_atomic' end)
  or v_operation='00000000-0000-0000-0000-000000000000'::uuid
  or(v_scenario='update-race' and(v_other=v_operation or v_other='00000000-0000-0000-0000-000000000000'::uuid)) then
  raise exception 'Unexpected fixture scenario or operation';
 end if;
 if not exists(select 1 from public.companies where id=v_company and name like 'TEST-CORE-CALCULATION-%') then
  raise exception 'Dedicated synthetic company is missing';
 end if;
 v_ops:=case when v_scenario='update-race' then array[v_operation,v_other] else array[v_operation] end;
 select jsonb_agg(jsonb_build_object('operationId',operation_id,'key',lock_key::text,
  'classId',((lock_key>>32)&4294967295::bigint)::text,'objectId',(lock_key&4294967295::bigint)::text,'objectSubId',1) order by operation_id)
 into v_keys from(select operation_id,hashtextextended('core-calculation:'||v_company::text||':'||operation_id::text,0) lock_key from unnest(v_ops) operation_id) keys;
 if v_rpc='create_core_calculation_atomic' then
  v_key:=hashtextextended('core-calculation:'||v_company::text||':'||v_operation::text,0);
  perform pg_advisory_xact_lock(v_key);
  select exists(select 1 from pg_locks l where l.pid=pg_backend_pid() and l.database=v_db and l.locktype='advisory'
   and l.classid::bigint=((v_key>>32)&4294967295::bigint) and l.objid::bigint=(v_key&4294967295::bigint)
   and l.objsubid=1 and l.mode='ExclusiveLock' and l.granted) into v_owner_advisory;
  if not v_owner_advisory then raise exception 'Owner operation lock not visible';end if;
 else
  perform 1 from public.calculations where id=v_calculation and company_id=v_company
   and title like 'TEST-CORE-CALCULATION-%' for update;
  v_parent_found:=found;
  if not v_parent_found then raise exception 'Synthetic calculation is missing'; end if;
 end if;
 v_acquired:=clock_timestamp();
 loop
  perform pg_stat_clear_snapshot();
  with recursive chain(pid,depth) as (
   select pg_backend_pid(),0
   union all
   select a.pid,c.depth+1 from chain c join pg_stat_activity a on c.pid=any(pg_blocking_pids(a.pid))
    where c.depth<8 and a.pid<>c.pid
  ), expected_keys as (
   select operation_id,hashtextextended('core-calculation:'||v_company::text||':'||operation_id::text,0) lock_key from unnest(v_ops) operation_id
  ), waiters as (
   select distinct a.pid,a.state,a.wait_event_type,a.backend_start,a.xact_start,a.query_start,
    pg_blocking_pids(a.pid) blocking_pids,
    (select jsonb_agg(jsonb_build_object('operationId',k.operation_id,'key',k.lock_key::text,'mode',l.mode,'granted',l.granted) order by k.operation_id)
      from pg_locks l join expected_keys k on l.classid::bigint=((k.lock_key>>32)&4294967295::bigint)
       and l.objid::bigint=(k.lock_key&4294967295::bigint)
      where l.pid=a.pid and l.database=v_db and l.locktype='advisory' and l.objsubid=1 and l.mode='ExclusiveLock') operation_locks
   from chain c join pg_stat_activity a on a.pid=c.pid
   where c.depth>0 and a.datname=current_database() and a.state='active' and a.wait_event_type='Lock'
    and a.query_start>=v_acquired and position(v_rpc in a.query)>0
  )
  select coalesce(jsonb_agg(jsonb_build_object('pid',w.pid,'state',w.state,'waitEventType',w.wait_event_type,
   'rootBlocked',true,'queryFunction',v_rpc,'blockingPids',w.blocking_pids,'backendStartedAt',w.backend_start,
   'transactionStartedAt',w.xact_start,'queryStartedAt',w.query_start,'operationLocks',w.operation_locks) order by w.pid),'[]'::jsonb)
   into v_waiters from waiters w where jsonb_array_length(w.operation_locks)=1;
  if jsonb_array_length(v_waiters)=2 then
   v_evidence:=jsonb_build_object('proofVersion',2,'project','wfcpfraxiuhuglnuaxqj','runId','__RUN_ID__','round',__ROUND__,
    'scenario',v_scenario,'companyId',v_company,'operationId',v_operation,
    'otherOperationId',case when v_scenario='update-race' then v_other else null end,
    'calculationId',case when v_rpc='update_core_calculation_atomic' then v_calculation else null end,
    'lockKind',case when v_rpc='update_core_calculation_atomic' then 'calculation' else 'operation' end,
    'operationKeys',v_keys,'ownerOperationLockGranted',v_owner_advisory,'ownerParentLockConfirmed',v_parent_found,
    'applicationName','corecalc:__RUN_ID__:__ROUND__','blockerPid',pg_backend_pid(),
    'barrierLockHeld',true,'barrierAcquiredAt',v_acquired,'observedAt',clock_timestamp(),'phase','observed','waiters',v_waiters);
   exit;
  end if;
  if clock_timestamp()>v_deadline then raise exception 'Two lock-correlated calculation backends were not observed'; end if;
  perform pg_sleep(0.05);
 end loop;
 raise exception 'RELEASE_OBSERVED_BARRIER' using errcode='PT001';
 exception when sqlstate 'PT001' then
  if v_evidence is null then raise; end if;
 end;
 -- Nested rollback releases the owner lock. These timestamps all share the server clock.
 v_evidence:=v_evidence||jsonb_build_object('barrierReleasedAt',clock_timestamp());
 perform set_config('diriqo.core_calculation_barrier_result',v_evidence::text,true);
end;
$hold$;
select current_setting('diriqo.core_calculation_barrier_result')::jsonb as barrier_evidence;
