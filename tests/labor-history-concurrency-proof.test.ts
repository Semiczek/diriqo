import { describe, expect, it } from 'vitest'
import { laborHistoryScenarios, matchesLaborHistoryGate, validateLaborHistoryOverlap } from '../scripts/labor-history-concurrency-proof.mjs'

const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const separate = (scenario: string) => ['approve-race', 'rate-vs-approve'].includes(scenario)
const reviews = (scenario: string) => scenario.startsWith('approve-') || scenario === 'rate-vs-approve'
function fixture(scenario = 'approve-retry') {
  return { scenario, runId: id('1'), companyId: id('2'), actorProfileId: id('3'), workerProfileId: id('4'),
    operationId: id('5'), otherOperationId: id('6'), submissionId: id('7'), versionId: id('8') }
}
const rpc = (f: ReturnType<typeof fixture>, index: number) => f.scenario === 'rate-vs-approve'
  ? index === 0 ? 'set_company_worker_rate' : 'review_labor_submission'
  : f.scenario.startsWith('rate-') ? 'set_company_worker_rate' : 'review_labor_submission'
function evidence(f = fixture()) {
  const workerKey = { lockName: `labor:${f.companyId}:${f.workerProfileId}`, key: '1001', classId: '0', objectId: '1001', objectSubId: 1 }
  const operationKeys = (separate(f.scenario) ? [f.operationId, f.otherOperationId] : [f.operationId]).map((operationId, index) => ({
    operationId, lockName: `labor-op:${f.companyId}:${f.actorProfileId}:${operationId}`,
    key: String(2001 + index), classId: '0', objectId: String(2001 + index), objectSubId: 1,
  }))
  const lock = (key: typeof workerKey, pid: number, granted: boolean) => ({ ...key, locktype: 'advisory', databaseOid: 16400, pid, mode: 'ExclusiveLock', granted })
  return {
    proofVersion: 1, project: 'wfcpfraxiuhuglnuaxqj', runId: f.runId, round: 1, scenario: f.scenario,
    companyId: f.companyId, actorProfileId: f.actorProfileId, workerProfileId: f.workerProfileId,
    operationId: f.operationId, otherOperationId: separate(f.scenario) ? f.otherOperationId : null,
    submissionId: reviews(f.scenario) ? f.submissionId : null, versionId: reviews(f.scenario) ? f.versionId : null,
    lockKind: 'worker', applicationName: `labor-history:${f.runId}:1`, databaseOid: 16400, blockerPid: 100,
    barrierLockHeld: true, phase: 'observed', barrierAcquiredAt: '2026-10-24T10:00:00.100Z',
    observedAt: '2026-10-24T10:00:00.500Z', barrierReleasedAt: '2026-10-24T10:00:00.600Z',
    workerKey, operationKeys, ownerWorkerLock: lock(workerKey, 100, true),
    waiters: [201, 202].map((pid, index) => {
      const holdsOperation = index === 0 || separate(f.scenario)
      const key = operationKeys[separate(f.scenario) ? index : 0]
      return {
        pid, state: 'active', waitEventType: 'Lock', rootBlocked: true, queryFunction: rpc(f, index),
        blockingPids: holdsOperation ? [100] : [201], backendStartedAt: '2026-10-24T09:00:00.000Z',
        transactionStartedAt: '2026-10-24T10:00:00.200Z', queryStartedAt: '2026-10-24T10:00:00.300Z',
        operationLocks: [{ ...lock(key, pid, holdsOperation), operationId: key.operationId }],
        workerLocks: holdsOperation ? [lock(workerKey, pid, false)] : [],
      }
    }),
  }
}
function responses(f = fixture()) {
  return ['A', 'B'].map((client, index) => ({
    client, operationId: index === 1 && separate(f.scenario) ? f.otherOperationId : f.operationId,
    queryFunction: rpc(f, index), startedMonotonicMs: 1000 + index, finishedMonotonicMs: 1500,
  }))
}
type Gate = ReturnType<typeof evidence>
type Response = ReturnType<typeof responses>

describe('labor concurrency evidence validator (offline only)', () => {
  it.each(laborHistoryScenarios)('accepts worker and operation lock correlation for %s without claiming outcome', scenario => {
    const f = fixture(scenario)
    expect(validateLaborHistoryOverlap(evidence(f), responses(f), f)).toMatchObject({
      overlapVerified: true, businessOutcomeVerified: false, authSessionsVerified: false,
      authSessionPidMappingClaimed: false, clockDomainsCompared: false, localMonotonicOverlapMs: 499,
    })
  })
  it('accepts PostgreSQL oid JSON strings from the observed hosted replay shape', () => {
    const f = fixture(), gate = evidence(f)
    // PostgreSQL jsonb_build_object serializes oid as text, unlike ordinary integer PID.
    const observed = JSON.parse(JSON.stringify(gate))
    observed.databaseOid = '5'
    observed.ownerWorkerLock.databaseOid = '5'
    for (const waiter of observed.waiters) for (const lock of [...waiter.operationLocks, ...waiter.workerLocks]) lock.databaseOid = '5'
    expect(matchesLaborHistoryGate(observed, f)).toBe(true)
    expect(validateLaborHistoryOverlap(observed, responses(f), f).overlapVerified).toBe(true)
  })
  it('compares canonical numeric and textual representations of the same database OID', () => {
    const f = fixture(), gate = evidence(f), observed = JSON.parse(JSON.stringify(gate))
    observed.ownerWorkerLock.databaseOid = '16400'
    observed.waiters[0].operationLocks[0].databaseOid = '16400'
    expect(validateLaborHistoryOverlap(observed, responses(f), f).overlapVerified).toBe(true)
  })
  it.each(['0', '05', '-5', '5.0', '5e0', ' 5', '5 ', '4294967296', '', null, 4294967296, Infinity, 1.5])('rejects noncanonical or out-of-range database OID %j', databaseOid => {
    const f = fixture(), gate = { ...evidence(f), databaseOid }
    expect(matchesLaborHistoryGate(gate, f)).toBe(false)
    expect(() => validateLaborHistoryOverlap(gate, responses(f), f)).toThrow()
  })
  it('does not normalize malformed backend lock OIDs into the expected database', () => {
    const f = fixture(), observed = JSON.parse(JSON.stringify(evidence(f)))
    observed.ownerWorkerLock.databaseOid = '016400'
    expect(() => validateLaborHistoryOverlap(observed, responses(f), f)).toThrow()
  })
  it('rejects source PATCH evidence rather than inferring an operation lock it cannot have', () => {
    const f = fixture('source-vs-approve'), gate = evidence(f)
    expect(matchesLaborHistoryGate(gate, f)).toBe(false)
    expect(() => validateLaborHistoryOverlap(gate, responses(f), f)).toThrow()
  })
  it('does not compare HTTP wall clock to database wall clock', () => {
    const f = fixture(), http = responses(f).map(r => ({ ...r, startedAt: '2099-01-01T00:00:00Z', finishedAt: '1999-01-01T00:00:00Z' }))
    expect(validateLaborHistoryOverlap(evidence(f), http, f).overlapVerified).toBe(true)
  })
  it.each([
    { proofVersion: 2 }, { project: 'other-project' }, { runId: id('9') }, { round: 2 },
    { companyId: id('9') }, { actorProfileId: id('9') }, { workerProfileId: id('9') },
    { operationId: id('9') }, { otherOperationId: id('9') }, { submissionId: id('9') }, { versionId: id('9') },
    { scenario: 'approve-race' }, { lockKind: 'operation' }, { applicationName: 'stale' },
    { blockerPid: 0 }, { databaseOid: 0 }, { barrierLockHeld: false }, { phase: 'started' },
  ])('rejects a stale or differently scoped invocation: %j', change => {
    const f = fixture(), gate = { ...evidence(f), ...change }
    expect(matchesLaborHistoryGate(gate, f)).toBe(false)
    expect(() => validateLaborHistoryOverlap(gate, responses(f), f)).toThrow()
  })
  const invalidEvidence: [string, (gate: Gate) => void][] = [
    ['wrong worker lock name', g => { g.workerKey.lockName += ':other' }],
    ['wrong actor namespace', g => { g.operationKeys[0].lockName += ':other' }],
    ['missing owner pg_locks proof', g => { g.ownerWorkerLock.granted = false }],
    ['owner lock from another database', g => { g.ownerWorkerLock.databaseOid++ }],
    ['owner lock from another backend', g => { g.ownerWorkerLock.pid++ }],
    ['owner lock wrong kind', g => { g.ownerWorkerLock.locktype = 'relation' }],
    ['owner lock wrong mode', g => { g.ownerWorkerLock.mode = 'ShareLock' }],
    ['owner key wrong low tag', g => { g.ownerWorkerLock.objectId = '1002' }],
    ['wrong operation high tag', g => { g.operationKeys[0].classId = '1' }],
    ['two-integer lock namespace', g => { g.operationKeys[0].objectSubId = 2 }],
    ['noncanonical key string', g => { g.operationKeys[0].key = '02001' }],
    ['out of bigint range', g => { g.operationKeys[0].key = '9223372036854775808' }],
    ['unexpected operation ID', g => { g.operationKeys[0].operationId = id('9') }],
    ['absent operation key', g => { g.operationKeys = [] }],
    ['duplicate backend', g => { g.waiters[1].pid = 201 }],
    ['owner counted as client', g => { g.waiters[1].pid = 100 }],
    ['wrong RPC', g => { g.waiters[0].queryFunction = 'set_company_worker_rate' }],
    ['idle backend', g => { g.waiters[0].state = 'idle' }],
    ['IO wait', g => { g.waiters[0].waitEventType = 'IO' }],
    ['non-root blocker graph', g => { g.waiters[0].blockingPids = [900] }],
    ['missing replay-to-holder edge', g => { g.waiters[1].blockingPids = [100] }],
    ['self blocking', g => { g.waiters[1].blockingPids = [202, 201] }],
    ['empty blockers', g => { g.waiters[0].blockingPids = [] }],
    ['unconfirmed root', g => { g.waiters[0].rootBlocked = false }],
    ['stale query', g => { g.waiters[0].queryStartedAt = '2026-10-24T09:59:59.000Z' }],
    ['future query', g => { g.waiters[0].queryStartedAt = '2026-10-24T10:00:01.000Z' }],
    ['transaction after query', g => { g.waiters[0].transactionStartedAt = '2026-10-24T10:00:00.400Z' }],
    ['release before observation', g => { g.barrierReleasedAt = '2026-10-24T10:00:00.400Z' }],
    ['wrong operation PID', g => { g.waiters[0].operationLocks[0].pid = 202 }],
    ['operation lock from another database', g => { g.waiters[0].operationLocks[0].databaseOid++ }],
    ['operation lock not advisory', g => { g.waiters[0].operationLocks[0].locktype = 'transactionid' }],
    ['operation lock wrong tag', g => { g.waiters[0].operationLocks[0].objectId = '7000' }],
    ['worker key absent', g => { g.waiters[0].workerLocks = [] }],
    ['worker already acquired', g => { g.waiters[0].workerLocks[0].granted = true }],
    ['replay already waiting worker', g => { g.waiters[1].workerLocks = [{ ...g.waiters[0].workerLocks[0], pid: 202 }] }],
    ['replay same operation has two granted locks', g => {
      g.waiters[1].operationLocks[0].granted = true
      g.waiters[1].workerLocks = [{ ...g.waiters[0].workerLocks[0], pid: 202 }]
      g.waiters[1].blockingPids = [100]
    }],
  ]
  it.each(invalidEvidence)('rejects %s', (_name, mutate) => {
    const f = fixture(), gate = evidence(f)
    mutate(gate)
    expect(() => validateLaborHistoryOverlap(gate, responses(f), f)).toThrow()
  })
  it('checks signed negative bigint tags including the full high bit', () => {
    const f = fixture(), gate = evidence(f)
    for (const key of [gate.workerKey, gate.ownerWorkerLock, gate.waiters[0].workerLocks[0]]) {
      Object.assign(key, { key: '-1', classId: '4294967295', objectId: '4294967295' })
    }
    expect(validateLaborHistoryOverlap(gate, responses(f), f).overlapVerified).toBe(true)
  })
  it('rejects worker and operation hash collision, even when individual lock tags are valid', () => {
    const f = fixture(), gate = evidence(f)
    for (const key of [gate.operationKeys[0], ...gate.waiters.map(w => w.operationLocks[0])]) {
      Object.assign(key, { key: '1001', classId: '0', objectId: '1001' })
    }
    expect(() => validateLaborHistoryOverlap(gate, responses(f), f)).toThrow()
  })
  it('requires two distinct operation keys for a rate versus approval race', () => {
    const f = fixture('rate-vs-approve'), gate = evidence(f)
    gate.waiters[1].operationLocks[0] = { ...gate.waiters[0].operationLocks[0], pid: 202 }
    gate.waiters[1].queryFunction = 'set_company_worker_rate'
    expect(() => validateLaborHistoryOverlap(gate, responses(f), f)).toThrow()
  })
  it('matches different RPCs to their own operation key for rate versus approval', () => {
    const f = fixture('rate-vs-approve'), gate = evidence(f)
    gate.waiters[1].queryFunction = 'set_company_worker_rate'
    expect(() => validateLaborHistoryOverlap(gate, responses(f), f)).toThrow()
  })
  const invalidHttp: [string, (r: Response) => void][] = [
    ['same client twice', r => { r[1].client = 'A' }],
    ['wrong operation', r => { r[1].operationId = id('9') }],
    ['wrong HTTP RPC', r => { r[1].queryFunction = 'other_rpc' }],
    ['missing monotonic time', r => { r[1].startedMonotonicMs = NaN }],
    ['negative monotonic time', r => { r[1].startedMonotonicMs = -1 }],
    ['reversed interval', r => { r[1].finishedMonotonicMs = 900 }],
    ['touching intervals', r => { r[1].startedMonotonicMs = 1500; r[1].finishedMonotonicMs = 1600 }],
    ['disjoint intervals', r => { r[1].startedMonotonicMs = 1501; r[1].finishedMonotonicMs = 1600 }],
  ]
  it.each(invalidHttp)('rejects %s', (_name, mutate) => {
    const f = fixture(), http = responses(f)
    mutate(http)
    expect(() => validateLaborHistoryOverlap(evidence(f), http, f)).toThrow()
  })
})
