import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { matchesCoreCalculationGate, validateCoreCalculationOverlap } from '../scripts/core-calculation-concurrency-proof.mjs'

type Scenario = 'create-retry' | 'create-conflict' | 'update-retry' | 'update-race'
const companyId = '11111111-1111-4111-8111-111111111111'
const operationId = '22222222-2222-4222-8222-222222222222'
const otherOperationId = '33333333-3333-4333-8333-333333333333'
const calculationId = '44444444-4444-4444-8444-444444444444'
const runId = '55555555-5555-4555-8555-555555555555'
function fixture(scenario: Scenario = 'create-retry') {
  return { scenario, companyId, operationId, runId,
    ...(scenario.startsWith('update') ? { calculationId } : {}),
    ...(scenario === 'update-race' ? { otherOperationId } : {}) }
}
function evidence(f = fixture()) {
  const update = f.scenario.startsWith('update')
  const keys = [{ operationId: f.operationId, key: '1001', classId: '0', objectId: '1001', objectSubId: 1 }]
  if (f.scenario === 'update-race') keys.push({ ...keys[0], operationId: f.otherOperationId!, key: '2001', objectId: '2001' })
  return {
    proofVersion: 2, project: 'wfcpfraxiuhuglnuaxqj', runId: f.runId, round: 1, scenario: f.scenario, companyId: f.companyId,
    operationId: f.operationId, otherOperationId: f.scenario === 'update-race' ? f.otherOperationId : null,
    calculationId: update ? f.calculationId : null, lockKind: update ? 'calculation' : 'operation',
    applicationName: 'corecalc:' + f.runId + ':1', blockerPid: 100, barrierLockHeld: true, phase: 'observed',
    barrierAcquiredAt: '2026-10-21T11:43:24.300000Z', observedAt: '2026-10-21T11:43:24.801217Z',
    barrierReleasedAt: '2026-10-21T11:43:24.802000Z', operationKeys: keys,
    ownerOperationLockGranted: !update, ownerParentLockConfirmed: update,
    waiters: [201, 202].map((pid, index) => ({
      pid, state: 'active', waitEventType: 'Lock', rootBlocked: true,
      queryFunction: update ? 'update_core_calculation_atomic' : 'create_core_calculation_atomic',
      blockingPids: f.scenario === 'update-retry' && index === 1 ? [201] : [100],
      backendStartedAt: '2026-10-21T11:00:00.000000Z', transactionStartedAt: '2026-10-21T11:43:24.400000Z',
      queryStartedAt: '2026-10-21T11:43:24.500000Z',
      operationLocks: [{ operationId: keys[f.scenario === 'update-race' ? index : 0].operationId,
        key: keys[f.scenario === 'update-race' ? index : 0].key, mode: 'ExclusiveLock',
        granted: update && (f.scenario === 'update-race' || index === 0) }],
    })),
  }
}
function responses(f = fixture()) {
  return ['A', 'B'].map((client, index) => ({
    client, operationId: client === 'B' && f.scenario === 'update-race' ? f.otherOperationId : f.operationId,
    started: index ? '2026-10-21T11:43:24.238Z' : '2026-10-21T11:43:24.237Z',
    finished: '2026-10-21T11:43:24.671Z', startedMonotonicMs: 1000 + index, finishedMonotonicMs: 1434,
  }))
}
describe('causal calculation concurrency proof', () => {
  it.each<Scenario>(['create-retry', 'create-conflict', 'update-retry', 'update-race'])('accepts exact server lock correlation for %s', scenario => {
    const f = fixture(scenario), result = validateCoreCalculationOverlap(evidence(f), responses(f), f)
    expect(result).toMatchObject({ verified: true, clockDomainsCompared: false, authSessionPidMappingClaimed: false, localMonotonicOverlapMs: 433 })
  })
  it('accepts the observed 130 ms clock skew without inventing a tolerance', () => {
    const f = fixture(), gate = evidence(f), http = responses(f)
    expect(Date.parse(gate.observedAt)).toBeGreaterThan(Date.parse(http[0].finished))
    expect(validateCoreCalculationOverlap(gate, http, f).verified).toBe(true)
  })
  it('ignores host clock jumps while requiring one monotonic HTTP overlap', () => {
    const f = fixture(), http = responses(f).map(row => ({ ...row, started: '2099-01-01T00:00:00Z', finished: '1999-01-01T00:00:00Z' }))
    expect(validateCoreCalculationOverlap(evidence(f), http, f).verified).toBe(true)
  })
  it.each([
    { proofVersion: 1 }, { runId: operationId }, { scenario: 'create-conflict' }, { companyId: calculationId },
    { operationId: otherOperationId }, { otherOperationId }, { calculationId }, { round: 2 },
    { applicationName: 'stale' }, { lockKind: 'calculation' }, { barrierLockHeld: false }, { blockerPid: 0 },
  ])('rejects a stale or mismatched owner invocation: %j', change => {
    const f = fixture(), gate = { ...evidence(f), ...change }
    expect(matchesCoreCalculationGate(gate, f)).toBe(false)
    expect(() => validateCoreCalculationOverlap(gate, responses(f), f)).toThrow()
  })
  it.each([
    ['duplicate PID', (g: ReturnType<typeof evidence>) => { g.waiters[1].pid = g.waiters[0].pid }],
    ['owner PID as waiter', (g: ReturnType<typeof evidence>) => { g.waiters[0].pid = g.blockerPid }],
    ['wrong RPC', (g: ReturnType<typeof evidence>) => { g.waiters[0].queryFunction = 'unrelated_rpc' }],
    ['idle backend', (g: ReturnType<typeof evidence>) => { g.waiters[0].state = 'idle' }],
    ['non-lock wait', (g: ReturnType<typeof evidence>) => { g.waiters[0].waitEventType = 'IO' }],
    ['detached blocker', (g: ReturnType<typeof evidence>) => { g.waiters[0].blockingPids = [999] }],
    ['cyclic blocker graph', (g: ReturnType<typeof evidence>) => { g.waiters[0].blockingPids = [202]; g.waiters[1].blockingPids = [201] }],
    ['stale query', (g: ReturnType<typeof evidence>) => { g.waiters[0].queryStartedAt = '2026-10-21T11:43:24.299Z'; g.waiters[0].transactionStartedAt = '2026-10-21T11:43:24.200Z' }],
    ['future query', (g: ReturnType<typeof evidence>) => { g.waiters[0].queryStartedAt = '2026-10-21T11:43:24.900Z' }],
    ['release before observation', (g: ReturnType<typeof evidence>) => { g.barrierReleasedAt = '2026-10-21T11:43:24.700Z' }],
    ['wrong operation lock', (g: ReturnType<typeof evidence>) => { g.waiters[0].operationLocks[0].operationId = otherOperationId }],
    ['wrong advisory key', (g: ReturnType<typeof evidence>) => { g.waiters[0].operationLocks[0].key = '999' }],
    ['wrong key tag', (g: ReturnType<typeof evidence>) => { g.operationKeys[0].classId = '1' }],
    ['wrong lock type', (g: ReturnType<typeof evidence>) => { g.waiters[0].operationLocks[0].mode = 'ShareLock' }],
    ['already granted create lock', (g: ReturnType<typeof evidence>) => { g.waiters[0].operationLocks[0].granted = true }],
    ['missing owner lock', (g: ReturnType<typeof evidence>) => { g.ownerOperationLockGranted = false }],
  ])('rejects %s', (_name, mutate) => {
    const f = fixture(), gate = evidence(f)
    ;(mutate as (g: ReturnType<typeof evidence>) => void)(gate)
    expect(() => validateCoreCalculationOverlap(gate, responses(f), f)).toThrow()
  })
  it('requires the update retry to wait through its peer holding the same operation lock', () => {
    const f = fixture('update-retry'), gate = evidence(f)
    gate.waiters[1].operationLocks[0].granted = true
    expect(() => validateCoreCalculationOverlap(gate, responses(f), f)).toThrow()
  })
  it('requires both racing updates to hold distinct operation locks behind the exact parent', () => {
    const f = fixture('update-race'), gate = evidence(f)
    gate.waiters[1].operationLocks[0] = { ...gate.waiters[0].operationLocks[0] }
    expect(() => validateCoreCalculationOverlap(gate, responses(f), f)).toThrow()
  })
  it('rejects an update proof for another parent', () => {
    const f = fixture('update-race'), gate = { ...evidence(f), calculationId: operationId }
    expect(() => validateCoreCalculationOverlap(gate, responses(f), f)).toThrow()
  })
  it.each([
    ['disjoint local intervals', (r: ReturnType<typeof responses>) => { r[1].startedMonotonicMs = 1435; r[1].finishedMonotonicMs = 1500 }],
    ['touching local intervals', (r: ReturnType<typeof responses>) => { r[1].startedMonotonicMs = 1434; r[1].finishedMonotonicMs = 1500 }],
    ['missing monotonic sample', (r: ReturnType<typeof responses>) => { r[1].startedMonotonicMs = NaN }],
    ['wrong submitted operation', (r: ReturnType<typeof responses>) => { r[1].operationId = otherOperationId }],
    ['same client twice', (r: ReturnType<typeof responses>) => { r[1].client = 'A' }],
  ])('rejects %s', (_name, mutate) => {
    const f = fixture(), http = responses(f)
    ;(mutate as (r: ReturnType<typeof responses>) => void)(http)
    expect(() => validateCoreCalculationOverlap(evidence(f), http, f)).toThrow()
  })
})

const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    const absolute = resolve(directory), within = relative(resolve(tmpdir()), absolute)
    if (!within || within.startsWith('..') || isAbsolute(within) || !within.startsWith('diriqo-corecalc-proof-')) throw new Error('Unsafe test cleanup path')
    await rm(absolute, { recursive: true, force: true })
  }
})
describe('one-time run protection before Auth or environment reads', () => {
  it.each(['existing-output', 'existing-barrier', 'existing-claim'])('does not overwrite %s or dispatch', async existing => {
    const directory = await mkdtemp(join(tmpdir(), 'diriqo-corecalc-proof-'))
    temporaryDirectories.push(directory)
    const f = { ...fixture(), runId: randomUUID(), profileId: randomUUID(), input: {
      title: 'TEST-CORE-CALCULATION-guard', customer_id: null, items: [
        { item_type: 'customer', unit_price: '0' }, { item_type: 'material', unit_cost: '1' },
      ],
    } }
    const fixturePath = join(directory, 'private.json'), output = join(directory, 'report.json'), barrier = join(directory, 'observation.json')
    const claim = join(directory, 'core-calculation-run-' + f.runId + '.claim.json')
    await writeFile(fixturePath, JSON.stringify({ email: 'core-calculation-concurrency-' + randomUUID() + '@example.invalid', password: 'synthetic-local-only', fixture: f }))
    const protectedFile = existing === 'existing-output' ? output : existing === 'existing-barrier' ? barrier : claim
    await writeFile(protectedFile, 'DO NOT OVERWRITE')
    const run = spawnSync(process.execPath, ['--', resolve('scripts/test-core-calculation-save-concurrency.mjs'),
      '--fixture=' + fixturePath, '--output=' + output, '--barrier=' + barrier, '--env-file=' + join(directory, 'MUST-NOT-BE-READ.env')],
    { encoding: 'utf8', timeout: 5000, windowsHide: true })
    expect(run.status, run.stderr).toBe(1)
    expect(await readFile(protectedFile, 'utf8')).toBe('DO NOT OVERWRITE')
    expect(run.stdout + run.stderr).not.toContain('synthetic-local-only')
    expect(run.stdout + run.stderr).not.toContain('@example.invalid')
    if (existing !== 'existing-output') await expect(access(output)).rejects.toThrow()
    const finalLine = run.stdout.trim().split(/\r?\n/).at(-1)!
    expect(JSON.parse(finalLine)).toMatchObject({ passed: false, loggedOutSessions: 0, failureStage: 'configuration' })
  })
})


describe('fresh one-time invocation control', () => {
  it('accepts the synthetic fixture, claims it, then fails at the deliberately absent environment file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diriqo-corecalc-proof-'))
    temporaryDirectories.push(directory)
    const f = { ...fixture(), runId: randomUUID(), profileId: randomUUID(), input: {
      title: 'TEST-CORE-CALCULATION-guard', customer_id: null, items: [
        { item_type: 'customer', unit_price: '0' }, { item_type: 'material', unit_cost: '1' },
      ],
    } }
    const fixturePath = join(directory, 'private.json'), output = join(directory, 'report.json'), barrier = join(directory, 'observation.json')
    await writeFile(fixturePath, JSON.stringify({ email: 'core-calculation-concurrency-' + randomUUID() + '@example.invalid', password: 'synthetic-local-only', fixture: f }))
    const run = spawnSync(process.execPath, ['--', resolve('scripts/test-core-calculation-save-concurrency.mjs'),
      '--fixture=' + fixturePath, '--output=' + output, '--barrier=' + barrier, '--env-file=' + join(directory, 'MUST-NOT-BE-READ.env')],
    { encoding: 'utf8', timeout: 5000, windowsHide: true })
    expect(run.status, run.stderr).toBe(1)
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ oneTimeRunClaim: true, passed: false, loggedOutSessions: 0, failureStage: 'configuration' })
    expect(JSON.parse(await readFile(join(directory, 'core-calculation-run-' + f.runId + '.claim.json'), 'utf8'))).toMatchObject({ runId: f.runId, operationId: f.operationId, companyId: f.companyId })
    await expect(access(barrier)).rejects.toThrow()
    expect(run.stdout + run.stderr).not.toContain('synthetic-local-only')
    expect(run.stdout + run.stderr).not.toContain('@example.invalid')
  })
  it('validates pg_locks high and low tags for a negative signed advisory bigint', () => {
    const f = fixture(), gate = evidence(f)
    Object.assign(gate.operationKeys[0], { key: '-1', classId: '4294967295', objectId: '4294967295' })
    for (const waiter of gate.waiters) waiter.operationLocks[0].key = '-1'
    expect(validateCoreCalculationOverlap(gate, responses(f), f)).toMatchObject({ verified: true })
  })
})