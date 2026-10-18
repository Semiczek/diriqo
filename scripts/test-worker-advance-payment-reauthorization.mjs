// Diriqo TEST only. Prepared owner-controlled licence-wait proof; no owner writes here.
// Usage: node scripts/test-worker-advance-payment-reauthorization.mjs
//   --fixture=<private.json> --output=<new-evidence.json>
//   --barrier=rollout|test-grant|paid-receipt --change=admin-revoke|subject-revoke|grant-revoke|expiry
//   --request-delay-ms=15000 [--env-file=<private.env>]
// Expiry only: --expiry-lead-ms=3000 derives the delay after the capability probe.
// Private fixture: {administrator:{email,password},observer:{email,password},fixture:{
// companyId,companyName,controlCompanyId,controlCompanyName,administratorProfileId,
// observerProfileId,workerProfileId,operationId,issuedOn,grantValidUntil?}}
// Dedicated synthetic accounts/tenants only, distinct observer administrator.
// Owner must prove pg_blocking_pids overlap, change only the declared synthetic
// authorization and release before the existing 8s database timeout. No ALTER ROLE.
// Paid receipts are immutable: no bypass to manufacture paid revocation fixtures.
// See docs/worker-advances-preflight-20261018.md for owner barriers and constraints.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const project = 'wfcpfraxiuhuglnuaxqj'
const url = `https://${project}.supabase.co`
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const i = arg.indexOf('=')
  assert(i > 0, 'Use --name=value arguments')
  return [arg.slice(0, i), arg.slice(i + 1)]
}))
const barrier = args['--barrier']
const change = args['--change']
assert(['rollout', 'test-grant', 'paid-receipt'].includes(barrier), 'Explicit rollout, test-grant or paid-receipt barrier required')
assert(['admin-revoke', 'subject-revoke', 'grant-revoke', 'expiry'].includes(change), 'Explicit admin-revoke, subject-revoke, grant-revoke or expiry required')
assert(!(barrier === 'paid-receipt' && change === 'grant-revoke'), 'Paid receipts are immutable; do not bypass constraints to simulate revocation')
assert(args['--fixture'] && args['--output'], 'Private fixture and evidence paths required')
const output = path.resolve(args['--output'])
const envPath = path.resolve(args['--env-file'] || path.join(root, '.env.local'))
assert(output !== path.resolve(args['--fixture']) && output !== envPath, 'Evidence must not overwrite credentials')
let requestDelayMs = Number(args['--request-delay-ms'] ?? 15000)
assert(Number.isInteger(requestDelayMs) && requestDelayMs >= 0 && requestDelayMs <= 45000, 'Delay must be 0..45000ms')
const expiryLeadMs = args['--expiry-lead-ms'] === undefined ? undefined : Number(args['--expiry-lead-ms'])
if (expiryLeadMs !== undefined) {
  assert(change === 'expiry', '--expiry-lead-ms requires --change=expiry')
  assert(Number.isInteger(expiryLeadMs) && expiryLeadMs >= 1000 && expiryLeadMs <= 6000,
    'Expiry lead must be an integer 1000..6000ms')
}
const auth = JSON.parse(await fs.readFile(args['--fixture'], 'utf8'))
for (const account of [auth.administrator, auth.observer]) {
  assert(/^worker-advance-concurrency-[^@]+@example\.invalid$/.test(account?.email), 'Dedicated synthetic accounts required')
  assert(typeof account.password === 'string' && account.password.length > 0, 'Private passwords required')
}
assert(auth.administrator.email !== auth.observer.email, 'Administrator and observer must be distinct accounts')
const f = auth.fixture
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
assert(f && [f.companyId, f.controlCompanyId, f.administratorProfileId, f.observerProfileId, f.workerProfileId, f.operationId]
  .every(v => typeof v === 'string' && uuid.test(v)), 'Fixture UUIDs required')
assert(f.companyId !== f.controlCompanyId && f.administratorProfileId !== f.observerProfileId, 'Distinct tenants and actors required')
assert(![f.administratorProfileId, f.observerProfileId].includes(f.workerProfileId), 'Subject must be a separate synthetic worker')
assert(/^\d{4}-\d{2}-\d{2}$/.test(f.issuedOn ?? '') && Number.isFinite(Date.parse(f.issuedOn)), 'Explicit recording date required')
assert([f.companyName, f.controlCompanyName].every(v => typeof v === 'string'
  && v.startsWith('Synthetic advance concurrency ')), 'Exact synthetic tenant names required')
if (change === 'expiry') assert(Number.isFinite(Date.parse(f.grantValidUntil)), 'Explicit owner-created test grant deadline required')
const env = Object.fromEntries((await fs.readFile(envPath, 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, '')]))
assert(env.NEXT_PUBLIC_SUPABASE_URL === url && env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Diriqo test project public credentials required')
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Connection: 'close' }
const sessions = []
let outputOwned = false
const barrierTable = { rollout: 'private.company_module_rollouts', 'test-grant': 'private.company_test_module_grants', 'paid-receipt': 'public.company_module_entitlements' }[barrier]
const report = { project, barrier, barrierTable, change, passed: false, startedAt: new Date().toISOString(),
  databaseOverlapEvidence: 'REQUIRED_SEPARATE_OWNER_LOCK_BARRIER', realTransferPerformed: false }
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
async function rows(token, table, filter) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&${filter}&order=id.asc`, {
    headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  })
  assert(response.status === 200, `Fixture ${table} read failed (HTTP ${response.status})`)
  const result = await response.json()
  assert(Array.isArray(result) && result.length <= 20, 'Use only small synthetic tenants')
  return result
}
async function financialSnapshot(token, companyId) {
  const result = {}
  for (const table of ['advance_requests', 'worker_advances', 'worker_advance_settlements']) {
    result[table] = await rows(token, table, `company_id=eq.${companyId}`)
    assert(result[table].every(row => row.company_id === companyId), 'Financial snapshot tenant mismatch')
  }
  return result
}
async function rpc(token, name, body) {
  const started = new Date().toISOString()
  const start = performance.now()
  try {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    })
    return { status: response.status, data: await response.json(), started, finished: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - start) }
  } catch {
    return { status: null, transportError: true, started, finished: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - start) }
  }
}
try {
  for (const account of [auth.administrator, auth.observer]) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify(account), signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Synthetic login failed (HTTP ${response.status})`)
    const session = await response.json()
    assert(typeof session.access_token === 'string' && session.user?.id, 'Incomplete Auth response')
    sessions.push({ token: session.access_token, userId: session.user.id })
  }
  const [administrator, observer] = sessions
  assert(administrator.userId !== observer.userId, 'Caller must not be the observer administrator')
  for (const [profileId, userId] of [[f.administratorProfileId, administrator.userId], [f.observerProfileId, observer.userId]]) {
    const result = await rows(observer.token, 'profiles', `id=eq.${profileId}`)
    assert(result.length === 1 && result[0].auth_user_id === userId && result[0].is_active === true, 'Exact active synthetic actor required')
  }
  for (const [id, name] of [[f.companyId, f.companyName], [f.controlCompanyId, f.controlCompanyName]]) {
    const company = await rows(observer.token, 'companies', `id=eq.${id}`)
    assert(company.length === 1 && company[0].name === name, 'Exact synthetic tenant identity required')
    const members = await rows(observer.token, 'company_members', `company_id=eq.${id}`)
    assert(members.some(row => row.profile_id === f.observerProfileId && row.role === 'company_admin' && row.is_active), 'Observer must be active company admin')
    if (id === f.companyId) {
      assert(members.some(row => row.profile_id === f.administratorProfileId && row.role === 'company_admin' && row.is_active), 'Actual caller must be an active company administrator')
      assert(members.some(row => row.profile_id === f.workerProfileId && row.role === 'worker' && row.is_active), 'Subject must be an active company worker')
    }
  }
  const subject = await rows(observer.token, 'profiles', `id=eq.${f.workerProfileId}`)
  assert(subject.length === 1 && subject[0].is_active === true, 'Subject profile must be active')
  const settings = await rows(observer.token, 'company_payroll_settings', `company_id=eq.${f.companyId}`)
  const workerSettings = await rows(observer.token, 'worker_payment_settings', `company_id=eq.${f.companyId}`)
  assert(settings.length === 1, 'Barrier fixture requires a canonical company settings row')
  const override = workerSettings.find(row => row.profile_id === f.workerProfileId && row.is_active)
  assert((override?.advances_enabled_override ?? settings[0].advances_enabled) === true, 'Fixture payments must be enabled')
  assert(override?.advance_limit_amount_override != null || settings[0].advance_limit_type === 'monthly_amount', 'Use an implemented amount-limit fixture')
  const before = await financialSnapshot(observer.token, f.companyId)
  const controlBefore = await financialSnapshot(observer.token, f.controlCompanyId)
  assert(before.advance_requests.some(row => row.profile_id === f.workerProfileId)
    && controlBefore.advance_requests.length > 0, 'Both tenant fingerprints require existing visible fixture evidence')
  assert(!before.worker_advances.some(row => row.operation_id === f.operationId), 'Payment operation must be fresh')
  const limit = override?.advance_limit_amount_override ?? settings[0].advance_limit_amount
  const used = before.worker_advances.filter(row => row.profile_id === f.workerProfileId && row.payroll_month === `${f.issuedOn.slice(0, 7)}-01`)
    .reduce((sum, row) => sum + Number(row.amount), 0)
  assert(limit == null || (Number.isFinite(Number(limit)) && used + 1 <= Number(limit)), 'Fixture must have room for the attempted 1.00 payment')
  const capability = await rpc(administrator.token, 'get_company_capability_access', {
    target_company_id: f.companyId, target_capability: 'core.advances.pay',
  })
  assert(capability.status === 200 && capability.data?.allowed === true, 'Administrator capability must be allowed before entering the barrier')
  assert(capability.data.enforced === true && capability.data.reason === (barrier === 'paid-receipt' ? 'paid' : 'test'), 'Fixture must use the declared enforced licence source')
  if (change === 'expiry') {
    assert(capability.data.enforced === true && capability.data.reason === (barrier === 'paid-receipt' ? 'paid' : 'test'), 'Expiry requires the expected enforced licence source')
    const until = Date.parse(f.grantValidUntil)
    const timingCheckedAt = Date.now()
    if (expiryLeadMs !== undefined) {
      requestDelayMs = until - timingCheckedAt - expiryLeadMs
      assert(Number.isInteger(requestDelayMs) && requestDelayMs >= 0 && requestDelayMs <= 45000,
        'Derived expiry delay must be 0..45000ms; prepare a fresh grant deadline')
    }
    assert(until > timingCheckedAt + requestDelayMs + 1000 && until < timingCheckedAt + requestDelayMs + 6000,
      'Set grant deadline 1..6 seconds after the planned RPC start; owner must observe the wait and release before the 8s database timeout')
  }
  const body = { target_company_id: f.companyId, target_profile_id: f.workerProfileId, target_request_id: null,
    operation_id: f.operationId, payment_amount: '1.00', issued_on: f.issuedOn,
    payment_note: `SYNTHETIC-${barrier}-${change}-WRITE-REAUTHORIZATION`, expected_revision: null,
    payment_method: 'cash', payment_reference: 'SYNTHETIC-RECORD-ONLY' }
  Object.assign(report, { companyId: f.companyId, administratorProfileId: f.administratorProfileId, workerProfileId: f.workerProfileId, operationId: f.operationId,
    requestDelayMs, expiryLeadMs, callerRole: 'company_admin', observerRole: 'company_admin', capabilityAllowedBefore: true,
    grantValidUntil: change === 'expiry' ? f.grantValidUntil : undefined, attempt: body,
    beforeFingerprint: fingerprint(before), controlBeforeFingerprint: fingerprint(controlBefore) })
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  outputOwned = true
  console.log(JSON.stringify({ ready: true, project, barrierTable, change, companyId: f.companyId,
    operationId: f.operationId, requestDelayMs, expiryLeadMs, at: new Date().toISOString() }))
  await delay(requestDelayMs)
  const result = await rpc(administrator.token, 'pay_worker_advance_atomic', body)
  report.response = { status: result.status, started: result.started, finished: result.finished,
    elapsedMs: result.elapsedMs, transportError: Boolean(result.transportError), errorCode: result.data?.code,
    errorMessage: /^[A-Z_]+$/.test(result.data?.message ?? '') ? result.data.message : undefined }
  assert(!result.transportError, 'Indeterminate request outcome: inspect the stored operationId; do not retry with a new ID')
  const expected = change === 'admin-revoke' ? 'ADVANCE_FORBIDDEN' : change === 'subject-revoke' ? 'ADVANCE_WORKER_UNAVAILABLE' : 'ADVANCE_MODULE_REQUIRED'
  assert(result.status !== 200 && result.data?.message === expected, `Queued administrator payment must fail with ${expected}`)
  const after = await financialSnapshot(observer.token, f.companyId)
  const controlAfter = await financialSnapshot(observer.token, f.controlCompanyId)
  assert(isDeepStrictEqual(after, before), 'Rejected in-flight payment changed target financial state')
  assert(isDeepStrictEqual(controlAfter, controlBefore), 'Control tenant state changed')
  assert(!after.worker_advances.some(row => row.operation_id === f.operationId), 'Unauthorized payment was persisted')
  Object.assign(report, { assertionsPassed: true, rejectedPaymentAbsent: true, targetFinancialStateUnchanged: true,
    controlTenantUnchanged: true, afterFingerprint: fingerprint(after), controlAfterFingerprint: fingerprint(controlAfter) })
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Unknown verification failure'
  process.exitCode = 1
} finally {
  const logout = await Promise.allSettled(sessions.map(session => fetch(`${url}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { ...headers, Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(15000),
  })))
  report.loggedOutSessions = logout.filter(result => result.status === 'fulfilled' && result.value.ok).length
  report.passed = Boolean(report.assertionsPassed) && report.loggedOutSessions === 2 && sessions.length === 2
  report.finishedAt = new Date().toISOString()
  if (!report.passed) process.exitCode = 1
  if (outputOwned) await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
