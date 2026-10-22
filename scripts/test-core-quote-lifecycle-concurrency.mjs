// OFFLINE preparation; run only after explicit authorization on the TEST project.
// Usage: node -- scripts/test-core-quote-lifecycle-concurrency.mjs --fixture=<private.json>
// --output=<redacted.json> --barrier=<owner-observation.json> --env-file=<local.env>
// [--request-delay-ms=15000]. One fresh scenario/run/company per invocation.
// Fixture: {email,password,authUserId,fixture:{runId,scenario,companyId,profileId,
// operationId,otherOperationId?,calculationId?,expectedCalculationRevision?,quoteId?,
// expectedRevision?,versionId?,input?}}. Inputs are complete canonical snake-case.
// Five scenarios: create-retry/update-race/publish-retry/delivery-retry/conversion-retry.
// Owner prepares fixtures and the matching SQL template. No fixtures are created or
// deleted here. The runner always logs out its two synthetic sessions; root separately
// disables its account after evidence review. No service key and NO mail-provider call.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { quoteLifecycleRpcs, matchesQuoteLifecycleGate, validateQuoteLifecycleOverlap, validateQuoteLifecycleOwnerResult } from './core-quote-lifecycle-concurrency-proof.mjs'
const project='wfcpfraxiuhuglnuaxqj',url=`https://${project}.supabase.co`,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tokens=[],sessions=[]
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const report={project,mode:'core-quote-lifecycle',passed:false,loggedOutSessions:0}
let args={},f,auth,headers,output,outputOwned=false,stage='configuration'
async function unused(file){try{await fs.lstat(file)}catch(e){if(e?.code==='ENOENT')return;throw e}throw Error('Fresh one-time file required')}
async function rows(table,filter,token){
 const r=await fetch(`${url}/rest/v1/${table}?select=*&${filter}&order=id.asc`,{headers:{...headers,Authorization:'Bearer '+token,Prefer:'count=exact',Range:'0-9999'},signal:AbortSignal.timeout(30000)})
 assert(r.ok,'Fixture read failed');const data=await r.json(),count=Number(r.headers.get('content-range')?.split('/')[1])
 assert(Array.isArray(data)&&Number.isInteger(count)&&data.length===count,'Complete visible fixture read required');return data
}
async function readRpc(name,body,token){const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});assert(r.ok,'Fixture RPC read failed');return r.json()}
async function snapshot(token){
 const filter='company_id=eq.'+f.companyId,quotes=await rows('quotes',filter,token),items=await rows('quote_items',filter,token),jobs=await rows('jobs',filter,token)
 const calculations=await rows('calculations',filter,token),calculationItems=calculations.length?await rows('calculation_items','calculation_id=in.('+calculations.map(c=>c.id).join(',')+')',token):[]
 assert(quotes.length<=10&&calculations.length<=10&&jobs.length<=400,'Dedicated small fixture required')
 const workspaces=[],versions=[]
 for(const quote of quotes){
  const workspace=await readRpc('get_core_quote_workspace',{p_company_id:f.companyId,p_quote_id:quote.id},token)
  assert(workspace.companyId===f.companyId&&workspace.quoteId===quote.id,'Workspace scope required');workspaces.push(workspace)
  for(const version of workspace.versions){const read=await readRpc('get_core_quote_version',{p_company_id:f.companyId,p_quote_id:quote.id,p_version_id:version.versionId},token);versions.push({versionId:version.versionId,document:read.document})}
 }
 return {quotes,items,jobs,calculations,calculationItems,workspaces,versions}
}
const workspace=(state,id)=>state.workspaces.find(w=>w.quoteId===id)
function input(index){return index===1&&f.scenario==='update-race'?{...f.input,title:f.input.title+' - B'}:f.input}
function body(index){
 const base={p_company_id:f.companyId,p_operation_id:index===1&&f.scenario==='update-race'?f.otherOperationId:f.operationId}
 if(f.scenario==='create-retry')return {...base,p_calculation_id:f.calculationId,p_expected_calculation_revision:f.expectedCalculationRevision}
 if(f.scenario==='update-race')return {...base,p_quote_id:f.quoteId,p_expected_revision:f.expectedRevision,p_input:input(index)}
 if(f.scenario==='publish-retry')return {...base,p_quote_id:f.quoteId,p_expected_revision:f.expectedRevision}
 return {...base,p_quote_id:f.quoteId,p_version_id:f.versionId,p_input:f.input}
}
async function call(index){
 const payload=body(index),start=performance.now()
 try{
  const r=await fetch(url+'/rest/v1/rpc/'+quoteLifecycleRpcs[f.scenario],{method:'POST',headers:{...headers,Authorization:'Bearer '+tokens[index]},body:JSON.stringify(payload),signal:AbortSignal.timeout(55000)})
  const data=await r.json(),quoteValid=uuid.test(data?.quoteId||'')&&(f.scenario==='create-retry'||data.quoteId===f.quoteId)
  let success=r.status===200&&data.companyId===f.companyId&&quoteValid
  const clean={client:index?'B':'A',operationId:payload.p_operation_id,status:r.status,startedMonotonicMs:start,finishedMonotonicMs:performance.now()}
  if(f.scenario==='conversion-retry')success=success&&data.versionId===f.versionId&&uuid.test(data.jobId||'')&&typeof data.created==='boolean'
  else if(f.scenario==='delivery-retry')success=success&&data.operationId===payload.p_operation_id&&data.versionId===f.versionId&&uuid.test(data.deliveryId||'')&&data.state==='reserved'&&typeof data.canSend==='boolean'
  else success=success&&data.operationId===payload.p_operation_id&&typeof data.replayed==='boolean'&&/^[1-9]\d*$/.test(data.revision||'')&&typeof data.revision==='string'
  if(f.scenario==='publish-retry')success=success&&uuid.test(data.versionId||'')&&Number.isSafeInteger(data.versionNumber)&&data.versionNumber>0&&/^[0-9a-f]{64}$/.test(data.shareToken||'')&&Number.isFinite(Date.parse(data.publishedAt))
  if(!success)return {...clean,success:false,conflict:r.status===409&&data.code==='PT409'&&data.message==='CORE_QUOTE_REVISION_CONFLICT'}
  const safe={...clean,success:true,quoteId:data.quoteId}
  if(f.scenario==='conversion-retry')return {...safe,jobId:data.jobId,versionId:data.versionId,created:data.created}
  if(f.scenario==='delivery-retry')return {...safe,deliveryId:data.deliveryId,versionId:data.versionId,state:data.state,canSend:data.canSend,attemptTokenPresent:typeof data.attemptToken==='string'&&/^[0-9a-f]{64}$/.test(data.attemptToken)}
  return {...safe,revision:data.revision,replayed:data.replayed,...(f.scenario==='publish-retry'?{versionId:data.versionId,versionNumber:data.versionNumber,shareTokenHash:hash(data.shareToken)}:{})}
 }catch{return {client:index?'B':'A',operationId:payload.p_operation_id,startedMonotonicMs:start,finishedMonotonicMs:performance.now(),success:false,transportError:true}}
}
async function waitGate(){const deadline=performance.now()+180000;while(performance.now()<deadline){let gate;try{gate=JSON.parse(await fs.readFile(args['--barrier'],'utf8'))}catch{}if(matchesQuoteLifecycleGate(gate,f))return gate;await delay(250)}throw Error('Independent owner proof unavailable')}
const cents=value=>{const m=String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);assert(m,'Nonnegative exact decimal required');return BigInt(m[1])*100n+BigInt((m[2]||'').padEnd(2,'0'))}
function verifyDraft(state,id,expected){
 const w=workspace(state,id);assert(w&&isDeepStrictEqual(w.draft,expected),'Complete committed draft must equal canonical input')
 const items=state.items.filter(i=>i.quote_id===id).sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id)),q=state.quotes.find(q=>q.id===id)
 assert(items.length===expected.items.length,'Every line must be saved once')
 let subtotal=0n
 items.forEach((item,index)=>{const e=expected.items[index];assert(item.sort_order===index,'Line order');for(const key of ['name','description','unit','note'])assert(item[key]===e[key],'Line text');for(const key of ['quantity','unit_price'])assert(cents(item[key])===cents(e[key]),'Line decimal');assert(e.vat_rate===null?item.vat_rate===null:cents(item.vat_rate)===cents(e.vat_rate),'VAT known/unknown must be preserved');const total=(cents(e.quantity)*cents(e.unit_price)+50n)/100n;assert(cents(item.total_price)===total,'Line rounding');subtotal+=total})
 assert(cents(q.subtotal_price)===subtotal&&cents(q.total_price)===subtotal-cents(expected.discount_amount),'Exact parent totals')
}
function verifyOutcome(before,after,responses){
 const successes=responses.filter(r=>r.success),race=f.scenario==='update-race';assert(successes.length===(race?1:2),'Expected successes')
 if(race)assert(responses.filter(r=>r.conflict).length===1,'One CAS conflict required')
 const id=successes[0].quoteId;assert(successes.every(r=>r.quoteId===id),'Same quote identity')
 const old=workspace(before,id),current=workspace(after,id),newQuotes=f.scenario==='create-retry'?1:0
 assert(after.quotes.length===before.quotes.length+newQuotes,'Exactly expected quote count')
 assert(isDeepStrictEqual(before.quotes.filter(q=>q.id!==id),after.quotes.filter(q=>q.id!==id))&&isDeepStrictEqual(before.items.filter(i=>i.quote_id!==id),after.items.filter(i=>i.quote_id!==id)),'Unrelated quote content unchanged')
 assert(isDeepStrictEqual(before.calculations,after.calculations)&&isDeepStrictEqual(before.calculationItems,after.calculationItems),'Source calculations untouched')
 assert(isDeepStrictEqual(before.versions,after.versions.filter(v=>before.versions.some(old=>old.versionId===v.versionId))),'All old issued documents unchanged')
 if(['create-retry','update-race','publish-retry'].includes(f.scenario)){assert(successes.filter(r=>!r.replayed).length===1,'Exactly one non-replay receipt');assert(successes.every(r=>r.revision===current.revision),'Receipts must match the single committed revision')}
 if(f.scenario==='create-retry'){
  const calc=before.calculations.find(c=>c.id===f.calculationId),source=before.calculationItems.filter(i=>i.calculation_id===f.calculationId&&i.item_type==='customer').sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id))
  assert(current.revision==='1'&&current.sourceCalculationId===f.calculationId&&current.sourceCalculationRevision===f.expectedCalculationRevision&&current.draft.items.length===source.length,'One source-linked quote')
  source.forEach((e,index)=>{const row=current.draft.items[index];for(const key of ['name','description','unit','note'])assert(row[key]===e[key],'Exact customer source line');for(const key of ['quantity','unit_price'])assert(cents(row[key])===cents(e[key]),'Exact source decimals');assert(row.vat_rate===null?e.vat_rate===null:cents(row.vat_rate)===cents(e.vat_rate),'Source VAT')})
  assert(current.draft.title===calc.title&&current.customerId===calc.customer_id&&current.draft.currency===calc.currency,'Source header and customer')
  verifyDraft(after,id,current.draft)
 }else if(race){verifyDraft(after,id,input(successes[0].client==='A'?0:1));assert(current.revision===(BigInt(f.expectedRevision)+1n).toString(),'Single revision increment')}
 else if(f.scenario==='publish-retry'){
  assert(successes[0].versionId===successes[1].versionId&&successes[0].shareTokenHash===successes[1].shareTokenHash,'One exact issued version and token')
  assert(current.versions.length===old.versions.length+1&&current.currentVersionId===successes[0].versionId&&!current.draftOpen,'One new closed publication')
  assert(isDeepStrictEqual(old.draft,current.draft),'Publication cannot change canonical draft content')
 }else if(f.scenario==='delivery-retry'){
  assert(successes.filter(r=>r.canSend).length===1&&successes.every(r=>r.attemptTokenPresent===r.canSend)&&successes[0].deliveryId===successes[1].deliveryId,'Only one provider send permission')
  assert(isDeepStrictEqual(before,after),'Reserving mail must not change business documents or jobs')
 }else{
  assert(successes.filter(r=>r.created).length===1&&successes[0].jobId===successes[1].jobId,'One job identity')
  const job=after.jobs.find(j=>j.id===successes[0].jobId),children=after.jobs.filter(j=>j.parent_job_id===job?.id),issued=before.versions.find(v=>v.versionId===f.versionId)?.document
  assert(job&&issued&&job.company_id===f.companyId&&job.source_quote_id===id&&job.source_quote_version_id===f.versionId&&job.parent_job_id===null&&job.customer_id===old.customerId,'Exact version parent scope')
  assert(cents(job.price)===cents(issued.total_price)&&job.currency===issued.currency&&job.title===f.input.title&&job.description===f.input.description&&job.address===f.input.address&&Date.parse(job.start_at)===Date.parse(f.input.start_at)&&Date.parse(job.end_at)===Date.parse(f.input.end_at),'Accepted version price and requested job')
  assert(isDeepStrictEqual(before.quotes,after.quotes)&&isDeepStrictEqual(before.items,after.items),'Conversion must not change quote content')
  assert(children.length===f.input.split_days.length&&after.jobs.length===before.jobs.length+1+children.length,'Complete job tree once')
  for(const day of f.input.split_days)assert(children.some(c=>c.title===f.input.title+' - '+day.label&&Date.parse(c.start_at)===Date.parse(day.start_at)&&Date.parse(c.end_at)===Date.parse(day.end_at)&&cents(c.price)===0n&&c.source_quote_id===null&&c.company_id===f.companyId),'Every selected day must exist')
 }
 if(f.scenario!=='conversion-retry')assert(isDeepStrictEqual(before.jobs,after.jobs),'Unrelated jobs unchanged')
 else assert(isDeepStrictEqual(before.jobs,after.jobs.filter(j=>before.jobs.some(old=>old.id===j.id))),'Existing jobs unchanged')
 return {quoteId:id,completeEffect:true,unrelatedDataPreserved:true,preservationScope:'complete visible fixture-company quote, calculation, version and job rows'}
}
try{
 args=Object.fromEntries(process.argv.slice(2).map(arg=>{const at=arg.indexOf('=');assert(at>0,'Use --name=value');return [arg.slice(0,at),arg.slice(at+1)]}))
 assert(args['--fixture']&&args['--output']&&args['--barrier'],'Fixture, output and barrier paths required')
 const files=[args['--fixture'],args['--output'],args['--barrier']].map(p=>path.resolve(p).toLowerCase());assert(new Set(files).size===3,'Distinct private/report/evidence files required')
 auth=JSON.parse(await fs.readFile(args['--fixture'],'utf8'));f=auth.fixture;output=path.resolve(args['--output'])
 assert(/^core-quote-lifecycle-concurrency-[0-9a-f-]+@example\.invalid$/i.test(auth.email)&&typeof auth.password==='string'&&auth.password.length>0&&uuid.test(auth.authUserId||''),'Dedicated synthetic Auth fixture required')
 assert(f&&[f.runId,f.companyId,f.profileId,f.operationId].every(v=>typeof v==='string'&&uuid.test(v))&&Object.hasOwn(quoteLifecycleRpcs,f.scenario),'Known scenario and scope required')
 if(f.scenario==='create-retry')assert(uuid.test(f.calculationId||'')&&/^[1-9]\d*$/.test(f.expectedCalculationRevision||''),'Source revision required')
 else assert(uuid.test(f.quoteId||''),'Exact quote required')
 if(['update-race','publish-retry'].includes(f.scenario))assert(typeof f.expectedRevision==='string'&&/^[1-9]\d*$/.test(f.expectedRevision),'CAS revision required')
 if(f.scenario==='update-race')assert(uuid.test(f.otherOperationId||'')&&f.otherOperationId!==f.operationId&&f.input?.title?.startsWith('TEST-CORE-QUOTE-LIFECYCLE-')&&f.input.title.length<280,'Fresh two-operation draft race required')
 if(['conversion-retry','delivery-retry'].includes(f.scenario))assert(uuid.test(f.versionId||'')&&f.input&&typeof f.input==='object','Exact issued version required')
 if(f.scenario==='delivery-retry')assert(/@example\.invalid$/.test(f.input.to_email||'')&&f.input.subject?.startsWith('TEST-CORE-QUOTE-LIFECYCLE-'),'Synthetic reservation recipient required')
 if(f.scenario==='conversion-retry')assert(f.input.title?.startsWith('TEST-CORE-QUOTE-LIFECYCLE-')&&Array.isArray(f.input.split_days)&&f.input.split_days.length>=1,'Synthetic job including day required')
 const requestDelayMs=Number(args['--request-delay-ms']??15000);assert(Number.isInteger(requestDelayMs)&&requestDelayMs>=0&&requestDelayMs<=45000,'Delay must be bounded')
 const claim=path.join(path.dirname(path.resolve(args['--fixture'])),'core-quote-lifecycle-run-'+f.runId+'.claim.json');assert(!files.includes(claim.toLowerCase()),'Separate claim file required')
 await unused(output);await unused(args['--barrier']);await fs.writeFile(claim,JSON.stringify({project,runId:f.runId,companyId:f.companyId,scenario:f.scenario,operationId:f.operationId})+'\n',{flag:'wx',mode:0o600})
 await fs.writeFile(output,JSON.stringify({...report,stage:'claimed'})+'\n',{flag:'wx',mode:0o600});outputOwned=true;report.oneTimeRunClaim=true
 const env=Object.fromEntries((await fs.readFile(args['--env-file']||path.join(root,'.env.local'),'utf8')).split(/\r?\n/).map(l=>l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(([,k,v])=>[k,v.trim().replace(/^["']|["']$/g,'')]))
 assert(env.NEXT_PUBLIC_SUPABASE_URL===url&&env.NEXT_PUBLIC_SUPABASE_ANON_KEY,'Exact authorized test endpoint required')
 const publicKey=env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 assert(publicKey.startsWith('sb_publishable_')||JSON.parse(Buffer.from(publicKey.split('.')[1]??'','base64url').toString('utf8')).role==='anon','Only an anonymous or publishable API key is permitted')
 headers={apikey:publicKey,'Content-Type':'application/json',Connection:'close'}
 stage='authentication'
 for(let i=0;i<2;i++){
  const r=await fetch(url+'/auth/v1/token?grant_type=password',{method:'POST',headers,body:JSON.stringify({email:auth.email,password:auth.password}),signal:AbortSignal.timeout(30000)});assert(r.ok,'Synthetic Auth failed');const data=await r.json()
  assert(typeof data.access_token==='string','Auth token required');tokens.push(data.access_token);assert(data.user?.id===auth.authUserId,'Exact fixture user required')
  const claims=JSON.parse(Buffer.from(data.access_token.split('.')[1],'base64url').toString('utf8'));assert(claims.role==='authenticated'&&uuid.test(claims.session_id||''),'Authenticated session required');sessions.push(claims.session_id)
 }
 assert(sessions[0]!==sessions[1],'Two distinct sessions required');report.distinctAuthenticatedSessions=true
 stage='fixture validation'
 const companies=await rows('companies','id=eq.'+f.companyId,tokens[0]),profiles=await rows('profiles','id=eq.'+f.profileId,tokens[0])
 assert(companies.length===1&&companies[0].name==='TEST-CORE-QUOTE-LIFECYCLE-'+f.runId&&profiles.length===1&&profiles[0].auth_user_id===auth.authUserId,'Dedicated tenant and actor required')
 const before=await snapshot(tokens[0]);assert(before.quotes.every(q=>q.title?.startsWith('TEST-CORE-QUOTE-LIFECYCLE-'))&&before.calculations.every(c=>c.title?.startsWith('TEST-CORE-QUOTE-LIFECYCLE-')),'No ordinary business records allowed')
 if(f.scenario==='create-retry'){const calc=before.calculations.find(c=>c.id===f.calculationId);assert(calc&&String(calc.revision)===f.expectedCalculationRevision&&!before.quotes.some(q=>q.source_calculation_id===f.calculationId),'Unused source calculation required');assert(before.calculationItems.some(i=>i.calculation_id===f.calculationId&&i.item_type==='customer'&&cents(i.unit_price)===0n),'Explicit zero customer line required')}
 else{const w=workspace(before,f.quoteId);assert(w&&!w.archivedAt,'Active fixture quote required');if(f.expectedRevision)assert(w.revision===f.expectedRevision&&w.draftOpen,'Current open draft revision required');if(f.versionId)assert(w.versions.some(v=>v.versionId===f.versionId),'Fixture version required');if(f.scenario==='conversion-retry')assert(w.acceptedVersionId===f.versionId&&!before.jobs.some(j=>j.source_quote_id===f.quoteId),'Accepted unused conversion source required')}
 Object.assign(report,{runId:f.runId,scenario:f.scenario,beforeFingerprint:hash(before),requestDelayMs});stage='waiting before dispatch';await fs.writeFile(output,JSON.stringify({...report,stage})+'\n')
 console.log(JSON.stringify({ready:true,project,runId:f.runId,scenario:f.scenario,requestDelayMs,applicationName:'corequote-lifecycle:'+f.runId}));await delay(requestDelayMs)
 stage='requests in flight';const responses=await Promise.all([call(0),call(1)]);report.responses=responses;await fs.writeFile(output,JSON.stringify({...report,stage:'waiting for owner proof'},null,2)+'\n');console.log(JSON.stringify({httpCompleted:true,runId:f.runId,responses}))
 stage='owner causal evidence';const gate=await waitGate();report.databaseOverlap=validateQuoteLifecycleOverlap(gate,responses,f);report.ownerPostcondition=validateQuoteLifecycleOwnerResult(gate,f)
 stage='committed state';const after=await snapshot(tokens[1]);Object.assign(report,verifyOutcome(before,after,responses),{afterFingerprint:hash(after),httpAndDatabaseProofComplete:true,noProviderCalled:true})
}catch{report.failureStage=stage;process.exitCode=1;console.error(JSON.stringify({passed:false,stage,message:'Test did not complete; inspect redacted phase and independent owner evidence.'}))}
finally{
 const logout=await Promise.allSettled(tokens.map(token=>fetch(url+'/auth/v1/logout?scope=local',{method:'POST',headers:{...headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)})))
 report.loggedOutSessions=logout.filter(r=>r.status==='fulfilled'&&r.value.ok).length;report.passed=report.httpAndDatabaseProofComplete===true&&tokens.length===2&&report.loggedOutSessions===2
 if(!report.passed)process.exitCode=1
 if(outputOwned)await fs.writeFile(output,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report))
}
