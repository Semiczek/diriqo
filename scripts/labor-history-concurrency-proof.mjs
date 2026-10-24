// Pure, offline evidence validation. No files, network, Auth, keys or business writes.
// A successful return proves overlap only, not the operation outcome or release readiness.
import assert from 'node:assert/strict'

export const laborHistoryScenarios = Object.freeze([
  'approve-retry', 'approve-race', 'rate-retry', 'rate-conflict', 'rate-vs-approve',
])
const project = 'wfcpfraxiuhuglnuaxqj'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isId = value => typeof value === 'string' && uuid.test(value)
const positiveInt = value => Number.isSafeInteger(value) && value > 0
// PostgreSQL's JSON conversion emits oid as a string. Accept only canonical uint32
// representations; comparing normalized identities must not accept floats/leading zeros.
const canonicalOid = value => {
  if (typeof value === 'number') return positiveInt(value) && value <= 4294967295 ? String(value) : null
  return typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 4294967295 ? value : null
}
const date = value => typeof value === 'string' ? Date.parse(value) : NaN
const separateOperations = f => ['approve-race', 'rate-vs-approve'].includes(f.scenario)
const reviews = f => f.scenario.startsWith('approve-') || f.scenario === 'rate-vs-approve'
const operations = f => separateOperations(f) ? [f.operationId, f.otherOperationId] : [f.operationId]
const rpc = (f, operationId) => f.scenario === 'rate-vs-approve'
  ? (operationId === f.operationId ? 'set_company_worker_rate' : 'review_labor_submission')
  : f.scenario.startsWith('rate-') ? 'set_company_worker_rate' : 'review_labor_submission'
const workerName = f => 'labor:' + f.companyId + ':' + f.workerProfileId
const operationName = (f, operationId) => 'labor-op:' + f.companyId + ':' + f.actorProfileId + ':' + operationId

function validFixture(f, round) {
  return f && laborHistoryScenarios.includes(f.scenario) && positiveInt(round)
    && [f.runId, f.companyId, f.actorProfileId, f.workerProfileId, f.operationId].every(isId)
    && (!separateOperations(f) || (isId(f.otherOperationId) && f.otherOperationId !== f.operationId))
    && (!reviews(f) || [f.submissionId, f.versionId].every(isId))
}

export function matchesLaborHistoryGate(gate, f, round = 1) {
  return Boolean(validFixture(f, round) && gate?.proofVersion === 1 && gate.project === project
    && gate.runId === f.runId && gate.round === round && gate.scenario === f.scenario
    && gate.companyId === f.companyId && gate.actorProfileId === f.actorProfileId
    && gate.workerProfileId === f.workerProfileId && gate.operationId === f.operationId
    && gate.otherOperationId === (separateOperations(f) ? f.otherOperationId : null)
    && gate.submissionId === (reviews(f) ? f.submissionId : null)
    && gate.versionId === (reviews(f) ? f.versionId : null)
    && gate.lockKind === 'worker' && gate.applicationName === 'labor-history:' + f.runId + ':' + round
    && canonicalOid(gate.databaseOid) !== null && positiveInt(gate.blockerPid)
    && gate.barrierLockHeld === true && gate.phase === 'observed')
}

function validateKey(key, expectedName) {
  assert(key && key.lockName === expectedName, 'Exact labor advisory lock namespace and scope required')
  assert(typeof key.key === 'string' && /^-?\d+$/.test(key.key), 'PostgreSQL signed bigint key required')
  const value = BigInt(key.key), mask = 4294967295n
  assert(key.key === value.toString(), 'Canonical PostgreSQL bigint text required')
  assert(value >= -9223372036854775808n && value <= 9223372036854775807n, 'Advisory key bigint range')
  assert(key.classId === ((value >> 32n) & mask).toString()
    && key.objectId === (value & mask).toString() && key.objectSubId === 1,
  'Exact single-bigint pg_locks tag required')
}

function validateLock(lock, key, pid, databaseOid) {
  assert(lock && lock.locktype === 'advisory' && canonicalOid(lock.databaseOid) !== null
    && canonicalOid(lock.databaseOid) === canonicalOid(databaseOid)
    && lock.pid === pid && lock.mode === 'ExclusiveLock' && typeof lock.granted === 'boolean'
    && lock.lockName === key.lockName && lock.key === key.key && lock.classId === key.classId
    && lock.objectId === key.objectId && lock.objectSubId === key.objectSubId,
  'Actual backend, database and complete advisory lock tag must match')
}

export function validateLaborHistoryOverlap(gate, responses, f, round = 1) {
  assert(matchesLaborHistoryGate(gate, f, round), 'Exact fresh labor invocation and worker scope required')
  const acquired = date(gate.barrierAcquiredAt), observed = date(gate.observedAt), released = date(gate.barrierReleasedAt)
  assert([acquired, observed, released].every(Number.isFinite) && acquired <= observed && observed <= released,
    'Owner acquisition, observation and release must be ordered on the database clock')
  validateKey(gate.workerKey, workerName(f))
  validateLock(gate.ownerWorkerLock, gate.workerKey, gate.blockerPid, gate.databaseOid)
  assert(gate.ownerWorkerLock.granted, 'Owner must actually hold the exact worker advisory lock')
  const expected = operations(f)
  assert(Array.isArray(gate.operationKeys) && gate.operationKeys.length === expected.length,
    'Exact distinct operation key set required')
  const keys = new Map()
  for (const key of gate.operationKeys) {
    assert(expected.includes(key.operationId) && !keys.has(key.operationId), 'Unexpected or duplicate operation key')
    validateKey(key, operationName(f, key.operationId))
    keys.set(key.operationId, key)
  }
  assert(new Set([gate.workerKey.key, ...gate.operationKeys.map(k => k.key)]).size === expected.length + 1,
    'Worker and operation advisory keys must not collide')
  assert(Array.isArray(gate.waiters) && gate.waiters.length === 2, 'Two observed database backends required')
  const pids = gate.waiters.map(w => w.pid)
  assert(pids.every(pid => positiveInt(pid) && pid !== gate.blockerPid) && new Set(pids).size === 2,
    'Distinct non-owner backend PIDs required')
  const waiters = new Map(gate.waiters.map(w => [w.pid, w]))
  function reachesOwner(pid, seen = new Set()) {
    if (pid === gate.blockerPid) return true
    if (seen.has(pid)) return false
    seen.add(pid)
    return waiters.get(pid)?.blockingPids.some(other => reachesOwner(other, new Set(seen))) ?? false
  }
  const correlated = []
  for (const waiter of gate.waiters) {
    assert(waiter.state === 'active' && waiter.waitEventType === 'Lock' && waiter.rootBlocked === true,
      'Each correlated RPC must be active and waiting for a lock')
    assert(Array.isArray(waiter.blockingPids) && waiter.blockingPids.length > 0
      && waiter.blockingPids.every(positiveInt) && !waiter.blockingPids.includes(waiter.pid)
      && new Set(waiter.blockingPids).size === waiter.blockingPids.length,
    'Actual distinct blocking PIDs required')
    const backend = date(waiter.backendStartedAt), transaction = date(waiter.transactionStartedAt), query = date(waiter.queryStartedAt)
    assert([backend, transaction, query].every(Number.isFinite) && backend <= transaction && transaction <= query
      && query >= acquired && query <= observed, 'RPC start must fall inside this server observation window')
    assert(Array.isArray(waiter.operationLocks) && waiter.operationLocks.length === 1,
      'One exact operation advisory lock per RPC required')
    const operationLock = waiter.operationLocks[0], key = keys.get(operationLock.operationId)
    assert(key, 'RPC must use an expected operation key')
    validateLock(operationLock, key, waiter.pid, gate.databaseOid)
    assert(waiter.queryFunction === rpc(f, operationLock.operationId), 'Exact RPC must match its operation')
    assert(Array.isArray(waiter.workerLocks), 'Worker lock observations required')
    if (operationLock.granted) {
      assert(waiter.workerLocks.length === 1, 'Operation holder must wait on the exact worker lock')
      validateLock(waiter.workerLocks[0], gate.workerKey, waiter.pid, gate.databaseOid)
      assert(!waiter.workerLocks[0].granted && waiter.blockingPids.includes(gate.blockerPid),
        'Operation holder must await the owner worker barrier')
    } else {
      assert(waiter.workerLocks.length === 0, 'Operation replay waiter cannot already hold or await worker lock')
    }
    correlated.push({ waiter, operationLock })
  }
  assert(pids.every(pid => reachesOwner(pid)), 'Both blocker paths must reach the observed owner worker lock')
  if (separateOperations(f)) {
    assert(correlated.every(x => x.operationLock.granted)
      && new Set(correlated.map(x => x.operationLock.operationId)).size === 2,
    'Different operations must both own distinct operation locks and await the same worker')
  } else {
    const holder = correlated.find(x => x.operationLock.granted), replay = correlated.find(x => !x.operationLock.granted)
    assert(holder && replay && replay.waiter.blockingPids.includes(holder.waiter.pid),
      'Same-operation replay must wait behind its peer owning the operation lock')
  }
  assert(Array.isArray(responses) && responses.length === 2 && new Set(responses.map(r => r.client)).size === 2
    && responses.every(r => ['A', 'B'].includes(r.client)), 'Exactly two HTTP client observations required')
  for (const response of responses) {
    const operationId = response.client === 'B' && separateOperations(f) ? f.otherOperationId : f.operationId
    assert(response.operationId === operationId && response.queryFunction === rpc(f, operationId),
      'HTTP client must dispatch the exact operation and RPC')
    assert(Number.isFinite(response.startedMonotonicMs) && Number.isFinite(response.finishedMonotonicMs)
      && response.startedMonotonicMs >= 0 && response.finishedMonotonicMs >= response.startedMonotonicMs,
    'One local monotonic request interval required')
  }
  const start = Math.max(...responses.map(r => r.startedMonotonicMs))
  const end = Math.min(...responses.map(r => r.finishedMonotonicMs))
  assert(end > start, 'Both HTTP calls must overlap on one local monotonic clock')
  return {
    source: 'owner pg_stat_activity + pg_blocking_pids + complete pg_locks worker and operation tags',
    project, runId: f.runId, scenario: f.scenario, proofVersion: 1, round,
    blockerPid: gate.blockerPid, waitingBackendPids: pids, databaseOid: gate.databaseOid,
    companyId: f.companyId, workerProfileId: f.workerProfileId, operationIds: expected,
    barrierAcquiredAt: gate.barrierAcquiredAt, observedAt: gate.observedAt, barrierReleasedAt: gate.barrierReleasedAt,
    localMonotonicOverlapMs: end - start, clockDomainsCompared: false, authSessionPidMappingClaimed: false,
    overlapVerified: true, businessOutcomeVerified: false, authSessionsVerified: false,
  }
}
