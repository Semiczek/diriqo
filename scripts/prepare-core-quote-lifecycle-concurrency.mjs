// OFFLINE ONLY. No network, Auth creation, database calls or secrets in stdout.
// node -- scripts/prepare-core-quote-lifecycle-concurrency.mjs --mode=prepare
// --auth-private=<new-auth.json> --directory=<NEW protected Temp child directory>
// Auth JSON: {project:'wfcpfraxiuhuglnuaxqj',authUserId,email,password} for ONE NEW
// email core-quote-lifecycle-concurrency-<uuid>@example.invalid, email_confirm:true.
// Root creates that new Auth user separately, never re-enables an old disabled user.
// After owner executes owner-setup.sql and saves its JSON scalar to owner-result.json:
// node -- scripts/prepare-core-quote-lifecycle-concurrency.mjs --mode=finalize
// --auth-private=<same-new-auth.json> --directory=<same directory>
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const project='wfcpfraxiuhuglnuaxqj',root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,nil='00000000-0000-0000-0000-000000000000'
const scenarios=['create-retry','update-race','publish-retry','delivery-retry','conversion-retry']
const sql=value=>"'"+String(value).replaceAll("'","''")+"'"
const save=(directory,name,value)=>fs.writeFile(path.join(directory,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600})
try{
 const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');assert(i>0,'Use --name=value');return [arg.slice(0,i),arg.slice(i+1)]}))
 assert(['prepare','finalize'].includes(args['--mode'])&&args['--directory']&&args['--auth-private'],'Mode, private Auth and directory required')
 const directory=path.resolve(args['--directory']),inside=path.relative(path.resolve(tmpdir()),directory)
 assert(inside&&!inside.startsWith('..')&&!path.isAbsolute(inside),'Use a new protected child of the current Temp directory')
 const auth=JSON.parse(await fs.readFile(args['--auth-private'],'utf8'))
 assert(auth.project===project&&uuid.test(auth.authUserId||'')&&/^core-quote-lifecycle-concurrency-[0-9a-f-]+@example\.invalid$/i.test(auth.email)&&typeof auth.password==='string'&&auth.password.length>0,'Exact new synthetic Auth fixture required')
 if(args['--mode']==='prepare'){
  await fs.mkdir(directory,{mode:0o700})
  const profileId=randomUUID(),plan={project,profileId,authUserId:auth.authUserId,scenarios:scenarios.map(scenario=>({scenario,runId:randomUUID(),companyId:randomUUID(),operationId:randomUUID(),...(scenario==='update-race'?{otherOperationId:randomUUID()}:{})}))}
  await save(directory,'plan.json',plan)
  const setup=`-- OWNER ONLY on ${project}. One transaction, only new synthetic fixtures.
-- Auth must already exist; no Auth email is sent and no existing account is reused.
do $setup$
#variable_conflict use_variable
declare actor uuid:=${sql(profileId)}; user_id uuid:=${sql(auth.authUserId)}; p jsonb; company uuid; run uuid; calc uuid; quote uuid; version uuid;
 r jsonb; draft jsonb; input jsonb; results jsonb:='[]'; now_at timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from auth.users u where u.id=user_id and u.email=${sql(auth.email)} and (u.banned_until is null or u.banned_until<clock_timestamp()))
  or exists(select 1 from public.profiles where auth_user_id=user_id or id=actor) then raise exception 'NEW_AUTH_FIXTURE_REQUIRED';end if;
 insert into public.profiles(id,auth_user_id,user_id,full_name,is_active) values(actor,user_id,user_id,'TEST core quote lifecycle',true);
 for p in select value from jsonb_array_elements(${sql(JSON.stringify(plan.scenarios))}::jsonb) loop
  company:=(p->>'companyId')::uuid;run:=(p->>'runId')::uuid;
  if exists(select 1 from public.companies where id=company or name='TEST-CORE-QUOTE-LIFECYCLE-'||run::text) then raise exception 'FIXTURE_COLLISION';end if;
  insert into public.companies(id,name) values(company,'TEST-CORE-QUOTE-LIFECYCLE-'||run::text);
  insert into public.company_members(company_id,profile_id,role,is_active) values(company,actor,'company_admin',true);
  insert into public.company_modules(company_id,module_key,is_enabled) values(company,'quotes',true),(company,'kalkulace',true),(company,'jobs',true) on conflict(company_id,module_key) do update set is_enabled=true;
  insert into private.company_module_rollouts(company_id,product,livemode) values(company,'diriqo_core',false);
  insert into private.company_test_module_grants(company_id,product,source_ref,reason,valid_from,valid_until,history_until,capabilities)
   values(company,'diriqo_core','quote-lifecycle-concurrency:'||run::text,'Synthetic real Auth concurrency proof only',now_at-interval '1 minute',now_at+interval '24 hours',now_at+interval '24 hours',array['core.quotes.create','core.jobs.create']);
  perform set_config('request.jwt.claim.sub',user_id::text,true);
  execute 'set local role authenticated';
  input:=jsonb_build_object('customer_id',null,'title','TEST-CORE-QUOTE-LIFECYCLE-'||run::text,'description',null,'status','draft','calculation_date',current_date,'internal_note','Synthetic private cost','currency','CZK',
   'items',jsonb_build_array(
    jsonb_build_object('item_type','customer','name','Free customer line','description',null,'quantity','1.00','unit','ks','unit_cost','0.00','unit_price','0.00','vat_rate','0.00','note',null),
    jsonb_build_object('item_type','customer','name','Paid customer line','description','Synthetic','quantity','2.00','unit','ks','unit_cost','0.00','unit_price','10.00','vat_rate','21.00','note',null),
    jsonb_build_object('item_type','material','name','Never copied internal cost','description',null,'quantity','1.00','unit','ks','unit_cost','40.00','unit_price','0.00','vat_rate','21.00','note','Private')));
  r:=public.create_core_calculation_atomic(company,gen_random_uuid(),input);calc:=(r->>'calculationId')::uuid;
  quote:=null;version:=null;draft:=null;
  if p->>'scenario'<>'create-retry' then
   r:=public.create_core_quote_from_calculation_atomic(company,calc,1,gen_random_uuid());quote:=(r->>'quoteId')::uuid;
   draft:=public.get_core_quote_workspace(company,quote)->'draft';
  end if;
  if p->>'scenario' in('delivery-retry','conversion-retry') then
   r:=public.publish_core_quote_version_atomic(company,quote,1,gen_random_uuid());version:=(r->>'versionId')::uuid;
  end if;
  if p->>'scenario'='conversion-retry' then
   perform public.record_core_quote_decision_atomic(company,quote,version,gen_random_uuid(),jsonb_build_object('decision','accepted','evidence','Synthetic fixture approval only; no real customer','decided_at',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
  end if;
  results:=results||jsonb_build_array(p||jsonb_build_object('calculationId',calc,'quoteId',quote,'versionId',version,'draftInput',draft));
  execute 'reset role';
 end loop;
 perform set_config('diriqo.core_quote_lifecycle_fixtures',jsonb_build_object('project',${sql(project)},'profileId',actor,'authUserId',user_id,'fixtures',results)::text,true);
end;$setup$;
select current_setting('diriqo.core_quote_lifecycle_fixtures')::jsonb as fixtures;
`
  await save(directory,'owner-setup.sql',setup)
  const cleanup=`-- OWNER ONLY after all reports reviewed; preserve history and do not delete Auth/business rows.
do $cleanup$
#variable_conflict use_variable
declare p jsonb; actor uuid:=${sql(profileId)};
begin
 if not exists(select 1 from public.profiles where id=actor and auth_user_id=${sql(auth.authUserId)}) then raise exception 'EXACT_ACTOR_REQUIRED';end if;
 for p in select value from jsonb_array_elements(${sql(JSON.stringify(plan.scenarios))}::jsonb) loop
  if not exists(select 1 from public.companies where id=(p->>'companyId')::uuid and name='TEST-CORE-QUOTE-LIFECYCLE-'||(p->>'runId')) then raise exception 'EXACT_COMPANY_REQUIRED';end if;
  update public.company_members set is_active=false where company_id=(p->>'companyId')::uuid and profile_id=actor;
  update private.company_test_module_grants set revoked_at=clock_timestamp(),revocation_reason='Synthetic concurrency run finished; history retained' where company_id=(p->>'companyId')::uuid and source_ref='quote-lifecycle-concurrency:'||(p->>'runId') and revoked_at is null;
 end loop;
 update public.profiles set is_active=false where id=actor;
end;$cleanup$;
-- Then revoke all sessions, ban the exact NEW Auth ID and rotate its password via
-- the separate secured Admin helper. Verify auth.sessions count=0. Never reactivate old accounts.
`
  await save(directory,'owner-disable.sql',cleanup)
  console.log(JSON.stringify({prepared:true,project,companies:5,authAccounts:1,ownerSetup:path.join(directory,'owner-setup.sql')}))
 }else{
  const plan=JSON.parse(await fs.readFile(path.join(directory,'plan.json'),'utf8')),result=JSON.parse(await fs.readFile(path.join(directory,'owner-result.json'),'utf8'))
  assert(plan.project===project&&plan.authUserId===auth.authUserId&&result.project===project&&result.profileId===plan.profileId&&result.authUserId===auth.authUserId&&result.fixtures?.length===5,'Exact completed owner result required')
  const template=await fs.readFile(path.join(root,'supabase/tests/core-quote-lifecycle-concurrency-barrier.sql'),'utf8'),commands=[]
  for(const expected of plan.scenarios){
   const row=result.fixtures.find(r=>r.scenario===expected.scenario);assert(row&&['runId','companyId','operationId'].every(k=>row[k]===expected[k])&&uuid.test(row.calculationId||''),'Exact scenario result required')
   const f={...expected,profileId:plan.profileId}
   if(f.scenario==='create-retry'){f.calculationId=row.calculationId;f.expectedCalculationRevision='1'}
   else{assert(uuid.test(row.quoteId||''),'Quote ID required');f.quoteId=row.quoteId}
   if(['update-race','publish-retry'].includes(f.scenario))f.expectedRevision='1'
   if(f.scenario==='update-race'){assert(row.draftInput?.items?.length===2,'Complete source draft required');f.input={...row.draftInput,title:row.draftInput.title+' - saved',customer_note:'Synthetic complete update',items:row.draftInput.items.map((item,i)=>i===1?{...item,unit_price:'20.00'}:item)}}
   if(['delivery-retry','conversion-retry'].includes(f.scenario)){assert(uuid.test(row.versionId||''),'Issued version required');f.versionId=row.versionId}
   if(f.scenario==='delivery-retry')f.input={to_email:'quote-concurrency@example.invalid',to_name:'Synthetic recipient',subject:'TEST-CORE-QUOTE-LIFECYCLE-'+f.runId,body_text:'Reservation only. No provider is called.',body_html:null,thread_id:null}
   if(f.scenario==='conversion-retry'){const day=new Date(Date.now()+86400000).toISOString().slice(0,10),start=day+'T08:00:00.000Z',end=day+'T18:00:00.000Z';f.input={title:'TEST-CORE-QUOTE-LIFECYCLE-'+f.runId,description:null,address:null,start_at:start,end_at:end,split_days:[{label:day,start_at:start,end_at:end}]}}
   const name=f.scenario,fixturePath=path.join(directory,name+'.private.json'),output=path.join(directory,name+'.report.json'),barrier=path.join(directory,name+'.observation.json')
   await save(directory,name+'.private.json',{email:auth.email,password:auth.password,authUserId:auth.authUserId,fixture:f})
   const substitutions={RUN_ID:f.runId,COMPANY_ID:f.companyId,OPERATION_ID:f.operationId,OTHER_OPERATION_ID:f.otherOperationId??nil,QUOTE_ID:f.quoteId??nil,CALCULATION_ID:f.calculationId??nil,VERSION_ID:f.versionId??nil,SCENARIO:f.scenario}
   let rendered=template;for(const [key,value]of Object.entries(substitutions))rendered=rendered.replaceAll('__'+key+'__',value)
   assert(!/__[A-Z_]+__/.test(rendered),'No unresolved SQL placeholder');await save(directory,name+'.owner-barrier.sql',rendered)
   const ps=v=>"'"+v.replaceAll("'","''")+"'"
   commands.push('node -- '+ps(path.join(root,'scripts/test-core-quote-lifecycle-concurrency.mjs'))+' '+ps('--fixture='+fixturePath)+' '+ps('--output='+output)+' '+ps('--barrier='+barrier)+" '--env-file=C:\\vyvoj\\diriqo\\.env.local' --request-delay-ms=15000")
  }
  await save(directory,'commands.ps1',commands.join('\n')+'\n');console.log(JSON.stringify({finalized:true,project,scenarios:5,commands:path.join(directory,'commands.ps1')}))
 }
}catch{console.error(JSON.stringify({prepared:false,message:'Offline fixture preparation stopped; verify mode, exact new Auth fixture and unused protected paths.'}));process.exitCode=1}
