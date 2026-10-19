-- Owner-only TEST harness. No DDL and no business-data writes.
-- Target project: wfcpfraxiuhuglnuaxqj. Never run this whole file as one command.
-- Replace __COMPANY_ID__, __QUOTE_ID__, __RUN_ID__, __ROUND__ (1 or 2).
-- 1. Start the client with --request-delay-ms=15000; it prints ready/dispatchAt.
-- 2. During that delay run HOLD as ONE owner query (DO + SELECT). No second
--    connection or held proof file is required; dispatch happens after the delay.
-- 3. HOLD observes BOTH blocked RPC backends and immediately rolls back its lock.
--    This is essential: hosted authenticated statement_timeout/lock_timeout is 8s.
--    Write HOLD's returned phase=observed JSON atomically to --barrier; the client
--    waits up to60s but validates the original timestamp inside both HTTP calls.
-- 4. Wait for ready round2 and repeat with __ROUND__=2. No role timeout changes.
-- Do not substitute Promise.all timestamps or invented PIDs for observer output.
-- The observer emits no query text, JWT, email, password or customer data.

-- BEGIN HOLD
-- Execute this DO + SELECT as ONE owner query, as with the rollback SQL suites.
-- The query owns no business writes. A forced subtransaction rollback releases locks.
do $hold$
declare
 v_deadline timestamptz:=clock_timestamp()+interval '45 seconds';
 v_waiters jsonb; v_evidence jsonb;
begin
 begin
 perform set_config('statement_timeout','55s',true);
 perform set_config('lock_timeout','5s',true);
 perform set_config('application_name','corequote:__RUN_ID__:__ROUND__',true);
 if not exists(select 1 from public.quotes where id='__QUOTE_ID__'::uuid
   and company_id='__COMPANY_ID__'::uuid and title like 'TEST-CORE-QUOTE-%') then
  raise exception 'Synthetic core quote fixture is missing';
 end if;
 perform 1 from public.companies where id='__COMPANY_ID__'::uuid for update;
 if not found then raise exception 'Synthetic company is missing'; end if;
 loop
  -- Refresh before every read; PostgreSQL may cache activity within a transaction.
  perform pg_stat_clear_snapshot();
  with recursive chain(pid,depth) as (
   select pg_backend_pid(),0
   union all
   select a.pid,c.depth+1 from chain c join pg_stat_activity a on c.pid=any(pg_blocking_pids(a.pid))
   where c.depth<8 and a.pid<>c.pid
  ), waiters as (
   select distinct a.pid,a.state,a.wait_event_type from chain c join pg_stat_activity a on a.pid=c.pid
   where c.depth>0 and a.datname=current_database() and a.state='active' and a.wait_event_type='Lock'
    and position('convert_core_quote_to_job_atomic' in a.query)>0
  )
  select coalesce(jsonb_agg(jsonb_build_object('pid',w.pid,'state',w.state,'waitEventType',w.wait_event_type,
   'rootBlocked',true,'queryFunction','convert_core_quote_to_job_atomic') order by w.pid),'[]'::jsonb)
  into v_waiters from waiters w;
  if jsonb_array_length(v_waiters)=2 then
   v_evidence:=jsonb_build_object('project','wfcpfraxiuhuglnuaxqj','runId','__RUN_ID__','round',__ROUND__,
    'companyId','__COMPANY_ID__','applicationName','corequote:__RUN_ID__:__ROUND__','blockerPid',pg_backend_pid(),
    'barrierLockHeld',true,'observedAt',clock_timestamp(),'phase','observed','waiters',v_waiters);
   exit;
  end if;
  if clock_timestamp()>v_deadline then raise exception 'Two waiting conversion backends were not observed'; end if;
  perform pg_sleep(0.05);
 end loop;
 raise exception 'RELEASE_OBSERVED_BARRIER' using errcode='PT001';
 exception when sqlstate 'PT001' then
  if v_evidence is null then raise; end if;
 end;
 -- The nested subtransaction rolled back the row lock; only local JSON survives.
 perform set_config('diriqo.core_quote_barrier_result',v_evidence::text,true);
end;
$hold$;
select current_setting('diriqo.core_quote_barrier_result')::jsonb as barrier_evidence;
-- END HOLD

-- BEGIN OBSERVE
with recursive
barrier as (
 select a.pid,a.application_name,a.xact_start
 from pg_stat_activity a
 where a.datname=current_database() and a.pid<>pg_backend_pid()
   and a.application_name='corequote:__RUN_ID__:__ROUND__'
   and a.state='active' and a.wait_event='PgSleep'
   and exists(select 1 from pg_locks l where l.pid=a.pid and l.granted
     and l.locktype='relation' and l.relation='public.companies'::regclass and l.mode='RowShareLock')
),
wait_chain(pid,root_pid,depth) as (
 select b.pid,b.pid,0 from barrier b
 union all
 select a.pid,c.root_pid,c.depth+1 from wait_chain c
 join pg_stat_activity a on c.pid=any(pg_blocking_pids(a.pid))
 where c.depth<8 and a.pid<>c.pid
),
waiters as (
 select distinct a.pid,c.root_pid,a.state,a.wait_event_type
 from wait_chain c join pg_stat_activity a on a.pid=c.pid
 where c.depth>0 and a.datname=current_database() and a.state='active'
   and a.wait_event_type='Lock' and position('convert_core_quote_to_job_atomic' in a.query)>0
)
select jsonb_build_object(
 'project','wfcpfraxiuhuglnuaxqj','runId','__RUN_ID__','round',__ROUND__,
 'companyId','__COMPANY_ID__','applicationName','corequote:__RUN_ID__:__ROUND__',
 'blockerPid',(select min(pid) from barrier),'barrierLockHeld',(select count(*)=1 from barrier),
 'observedAt',clock_timestamp(),
 'phase',case when (select count(*) from waiters)=2 and (select count(*) from barrier)=1 then 'observed' else 'held' end,
 'waiters',coalesce((select jsonb_agg(jsonb_build_object('pid',w.pid,'state',w.state,
   'waitEventType',w.wait_event_type,'rootBlocked',true,'queryFunction','convert_core_quote_to_job_atomic') order by w.pid)
   from waiters w),'[]'::jsonb)
) as barrier_evidence;
-- END OBSERVE