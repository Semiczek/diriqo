// Prepared test runner. NOT executed by preparation. Only the exact authorized TEST project.
// node scripts/test-labor-history-concurrency.mjs --execute=wfcpfraxiuhuglnuaxqj
//   --fixture=<private.json> --env-file=<local.env> --output=<new.redacted.json>
//   --barrier=<new.owner-observation.json> [--request-delay-ms=15000]
// Private fixture: {email,password,authUserId,fixture:{runId,scenario,companyId,
// actorProfileId,workerProfileId,operationId,otherOperationId?,submissionId?,versionId?,
// expectedRevision?,expectedScheduleRevision?,rateInput?,otherRateAmount?}}.
// Does not create fixture rows, send mail, read service keys, or disable accounts.
// Both Auth sessions are logged out locally. Root separately verifies owner audit counts,
// bans/rotates only the fresh synthetic account and proves no remaining sessions.
// A completed run is evidence preparation, not final acceptance: ownerAuditPending remains true.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual as equal } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { laborHistoryScenarios, matchesLaborHistoryGate, validateLaborHistoryOverlap } from './labor-history-concurrency-proof.mjs'
const project='wfcpfraxiuhuglnuaxqj',url=`https://${project}.supabase.co`,root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,nil='00000000-0000-0000-0000-000000000000'
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),integer=x=>Number.isSafeInteger(x)&&x>=0
const tokens=[],sessions=[],report={project,passed:false,ownerAuditPending:true,loggedOutSessions:0}
let args={},auth,f,headers,output,outputOwned=false,stage='configuration',previewBefore
const requireFresh=async file=>{try{await fs.lstat(file)}catch(e){if(e.code==='ENOENT')return;throw e}throw Error('ONE_TIME_FILE_REQUIRED')}
const decimal=(value,scale)=>{const m=String(value).match(/^(\d+)(?:\.(\d+))?$/);assert(m&&(m[2]||'').length<=scale,'EXACT_DECIMAL_REQUIRED');return BigInt(m[1])*10n**BigInt(scale)+BigInt((m[2]||'').padEnd(scale,'0'))}
const selected=d=>d?.versions.find(v=>v.id===f.versionId)
const isRate=index=>f.scenario.startsWith('rate-')&&(f.scenario!=='rate-vs-approve'||index===0)
const opFor=index=>index===1&&['approve-race','rate-vs-approve'].includes(f.scenario)?f.otherOperationId:f.operationId
const rpcFor=index=>isRate(index)?'set_company_worker_rate':'review_labor_submission'
async function readRpc(name,body,token){const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});assert(r.ok,'READ_FAILED');return r.json()}
async function snapshot(token){
 const rates=await readRpc('list_company_worker_rates',{target_company_id:f.companyId,target_profile_id:f.workerProfileId},token)
 assert(rates.company_id===f.companyId&&rates.profile_id===f.workerProfileId&&rates.company_name==='TEST-LABOR-HISTORY-'+f.runId,'SYNTHETIC_TENANT_REQUIRED')
 let submission=null,totals=null
 if(!['rate-retry','rate-conflict'].includes(f.scenario)){
  submission=await readRpc('get_labor_submission',{target_company_id:f.companyId,target_submission_id:f.submissionId},token)
  assert(submission?.id===f.submissionId&&submission.company_id===f.companyId&&submission.profile_id===f.workerProfileId,'EXACT_SUBMISSION_REQUIRED')
  totals=await readRpc('get_job_labor_cost_totals',{target_company_id:f.companyId,job_ids:[submission.job_id]},token)
  assert(totals.company_id===f.companyId&&totals.items.length===1&&totals.items[0].job_id===submission.job_id,'EXACT_JOB_REQUIRED')
 }
 return {rates,submission,totals}
}
function requestBody(index){
 let payload
 if(isRate(index))payload={actor_profile_id:f.actorProfileId,profile_id:f.workerProfileId,expected_schedule_revision:f.expectedScheduleRevision,
  effective_from:f.rateInput.effective_from,amount:index===1&&f.scenario==='rate-conflict'?f.otherRateAmount:f.rateInput.amount,
  currency:f.rateInput.currency,unit:'hour',worker_type:'employee',billing_type:'hourly',reason:f.rateInput.reason,operation_id:opFor(index)}
 else payload={actor_profile_id:f.actorProfileId,submission_id:f.submissionId,version_id:f.versionId,expected_revision:f.expectedRevision,decision:'approve',expected_cost_preview_hash:previewBefore.preview_hash,operation_id:opFor(index)}
 return {target_company_id:f.companyId,payload}
}
async function call(index){
 const started=performance.now(),base={client:index?'B':'A',operationId:opFor(index),queryFunction:rpcFor(index),startedMonotonicMs:started}
 const signal=AbortSignal.timeout(55000);let responsePhase='headers',status=null
 try{
  const r=await fetch(url+'/rest/v1/rpc/'+rpcFor(index),{method:'POST',headers:{...headers,Authorization:'Bearer '+tokens[index]},body:JSON.stringify(requestBody(index)),signal})
  status=r.status;responsePhase='body'
  const data=await r.json();responsePhase='receipt'
  const clean={...base,status:r.status,finishedMonotonicMs:performance.now(),success:false}
  if(r.status!==200)return {clean:{...clean,code:/^[A-Z0-9]{5}$/.test(data?.code||'')?data.code:null,error:/^LABOR_[A-Z_]+$/.test(data?.message||'')?data.message:null},data:null}
  assert(data.company_id===f.companyId&&data.actor_profile_id===f.actorProfileId&&data.operation_id===opFor(index),'RECEIPT_SCOPE')
  assert(isRate(index)?data.profile_id===f.workerProfileId:data.id===f.submissionId,'RECEIPT_IDENTITY')
  return {clean:{...clean,success:true,receiptHash:hash(data)},data}
 }catch{return {clean:{...base,finishedMonotonicMs:performance.now(),success:false,transportOrReceiptError:true,status,responseFailurePhase:responsePhase,timedOut:signal.aborted},data:null}}
}
async function waitGate(){const end=performance.now()+60000;while(performance.now()<end){let g;try{g=JSON.parse(await fs.readFile(args['--barrier'],'utf8'))}catch{}if(matchesLaborHistoryGate(g,f))return g;await delay(250)}throw Error('OWNER_EVIDENCE_MISSING')}
function checkOutcome(before,after,results){
 const good=results.filter(x=>x.clean.success),failed=results.filter(x=>!x.clean.success),scenario=f.scenario
 const expected=({ 'approve-retry':2,'approve-race':1,'rate-retry':2,'rate-conflict':1 })[scenario]
 if(expected!==undefined)assert(good.length===expected,'EXPECTED_SUCCESS_COUNT')
 const conflict=token=>assert(failed.length===1&&failed[0].clean.status===409&&failed[0].clean.code==='PT409'&&failed[0].clean.error===token,'EXPECTED_CONFLICT')
 if(scenario==='approve-race')conflict('LABOR_REVISION_CONFLICT')
 if(scenario==='rate-conflict')conflict('LABOR_OPERATION_CONFLICT')
 if(scenario.endsWith('retry'))assert(equal(results[0].data,results[1].data),'IDENTICAL_REPLAY_RECEIPT')
 if(scenario.startsWith('rate-')){
  assert(after.rates.schedule_revision===before.rates.schedule_revision+1&&after.rates.rates.length===before.rates.rates.length+1,'ONE_RATE_VERSION')
  assert(equal(before.rates.rates,after.rates.rates.filter(r=>before.rates.rates.some(old=>old.id===r.id))),'IMMUTABLE_OLD_RATES')
  const newRate=after.rates.rates.find(r=>!before.rates.rates.some(old=>old.id===r.id)),rateWinner=results.find(x=>x.clean.success&&x.clean.queryFunction==='set_company_worker_rate')
  assert(rateWinner&&equal(rateWinner.data.rate,newRate),'COMMITTED_RATE_RECEIPT')
  assert(newRate.effective_from===f.rateInput.effective_from&&newRate.currency===f.rateInput.currency,'EXPECTED_NEW_RATE_SCOPE')
  const winnerInput=requestBody(rateWinner.clean.client==='A'?0:1).payload
  assert(['amount','currency','unit','worker_type','billing_type','reason','effective_from'].every(key=>newRate[key]===winnerInput[key])&&rateWinner.data.schedule_revision===after.rates.schedule_revision,'EXACT_WINNING_RATE_PAYLOAD')
 }else assert(equal(before.rates,after.rates),'APPROVAL_CANNOT_CHANGE_RATES')
 if(scenario==='rate-vs-approve'){
  assert(results[0].clean.success,'RATE_MUST_COMMIT')
  if(results[1].clean.success){assert(after.submission.revision===before.submission.revision+1&&after.submission.approved_version_id===f.versionId&&equal(selected(after.submission).cost,previewBefore.cost),'APPROVAL_FIRST_FROZEN_OLD_COST');report.serialOutcome='approval-before-rate'}
  else{conflict('LABOR_PREVIEW_CONFLICT');assert(equal(before.submission,after.submission),'STALE_PREVIEW_NO_PARTIAL_APPROVAL');report.serialOutcome='rate-before-approval-stale-preview'}
 }else if(scenario.startsWith('approve-')){
  assert(after.submission.revision===before.submission.revision+1&&after.submission.approved_version_id===f.versionId&&selected(after.submission).state==='approved','ONE_APPROVAL')
  assert(equal(selected(after.submission).cost,previewBefore.cost),'EXACT_APPROVED_SNAPSHOT')
 }
 if(before.submission){
  assert(equal(selected(before.submission).lines,selected(after.submission).lines),'REVIEWED_LINES_PRESERVED')
  const oldTotals=before.totals.items[0],totals=after.totals.items[0],approved=after.submission.approved_version_id===f.versionId
  assert(decimal(oldTotals.approved_cost,2)===0n&&oldTotals.legacy_unverified_count===0,'DEDICATED_FIRST_APPROVAL_JOB_REQUIRED')
  assert(totals.legacy_unverified_count===0&&totals.unconverted_costs.length===0&&decimal(totals.missing_rate_hours,4)===0n,'NO_HIDDEN_COST_GAPS')
  if(approved){
   assert(totals.completeness==='complete'&&decimal(totals.approved_cost,2)===decimal(previewBefore.cost.amount,2)&&decimal(totals.total_cost,2)===decimal(previewBefore.cost.amount,2),'ONE_EXACT_CANONICAL_COST')
   assert(decimal(totals.approved_hours,4)===selected(before.submission).lines.reduce((sum,line)=>sum+decimal(line.actual_hours,4),0n),'EXACT_CANONICAL_HOURS')
   for(const result of results.filter(x=>x.clean.success&&x.clean.queryFunction==='review_labor_submission')){const detail={...result.data};delete detail.actor_profile_id;delete detail.operation_id;assert(equal(detail,after.submission),'COMMITTED_APPROVAL_RECEIPT')}
  }else assert(totals.approved_cost===oldTotals.approved_cost&&totals.approved_hours===oldTotals.approved_hours&&totals.total_cost===null,'NO_PARTIAL_APPROVED_COST')
  assert(equal(before.submission.sources,after.submission.sources),'SOURCES_PRESERVED');for(const v of before.submission.versions.filter(v=>v.id!==f.versionId))assert(equal(v,after.submission.versions.find(x=>x.id===v.id)),'OLDER_VERSION_PRESERVED')}
 return {committedInvariantsVerified:true,sourceWritesTested:false,preservationScope:'exact fixture worker rate schedule and selected submission via scoped RPC; owner audit pending'}
}
try{
 args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');assert(i>0,'KEY_VALUE_ARGUMENTS_REQUIRED');return [arg.slice(0,i),arg.slice(i+1)]}))
 assert(args['--execute']===project&&args['--fixture']&&args['--output']&&args['--barrier']&&args['--env-file'],'EXPLICIT_TEST_RUN_CONFIGURATION_REQUIRED')
 auth=JSON.parse(await fs.readFile(args['--fixture'],'utf8'));f=auth.fixture;output=path.resolve(args['--output'])
 assert(/^labor-history-concurrency-[0-9a-f-]+@example\.invalid$/i.test(auth.email)&&typeof auth.password==='string'&&auth.password.length>0&&uuid.test(auth.authUserId||''),'FRESH_SYNTHETIC_AUTH_REQUIRED')
 assert(f&&laborHistoryScenarios.includes(f.scenario)&&[f.runId,f.companyId,f.actorProfileId,f.workerProfileId,f.operationId].every(x=>uuid.test(x||'')&&x!==nil),'EXACT_SCOPE_REQUIRED')
 assert(f.actorProfileId!==f.workerProfileId,'SEPARATE_SYNTHETIC_ACTOR_AND_WORKER_REQUIRED')
 if(['approve-race','rate-vs-approve'].includes(f.scenario))assert(uuid.test(f.otherOperationId||'')&&f.operationId!==f.otherOperationId&&f.otherOperationId!==nil,'FRESH_SECOND_OPERATION_REQUIRED')
 if(!['rate-retry','rate-conflict'].includes(f.scenario))assert(uuid.test(f.submissionId||'')&&uuid.test(f.versionId||'')&&integer(f.expectedRevision),'SUBMISSION_CAS_REQUIRED')
 if(f.scenario.startsWith('rate-')){
  assert(integer(f.expectedScheduleRevision)&&f.rateInput&&/^\d{4}-\d{2}-\d{2}$/.test(f.rateInput.effective_from)&&/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(f.rateInput.amount)&&/^[A-Z]{3}$/.test(f.rateInput.currency)&&f.rateInput.reason?.startsWith('TEST-LABOR-HISTORY-')&&f.rateInput.reason.length<=2000,'EXPLICIT_RATE_INPUT_REQUIRED')
  if(f.scenario==='rate-conflict')assert(/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(f.otherRateAmount)&&f.otherRateAmount!==f.rateInput.amount,'DIFFERENT_REPLAY_PAYLOAD_REQUIRED')
 }
 const requestDelayMs=Number(args['--request-delay-ms']??15000);assert(integer(requestDelayMs)&&requestDelayMs<=45000,'BOUNDED_DELAY_REQUIRED')
 const claim=path.join(path.dirname(path.resolve(args['--fixture'])),'labor-history-'+f.runId+'.claim.json'),sqlPath=output+'.barrier.sql'
 const paths=[args['--fixture'],output,args['--barrier'],args['--env-file'],claim,sqlPath].map(p=>path.resolve(p).toLowerCase());assert(new Set(paths).size===paths.length,'DISTINCT_FILES_REQUIRED')
 await requireFresh(output);await requireFresh(args['--barrier']);await requireFresh(sqlPath)
 await fs.writeFile(claim,JSON.stringify({project,runId:f.runId,scenario:f.scenario})+'\n',{flag:'wx',mode:0o600})
 await fs.writeFile(output,JSON.stringify({...report,stage:'claimed'})+'\n',{flag:'wx',mode:0o600});outputOwned=true
 let barrierSql=await fs.readFile(path.join(root,'supabase/tests/labor-history-concurrency-barrier.sql'),'utf8')
 for(const [key,value] of Object.entries({COMPANY_ID:f.companyId,ACTOR_PROFILE_ID:f.actorProfileId,WORKER_PROFILE_ID:f.workerProfileId,RUN_ID:f.runId,OPERATION_ID:f.operationId,OTHER_OPERATION_ID:f.otherOperationId||nil,SUBMISSION_ID:f.submissionId||nil,VERSION_ID:f.versionId||nil,SCENARIO:f.scenario}))barrierSql=barrierSql.replaceAll('__'+key+'__',value)
 assert(!/__\w+__/.test(barrierSql),'ALL_PLACEHOLDERS_BOUND');await fs.writeFile(sqlPath,barrierSql,{flag:'wx',mode:0o600})
 const env=Object.fromEntries((await fs.readFile(args['--env-file'],'utf8')).split(/\r?\n/).map(s=>s.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([,k,v])=>[k,v.trim().replace(/^["']|["']$/g,'')]))
 assert(env.NEXT_PUBLIC_SUPABASE_URL===url&&env.NEXT_PUBLIC_SUPABASE_ANON_KEY,'EXACT_PROJECT_REQUIRED')
 const key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;assert(key.startsWith('sb_publishable_')||JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role==='anon','PUBLIC_KEY_ONLY')
 headers={apikey:key,'Content-Type':'application/json',Connection:'close'};stage='authentication'
 for(let i=0;i<2;i++){
  const r=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers,body:JSON.stringify({email:auth.email,password:auth.password}),signal:AbortSignal.timeout(30000)});assert(r.ok,'AUTH_FAILED');const data=await r.json()
  assert(typeof data.access_token==='string','AUTH_TOKEN_REQUIRED');tokens.push(data.access_token);assert(data.user?.id===auth.authUserId,'EXACT_AUTH_ID_REQUIRED')
  const claims=JSON.parse(Buffer.from(data.access_token.split('.')[1],'base64url').toString());assert(claims.sub===auth.authUserId&&claims.role==='authenticated'&&uuid.test(claims.session_id||''),'EXACT_AUTH_SESSION_REQUIRED');sessions.push(claims.session_id)
 }
 assert(sessions[0]!==sessions[1],'DISTINCT_SESSIONS_REQUIRED');report.distinctAuthenticatedSessions=true
 stage='fixture validation';const before=await snapshot(tokens[0])
 if(f.scenario.startsWith('rate-'))assert(before.rates.schedule_revision===f.expectedScheduleRevision&&!before.rates.rates.some(x=>x.effective_from===f.rateInput.effective_from)&&before.rates.currency===f.rateInput.currency,'FRESH_RATE_CAS_REQUIRED')
 if(before.submission){
  assert(before.submission.current_version_id===f.versionId&&before.submission.revision===f.expectedRevision&&selected(before.submission)?.state==='submitted','CURRENT_SUBMITTED_VERSION_REQUIRED')
  previewBefore=await readRpc('get_labor_cost_preview',{target_company_id:f.companyId,target_submission_id:f.submissionId,target_version_id:f.versionId},tokens[0])
  assert(previewBefore.company_id===f.companyId&&previewBefore.submission_id===f.submissionId&&previewBefore.version_id===f.versionId&&previewBefore.completeness==='complete'&&previewBefore.cost&&/^[a-f0-9]{64}$/.test(previewBefore.preview_hash),'EXACT_COMPLETE_PREVIEW_REQUIRED')
  if(f.scenario==='rate-vs-approve')assert(selected(before.submission).lines.every(l=>f.rateInput.effective_from<=l.work_date&&!before.rates.rates.some(r=>r.effective_from>f.rateInput.effective_from&&r.effective_from<=l.work_date)),'NEW_RATE_MUST_COVER_REVIEWED_WORK')
 }
 Object.assign(report,{runId:f.runId,scenario:f.scenario,companyId:f.companyId,beforeFingerprint:hash(before),requestDelayMs,barrierSql:sqlPath})
 stage='before dispatch';await fs.writeFile(output,JSON.stringify({...report,stage})+'\n');console.log(JSON.stringify({ready:true,runId:f.runId,requestDelayMs,barrierSql:sqlPath}));await delay(requestDelayMs)
 stage='concurrent requests';const results=await Promise.all([call(0),call(1)]);report.responses=results.map(x=>x.clean)
 await fs.writeFile(output,JSON.stringify({...report,stage:'waiting for owner barrier proof'},null,2)+'\n');console.log(JSON.stringify({httpCompleted:true,runId:f.runId,responses:report.responses}))
 stage='owner overlap proof';report.overlap=validateLaborHistoryOverlap(await waitGate(),report.responses,f)
 stage='committed state';const after=await snapshot(tokens[1]);Object.assign(report,checkOutcome(before,after,results),{afterFingerprint:hash(after),httpAndOverlapVerified:true})
}catch{report.failureStage=stage;process.exitCode=1;console.error(JSON.stringify({stage,message:'Incomplete verification; inspect redacted evidence and owner result.'}))}
finally{
 const logout=await Promise.allSettled(tokens.map(token=>fetch(url+'/auth/v1/logout?scope=local',{method:'POST',headers:{...headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)})))
 report.loggedOutSessions=logout.filter(x=>x.status==='fulfilled'&&x.value.ok).length
 report.httpVerificationComplete=report.httpAndOverlapVerified===true&&tokens.length===2&&report.loggedOutSessions===2
 if(!report.httpVerificationComplete)process.exitCode=1
 if(outputOwned)await fs.writeFile(output,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report))
}
