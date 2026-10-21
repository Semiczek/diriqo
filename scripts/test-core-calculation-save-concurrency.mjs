// Authenticated concurrency proof for the authorized TEST project only.
// Usage: node -- scripts/test-core-calculation-save-concurrency.mjs --fixture=<private.json>
// --output=<redacted.json> --barrier=<owner-observation.json> --env-file=<local.env>
// Private fixture: {email,password,fixture:{companyId,profileId,runId,scenario,
// operationId,otherOperationId?,calculationId?,expectedRevision?,input:{...RPC snake_case payload}}}.
// scenario: create-retry, create-conflict, update-retry, update-race.
// Each invocation runs one deliberate overlap. Never rerun an uncertain invocation
// without inspecting its output and current DB. Owner prepares synthetic fixtures;
// this client uses two real sessions and never uses an owner/service key.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { matchesCoreCalculationGate, validateCoreCalculationOverlap } from './core-calculation-concurrency-proof.mjs'

const project='wfcpfraxiuhuglnuaxqj', url=`https://${project}.supabase.co`
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
 const split=arg.indexOf('='); assert(split>0,'Use --name=value arguments'); return [arg.slice(0,split),arg.slice(split+1)]
}))
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const requestDelayMs=Number(args['--request-delay-ms']??15000)
assert(Number.isInteger(requestDelayMs)&&requestDelayMs>=0&&requestDelayMs<=45000,'Delay must be 0..45000ms')
const tokens=[], sessionIds=[]
const report={project,mode:'core-calculation-save',passed:false,rounds:[],loggedOutSessions:0}
let output,headers,stage='configuration',f,auth,outputOwned=false
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function requireUnusedFile(file) {
 try {await fs.lstat(file)} catch(error) {if(error?.code==='ENOENT')return;throw error}
 throw new Error('One-time fixture output, claim or observation already exists')
}
async function waitGate(round) {
 const deadline=performance.now()+180000
 while(performance.now()<deadline) {
  let value
  try {value=JSON.parse(await fs.readFile(args['--barrier'],'utf8'))} catch { /* Retry partial/late atomic evidence delivery. */ }
  if(matchesCoreCalculationGate(value,f,round))return value
  await delay(250)
 }
 throw new Error('Owner did not supply matching causal database evidence')
}
async function rows(table,filter,token) {
 const response=await fetch(`${url}/rest/v1/${table}?select=*&${filter}&order=id.asc`,{
  headers:{...headers,Authorization:`Bearer ${token}`,Prefer:'count=exact',Range:'0-9999'},signal:AbortSignal.timeout(30000)})
 assert(response.ok,`Read of ${table} failed (HTTP ${response.status})`)
 const value=await response.json(), total=Number(response.headers.get('content-range')?.split('/')[1])
 assert(Array.isArray(value) && Number.isInteger(total) && total===value.length,`Complete ${table} snapshot required`)
 return value
}
let rpcName
const lineKeys=['sort_order','item_type','name','description','quantity','unit','unit_cost','unit_price','vat_rate','total_cost','total_price','note']
const headerKeys=['customer_id','title','description','status','calculation_date','internal_note','subtotal_cost','subtotal_price','margin_amount','total_price','currency']
const pick=(row,keys)=>Object.fromEntries(keys.map(key=>[key,row[key]]))
const sortedLines=rows=>rows.map(row=>pick(row,lineKeys)).sort((a,b)=>a.sort_order-b.sort_order)
const cents=value=>{const m=String(value).match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);assert(m,'Exact decimal required');return BigInt(m[1]+m[2])*100n+(m[1]? -1n:1n)*BigInt((m[3]||'').padEnd(2,'0'))}
const product=(a,b)=>(cents(a)*cents(b)+50n)/100n
async function snapshot(token) {
 const calculations=await rows('calculations','company_id=eq.'+f.companyId,token)
 const versions=await rows('calculation_versions','company_id=eq.'+f.companyId,token)
 assert(calculations.length<=100&&versions.length<=100,'Dedicated small fixture required')
 const items=calculations.length?await rows('calculation_items','calculation_id=in.('+calculations.map(r=>r.id).join(',')+')',token):[]
 const versionItems=versions.length?await rows('calculation_version_items','calculation_version_id=in.('+versions.map(r=>r.id).join(',')+')',token):[]
 return {calculations,items,versions,versionItems}
}
function expectedPayload(index) {
 const changed=index===1&&['create-conflict','update-race'].includes(f.scenario)
 return changed?{...f.input,title:f.input.title+' - B'}:f.input
}
async function save(index) {
 const input=expectedPayload(index), operationId=index===1&&f.scenario==='update-race'?f.otherOperationId:f.operationId
 const body={p_company_id:f.companyId,p_operation_id:operationId,p_input:input,
  ...(f.scenario.startsWith('update')?{p_calculation_id:f.calculationId,p_expected_revision:f.expectedRevision}:{})}
 const started=new Date().toISOString(),timer=performance.now()
 try {
  const response=await fetch(url+'/rest/v1/rpc/'+rpcName,{method:'POST',headers:{...headers,Authorization:'Bearer '+tokens[index]},
   body:JSON.stringify(body),signal:AbortSignal.timeout(30000)})
  const data=await response.json()
  const success=response.status===200&&data.companyId===f.companyId&&data.operationId===operationId
   &&uuid.test(data.calculationId||'')&&typeof data.replayed==='boolean'&&typeof data.revision==='string'&&/^[1-9]\d*$/.test(data.revision)
  return {client:index===0?'A':'B',operationId,started,startedMonotonicMs:timer,finishedMonotonicMs:performance.now(),finished:new Date().toISOString(),elapsedMs:Math.round(performance.now()-timer),
   status:response.status,success,...(success?{calculationId:data.calculationId,revision:data.revision,replayed:data.replayed}:{
    conflict:response.status===409&&data.code==='PT409'&&data.message===(f.scenario==='update-race'?'CALCULATION_REVISION_CONFLICT':'CALCULATION_OPERATION_CONFLICT'),
    errorCode:typeof data.code==='string'&&/^[A-Z0-9]{5}$/.test(data.code)?data.code:null})}
 } catch {return {client:index===0?'A':'B',operationId,started,startedMonotonicMs:timer,finishedMonotonicMs:performance.now(),finished:new Date().toISOString(),elapsedMs:Math.round(performance.now()-timer),transportError:true}}
}
function verifySaved(snapshot,id,input) {
 const parent=snapshot.calculations.find(row=>row.id===id),items=snapshot.items.filter(row=>row.calculation_id===id).sort((a,b)=>a.sort_order-b.sort_order)
 assert(parent&&parent.company_id===f.companyId&&parent.title===input.title&&parent.customer_id===input.customer_id,'Correct parent and scope required')
 for(const key of ['description','status','calculation_date','internal_note','currency']) assert(parent[key]===input[key],'Header must match submitted payload')
 assert(items.length===input.items.length,'Complete items required')
 let cost=0n,price=0n
 items.forEach((row,index)=>{const expected=input.items[index]
  assert(row.sort_order===index,'Input order must be preserved')
  for(const key of ['item_type','name','description','unit','note']) assert(row[key]===expected[key],'Item content must match input')
  for(const key of ['quantity','unit_cost','unit_price','vat_rate']) assert(cents(row[key])===cents(expected[key]),'Decimal input must be preserved')
  const c=product(expected.quantity,expected.unit_cost),p=product(expected.quantity,expected.unit_price)
  assert(cents(row.total_cost)===c&&cents(row.total_price)===p,'Exact line totals required');cost+=c;price+=p
 })
 assert(cents(parent.subtotal_cost)===cost&&cents(parent.subtotal_price)===price&&cents(parent.total_price)===price
  &&cents(parent.margin_amount)===price-cost,'Exact totals and possibly negative margin required')
 return parent
}
try {
 assert(args['--fixture']&&args['--output']&&args['--barrier'],'Provide fixture, output and barrier paths')
 const paths=[args['--fixture'],args['--output'],args['--barrier']].map(value=>path.resolve(value).toLowerCase())
 assert(new Set(paths).size===3,'Credentials, report and barrier must be separate files')
 output=path.resolve(args['--output']);auth=JSON.parse(await fs.readFile(args['--fixture'],'utf8'));f=auth.fixture
 assert(/^core-calculation-concurrency-[^@]+@example\.invalid$/.test(auth.email),'Dedicated synthetic account required')
 assert(typeof auth.password==='string'&&auth.password.length>0,'Private fixture password required')
 assert(f&&[f.companyId,f.profileId,f.operationId,f.runId].every(value=>typeof value==='string'&&uuid.test(value)),'Fixture UUIDs required')
 assert(['create-retry','create-conflict','update-retry','update-race'].includes(f.scenario),'Known scenario required')
 assert(f.input?.title?.startsWith('TEST-CORE-CALCULATION-')&&f.input.title.length<280&&f.input.customer_id===null
  &&Array.isArray(f.input.items)&&f.input.items.length>=2,'Dedicated standalone calculation fixture required')
 assert(f.input.items.some(row=>row.item_type==='customer'&&cents(row.unit_price)===0n)
  &&f.input.items.some(row=>row.item_type==='material'&&cents(row.unit_cost)>0n),'Zero customer price and nonzero internal material must both be tested')
 const isUpdate=f.scenario.startsWith('update');rpcName=isUpdate?'update_core_calculation_atomic':'create_core_calculation_atomic'
 if(isUpdate) assert(uuid.test(f.calculationId||'')&&/^[1-9]\d*$/.test(f.expectedRevision||''),'Update ID/revision required')
 if(f.scenario==='update-race') assert(uuid.test(f.otherOperationId||'')&&f.otherOperationId!==f.operationId,'Two distinct operations required')
 // runId is a one-time invocation nonce. Claim it before Auth, and never overwrite an older report/evidence.
 const claimFile=path.join(path.dirname(path.resolve(args['--fixture'])),'core-calculation-run-'+f.runId+'.claim.json')
 assert(!paths.includes(claimFile.toLowerCase()),'Claim path must differ from private fixture/report/barrier')
 await requireUnusedFile(output);await requireUnusedFile(args['--barrier'])
 await fs.writeFile(claimFile,JSON.stringify({project,runId:f.runId,scenario:f.scenario,companyId:f.companyId,
  operationId:f.operationId,otherOperationId:f.otherOperationId??null,calculationId:f.calculationId??null,
  claimedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600})
 await fs.writeFile(output,JSON.stringify({...report,stage:'claimed'},null,2)+'\n',{flag:'wx',mode:0o600})
 outputOwned=true;report.oneTimeRunClaim=true
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
 report.scenario=f.scenario;stage='initial snapshot';const before=await snapshot(tokens[0])
 const oldParent=isUpdate?before.calculations.find(row=>row.id===f.calculationId):null
 if(isUpdate) assert(oldParent?.title?.startsWith('TEST-CORE-CALCULATION-')&&String(oldParent.revision)===f.expectedRevision,'Current synthetic revision required')
 assert(before.calculations.every(row=>row.title.startsWith('TEST-CORE-CALCULATION-')),'Only a dedicated test tenant may be used')
 report.beforeFingerprint=hash(before)
 stage='waiting before dispatch';await fs.writeFile(output,JSON.stringify({...report,stage},null,2)+'\n')
 console.log(JSON.stringify({ready:true,project,runId:f.runId,scenario:f.scenario,round:1,requestDelayMs,
  dispatchAt:new Date(Date.now()+requestDelayMs).toISOString(),applicationName:'corecalc:'+f.runId+':1'}))
 await delay(requestDelayMs);stage='requests in flight'
 const responses=await Promise.all([save(0),save(1)])
 const round={round:1,responses,databaseOverlap:{verified:false,pending:true}};report.rounds.push(round)
 await fs.writeFile(output,JSON.stringify({...report,stage:'waiting for owner proof'},null,2)+'\n')
 console.log(JSON.stringify({httpCompleted:true,...round}))
 stage='owner causal evidence';round.databaseOverlap=validateCoreCalculationOverlap(await waitGate(1),responses,f)
 stage='committed result verification'
 const successes=responses.filter(row=>row.success), expectedSuccesses=f.scenario.endsWith('retry')?2:1
 assert(successes.length===expectedSuccesses,'Expected committed results required')
 assert(successes.filter(row=>!row.replayed).length===1,'Exactly one new operation required')
 if(expectedSuccesses===2) assert(successes.filter(row=>row.replayed).length===1&&successes[0].calculationId===successes[1].calculationId,'Identical replay required')
 else assert(responses.filter(row=>row.conflict).length===1,'Conflicting concurrent request must fail')
 const winner=successes.find(row=>!row.replayed),id=winner.calculationId,expected=expectedPayload(winner.client==='A'?0:1)
 if(isUpdate) assert(successes.every(row=>row.calculationId===f.calculationId),'Every update receipt must target the fixture calculation')
 const after=await snapshot(tokens[1]);const current=verifySaved(after,id,expected)
 if(!isUpdate) assert(current.created_by===f.profileId,'Creation actor must match the authenticated fixture profile')
 else {
  const immutableKeys=Object.keys(oldParent).filter(key=>![...headerKeys,'revision','updated_at'].includes(key))
  assert(isDeepStrictEqual(pick(oldParent,immutableKeys),pick(current,immutableKeys)),'Update must preserve all noneditable parent fields')
 }
 assert(String(current.revision)===(isUpdate?(BigInt(f.expectedRevision)+1n).toString():'1'),'One revision increment required')
 assert(successes.every(row=>row.revision===String(current.revision)),'Receipt revision must match committed result')
 assert(after.calculations.length===before.calculations.length+(isUpdate?0:1),'Exactly one parent effect required')
 assert(isDeepStrictEqual(before.calculations.filter(row=>row.id!==id),after.calculations.filter(row=>row.id!==id)),'Other headers must remain unchanged')
 assert(isDeepStrictEqual(before.items.filter(row=>row.calculation_id!==id),after.items.filter(row=>row.calculation_id!==id)),'Other items must remain unchanged')
 const priorVersionIds=new Set(before.versions.map(row=>row.id))
 assert(isDeepStrictEqual(before.versions,after.versions.filter(row=>priorVersionIds.has(row.id))),'Historical headers must remain unchanged')
 assert(isDeepStrictEqual(before.versionItems,after.versionItems.filter(row=>priorVersionIds.has(row.calculation_version_id))),'Historical items must remain unchanged')
 const addedVersions=after.versions.filter(row=>!priorVersionIds.has(row.id))
 assert(addedVersions.length===(isUpdate?1:0),'Exactly one historical version per successful update')
 if(isUpdate) {
  const version=addedVersions[0];assert(version.calculation_id===id&&version.company_id===f.companyId&&version.saved_by===f.profileId,'Version scope and actor required')
  assert(isDeepStrictEqual(pick(oldParent,headerKeys),pick(version,headerKeys)),'Version header must be exact preimage')
  assert(String(version.source_revision)===f.expectedRevision,'Version must identify the exact previous revision')
  assert(isDeepStrictEqual(version.source_snapshot,oldParent),'Full source snapshot must preserve every prior parent field')
  const priorNumbers=before.versions.filter(row=>row.calculation_id===id).map(row=>row.version_number)
  assert(version.version_number===Math.max(0,...priorNumbers)+1,'Historical version numbering must advance once')
  const priorItems=before.items.filter(row=>row.calculation_id===id)
  const capturedItems=after.versionItems.filter(row=>row.calculation_version_id===version.id)
  assert(capturedItems.length===priorItems.length&&new Set(capturedItems.map(row=>row.source_item_id)).size===priorItems.length,
   'Each source item must be captured exactly once')
  for(const captured of capturedItems) {
   const prior=priorItems.find(row=>row.id===captured.source_item_id)
   assert(prior&&captured.source_created_at===prior.created_at,'Source item identity and creation time must be preserved')
   assert(isDeepStrictEqual(pick(prior,lineKeys),pick(captured,lineKeys)),'Every captured source item field must match its preimage')
  }
  assert(isDeepStrictEqual(sortedLines(before.items.filter(row=>row.calculation_id===id)),
   sortedLines(after.versionItems.filter(row=>row.calculation_version_id===version.id))),'Version items must be exact preimage including nullable history')
 }
 report.calculationId=id;report.revision=String(current.revision);report.finalFingerprint=hash(after)
 report.completeCalculation=true;report.preimagePreserved=isUpdate;report.unrelatedDataPreserved=true;report.preservationScope='complete visible calculation/history rows in dedicated fixture company';report.httpAndDatabaseProofComplete=true
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
 if(output&&outputOwned) await fs.writeFile(output,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report))
}