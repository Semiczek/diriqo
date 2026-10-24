-- Preparation only. Root executes on wfcpfraxiuhuglnuaxqj after fresh synthetic setup.
-- No DDL or business writes. Replace UUID/scenario placeholders from validated runner fixture.
-- Start runner first (15s delay), then this ONE owner query; export final JSON atomically.
-- Do not infer session-to-PID identity. Actual advisory tags + blocker graph prove DB overlap.
do $hold$
declare
 c uuid:='__COMPANY_ID__'; a uuid:='__ACTOR_PROFILE_ID__'; w uuid:='__WORKER_PROFILE_ID__';
 run uuid:='__RUN_ID__'; op uuid:='__OPERATION_ID__'; other_op uuid:='__OTHER_OPERATION_ID__';
 sid uuid:='__SUBMISSION_ID__'; vid uuid:='__VERSION_ID__'; scenario text:='__SCENARIO__';
 ops uuid[]; worker_key bigint; keys jsonb; worker_tag jsonb; owner_lock jsonb; waiters jsonb; evidence jsonb;
 acquired timestamptz; deadline timestamptz:=clock_timestamp()+interval '45 seconds';
 db oid:=(select oid from pg_database where datname=current_database());
begin
 if current_user<>'postgres' then raise exception 'OWNER_ONLY';end if;
 if scenario not in('approve-retry','approve-race','rate-retry','rate-conflict','rate-vs-approve') then raise exception 'BAD_SCENARIO';end if;
 if not exists(select 1 from public.companies where id=c and name='TEST-LABOR-HISTORY-'||run::text)
  or not exists(select 1 from public.company_members where company_id=c and profile_id=a and role='company_admin' and is_active)
  or not exists(select 1 from public.company_members where company_id=c and profile_id=w and role='worker' and is_active) then raise exception 'FRESH_SYNTHETIC_SCOPE_REQUIRED';end if;
 ops:=case when scenario in('approve-race','rate-vs-approve') then array[op,other_op] else array[op] end;
 if op='00000000-0000-0000-0000-000000000000' or (cardinality(ops)=2 and (op=other_op or other_op='00000000-0000-0000-0000-000000000000')) then raise exception 'FRESH_OPERATION_REQUIRED';end if;
 select jsonb_agg(jsonb_build_object('operationId',operation_id,'lockName',lock_name,'key',lock_key::text,'classId',((lock_key>>32)&4294967295)::text,'objectId',(lock_key&4294967295)::text,'objectSubId',1) order by operation_id)
 into keys from(select operation_id,'labor-op:'||c||':'||a||':'||operation_id lock_name,hashtextextended('labor-op:'||c||':'||a||':'||operation_id,0) lock_key from unnest(ops) operation_id) q;
 worker_key:=hashtextextended('labor:'||c||':'||w,0);
 worker_tag:=jsonb_build_object('lockName','labor:'||c||':'||w,'key',worker_key::text,'classId',((worker_key>>32)&4294967295)::text,'objectId',(worker_key&4294967295)::text,'objectSubId',1);
 begin
  perform set_config('statement_timeout','55s',true);perform set_config('lock_timeout','5s',true);
  perform set_config('application_name','labor-history:'||run||':1',true);
  perform pg_advisory_xact_lock(worker_key);
  select worker_tag||jsonb_build_object('locktype','advisory','databaseOid',db,'pid',l.pid,'mode',l.mode,'granted',l.granted)
   into owner_lock from pg_locks l where l.pid=pg_backend_pid() and l.database=db and l.locktype='advisory'
   and l.classid::bigint=((worker_key>>32)&4294967295) and l.objid::bigint=(worker_key&4294967295)
   and l.objsubid=1 and l.mode='ExclusiveLock' and l.granted;
  if owner_lock is null then raise exception 'OWNER_LOCK_NOT_OBSERVED';end if;
  acquired:=clock_timestamp();
  loop
   perform pg_stat_clear_snapshot();
   with recursive chain(pid,depth) as (
    select pg_backend_pid(),0 union all
    select x.pid,y.depth+1 from chain y join pg_stat_activity x on y.pid=any(pg_blocking_pids(x.pid)) where y.depth<8 and x.pid<>y.pid
   ), candidates as (
    select distinct x.pid,x.state,x.wait_event_type,x.backend_start,x.xact_start,x.query_start,pg_blocking_pids(x.pid) blocking_pids,
     case when position('set_company_worker_rate' in x.query)>0 then 'set_company_worker_rate'
          when position('review_labor_submission' in x.query)>0 then 'review_labor_submission' end rpc,
     (select coalesce(jsonb_agg(k||jsonb_build_object('locktype','advisory','databaseOid',db,'pid',l.pid,'mode',l.mode,'granted',l.granted)),'[]')
      from pg_locks l join jsonb_array_elements(keys) k on l.classid::bigint=(k->>'classId')::bigint and l.objid::bigint=(k->>'objectId')::bigint
      where l.pid=x.pid and l.database=db and l.locktype='advisory' and l.objsubid=1 and l.mode='ExclusiveLock') operation_locks,
     (select coalesce(jsonb_agg(worker_tag||jsonb_build_object('locktype','advisory','databaseOid',db,'pid',l.pid,'mode',l.mode,'granted',l.granted)),'[]')
      from pg_locks l where l.pid=x.pid and l.database=db and l.locktype='advisory' and l.objsubid=1 and l.mode='ExclusiveLock'
      and l.classid::bigint=((worker_key>>32)&4294967295) and l.objid::bigint=(worker_key&4294967295)) worker_locks
    from chain y join pg_stat_activity x on x.pid=y.pid where y.depth>0 and x.datname=current_database() and x.state='active' and x.wait_event_type='Lock' and x.query_start>=acquired
   ) select coalesce(jsonb_agg(jsonb_build_object('pid',pid,'state',state,'waitEventType',wait_event_type,'rootBlocked',true,'queryFunction',rpc,'blockingPids',blocking_pids,
     'backendStartedAt',backend_start,'transactionStartedAt',xact_start,'queryStartedAt',query_start,'operationLocks',operation_locks,'workerLocks',worker_locks) order by pid),'[]') into waiters
    from candidates where rpc is not null and jsonb_array_length(operation_locks)=1;
   if jsonb_array_length(waiters)=2 then
    evidence:=jsonb_build_object('proofVersion',1,'project','wfcpfraxiuhuglnuaxqj','runId',run,'round',1,'scenario',scenario,'companyId',c,'actorProfileId',a,'workerProfileId',w,
     'operationId',op,'otherOperationId',case when cardinality(ops)=2 then other_op else null end,
     'submissionId',case when scenario in('rate-retry','rate-conflict') then null else sid end,'versionId',case when scenario in('rate-retry','rate-conflict') then null else vid end,
     'lockKind','worker','applicationName','labor-history:'||run||':1','databaseOid',db,'blockerPid',pg_backend_pid(),'barrierLockHeld',true,'phase','observed',
     'barrierAcquiredAt',acquired,'observedAt',clock_timestamp(),'workerKey',worker_tag,'operationKeys',keys,'ownerWorkerLock',owner_lock,'waiters',waiters);
    exit;
   end if;
   if clock_timestamp()>deadline then raise exception 'TWO_EXACT_WAITERS_NOT_OBSERVED';end if;
   perform pg_sleep(0.05);
  end loop;
  raise exception 'RELEASE_LABOR_BARRIER' using errcode='PT001';
 exception when sqlstate 'PT001' then if evidence is null then raise;end if;end;
 evidence:=evidence||jsonb_build_object('barrierReleasedAt',clock_timestamp());
 perform set_config('diriqo.labor_barrier_result',evidence::text,true);
end $hold$;
select current_setting('diriqo.labor_barrier_result')::jsonb as barrier_evidence;
