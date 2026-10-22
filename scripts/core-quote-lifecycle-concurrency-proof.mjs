// Pure validation of the exact company-row barrier used by core quote RPCs.
// Reuses the calculation harness's causal model, not its unrelated advisory locks.
import assert from 'node:assert/strict'
export const quoteLifecycleRpcs = Object.freeze({
 'create-retry':'create_core_quote_from_calculation_atomic', 'update-race':'update_core_quote_draft_atomic',
 'publish-retry':'publish_core_quote_version_atomic', 'delivery-retry':'begin_core_quote_delivery_atomic',
 'conversion-retry':'convert_core_quote_to_job_atomic',
})
const project='wfcpfraxiuhuglnuaxqj'
const positive=value=>Number.isSafeInteger(value)&&value>0
const at=value=>typeof value==='string'?Date.parse(value):NaN
export function matchesQuoteLifecycleGate(g,f) {
 return g?.proofVersion===1&&g.project===project&&g.runId===f.runId&&g.scenario===f.scenario
  &&g.companyId===f.companyId&&g.operationId===f.operationId&&g.otherOperationId===(f.otherOperationId??null)
  &&g.quoteId===(f.quoteId??null)&&g.calculationId===(f.calculationId??null)&&g.versionId===(f.versionId??null)
  &&g.applicationName==='corequote-lifecycle:'+f.runId&&g.lockKind==='company-row'
  &&g.phase==='observed'&&positive(g.blockerPid)&&g.barrierLockHeld===true
}
export function validateQuoteLifecycleOverlap(g,responses,f) {
 assert(matchesQuoteLifecycleGate(g,f),'Exact one-time fixture and barrier identity required')
 assert(g.ownerCompanyLockConfirmed===true&&g.ownerTransactionLockGranted===true,'Owner must actually lock the dedicated company')
 assert(g.lockRelation==='public.companies'&&positive(g.relationOid)&&Number.isInteger(g.rowPage)&&g.rowPage>=0&&positive(g.rowTuple),'Exact relation and company ctid required')
 assert(typeof g.ownerTransactionId==='string'&&/^\d+$/.test(g.ownerTransactionId),'Actual owner transaction lock required')
 const acquired=at(g.barrierAcquiredAt),observed=at(g.observedAt),released=at(g.barrierReleasedAt)
 assert([acquired,observed,released].every(Number.isFinite)&&acquired<=observed&&observed<=released,'Server timestamps must be ordered')
 assert(Array.isArray(g.waiters)&&g.waiters.length===2,'Exactly two database waiters required')
 const pids=g.waiters.map(w=>w.pid),waiters=new Map(g.waiters.map(w=>[w.pid,w]))
 assert(new Set(pids).size===2&&pids.every(pid=>positive(pid)&&pid!==g.blockerPid),'Distinct waiting backends required')
 const reachesRoot=(pid,seen=new Set())=>{
  if(pid===g.blockerPid)return true
  if(seen.has(pid))return false
  seen.add(pid)
  return waiters.get(pid)?.blockingPids.some(blocker=>reachesRoot(blocker,new Set(seen)))??false
 }
 let directOwnerWaits=0
 for(const w of g.waiters) {
  assert(w.queryFunction===quoteLifecycleRpcs[f.scenario]&&w.state==='active'&&w.waitEventType==='Lock'&&w.rootBlocked===true,'Both exact RPC backends must wait behind the owner')
  assert(Array.isArray(w.blockingPids)&&w.blockingPids.length>0&&w.blockingPids.every(positive),'Actual blocking PID graph required')
  const backend=at(w.backendStartedAt),transaction=at(w.transactionStartedAt),query=at(w.queryStartedAt)
  assert([backend,transaction,query].every(Number.isFinite)&&backend<=transaction&&transaction<=query&&query>=acquired&&query<=observed,'No stale or future database query')
  assert(w.companyRelationLockGranted===true,'Both RPCs must have the companies RowShareLock')
  assert(Array.isArray(w.companyTupleLocks)&&w.companyTupleLocks.length===1,'Exact company tuple pg_locks tag required')
  const lock=w.companyTupleLocks[0]
  assert(lock.relationOid===g.relationOid&&lock.page===g.rowPage&&lock.tuple===g.rowTuple&&lock.mode==='AccessExclusiveLock'&&typeof lock.granted==='boolean','Wrong row lock identity')
  assert(Array.isArray(w.transactionWaits),'Transaction lock observations required')
  if(w.transactionWaits.some(lock=>lock.transactionId===g.ownerTransactionId&&lock.mode==='ShareLock'&&lock.granted===false))directOwnerWaits++
 }
 assert(directOwnerWaits>=1&&pids.every(pid=>reachesRoot(pid)),'Both exact row waiters must connect to the owner transaction')
 assert(g.waiters.filter(w=>w.companyTupleLocks[0].granted).length===1,'One tuple lock holder and one tuple waiter required')
 assert(Array.isArray(responses)&&responses.length===2&&new Set(responses.map(r=>r.client)).size===2,'Two HTTP clients required')
 for(const r of responses) {
  assert(['A','B'].includes(r.client)&&r.operationId===(r.client==='B'&&f.scenario==='update-race'?f.otherOperationId:f.operationId),'Exact submitted operations required')
  assert(Number.isFinite(r.startedMonotonicMs)&&Number.isFinite(r.finishedMonotonicMs)&&r.startedMonotonicMs>=0&&r.finishedMonotonicMs>=r.startedMonotonicMs,'Local monotonic HTTP interval required')
 }
 const overlap=Math.min(...responses.map(r=>r.finishedMonotonicMs))-Math.max(...responses.map(r=>r.startedMonotonicMs))
 assert(overlap>0,'The HTTP intervals must overlap on one local monotonic clock')
 return {verified:true,source:'owner pg_locks exact company ctid and transaction + pg_blocking_pids',waitingBackendPids:pids,
  blockerPid:g.blockerPid,companyId:f.companyId,localMonotonicOverlapMs:overlap,clockDomainsCompared:false,
  authSessionPidMappingClaimed:false,operationPidMappingClaimed:false}
}
export function validateQuoteLifecycleOwnerResult(g,f) {
 const p=g.postcondition
 assert(p?.requestsFinished===true&&p.existingVersionsUnchanged===true&&p.existingDecisionsUnchanged===true,'Independent committed postcondition required')
 assert(p.operationRows===(f.scenario==='conversion-retry'||f.scenario==='delivery-retry'?0:1),'One successful command receipt required')
 if(f.scenario==='create-retry')assert(p.sourceQuoteRows===1&&p.sourceClaimRows===1&&p.quotesAdded===1&&p.versionsAdded===0,'One complete source claim and quote required')
 if(f.scenario==='update-race')assert(p.quotesAdded===0&&p.versionsAdded===0&&p.revision===(BigInt(f.expectedRevision)+1n).toString(),'One CAS revision increment required')
 if(f.scenario==='publish-retry')assert(p.versionsAdded===1&&p.versionTokenRows===1&&p.revision===(BigInt(f.expectedRevision)+1n).toString(),'Exactly one issued version/token required')
 if(f.scenario==='delivery-retry')assert(p.deliveryRows===1&&p.deliveryState==='reserved'&&p.versionsAdded===0,'Exactly one reserve without mail required')
 if(f.scenario==='conversion-retry')assert(p.conversionRows===1&&p.conversionRequestRows===1&&p.jobTreeRows===1+f.input.split_days.length&&p.versionsAdded===0,'Exactly one accepted-version job tree required')
 return {verified:true,...p}
}
