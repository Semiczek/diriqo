// Diriqo TEST only. Never run against customer accounts or live financial data.
// Prepare fixtures and an owner-session row lock separately; this script neither
// changes membership/licences nor opens a privileged database connection.
// Usage: node scripts/test-worker-advance-request-reauthorization.mjs
//   --fixture=<private.json> --output=<new-evidence.json>
//   --barrier=settings|company --change=revoke|expiry --request-delay-ms=15000
// Optional --env-file=<private .env.local>.
// Private JSON: {worker:{email,password},observer:{email,password},fixture:{
//   companyId,companyName,controlCompanyId,controlCompanyName,workerProfileId,
//   observerProfileId,requestId,grantValidUntil?}}
// Both emails: worker-advance-concurrency-...@example.invalid. The caller must
// have the worker role; a distinct observer is company_admin in both tenants.
// Both tenant names start "Synthetic advance concurrency ". A fresh requestId
// must not exist. Baseline tenants each need visible request evidence.
// The owner holds SELECT ... FOR UPDATE on company_payroll_settings or companies,
// observes the actual request backend waiting on that row lock, then revokes the
// worker membership in another transaction OR waits past grantValidUntil and
// releases the row lock. See docs/worker-advances-preflight-20261018.md.
// HTTP timing and these assertions alone are NOT evidence of the lock barrier.
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
assert(['settings', 'company'].includes(barrier), 'Explicit settings or company barrier required')
assert(['revoke', 'expiry'].includes(change), 'Explicit revoke or expiry scenario required')
assert(args['--fixture'] && args['--output'], 'Private fixture and evidence paths required')
const output = path.resolve(args['--output'])
const envPath = path.resolve(args['--env-file'] || path.join(root, '.env.local'))
assert(output !== path.resolve(args['--fixture']) && output !== envPath, 'Evidence must not overwrite credentials')
const requestDelayMs = Number(args['--request-delay-ms'] ?? 15000)
assert(Number.isInteger(requestDelayMs) && requestDelayMs >= 0 && requestDelayMs <= 45000, 'Delay must be 0..45000ms')
const auth = JSON.parse(await fs.readFile(args['--fixture'], 'utf8'))
for (const account of [auth.worker, auth.observer]) {
  assert(/^worker-advance-concurrency-[^@]+@example\.invalid$/.test(account?.email), 'Dedicated synthetic accounts required')
  assert(typeof account.password === 'string' && account.password.length > 0, 'Private passwords required')
}
assert(auth.worker.email !== auth.observer.email, 'Worker and observer must be distinct accounts')
const f = auth.fixture
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
assert(f && [f.companyId, f.controlCompanyId, f.workerProfileId, f.observerProfileId, f.requestId]
  .every(v => typeof v === 'string' && uuid.test(v)), 'Fixture UUIDs required')
assert(f.companyId !== f.controlCompanyId && f.workerProfileId !== f.observerProfileId, 'Distinct tenants and actors required')
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
const barrierTable = barrier === 'settings' ? 'company_payroll_settings' : 'companies'
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
  for (const account of [auth.worker, auth.observer]) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify(account), signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Synthetic login failed (HTTP ${response.status})`)
    const session = await response.json()
    assert(typeof session.access_token === 'string' && session.user?.id, 'Incomplete Auth response')
    sessions.push({ token: session.access_token, userId: session.user.id })
  }
  const [worker, observer] = sessions
  assert(worker.userId !== observer.userId, 'Caller must not be the observer administrator')
  for (const [profileId, userId] of [[f.workerProfileId, worker.userId], [f.observerProfileId, observer.userId]]) {
    const result = await rows(observer.token, 'profiles', `id=eq.${profileId}`)
    assert(result.length === 1 && result[0].auth_user_id === userId && result[0].is_active === true, 'Exact active synthetic actor required')
  }
  for (const [id, name] of [[f.companyId, f.companyName], [f.controlCompanyId, f.controlCompanyName]]) {
    const company = await rows(observer.token, 'companies', `id=eq.${id}`)
    assert(company.length === 1 && company[0].name === name, 'Exact synthetic tenant identity required')
    const members = await rows(observer.token, 'company_members', `company_id=eq.${id}`)
    assert(members.some(row => row.profile_id === f.observerProfileId && row.role === 'company_admin' && row.is_active), 'Observer must be active company admin')
    if (id === f.companyId) assert(members.some(row => row.profile_id === f.workerProfileId && row.role === 'worker' && row.is_active), 'Actual caller must be an active worker')
  }
  const settings = await rows(observer.token, 'company_payroll_settings', `company_id=eq.${f.companyId}`)
  const workerSettings = await rows(observer.token, 'worker_payment_settings', `company_id=eq.${f.companyId}`)
  assert(settings.length === 1, 'Barrier fixture requires a canonical company settings row')
  const override = workerSettings.find(row => row.profile_id === f.workerProfileId && row.is_active)
  assert((override?.advances_enabled_override ?? settings[0].advances_enabled) === true, 'Fixture requests must be enabled')
  const before = await financialSnapshot(observer.token, f.companyId)
  const controlBefore = await financialSnapshot(observer.token, f.controlCompanyId)
  assert(before.advance_requests.some(row => row.profile_id === f.workerProfileId)
    && controlBefore.advance_requests.length > 0, 'Both tenant fingerprints require existing visible fixture evidence')
  assert(!before.advance_requests.some(row => row.id === f.requestId), 'Request operation must be fresh')
  const capability = await rpc(worker.token, 'get_company_capability_access', {
    target_company_id: f.companyId, target_capability: 'core.advances.request',
  })
  assert(capability.status === 200 && capability.data?.allowed === true, 'Worker capability must be allowed before entering the barrier')
  if (change === 'expiry') {
    assert(capability.data.enforced === true && capability.data.reason === 'test', 'Expiry requires enforced nonfinancial test grant only')
    const until = Date.parse(f.grantValidUntil)
    assert(until > Date.now() + requestDelayMs + 1000 && until < Date.now() + requestDelayMs + 6000,
      'Set grant deadline 1..6 seconds after the planned RPC start; owner must observe the wait and release before the 8s database timeout')
  }
  const body = { target_company_id: f.companyId, target_request_id: f.requestId, requested_amount: '1.00',
    request_reason: `SYNTHETIC-${barrier}-${change}-WRITE-REAUTHORIZATION`, requested_for_month: null }
  Object.assign(report, { companyId: f.companyId, workerProfileId: f.workerProfileId, requestId: f.requestId,
    requestDelayMs, callerRole: 'worker', observerRole: 'company_admin', capabilityAllowedBefore: true,
    grantValidUntil: change === 'expiry' ? f.grantValidUntil : undefined, attempt: body,
    beforeFingerprint: fingerprint(before), controlBeforeFingerprint: fingerprint(controlBefore) })
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  outputOwned = true
  console.log(JSON.stringify({ ready: true, project, barrierTable, change, companyId: f.companyId,
    requestId: f.requestId, requestDelayMs, at: new Date().toISOString() }))
  await delay(requestDelayMs)
  const result = await rpc(worker.token, 'request_advance_atomic', body)
  report.response = { status: result.status, started: result.started, finished: result.finished,
    elapsedMs: result.elapsedMs, transportError: Boolean(result.transportError), errorCode: result.data?.code,
    errorMessage: /^[A-Z_]+$/.test(result.data?.message ?? '') ? result.data.message : undefined }
  assert(!result.transportError, 'Indeterminate request outcome: inspect the stored requestId; do not retry with a new ID')
  const expected = change === 'revoke' ? 'ADVANCE_FORBIDDEN' : 'ADVANCE_MODULE_REQUIRED'
  assert(result.status !== 200 && result.data?.message === expected, `Queued worker request must fail with ${expected}`)
  const after = await financialSnapshot(observer.token, f.companyId)
  const controlAfter = await financialSnapshot(observer.token, f.controlCompanyId)
  assert(isDeepStrictEqual(after, before), 'Rejected in-flight request changed target financial state')
  assert(isDeepStrictEqual(controlAfter, controlBefore), 'Control tenant state changed')
  assert(!after.advance_requests.some(row => row.id === f.requestId), 'Unauthorized request was persisted')
  Object.assign(report, { assertionsPassed: true, rejectedRequestAbsent: true, targetFinancialStateUnchanged: true,
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
