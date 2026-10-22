import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { quoteLifecycleRpcs, matchesQuoteLifecycleGate, validateQuoteLifecycleOverlap, validateQuoteLifecycleOwnerResult } from '../scripts/core-quote-lifecycle-concurrency-proof.mjs'
const companyId='11111111-1111-4111-8111-111111111111', operationId='22222222-2222-4222-8222-222222222222'
const otherOperationId='33333333-3333-4333-8333-333333333333', quoteId='44444444-4444-4444-8444-444444444444', runId='55555555-5555-4555-8555-555555555555'
const versionId='66666666-6666-4666-8666-666666666666',calculationId='77777777-7777-4777-8777-777777777777'
type Scenario=keyof typeof quoteLifecycleRpcs
type TestFixture={companyId:string;operationId:string;runId:string;scenario:Scenario;expectedRevision:string;input:{split_days:Record<string,never>[]};calculationId?:string;quoteId?:string;otherOperationId?:string;versionId?:string}
function fixture(scenario: Scenario='create-retry'):TestFixture{
 return {companyId,operationId,runId,scenario,expectedRevision:'3',input:{split_days:[{}]},
  ...(scenario==='create-retry'?{calculationId}:{quoteId}),
  ...(scenario==='update-race'?{otherOperationId}:{}),
  ...(['delivery-retry','conversion-retry'].includes(scenario)?{versionId}:{})}
}
function gate(f=fixture()){
 return {proofVersion:1,project:'wfcpfraxiuhuglnuaxqj',runId:f.runId,scenario:f.scenario,companyId:f.companyId,
  operationId:f.operationId,otherOperationId:f.otherOperationId??null,quoteId:f.quoteId??null,calculationId:f.calculationId??null,versionId:f.versionId??null,
  applicationName:'corequote-lifecycle:'+f.runId,lockKind:'company-row',phase:'observed',blockerPid:100,barrierLockHeld:true,
  ownerCompanyLockConfirmed:true,ownerTransactionLockGranted:true,ownerTransactionId:'9001',lockRelation:'public.companies',relationOid:17001,rowPage:4,rowTuple:7,
  barrierAcquiredAt:'2026-10-21T14:00:00.000Z',observedAt:'2026-10-21T14:00:01.000Z',barrierReleasedAt:'2026-10-21T14:00:01.001Z',
  waiters:[201,202].map((pid,index)=>({pid,state:'active',waitEventType:'Lock',rootBlocked:true,queryFunction:String(quoteLifecycleRpcs[f.scenario]),blockingPids:[index?201:100],
   backendStartedAt:'2026-10-21T13:00:00.000Z',transactionStartedAt:'2026-10-21T14:00:00.200Z',queryStartedAt:'2026-10-21T14:00:00.201Z',companyRelationLockGranted:true,
   companyTupleLocks:[{relationOid:17001,page:4,tuple:7,mode:'AccessExclusiveLock',granted:index===0}],
   transactionWaits:index?[]:[{transactionId:'9001',mode:'ShareLock',granted:false}]})),
  postcondition:{requestsFinished:true,existingVersionsUnchanged:true,existingDecisionsUnchanged:true,operationRows:['conversion-retry','delivery-retry'].includes(f.scenario)?0:1,
   sourceQuoteRows:1,sourceClaimRows:1,quotesAdded:f.scenario==='create-retry'?1:0,versionsAdded:f.scenario==='publish-retry'?1:0,
   revision:'4',versionTokenRows:1,deliveryRows:1,deliveryState:'reserved',conversionRows:1,conversionRequestRows:1,jobTreeRows:2}}
}
function responses(f=fixture()){return ['A','B'].map((client,index)=>({client,operationId:client==='B'&&f.scenario==='update-race'?f.otherOperationId:f.operationId,
 startedMonotonicMs:1000+index,finishedMonotonicMs:1500,started:'2099-01-01T00:00:00Z',finished:'1999-01-01T00:00:00Z'}))}
describe('exact quote company-row concurrency proof',()=>{
 it.each<Scenario>(Object.keys(quoteLifecycleRpcs) as Scenario[])('requires actual causal lock evidence for %s',scenario=>{
  const f=fixture(scenario),proof=gate(f)
  expect(validateQuoteLifecycleOverlap(proof,responses(f),f)).toMatchObject({verified:true,clockDomainsCompared:false,authSessionPidMappingClaimed:false,operationPidMappingClaimed:false,localMonotonicOverlapMs:499})
  expect(validateQuoteLifecycleOwnerResult(proof,f).verified).toBe(true)
 })
 it.each([{runId:operationId},{companyId:quoteId},{operationId:otherOperationId},{quoteId},{versionId},{otherOperationId},{scenario:'publish-retry'},
  {proofVersion:2},{lockKind:'advisory'},{applicationName:'old-run'},{phase:'held'},{barrierLockHeld:false},{blockerPid:0}])('rejects wrong invocation %j',change=>{
  const f=fixture(),g={...gate(f),...change};expect(matchesQuoteLifecycleGate(g,f)).toBe(false);expect(()=>validateQuoteLifecycleOverlap(g,responses(f),f)).toThrow()
 })
 it.each([
  ['unlocked owner',(g:ReturnType<typeof gate>)=>{g.ownerCompanyLockConfirmed=false}],
  ['missing owner xid',(g:ReturnType<typeof gate>)=>{g.ownerTransactionLockGranted=false}],
  ['another table',(g:ReturnType<typeof gate>)=>{g.lockRelation='public.jobs'}],
  ['duplicate PID',(g:ReturnType<typeof gate>)=>{g.waiters[1].pid=g.waiters[0].pid}],
  ['wrong RPC',(g:ReturnType<typeof gate>)=>{g.waiters[0].queryFunction='unrelated_rpc'}],
  ['idle waiter',(g:ReturnType<typeof gate>)=>{g.waiters[0].state='idle'}],
  ['unrelated blocked transaction',(g:ReturnType<typeof gate>)=>{g.waiters[0].blockingPids=[999]}],
  ['cyclic waiters',(g:ReturnType<typeof gate>)=>{g.waiters[0].blockingPids=[202]}],
  ['stale query',(g:ReturnType<typeof gate>)=>{g.waiters[0].queryStartedAt='2026-10-21T13:59:59.000Z'}],
  ['missing relation lock',(g:ReturnType<typeof gate>)=>{g.waiters[0].companyRelationLockGranted=false}],
  ['wrong row page',(g:ReturnType<typeof gate>)=>{g.waiters[0].companyTupleLocks[0].page++}],
  ['wrong row tuple',(g:ReturnType<typeof gate>)=>{g.waiters[1].companyTupleLocks[0].tuple++}],
  ['different relation oid',(g:ReturnType<typeof gate>)=>{g.waiters[0].companyTupleLocks[0].relationOid++}],
  ['wrong lock mode',(g:ReturnType<typeof gate>)=>{g.waiters[0].companyTupleLocks[0].mode='AccessShareLock'}],
  ['two tuple holders',(g:ReturnType<typeof gate>)=>{g.waiters[1].companyTupleLocks[0].granted=true}],
  ['wrong blocker transaction',(g:ReturnType<typeof gate>)=>{g.waiters[0].transactionWaits[0].transactionId='9999'}],
  ['already released before observation',(g:ReturnType<typeof gate>)=>{g.barrierReleasedAt='2026-10-21T14:00:00.500Z'}],
 ])('rejects %s',(_name,mutate)=>{
  const f=fixture(),g=gate(f);(mutate as (g:ReturnType<typeof gate>)=>void)(g);expect(()=>validateQuoteLifecycleOverlap(g,responses(f),f)).toThrow()
 })
 it('rejects disjoint HTTP calls and different submitted operations',()=>{
  const f=fixture(),r=responses(f);r[1].startedMonotonicMs=1500;expect(()=>validateQuoteLifecycleOverlap(gate(f),r,f)).toThrow()
  r[1].startedMonotonicMs=1001;r[1].operationId=otherOperationId;expect(()=>validateQuoteLifecycleOverlap(gate(f),r,f)).toThrow()
 })
 it.each<Scenario>(Object.keys(quoteLifecycleRpcs) as Scenario[])('rejects missing committed proof for %s',scenario=>{
  const f=fixture(scenario),g=gate(f);g.postcondition.requestsFinished=false;expect(()=>validateQuoteLifecycleOwnerResult(g,f)).toThrow()
 })
 it.each<Scenario>(Object.keys(quoteLifecycleRpcs) as Scenario[])('rejects duplicate effect or missing preimage preservation for %s',scenario=>{
  const f=fixture(scenario),g=gate(f);g.postcondition.existingVersionsUnchanged=false;expect(()=>validateQuoteLifecycleOwnerResult(g,f)).toThrow();g.postcondition.existingVersionsUnchanged=true
  if(scenario==='create-retry')g.postcondition.sourceQuoteRows=2
  if(scenario==='update-race')g.postcondition.revision='5'
  if(scenario==='publish-retry')g.postcondition.versionTokenRows=2
  if(scenario==='delivery-retry')g.postcondition.deliveryRows=2
  if(scenario==='conversion-retry')g.postcondition.jobTreeRows=1
  expect(()=>validateQuoteLifecycleOwnerResult(g,f)).toThrow()
 })
})
const directories:string[]=[]
afterEach(async()=>{for(const directory of directories.splice(0)){const absolute=resolve(directory),within=relative(resolve(tmpdir()),absolute);if(!within||within.startsWith('..')||isAbsolute(within)||!within.startsWith('diriqo-quote-lifecycle-proof-'))throw Error('Unsafe cleanup');await rm(absolute,{recursive:true,force:true})}})
describe('one-time harness guard without any Auth/network dispatch',()=>{
 it.each(['output','barrier','claim','fresh'])('handles %s before environment access',async existing=>{
  const directory=await mkdtemp(join(tmpdir(),'diriqo-quote-lifecycle-proof-'));directories.push(directory)
  const f={...fixture(),runId:randomUUID(),profileId:randomUUID(),expectedCalculationRevision:'1'}
  const privatePath=join(directory,'fixture.json'),output=join(directory,'report.json'),barrier=join(directory,'barrier.json'),claim=join(directory,'core-quote-lifecycle-run-'+f.runId+'.claim.json')
  await writeFile(privatePath,JSON.stringify({email:'core-quote-lifecycle-concurrency-'+randomUUID()+'@example.invalid',password:'synthetic-private-password',authUserId:randomUUID(),fixture:f}))
  const protectedFile=existing==='output'?output:existing==='barrier'?barrier:claim
  if(existing!=='fresh')await writeFile(protectedFile,'DO NOT OVERWRITE')
  const run=spawnSync(process.execPath,['--',resolve('scripts/test-core-quote-lifecycle-concurrency.mjs'),'--fixture='+privatePath,'--output='+output,'--barrier='+barrier,'--env-file='+join(directory,'ABSENT.env')],{encoding:'utf8',windowsHide:true,timeout:5000})
  expect(run.status,run.stderr).toBe(1);expect(run.stdout+run.stderr).not.toContain('synthetic-private-password');expect(run.stdout+run.stderr).not.toContain('@example.invalid')
  expect(JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1)!)).toMatchObject({passed:false,failureStage:'configuration',loggedOutSessions:0})
  if(existing!=='fresh')expect(await readFile(protectedFile,'utf8')).toBe('DO NOT OVERWRITE')
  if(['barrier','claim'].includes(existing))await expect(access(output)).rejects.toThrow()
  if(existing==='fresh'){expect(JSON.parse(await readFile(output,'utf8')).oneTimeRunClaim).toBe(true);expect(JSON.parse(await readFile(claim,'utf8')).runId).toBe(f.runId)}
 })
})

describe('offline five-scenario fixture recipe',()=>{
 it('creates one shared actor with isolated companies and finalizes only exact owner output without secrets in logs',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'diriqo-quote-lifecycle-proof-'));directories.push(directory)
  const target=join(directory,'prepared'),authFile=join(directory,'new-auth.json'),auth={project:'wfcpfraxiuhuglnuaxqj',authUserId:randomUUID(),email:'core-quote-lifecycle-concurrency-'+randomUUID()+'@example.invalid',password:'OFFLINE-ONLY-PRIVATE-PASSWORD'}
  await writeFile(authFile,JSON.stringify(auth))
  const prepare=spawnSync(process.execPath,['--',resolve('scripts/prepare-core-quote-lifecycle-concurrency.mjs'),'--mode=prepare','--auth-private='+authFile,'--directory='+target],{encoding:'utf8',windowsHide:true,timeout:5000})
  expect(prepare.status,prepare.stderr).toBe(0);expect(prepare.stdout+prepare.stderr).not.toContain(auth.password);expect(prepare.stdout).not.toContain(auth.email)
  const plan=JSON.parse(await readFile(join(target,'plan.json'),'utf8'))
  expect(plan.scenarios).toHaveLength(5);expect(new Set(plan.scenarios.map((r:{companyId:string})=>r.companyId)).size).toBe(5)
  const ownerSql=await readFile(join(target,'owner-setup.sql'),'utf8')
  expect(ownerSql).toContain('set local role authenticated');expect(ownerSql).toContain('core.quotes.create');expect(ownerSql).toContain('core.jobs.create');expect(ownerSql).not.toContain(auth.password)
  expect(ownerSql).not.toMatch(/insert into public\.(quotes|quote_items|jobs)/)
  await writeFile(join(target,'owner-result.json'),JSON.stringify({project:auth.project,authUserId:auth.authUserId,profileId:plan.profileId,fixtures:plan.scenarios.map((r:{scenario:string;runId:string})=>({...r,calculationId:randomUUID(),quoteId:r.scenario==='create-retry'?null:randomUUID(),versionId:['delivery-retry','conversion-retry'].includes(r.scenario)?randomUUID():null,draftInput:{title:'TEST-CORE-QUOTE-LIFECYCLE-'+r.runId,items:[{unit_price:'0.00'},{unit_price:'10.00'}]}}))}))
  const finalize=spawnSync(process.execPath,['--',resolve('scripts/prepare-core-quote-lifecycle-concurrency.mjs'),'--mode=finalize','--auth-private='+authFile,'--directory='+target],{encoding:'utf8',windowsHide:true,timeout:5000})
  expect(finalize.status,finalize.stderr).toBe(0);expect(finalize.stdout+finalize.stderr).not.toContain(auth.password);expect(finalize.stdout).not.toContain(auth.email)
  for(const row of plan.scenarios){
   const privateFixture=JSON.parse(await readFile(join(target,row.scenario+'.private.json'),'utf8')),barrierSql=await readFile(join(target,row.scenario+'.owner-barrier.sql'),'utf8')
   expect(privateFixture.authUserId).toBe(auth.authUserId);expect(privateFixture.fixture.profileId).toBe(plan.profileId);expect(privateFixture.fixture.companyId).toBe(row.companyId)
   expect(barrierSql).not.toMatch(/__[A-Z_]+__/);expect(barrierSql).not.toContain(auth.password)
  }
  expect((await readFile(join(target,'commands.ps1'),'utf8')).match(/node -- /g)).toHaveLength(5)
  const again=spawnSync(process.execPath,['--',resolve('scripts/prepare-core-quote-lifecycle-concurrency.mjs'),'--mode=prepare','--auth-private='+authFile,'--directory='+target],{encoding:'utf8',windowsHide:true,timeout:5000})
  expect(again.status).toBe(1);expect(JSON.parse(await readFile(join(target,'plan.json'),'utf8')).profileId).toBe(plan.profileId)
 })
})
