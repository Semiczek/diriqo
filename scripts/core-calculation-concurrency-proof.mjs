// Pure TEST evidence validation. No keys, Auth, files, network or business writes.
import assert from 'node:assert/strict'
const project='wfcpfraxiuhuglnuaxqj'
const at=value=>typeof value==='string'?Date.parse(value):NaN
const positiveInt=value=>Number.isInteger(value)&&value>0
const kind=f=>f.scenario.startsWith('update')?'calculation':'operation'
const rpc=f=>f.scenario.startsWith('update')?'update_core_calculation_atomic':'create_core_calculation_atomic'
const operationIds=f=>f.scenario==='update-race'?[f.operationId,f.otherOperationId]:[f.operationId]

export function matchesCoreCalculationGate(gate,f,round=1) {
 return gate?.proofVersion===2&&gate.project===project&&gate.runId===f.runId&&gate.round===round
  &&gate.scenario===f.scenario&&gate.companyId===f.companyId&&gate.operationId===f.operationId
  &&gate.otherOperationId===(f.scenario==='update-race'?f.otherOperationId:null)
  &&gate.calculationId===(f.scenario.startsWith('update')?f.calculationId:null)
  &&gate.lockKind===kind(f)&&gate.applicationName==='corecalc:'+f.runId+':'+round
  &&positiveInt(gate.blockerPid)&&gate.barrierLockHeld===true&&gate.phase==='observed'
}

export function validateCoreCalculationOverlap(gate,responses,f,round=1) {
 assert(matchesCoreCalculationGate(gate,f,round),'Exact one-time invocation and owner lock identity required')
 assert(Array.isArray(gate.waiters)&&gate.waiters.length===2,'Two observed database waiters required')
 const acquired=at(gate.barrierAcquiredAt),observed=at(gate.observedAt),released=at(gate.barrierReleasedAt)
 assert([acquired,observed,released].every(Number.isFinite)&&acquired<=observed&&observed<=released,
  'Owner acquisition, observation and release must be ordered on the server clock')
 const expected=operationIds(f)
 assert(Array.isArray(gate.operationKeys)&&gate.operationKeys.length===expected.length,'Exact operation lock keys required')
 const keys=new Map()
 for(const entry of gate.operationKeys) {
  assert(expected.includes(entry.operationId)&&!keys.has(entry.operationId),'Unexpected or duplicate operation key')
  assert(typeof entry.key==='string'&&/^-?\d+$/.test(entry.key),'PostgreSQL advisory bigint key required')
  const key=BigInt(entry.key),mask=BigInt('4294967295')
  assert(key>=BigInt('-9223372036854775808')&&key<=BigInt('9223372036854775807'),'Advisory bigint range')
  assert(entry.classId===((key>>BigInt(32))&mask).toString()&&entry.objectId===(key&mask).toString()
   &&entry.objectSubId===1,'Actual pg_locks single-bigint tag required')
  keys.set(entry.operationId,entry)
 }
 assert(new Set([...keys.values()].map(k=>k.key)).size===expected.length,'Distinct operations must have distinct lock keys')
 const pids=gate.waiters.map(w=>w.pid)
 assert(new Set(pids).size===2&&pids.every(pid=>positiveInt(pid)&&pid!==gate.blockerPid),'Distinct waiting database backends required')
 const waiters=new Map(gate.waiters.map(w=>[w.pid,w]))
 function reachesRoot(pid,seen=new Set()) {
  if(pid===gate.blockerPid)return true
  if(seen.has(pid))return false
  seen.add(pid)
  return waiters.get(pid)?.blockingPids.some(blocker=>reachesRoot(blocker,new Set(seen)))??false
 }
 const locks=[]
 for(const row of gate.waiters) {
  assert(row.state==='active'&&row.waitEventType==='Lock'&&row.rootBlocked===true&&row.queryFunction===rpc(f),
   'Both exact calculation RPC backends must be active and blocked')
  assert(Array.isArray(row.blockingPids)&&row.blockingPids.length>0&&row.blockingPids.every(positiveInt)
   &&new Set(row.blockingPids).size===row.blockingPids.length,'Actual blocking PIDs required')
  const backend=at(row.backendStartedAt),transaction=at(row.transactionStartedAt),query=at(row.queryStartedAt)
  assert([backend,transaction,query].every(Number.isFinite)&&backend<=transaction&&transaction<=query
   &&query>=acquired&&query<=observed,'Each query must start after barrier acquisition and before observation on the server clock')
  assert(Array.isArray(row.operationLocks)&&row.operationLocks.length===1,'One correlated operation advisory lock per backend required')
  const lock=row.operationLocks[0],key=keys.get(lock.operationId)
  assert(key&&lock.key===key.key&&typeof lock.granted==='boolean'&&lock.mode==='ExclusiveLock',
   'Backend must hold or await the exact expected operation advisory lock')
  locks.push(lock)
 }
 assert(pids.every(pid=>reachesRoot(pid)),'Observed blocker graph must connect both RPCs to the owner lock')
 if(kind(f)==='operation') {
  assert(gate.ownerOperationLockGranted===true&&locks.every(lock=>lock.operationId===f.operationId&&!lock.granted),
   'Create requests must both await the exact operation lock held by the owner')
 } else if(f.scenario==='update-retry') {
  assert(gate.ownerParentLockConfirmed===true&&locks.every(lock=>lock.operationId===f.operationId)
   &&locks.filter(lock=>lock.granted).length===1,
   'Update retry must hold one operation lock while its replay waits on that same lock')
 } else {
  assert(gate.ownerParentLockConfirmed===true&&locks.every(lock=>lock.granted)
   &&new Set(locks.map(lock=>lock.operationId)).size===2,
   'Update race must hold the two distinct expected operation locks behind the exact parent barrier')
 }
 assert(Array.isArray(responses)&&responses.length===2&&new Set(responses.map(r=>r.client)).size===2
  &&responses.every(r=>['A','B'].includes(r.client)),'Exactly two HTTP client results required')
 for(const response of responses) {
  assert(response.operationId===(response.client==='B'&&f.scenario==='update-race'?f.otherOperationId:f.operationId),'HTTP request must use the exact scenario operation')
  assert(Number.isFinite(response.startedMonotonicMs)&&Number.isFinite(response.finishedMonotonicMs)
   &&response.startedMonotonicMs>=0&&response.finishedMonotonicMs>=response.startedMonotonicMs,'Local monotonic HTTP interval required')
 }
 const overlapStart=Math.max(...responses.map(r=>r.startedMonotonicMs)),overlapEnd=Math.min(...responses.map(r=>r.finishedMonotonicMs))
 assert(overlapEnd>overlapStart,'Both client HTTP requests must overlap in the one local monotonic clock')
 return {source:'owner pg_stat_activity + pg_blocking_pids + exact pg_locks operation keys',
  proofVersion:2,blockerPid:gate.blockerPid,waitingBackendPids:pids,applicationName:gate.applicationName,
  operationIds:expected,calculationId:gate.calculationId,lockKind:gate.lockKind,
  barrierAcquiredAt:gate.barrierAcquiredAt,observedAt:gate.observedAt,barrierReleasedAt:gate.barrierReleasedAt,
  localMonotonicOverlapMs:overlapEnd-overlapStart,clockDomainsCompared:false,authSessionPidMappingClaimed:false,verified:true}
}
