-- OWNER ONLY, authorized wfcpfraxiuhuglnuaxqj TEST project. No DDL/business writes.
-- Render exact UUID placeholders from the private fixture; absent IDs use nil UUID.
-- __RUN_ID__, __COMPANY_ID__, __OPERATION_ID__, __OTHER_OPERATION_ID__, __QUOTE_ID__,
-- __CALCULATION_ID__, __VERSION_ID__, __SCENARIO__. Start during the client's delay.
-- Execute DO + SELECT together. Save ONLY returned JSON atomically to --barrier.
-- Fresh run/operations/files after every attempt. Keep this dedicated tenant quiescent.
-- Company FOR UPDATE is the real common lock in all five RPCs, no invented advisory key.
-- Server clock measures lock/query order; local monotonic clock measures HTTP overlap.
-- This proves the two matching RPCs waited on the exact fixture row. It does NOT map
-- Auth session IDs/operation IDs to backend PIDs (PostgREST does not expose that here).
do $hold$
declare
 c uuid:='__COMPANY_ID__'; op uuid:='__OPERATION_ID__'; other_op uuid:='__OTHER_OPERATION_ID__';
 q uuid:='__QUOTE_ID__'; calc uuid:='__CALCULATION_ID__'; ver uuid:='__VERSION_ID__';
 nil constant uuid:='00000000-0000-0000-0000-000000000000'; scenario text:='__SCENARIO__'; rpc text;
 deadline timestamptz; acquired timestamptz; waiters jsonb; evidence jsonb; post jsonb;
 relation_id oid:='public.companies'::regclass; database_id oid:=(select oid from pg_database where datname=current_database());
 row_id tid; row_page integer; row_tuple integer; owner_xid text; locked boolean;
 before_quotes integer; before_versions jsonb; before_decisions jsonb; after_old_versions jsonb; after_old_decisions jsonb;
 target_quote uuid; target_version uuid; job uuid; result jsonb;
begin
 if c=nil or op=nil or '__RUN_ID__'::uuid=nil then raise exception 'Invalid synthetic scope';end if;
 rpc:=case scenario when 'create-retry' then 'create_core_quote_from_calculation_atomic'
 when 'update-race' then 'update_core_quote_draft_atomic' when 'publish-retry' then 'publish_core_quote_version_atomic'
 when 'delivery-retry' then 'begin_core_quote_delivery_atomic' when 'conversion-retry' then 'convert_core_quote_to_job_atomic' end;
 if rpc is null or(scenario='update-race' and(other_op=nil or other_op=op)) then raise exception 'Invalid scenario';end if;
 if not exists(select 1 from public.companies where id=c and name='TEST-CORE-QUOTE-LIFECYCLE-__RUN_ID__') then raise exception 'Dedicated one-run company required';end if;
 if exists(select 1 from private.core_quote_operations where company_id=c and operation_id in(op,other_op))
 or exists(select 1 from private.core_quote_deliveries where company_id=c and operation_id=op)
 or exists(select 1 from private.core_quote_conversion_requests where company_id=c and operation_id=op) then raise exception 'Fresh operations required';end if;
 select count(*) into before_quotes from public.quotes where company_id=c;
 select coalesce(jsonb_agg(to_jsonb(v) order by id),'[]') into before_versions from private.core_quote_versions v where company_id=c;
 select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') into before_decisions from private.core_quote_decisions d where company_id=c;
 begin
  perform set_config('statement_timeout','55s',true);perform set_config('lock_timeout','5s',true);
  perform set_config('application_name','corequote-lifecycle:__RUN_ID__',true);
  select ctid into row_id from public.companies where id=c and name='TEST-CORE-QUOTE-LIFECYCLE-__RUN_ID__' for update;
  if not found then raise exception 'Company row not locked';end if;
  row_page:=split_part(trim(both '()' from row_id::text),',',1)::integer;
  row_tuple:=split_part(trim(both '()' from row_id::text),',',2)::integer;
  -- The subtransaction's xid is the one held by this row lock. Inspect pg_locks,
  -- not pg_current_xact_id() (which would name the parent transaction).
  select transactionid::text into owner_xid from pg_locks where pid=pg_backend_pid() and locktype='transactionid' and mode='ExclusiveLock' and granted order by transactionid::text::bigint desc limit 1;
  if owner_xid is null then raise exception 'Owner transaction lock missing';end if;
  acquired:=clock_timestamp();deadline:=acquired+interval '40 seconds';
  loop
   perform pg_stat_clear_snapshot();
   with recursive chain(pid,depth) as(
    select pg_backend_pid(),0 union all
    select a.pid,c.depth+1 from chain c join pg_stat_activity a on c.pid=any(pg_blocking_pids(a.pid)) where c.depth<8 and a.pid<>c.pid
   ), candidates as(
    select distinct a.pid,a.state,a.wait_event_type,a.backend_start,a.xact_start,a.query_start,pg_blocking_pids(a.pid) blockers
    from chain h join pg_stat_activity a on a.pid=h.pid where h.depth>0 and a.datname=current_database()
    and a.state='active' and a.wait_event_type='Lock' and a.query_start>=acquired and position(rpc in a.query)>0
   )
   select coalesce(jsonb_agg(jsonb_build_object('pid',a.pid,'state',a.state,'waitEventType',a.wait_event_type,'rootBlocked',true,
    'queryFunction',rpc,'blockingPids',a.blockers,'backendStartedAt',a.backend_start,'transactionStartedAt',a.xact_start,'queryStartedAt',a.query_start,
    'companyRelationLockGranted',exists(select 1 from pg_locks l where l.pid=a.pid and l.database=database_id and l.relation=relation_id and l.locktype='relation' and l.mode='RowShareLock' and l.granted),
    'companyTupleLocks',(select coalesce(jsonb_agg(jsonb_build_object('relationOid',l.relation::integer,'page',l.page,'tuple',l.tuple,'mode',l.mode,'granted',l.granted)),'[]') from pg_locks l where l.pid=a.pid and l.database=database_id and l.relation=relation_id and l.locktype='tuple' and l.page=row_page and l.tuple=row_tuple),
    'transactionWaits',(select coalesce(jsonb_agg(jsonb_build_object('transactionId',l.transactionid::text,'mode',l.mode,'granted',l.granted)),'[]') from pg_locks l where l.pid=a.pid and l.locktype='transactionid' and not l.granted)
   ) order by a.pid),'[]') into waiters from candidates a;
   if jsonb_array_length(waiters)=2 and not exists(select 1 from jsonb_array_elements(waiters) w where jsonb_array_length(w->'companyTupleLocks')<>1) then
    evidence:=jsonb_build_object('proofVersion',1,'project','wfcpfraxiuhuglnuaxqj','runId','__RUN_ID__','scenario',scenario,
     'companyId',c,'operationId',op,'otherOperationId',nullif(other_op,nil),'quoteId',nullif(q,nil),'calculationId',nullif(calc,nil),'versionId',nullif(ver,nil),
     'applicationName','corequote-lifecycle:__RUN_ID__','lockKind','company-row','phase','observed','blockerPid',pg_backend_pid(),
     'barrierLockHeld',true,'ownerCompanyLockConfirmed',true,'ownerTransactionLockGranted',true,'ownerTransactionId',owner_xid,
     'lockRelation','public.companies','relationOid',relation_id::integer,'rowPage',row_page,'rowTuple',row_tuple,
     'barrierAcquiredAt',acquired,'observedAt',clock_timestamp(),'waiters',waiters);exit;
   end if;
   if clock_timestamp()>deadline then raise exception 'Two exact company-row waiters were not observed';end if;
   perform pg_sleep(0.05);
  end loop;
  raise exception 'RELEASE_OBSERVED_QUOTE_BARRIER' using errcode='PT001';
 exception when sqlstate 'PT001' then if evidence is null then raise;end if;end;
 evidence:=evidence||jsonb_build_object('barrierReleasedAt',clock_timestamp());
 -- Subtransaction rollback releases the only owner row lock. Wait for those exact
 -- observed query incarnations to finish before checking committed private rows.
 deadline:=clock_timestamp()+interval '10 seconds';
 loop
  perform pg_stat_clear_snapshot();
  select exists(select 1 from pg_stat_activity a join jsonb_array_elements(waiters) w on a.pid=(w->>'pid')::integer
   where a.state='active' and a.query_start=(w->>'queryStartedAt')::timestamptz) into locked;
  exit when not locked;
  if clock_timestamp()>deadline then raise exception 'Observed requests did not finish';end if;
  perform pg_sleep(0.05);
 end loop;
 select o.result into result from private.core_quote_operations o where o.company_id=c and o.operation_id in(op,other_op) order by o.created_at limit 1;
 target_quote:=coalesce((result->>'quoteId')::uuid,nullif(q,nil));target_version:=coalesce((result->>'versionId')::uuid,nullif(ver,nil));
 select job_id into job from private.core_quote_conversions where company_id=c and quote_id=target_quote and version_id=target_version;
 select coalesce(jsonb_agg(to_jsonb(v) order by id),'[]') into after_old_versions from private.core_quote_versions v where company_id=c and id in(select (x->>'id')::uuid from jsonb_array_elements(before_versions) x);
 select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]') into after_old_decisions from private.core_quote_decisions d where company_id=c and id in(select (x->>'id')::uuid from jsonb_array_elements(before_decisions) x);
 post:=jsonb_build_object('requestsFinished',true,'existingVersionsUnchanged',before_versions=after_old_versions,'existingDecisionsUnchanged',before_decisions=after_old_decisions,
  'operationRows',(select count(*) from private.core_quote_operations where company_id=c and operation_id in(op,other_op)),
  'quotesAdded',(select count(*) from public.quotes where company_id=c)-before_quotes,
  'versionsAdded',(select count(*) from private.core_quote_versions where company_id=c)-jsonb_array_length(before_versions),
  'sourceQuoteRows',(select count(*) from public.quotes where company_id=c and source_calculation_id=calc),
  'sourceClaimRows',(select count(*) from private.core_quote_source_claims where company_id=c and calculation_id=calc),
  'revision',(select revision::text from public.quotes where company_id=c and id=target_quote),
  'versionTokenRows',(select count(*) from private.core_quote_tokens where company_id=c and quote_id=target_quote and version_id=target_version),
  'deliveryRows',(select count(*) from private.core_quote_deliveries where company_id=c and operation_id=op),
  'deliveryState',(select state from private.core_quote_deliveries where company_id=c and operation_id=op),
  'conversionRows',(select count(*) from private.core_quote_conversions where company_id=c and quote_id=target_quote and version_id=target_version),
  'conversionRequestRows',(select count(*) from private.core_quote_conversion_requests where company_id=c and operation_id=op),
  'jobTreeRows',(select count(*) from public.jobs where company_id=c and(id=job or parent_job_id=job)));
 perform set_config('diriqo.core_quote_lifecycle_barrier',(evidence||jsonb_build_object('postcondition',post))::text,true);
end;$hold$;
select current_setting('diriqo.core_quote_lifecycle_barrier')::jsonb as barrier_evidence;
