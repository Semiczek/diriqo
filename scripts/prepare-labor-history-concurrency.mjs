// OFFLINE ONLY. No network/Auth/SQL execution. Auth must be created separately without mail.
// prepare --auth-private=<private JSON> --directory=<NEW protected Temp child>
// finalize with same args after owner executes setup and saves scalar JSON as owner-result.json.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { laborHistoryScenarios } from './labor-history-concurrency-proof.mjs'
const project='wfcpfraxiuhuglnuaxqj',uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const q=x=>"'"+String(x).replaceAll("'","''")+"'",save=(dir,name,value)=>fs.writeFile(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600})
try{
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');assert(i>0);return[x.slice(0,i),x.slice(i+1)]}))
 assert(['prepare','finalize'].includes(args['--mode'])&&args['--auth-private']&&args['--directory'],'CONFIGURATION_REQUIRED')
 const dir=path.resolve(args['--directory']),inside=path.relative(path.resolve(tmpdir()),dir);assert(inside&&!inside.startsWith('..')&&!path.isAbsolute(inside),'NEW_TEMP_CHILD_REQUIRED')
 const auth=JSON.parse(await fs.readFile(args['--auth-private'],'utf8'))
 assert(auth.project===project&&uuid.test(auth.authUserId||'')&&/^labor-history-concurrency-[0-9a-f-]+@example\.invalid$/i.test(auth.email)&&typeof auth.password==='string'&&auth.password.length>0,'NEW_SYNTHETIC_AUTH_REQUIRED')
 if(args['--mode']==='prepare'){
  await fs.mkdir(dir,{mode:0o700});const actorProfileId=randomUUID(),workerProfileId=randomUUID()
  const plan={project,authUserId:auth.authUserId,actorProfileId,workerProfileId,scenarios:laborHistoryScenarios.map(scenario=>({scenario,runId:randomUUID(),companyId:randomUUID(),operationId:randomUUID(),...(['approve-race','rate-vs-approve'].includes(scenario)?{otherOperationId:randomUUID()}:{})}))}
  await save(dir,'plan.json',plan)
  await save(dir,'owner-setup.sql',`-- OWNER ONLY on ${project}; one transaction. Reviewed synthetic rows only.
do $setup$
#variable_conflict use_variable
declare a uuid:=${q(actorProfileId)};w uuid:=${q(workerProfileId)};u uuid:=${q(auth.authUserId)};p jsonb;c uuid;run uuid;job uuid;source uuid;r jsonb;s uuid;v uuid;result jsonb:='[]';input jsonb;now_at timestamptz:=clock_timestamp();
begin
 if current_user<>'postgres' then raise exception 'OWNER_ONLY';end if;
 if not exists(select 1 from auth.users where id=u and email=${q(auth.email)} and (banned_until is null or banned_until<now_at))
  or exists(select 1 from public.profiles where auth_user_id=u or user_id=u or id in(a,w)) then raise exception 'FRESH_AUTH_AND_PROFILES_REQUIRED';end if;
 insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values(a,u,u,'TEST labor concurrency administrator',true),(w,null,null,'TEST labor concurrency worker',true);
 for p in select value from jsonb_array_elements(${q(JSON.stringify(plan.scenarios))}::jsonb) loop
  c:=(p->>'companyId')::uuid;run:=(p->>'runId')::uuid;job:=gen_random_uuid();source:=gen_random_uuid();s:=null;v:=null;
  if exists(select 1 from public.companies where id=c or name='TEST-LABOR-HISTORY-'||run) then raise exception 'FIXTURE_COLLISION';end if;
  insert into public.companies(id,name,currency,default_currency,timezone) values(c,'TEST-LABOR-HISTORY-'||run,'CZK','CZK','Europe/Prague');
  insert into public.company_members(company_id,profile_id,role,is_active) values(c,a,'company_admin',true),(c,w,'worker',true);
  if p->>'scenario' not in('rate-retry','rate-conflict') then
   insert into public.jobs(id,company_id,title,currency) values(job,c,'TEST-LABOR-HISTORY-'||run,'CZK');
   insert into public.work_shifts(id,company_id,profile_id,job_id,shift_date,started_at,ended_at) values(source,c,w,job,'2026-10-15','2026-10-15T06:00Z','2026-10-15T14:00Z');
  end if;
  insert into private.company_module_rollouts(company_id,product,livemode) values(c,'diriqo_core',false);
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(c,'diriqo_core','labor-history-concurrency:'||run,'Synthetic labor concurrency only',now_at-interval '1 minute',now_at+interval '24 hours',now_at+interval '24 hours',array['core.jobs.create','core.rates.manage','core.time.record','core.time.approve']);
  perform set_config('request.jwt.claim.sub',u::text,true);execute 'set local role authenticated';
  perform public.set_company_worker_rate(c,jsonb_build_object('actor_profile_id',a,'profile_id',w,'expected_schedule_revision',0,'effective_from','2026-10-01','amount','200.00','currency','CZK','unit','hour','worker_type','employee','billing_type','hourly','reason','TEST-LABOR-HISTORY-'||run||':baseline','operation_id',gen_random_uuid()));
  if p->>'scenario' not in('rate-retry','rate-conflict') then
   r:=public.save_labor_submission_draft(c,jsonb_build_object('actor_profile_id',a,'profile_id',w,'job_id',job,'expected_revision',0,'operation_id',gen_random_uuid(),
    'sources',jsonb_build_array(jsonb_build_object('kind','shift','id',source)),
    'lines',jsonb_build_array(jsonb_build_object('work_date','2026-10-15','actual_hours','8','pay_hours','8','billed_hours','6'))));s:=(r->>'id')::uuid;v:=(r->>'current_version_id')::uuid;
   r:=public.submit_labor_submission(c,jsonb_build_object('actor_profile_id',a,'submission_id',s,'version_id',v,'expected_revision',1,'operation_id',gen_random_uuid()));
   assert r->>'revision'='2' and r#>>'{versions,0,state}'='submitted','SYNTHETIC_SUBMISSION_REQUIRED';
  end if;
  result:=result||jsonb_build_array(p||jsonb_build_object('actorProfileId',a,'workerProfileId',w,'submissionId',s,'versionId',v,'jobId',case when s is null then null else job end,'sourceId',case when s is null then null else source end,
   'expectedRevision',case when s is null then null else 2 end,'expectedScheduleRevision',1,'otherRateAmount','260.00',
   'rateInput',jsonb_build_object('effective_from','2026-10-10','amount','250.00','currency','CZK','reason','TEST-LABOR-HISTORY-'||run||':covering')));
  execute 'reset role';
 end loop;
 perform set_config('diriqo.labor_concurrency_setup',jsonb_build_object('project',${q(project)},'authUserId',u,'actorProfileId',a,'workerProfileId',w,'fixtures',result)::text,true);
end $setup$;
select current_setting('diriqo.labor_concurrency_setup')::jsonb as fixture_result;
`)
  await save(dir,'owner-disable.sql',`-- OWNER ONLY after reports reviewed; retain immutable audit and business rows.
do $cleanup$
#variable_conflict use_variable
declare p jsonb;a uuid:=${q(actorProfileId)};w uuid:=${q(workerProfileId)};
begin
 if current_user<>'postgres' or not exists(select 1 from public.profiles where id=a and auth_user_id=${q(auth.authUserId)}) then raise exception 'EXACT_SYNTHETIC_ACTOR_REQUIRED';end if;
 for p in select value from jsonb_array_elements(${q(JSON.stringify(plan.scenarios))}::jsonb) loop
  if not exists(select 1 from public.companies where id=(p->>'companyId')::uuid and name='TEST-LABOR-HISTORY-'||(p->>'runId')) then raise exception 'EXACT_SYNTHETIC_COMPANY_REQUIRED';end if;
  update public.company_members set is_active=false where company_id=(p->>'companyId')::uuid and profile_id in(a,w);
  update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Synthetic labor concurrency finished; audit retained'
   where company_id=(p->>'companyId')::uuid and source_ref='labor-history-concurrency:'||(p->>'runId') and revoked_at is null;
 end loop;
 update public.profiles set is_active=false where id in(a,w);
end $cleanup$;
-- Separately revoke/ban/rotate ONLY fresh Auth ${auth.authUserId}; verify auth.sessions count=0.
`)
  console.log(JSON.stringify({prepared:true,project,companies:5,authAccounts:1,ownerSetup:path.join(dir,'owner-setup.sql')}))
 }else{
  const plan=JSON.parse(await fs.readFile(path.join(dir,'plan.json'),'utf8')),result=JSON.parse(await fs.readFile(path.join(dir,'owner-result.json'),'utf8'))
  assert(plan.project===project&&result.project===project&&plan.authUserId===auth.authUserId&&result.authUserId===auth.authUserId&&result.actorProfileId===plan.actorProfileId&&result.workerProfileId===plan.workerProfileId&&result.fixtures?.length===5,'EXACT_OWNER_RESULT_REQUIRED')
  for(const wanted of plan.scenarios){
   const f=result.fixtures.find(x=>x.runId===wanted.runId);assert(f&&Object.entries(wanted).every(([k,v])=>f[k]===v)&&f.actorProfileId===plan.actorProfileId&&f.workerProfileId===plan.workerProfileId&&f.expectedScheduleRevision===1,'EXACT_SCENARIO_REQUIRED')
   if(!['rate-retry','rate-conflict'].includes(f.scenario))assert([f.submissionId,f.versionId,f.jobId,f.sourceId].every(x=>uuid.test(x||''))&&f.expectedRevision===2,'EXACT_SUBMISSION_REQUIRED')
   await save(dir,f.scenario+'.private.json',{email:auth.email,password:auth.password,authUserId:auth.authUserId,fixture:f})
   const receiptOps=[f.operationId,...(f.otherOperationId?[f.otherOperationId]:[])]
   await save(dir,f.scenario+'.owner-postflight.sql',`-- READ ONLY exact synthetic scope; compare to baseline (one baseline rate/event/receipt).
select jsonb_build_object('project',${q(project)},'runId',${q(f.runId)},'scenario',${q(f.scenario)},'companyId',${q(f.companyId)},'actorProfileId',${q(f.actorProfileId)},'workerProfileId',${q(f.workerProfileId)},
 'scheduleRevision',(select revision from public.company_worker_rate_schedules where company_id=${q(f.companyId)}::uuid and profile_id=${q(f.workerProfileId)}::uuid),
 'rateCount',(select count(*) from public.company_worker_rate_versions where company_id=${q(f.companyId)}::uuid and profile_id=${q(f.workerProfileId)}::uuid),
 'events',(select coalesce(jsonb_object_agg(action,n),'{}') from(select action,count(*) n from public.labor_history_events where company_id=${q(f.companyId)}::uuid group by action)t),
 'testedReceipts',(select coalesce(jsonb_agg(jsonb_build_object('operationId',operation_id,'operation',operation,'requestHash',request_hash,'responseHash',md5(response::text)) order by operation_id),'[]') from private.labor_operation_receipts where company_id=${q(f.companyId)}::uuid and actor_id=${q(f.actorProfileId)}::uuid and operation_id=any(array[${receiptOps.map(q).join(',')}]::uuid[])),
 'submissions',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'revision',s.revision,'currentVersionId',s.current_version_id,'approvedVersionId',s.approved_version_id,'versionCount',(select count(*) from public.labor_submission_versions v where v.submission_id=s.id),'snapshotCount',(select count(*) from public.labor_cost_snapshots x join public.labor_submission_versions v on v.id=x.version_id where v.submission_id=s.id))),'[]') from public.labor_submissions s where s.company_id=${q(f.companyId)}::uuid)) as owner_postflight;
`)
  }
  await save(dir,'run-instructions.txt','Five private fixtures prepared. Run ONE at a time with scripts/test-labor-history-concurrency.mjs --execute='+project+' and explicit --fixture/--env-file/--output/--barrier paths. During ready delay root runs the generated <output>.barrier.sql, then atomically saves barrier_evidence to the requested barrier path. After HTTP report, run matching owner-postflight.sql and verify exact counts. passed:false remains until independent owner checks. Never reuse run IDs; always review owner-disable.sql and separately ban/rotate exact fresh Auth. No email, payment, or deployment.\n')
  console.log(JSON.stringify({finalized:true,project,fixtures:5,directory:dir,secretsPrinted:false}))
 }
}catch{console.error(JSON.stringify({prepared:false,message:'Offline preparation failed. No network or database calls were made.'}));process.exitCode=1}
