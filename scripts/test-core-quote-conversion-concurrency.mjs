// Authorized TEST project only. Root prepares private credentials and synthetic data.
// Usage: node scripts/test-core-quote-conversion-concurrency.mjs --fixture=<private.json>
//   --output=<evidence.json> --barrier=<owner-observation.json> [--env-file=<local.env>]
// Optional --resume-evidence=<prior-redacted-report.json> verifies completed round1
// and the unchanged post-create snapshot, then runs ONLY round2 with fresh sessions.
// Private fixture: {email,password,fixture:{companyId,quoteId,operationId,runId,input:{
// title,description,address,start_at,end_at,split_days:[{label,start_at,end_at},...]}}}.
// Account: core-quote-concurrency-...@example.invalid; offer/job title: TEST-CORE-QUOTE-...
// Dispatch follows --request-delay-ms=15000 (default). Root starts HOLD during this
// delay. HOLD observes two blocked PIDs, immediately rolls back its lock, then root
// writes its phase=observed result to --barrier. No separate held file is required.
// See supabase/tests/core-quote-conversion-concurrency-barrier.sql. No DB owner key
// is used here. PASS requires that independent observation during both HTTP calls.
// This script never creates/deletes fixtures or prints credentials/response bodies.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const project='wfcpfraxiuhuglnuaxqj', url=`https://${project}.supabase.co`
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
 const split=arg.indexOf('='); assert(split>0,'Use --name=value arguments'); return [arg.slice(0,split),arg.slice(split+1)]
}))
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const requestDelayMs=Number(args['--request-delay-ms']??15000)
assert(Number.isInteger(requestDelayMs)&&requestDelayMs>=0&&requestDelayMs<=45000,'Delay must be 0..45000ms')
const tokens=[], sessionIds=[]
const report={project,mode:'core-quote-conversion',passed:false,rounds:[],loggedOutSessions:0}
let output,headers,stage='configuration',f,auth,resume
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const cleanText=value=>typeof value==='string' ? value.trim()||null : null
const at=value=>new Date(value).getTime()

function matchingGate(value,round) {
 return value?.project===project && value.runId===f.runId && value.round===round && value.companyId===f.companyId
  && value.applicationName===`corequote:${f.runId}:${round}` && Number.isInteger(value.blockerPid) && value.blockerPid>0
  && value.barrierLockHeld===true && ['held','observed'].includes(value.phase)
  && Number.isFinite(at(value.observedAt)) && Math.abs(Date.now()-at(value.observedAt))<60000
}
async function waitGate(round) {
 const deadline=Date.now()+60000
 while(Date.now()<deadline) {
  let value
  try {value=JSON.parse(await fs.readFile(args['--barrier'],'utf8'))} catch { /* Atomic file replacement is preferred; partial writes are retried. */ }
  if(matchingGate(value,round) && value.phase==='observed') return value
  await delay(250)
 }
 throw new Error('Owner did not supply two waiting database PIDs')
}
function validateOverlap(gate,responses) {
 assert(gate.phase==='observed' && Array.isArray(gate.waiters) && gate.waiters.length===2,'Two observed database waiters required')
 const pids=gate.waiters.map(row=>row.pid)
 assert(new Set(pids).size===2 && pids.every(pid=>Number.isInteger(pid)&&pid>0&&pid!==gate.blockerPid),'Distinct waiting backends required')
 assert(gate.waiters.every(row=>row.state==='active' && row.waitEventType==='Lock' && row.rootBlocked===true
  && row.queryFunction==='convert_core_quote_to_job_atomic'),'Both conversion backends must wait behind the owner barrier')
 const observed=at(gate.observedAt), start=Math.max(...responses.map(row=>at(row.started))), end=Math.min(...responses.map(row=>at(row.finished)))
 assert(start<=end && observed>=start-2000 && observed<=end+2000,'Owner observation must fall inside both active HTTP requests (2s clock tolerance)')
 return {source:'owner PostgreSQL pg_stat_activity + pg_blocking_pids observation',blockerPid:gate.blockerPid,
  waitingBackendPids:pids,observedAt:gate.observedAt,applicationName:gate.applicationName,clockToleranceMs:2000,verified:true}
}
async function rows(table,filter,token) {
 const response=await fetch(`${url}/rest/v1/${table}?select=*&${filter}&order=id.asc`,{
  headers:{...headers,Authorization:`Bearer ${token}`,Prefer:'count=exact',Range:'0-9999'},signal:AbortSignal.timeout(30000)})
 assert(response.ok,`Read of ${table} failed (HTTP ${response.status})`)
 const value=await response.json(), total=Number(response.headers.get('content-range')?.split('/')[1])
 assert(Array.isArray(value) && Number.isInteger(total) && total===value.length,`Complete ${table} snapshot required`)
 return value
}
async function snapshot(token) {
 const filter=`company_id=eq.${f.companyId}`
 // Sequential reads avoid extra pressure. Owner must keep this dedicated fixture quiescent.
 const jobs=await rows('jobs',filter,token),quotes=await rows('quotes',filter,token)
 const customers=await rows('customers',filter,token),items=await rows('quote_items',filter,token)
 return {jobs,quotes,customers,items}
}
async function convert(index,payload) {
 const started=new Date().toISOString(), timer=performance.now()
 try {
  const response=await fetch(`${url}/rest/v1/rpc/convert_core_quote_to_job_atomic`,{
   method:'POST',headers:{...headers,Authorization:`Bearer ${tokens[index]}`},
   body:JSON.stringify({p_company_id:f.companyId,p_quote_id:f.quoteId,p_operation_id:f.operationId,p_input:payload}),
   signal:AbortSignal.timeout(70000)})
  const data=await response.json()
  const success=response.status===200 && data.companyId===f.companyId && data.quoteId===f.quoteId
   && typeof data.created==='boolean' && typeof data.jobId==='string' && uuid.test(data.jobId)
  return {client:index===0?'A':'B',started,finished:new Date().toISOString(),elapsedMs:Math.round(performance.now()-timer),
   status:response.status,success,...(success?{jobId:data.jobId,created:data.created}:{
    conflict:response.status===409 && data.code==='PT409' && data.message==='CORE_QUOTE_REQUEST_CONFLICT',
    errorCode:typeof data.code==='string' && /^[A-Z0-9]{5}$/.test(data.code)?data.code:null})}
 } catch {return {client:index===0?'A':'B',started,finished:new Date().toISOString(),elapsedMs:Math.round(performance.now()-timer),transportError:true}}
}
async function runRound(round,payloadB) {
 stage=`round ${round} waiting before dispatch`
 await fs.writeFile(output,JSON.stringify({...report,stage,runId:f.runId},null,2)+'\n')
 console.log(JSON.stringify({ready:true,round,project,runId:f.runId,requestDelayMs,dispatchAt:new Date(Date.now()+requestDelayMs).toISOString(),applicationName:`corequote:${f.runId}:${round}`}))
 await delay(requestDelayMs)
 stage=`round ${round} requests in flight`
 console.log(JSON.stringify({dispatching:true,round,at:new Date().toISOString()}))
 const responses=await Promise.all([convert(0,f.input),convert(1,payloadB)])
 const result={round,responses,databaseOverlap:{verified:false,pending:true}}
 report.rounds.push(result)
 stage='round '+round+' waiting for owner proof'
 await fs.writeFile(output,JSON.stringify({...report,stage},null,2)+'\n')
 console.log(JSON.stringify({httpCompleted:true,...result}))
 const observed=await waitGate(round)
 result.databaseOverlap=validateOverlap(observed,responses)
 await fs.writeFile(output,JSON.stringify({...report,stage},null,2)+'\n')
 console.log(JSON.stringify(result))
 return responses
}
try {
 assert(args['--fixture']&&args['--output']&&args['--barrier'],'Provide fixture, output and owner barrier paths')
 const paths=[args['--fixture'],args['--output'],args['--barrier'],args['--resume-evidence']].filter(Boolean).map(value=>path.resolve(value).toLowerCase())
 assert(new Set(paths).size===paths.length,'Credentials, output, prior evidence and owner barrier must be different files')
 output=path.resolve(args['--output'])
 auth=JSON.parse(await fs.readFile(args['--fixture'],'utf8')); f=auth.fixture
 assert(/^core-quote-concurrency-[^@]+@example\.invalid$/.test(auth.email),'Dedicated synthetic account required')
 assert(typeof auth.password==='string'&&auth.password.length>0,'Private fixture password required')
 assert(f && [f.companyId,f.quoteId,f.operationId,f.runId].every(value=>typeof value==='string'&&uuid.test(value)),'Four fixture UUIDs required')
 assert(f.input?.title?.startsWith('TEST-CORE-QUOTE-') && Array.isArray(f.input.split_days)
  && f.input.split_days.length>=2 && f.input.split_days.length<=366,'A synthetic offer with at least two split children is required')

 if(args['--resume-evidence']) {
  stage='resume evidence validation'
  const prior=JSON.parse(await fs.readFile(args['--resume-evidence'],'utf8'))
  assert(prior.project===project&&prior.mode===report.mode&&prior.runId===f.runId
   && prior.distinctAuthenticatedSessions===true&&prior.loggedOutSessions===2,'Prior run must identify the same project/run and two logged out Auth sessions')
  assert(/^[a-f0-9]{64}$/.test(prior.beforeFingerprint)&&/^[a-f0-9]{64}$/.test(prior.afterCreateFingerprint)
   && uuid.test(prior.jobId)&&prior.childCount===2&&f.input.split_days.length===2,'Prior completed two-child snapshot and fingerprints required')
  const first=prior.rounds?.filter(row=>row.round===1)
  assert(Array.isArray(first)&&first.length===1,'Exactly one prior round1 proof required')
  const r=first[0], responses=r.responses, overlap=r.databaseOverlap
  assert(Array.isArray(responses)&&responses.length===2&&new Set(responses.map(row=>row.client)).size===2
   && responses.every(row=>row.status===200&&row.success===true&&row.jobId===prior.jobId)
   && responses.filter(row=>row.created===true).length===1&&responses.filter(row=>row.created===false).length===1,'Prior round1 must have one create and one replay of the recorded job')
  assert(overlap?.verified===true&&overlap.source==='owner PostgreSQL pg_stat_activity + pg_blocking_pids observation'
   && overlap.applicationName==='corequote:'+f.runId+':1'&&overlap.clockToleranceMs===2000
   && Number.isInteger(overlap.blockerPid)&&overlap.blockerPid>0
   && Array.isArray(overlap.waitingBackendPids)&&overlap.waitingBackendPids.length===2
   && new Set(overlap.waitingBackendPids).size===2
   && overlap.waitingBackendPids.every(pid=>Number.isInteger(pid)&&pid>0&&pid!==overlap.blockerPid),'Prior round1 requires two distinct observed blocked database backends')
  const start=Math.max(...responses.map(row=>at(row.started))),end=Math.min(...responses.map(row=>at(row.finished))),observed=at(overlap.observedAt)
  assert(Number.isFinite(observed)&&start<=end&&observed>=start-2000&&observed<=end+2000,'Prior DB observation must be inside both original HTTP requests')
  resume=prior
  report.rounds=[structuredClone(r)]
  report.beforeFingerprint=prior.beforeFingerprint
  report.afterCreateFingerprint=prior.afterCreateFingerprint
  report.jobId=prior.jobId; report.childCount=prior.childCount
  report.resumedFromEvidenceSha256=hash(prior)
  report.previousLoggedOutSessions=prior.loggedOutSessions
  report.previousIncompleteRounds=structuredClone(prior.rounds.filter(row=>row.round!==1))
 }
 const env=Object.fromEntries((await fs.readFile(args['--env-file']||path.join(root,'.env.local'),'utf8')).split(/\r?\n/)
  .map(line=>line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([,key,value])=>[key,value.trim().replace(/^["']|["']$/g,'')]))
 assert((process.env.NEXT_PUBLIC_SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL)===url,'Wrong test project')
 const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 assert(publicKey,'Missing public Supabase API key')
 headers={apikey:publicKey,'Content-Type':'application/json',Connection:'close'}
 stage='authentication'; let userId
 for(let index=0;index<2;index++) {
  const response=await fetch(`${url}/auth/v1/token?grant_type=password`,{method:'POST',headers,
   body:JSON.stringify({email:auth.email,password:auth.password}),signal:AbortSignal.timeout(30000)})
  assert(response.status===200,`Synthetic login failed (HTTP ${response.status})`)
  const value=await response.json(); assert(typeof value.access_token==='string','Incomplete Auth response')
  tokens.push(value.access_token)
  assert(value.user?.id && (!userId||userId===value.user.id),'Both sessions must belong to the fixture user'); userId=value.user.id
  const claims=JSON.parse(Buffer.from(value.access_token.split('.')[1],'base64url').toString('utf8'))
  assert(claims.role==='authenticated'&&typeof claims.session_id==='string','Authenticated session required'); sessionIds.push(claims.session_id)
 }
 assert(sessionIds[0]!==sessionIds[1],'Two different Auth sessions required')
 report.distinctAuthenticatedSessions=true; report.runId=f.runId; report.requestDelayMs=requestDelayMs
 stage='initial snapshot'; const before=await snapshot(tokens[0]), quote=before.quotes.find(row=>row.id===f.quoteId)
 if(resume) {
  assert(hash(before)===resume.afterCreateFingerprint,'Current snapshot must exactly match the completed round1 fingerprint')
  assert(quote?.title?.startsWith('TEST-CORE-QUOTE-')&&quote.status==='accepted','Only the recorded accepted synthetic offer may resume')
  report.resumeSnapshotVerified=true; report.freshAuthenticatedSessions=true
 } else {
  assert(quote?.title?.startsWith('TEST-CORE-QUOTE-') && ['draft','ready','sent'].includes(quote.status)
   && quote.accepted_at===null && !before.jobs.some(row=>row.source_quote_id===f.quoteId),'Only an unconverted synthetic offer may be tested')
  report.beforeFingerprint=hash(before)
 }
 const same=resume?resume.rounds.find(row=>row.round===1).responses:await runRound(1,f.input)
 assert(same.every(row=>row.status===200&&row.success) && same[0].jobId===same[1].jobId
  && same.filter(row=>row.created===true).length===1 && same.filter(row=>row.created===false).length===1,'One create and one replay of the same tree required')
 stage='first round snapshot'; const after=resume?before:await snapshot(tokens[1]), jobId=same[0].jobId
 const parent=after.jobs.find(row=>row.id===jobId), children=after.jobs.filter(row=>row.parent_job_id===jobId)
 assert(parent?.source_quote_id===f.quoteId && parent.company_id===f.companyId && parent.parent_job_id===null
  && parent.customer_id===quote.customer_id && parent.currency===quote.currency && Number(parent.price)===Number(quote.total_price),'Root must preserve source company, customer, price and currency')
 assert(children.length===f.input.split_days.length && (resume || after.jobs.length===before.jobs.length+1+children.length),'Exactly one full new tree required')
 assert(parent.title===f.input.title.trim() && parent.description===cleanText(f.input.description) && parent.address===cleanText(f.input.address)
  && at(parent.start_at)===at(f.input.start_at) && at(parent.end_at)===at(f.input.end_at),'Root must match the complete input')
 const expected=[...f.input.split_days].sort((a,b)=>at(a.start_at)-at(b.start_at))
 const actual=[...children].sort((a,b)=>at(a.start_at)-at(b.start_at))
 actual.forEach((row,index)=>assert(row.company_id===f.companyId && row.customer_id===quote.customer_id && row.currency===quote.currency
  && Number(row.price)===0 && row.source_quote_id===null && row.title===`${f.input.title.trim()} - ${expected[index].label.trim()}`
  && at(row.start_at)===at(expected[index].start_at) && at(row.end_at)===at(expected[index].end_at),'Every split child must match the original payload'))
 const afterQuote=after.quotes.find(row=>row.id===f.quoteId)
 assert(afterQuote?.status==='accepted'&&Number.isFinite(at(afterQuote.accepted_at)),'Offer must be accepted with the complete tree')
 assert(isDeepStrictEqual(before.customers,after.customers)&&isDeepStrictEqual(before.items,after.items),'Customer data and offer lines must remain untouched')
 assert(isDeepStrictEqual(before.jobs,after.jobs.filter(row=>before.jobs.some(old=>old.id===row.id))),'Pre-existing jobs must stay untouched')
 const omitAcceptance=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!['status','accepted_at','updated_at'].includes(key)))
 assert(isDeepStrictEqual(omitAcceptance(quote),omitAcceptance(afterQuote)),'Original offer data must stay untouched')
 assert(isDeepStrictEqual(before.quotes.filter(row=>row.id!==f.quoteId),after.quotes.filter(row=>row.id!==f.quoteId)),'Control offers must stay untouched')
 report.afterCreateFingerprint=hash(after); report.jobId=jobId; report.childCount=children.length
 const changed={...f.input,title:`${f.input.title.trim().slice(0,260)} - DIFFERENT PAYLOAD`}
 assert(changed.title!==f.input.title,'Second round must change the normalized payload')
 const conflict=await runRound(2,changed)
 assert(conflict[0].success&&conflict[0].status===200&&conflict[0].created===false&&conflict[0].jobId===jobId
  && conflict[1].conflict===true,'Original retry must return the root; changed request must return 409/PT409')
 stage='final snapshot'; const final=await snapshot(tokens[0]); assert(isDeepStrictEqual(final,after),'Conflicting retry must change no data')
 report.finalFingerprint=hash(final); report.completeTree=true; report.sourceDataPreserved=true; report.conflictChangedNothing=true
 report.httpAndDatabaseProofComplete=true
} catch {
 report.failureStage=stage; process.exitCode=1
 // Deliberately omit raw errors: Auth responses and private fixture values must not leak.
 console.error(JSON.stringify({passed:false,stage,message:'Concurrency verification did not complete. Check the phase and owner barrier evidence.'}))
} finally {
 const logout=await Promise.allSettled(tokens.map(token=>fetch(`${url}/auth/v1/logout?scope=local`,{
  method:'POST',headers:{...headers,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)})))
 report.loggedOutSessions=logout.filter(value=>value.status==='fulfilled'&&value.value.ok).length
 report.passed=report.httpAndDatabaseProofComplete===true&&tokens.length===2&&report.loggedOutSessions===2
 if(!report.passed) process.exitCode=1
 if(output) await fs.writeFile(output,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report))
}