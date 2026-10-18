// Diriqo TEST only. This consumes pre-created, explicitly synthetic fixtures.
// It records financial evidence but never performs a transfer or deduction.
// Usage: node scripts/test-worker-advance-concurrency.mjs --fixture=<private.json>
//   --output=<new-evidence.json> --mode=payout-overlap --request-delay-ms=15000
// Optional --env-file=<private .env.local>; default is the checkout's .env.local.
// Modes: payout-overlap, payout-retry, shared-limit, settlement-overlap.
// Private fixture JSON:
// {email,password,fixture:{companyId,companyName,profileId,requestId,
//   controlCompanyId,controlCompanyName,paymentId?,issuedOn:"YYYY-MM-DD"}}
// email must start worker-advance-concurrency- and end @example.invalid.
// Both company names must start "Synthetic advance concurrency ". The synthetic
// administrator must belong to BOTH companies; control company needs a request.
// Each mode needs fresh fixture state. requestId is approved with a positive
// remaining amount. settlement-overlap also needs paymentId with an unpaid balance.
// Root owns setup and preserved history; this script creates no user/tenant/DDL.
// Root separately holds pg_advisory_xact_lock(hashtextextended(
//   'advance-worker:'||companyId||':'||profileId,0)), observes the two waiting
// authenticator backends (including transitive wait chains), then releases it.
// HTTP timing alone does NOT prove overlapping database transactions.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
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
const mode = args['--mode']
assert(['payout-overlap', 'payout-retry', 'shared-limit', 'settlement-overlap'].includes(mode), 'Explicit supported mode required')
assert(args['--fixture'] && args['--output'], 'Private fixture and evidence paths required')
const output = path.resolve(args['--output'])
const envPath = path.resolve(args['--env-file'] || path.join(root, '.env.local'))
assert(output !== path.resolve(args['--fixture']) && output !== envPath, 'Evidence must not overwrite credentials')
const requestDelayMs = Number(args['--request-delay-ms'] ?? 15000)
assert(Number.isInteger(requestDelayMs) && requestDelayMs >= 0 && requestDelayMs <= 45000, 'Delay must be 0..45000ms')
const auth = JSON.parse(await fs.readFile(args['--fixture'], 'utf8'))
assert(/^worker-advance-concurrency-[^@]+@example\.invalid$/.test(auth.email), 'Dedicated synthetic account required')
assert(typeof auth.password === 'string' && auth.password.length > 0, 'Private fixture password required')
const f = auth.fixture
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
assert(f && [f.companyId, f.controlCompanyId, f.profileId, f.requestId].every(v => typeof v === 'string' && uuid.test(v)), 'Fixture UUIDs required')
assert(f.companyId !== f.controlCompanyId, 'Separate control company required')
assert([f.companyName, f.controlCompanyName].every(v => typeof v === 'string' && v.startsWith('Synthetic advance concurrency ')), 'Explicit synthetic company names required')
assert(typeof f.issuedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.issuedOn), 'Explicit recording date required')
if (mode === 'settlement-overlap') assert(uuid.test(f.paymentId), 'Fixture paymentId required for settlement race')
const env = Object.fromEntries((await fs.readFile(envPath, 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, '')]))
assert(env.NEXT_PUBLIC_SUPABASE_URL === url, 'Wrong Supabase project')
assert(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Missing public Supabase API key')
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Connection: 'close' }
const tokens = []
const sessionIds = []
let userId
let outputOwned = false
const report = { project, mode, passed: false, startedAt: new Date().toISOString(), requestDelayMs,
  databaseOverlapEvidence: 'REQUIRED_SEPARATE_OWNER_LOCK_BARRIER', realTransferPerformed: false }
const cents = value => {
  const text = String(value)
  assert(/^\d+(?:\.\d{1,2})?$/.test(text), 'Expected nonnegative decimal money')
  const [whole, fraction = ''] = text.split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  assert(Number.isSafeInteger(result), 'Money outside exact supported range')
  return result
}
const decimal = value => `${Math.trunc(value / 100)}.${String(value % 100).padStart(2, '0')}`
const sum = rows => rows.reduce((total, row) => total + cents(row.amount), 0)
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const raceAmount = balance => {
  assert(balance >= 100 && balance <= 1000000, 'Use a fresh synthetic balance of 1..10000 currency units')
  return Math.floor(balance * 3 / 4)
}
const isError = (response, message) => response.status !== 200 && response.data?.message === message
async function getRows(token, table, companyId, select = '*') {
  const response = await fetch(`${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&company_id=eq.${companyId}&order=id.asc`, {
    headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  })
  assert(response.status === 200, `Fixture ${table} read failed (HTTP ${response.status})`)
  const rows = await response.json()
  assert(Array.isArray(rows) && rows.length <= 20, 'Only small synthetic fixture tenants may be used')
  return rows
}
async function snapshot(token, companyId) {
  const [requests, payments, settlements, companySettings, workerSettings] = await Promise.all([
    getRows(token, 'advance_requests', companyId), getRows(token, 'worker_advances', companyId),
    getRows(token, 'worker_advance_settlements', companyId), getRows(token, 'company_payroll_settings', companyId),
    getRows(token, 'worker_payment_settings', companyId),
  ])
  return { requests, payments, settlements, companySettings, workerSettings }
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
    return { status: null, transportError: true, started, finished: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start) }
  }
}
const publicResponse = response => ({ status: response.status, started: response.started, finished: response.finished,
  elapsedMs: response.elapsedMs, changed: response.data?.changed, transportError: Boolean(response.transportError),
  errorCode: response.status !== 200 ? response.data?.code : undefined,
  errorMessage: response.status !== 200 && /^[A-Z_]+$/.test(response.data?.message ?? '') ? response.data.message : undefined })

try {
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify({ email: auth.email, password: auth.password }), signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Synthetic login failed (HTTP ${response.status})`)
    const session = await response.json()
    assert(typeof session.access_token === 'string' && session.user?.id, 'Incomplete Auth response')
    tokens.push(session.access_token)
    assert(!userId || userId === session.user.id, 'Both sessions must belong to the same synthetic administrator')
    userId = session.user.id
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'))
    assert(claims.role === 'authenticated' && typeof claims.session_id === 'string', 'Expected authenticated session')
    sessionIds.push(claims.session_id)
  }
  assert(sessionIds[0] !== sessionIds[1], 'Two distinct Auth sessions required')
  for (const [id, name] of [[f.companyId, f.companyName], [f.controlCompanyId, f.controlCompanyName]]) {
    const response = await fetch(`${url}/rest/v1/companies?select=id,name&id=eq.${id}`, {
      headers: { ...headers, Authorization: `Bearer ${tokens[0]}` }, signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, 'Synthetic company identity read failed')
    const rows = await response.json()
    assert(rows.length === 1 && rows[0].id === id && rows[0].name === name, 'Exact synthetic company identity required')
  }
  const before = await snapshot(tokens[0], f.companyId)
  const controlBefore = await snapshot(tokens[0], f.controlCompanyId)
  assert(controlBefore.requests.length > 0, 'Control tenant must have visible synthetic data for a meaningful fingerprint')
  assert(before.requests.every(row => row.company_id === f.companyId) && before.payments.every(row => row.company_id === f.companyId), 'Tenant scope mismatch')
  const request = before.requests.find(row => row.id === f.requestId)
  assert(request && request.profile_id === f.profileId && request.status === 'approved', 'Fixture requires the intended approved request')
  assert(Number.isSafeInteger(Number(request.revision)), 'Fixture revision must be exact')
  const linkedBefore = before.payments.filter(row => row.advance_request_id === f.requestId)
  const remaining = cents(request.amount) - sum(linkedBefore)
  const payment = mode === 'settlement-overlap' ? before.payments.find(row => row.id === f.paymentId) : null
  if (payment) assert(payment.profile_id === f.profileId && payment.operation_id, 'Settlement requires a new canonical payment for the same worker')
  const paymentSettlements = payment ? before.settlements.filter(row => row.worker_advance_id === payment.id) : []
  let amount = mode === 'settlement-overlap' ? raceAmount(cents(payment?.amount) - sum(paymentSettlements)) : raceAmount(remaining)
  if (mode === 'shared-limit') {
    assert(before.companySettings.length === 1, 'Shared-limit fixture needs explicit canonical company settings')
    const company = before.companySettings[0]
    const worker = before.workerSettings.find(row => row.profile_id === f.profileId && row.is_active)
    assert((worker?.advances_enabled_override ?? company.advances_enabled) === true, 'Fixture advances must be enabled')
    const limit = worker?.advance_limit_amount_override ?? company.advance_limit_amount
    assert(limit !== null && limit !== undefined, 'Shared-limit fixture needs an explicit finite amount limit')
    const used = sum(before.payments.filter(row => row.profile_id === f.profileId && row.payroll_month === `${f.issuedOn.slice(0, 7)}-01`))
    amount = raceAmount(cents(limit) - used)
    assert(remaining >= amount, 'Request approval must cover a candidate shared-limit payout')
  }
  const operationA = randomUUID()
  const operationB = mode === 'payout-retry' ? operationA : randomUUID()
  const method = mode === 'settlement-overlap' ? 'settle_worker_advance_atomic' : 'pay_worker_advance_atomic'
  const attempts = [operationA, operationB].map((operationId, index) => ({
    label: index === 0 ? 'A' : 'B',
    body: mode === 'settlement-overlap' ? {
      target_company_id: f.companyId, target_payment_id: f.paymentId, operation_id: operationId,
      settlement_amount: decimal(amount), settlement_method: index === 0 ? 'returned' : 'payroll_offset',
      settlement_reference: `SYNTHETIC-${mode}-${index}`, settled_on: f.issuedOn,
    } : {
      target_company_id: f.companyId, target_profile_id: f.profileId,
      target_request_id: mode === 'shared-limit' && index === 1 ? null : f.requestId,
      operation_id: operationId, payment_amount: decimal(amount), issued_on: f.issuedOn,
      payment_note: `SYNTHETIC-${mode}-${mode === 'payout-retry' ? 'same' : index}`,
      expected_revision: Number(request.revision), payment_method: 'cash', payment_reference: 'SYNTHETIC-RECORD-ONLY',
    },
  }))
  Object.assign(report, { companyId: f.companyId, profileId: f.profileId, requestId: f.requestId,
    twoAuthenticatedHttpSessions: true, distinctAuthSessions: true, role: 'authenticated',
    beforeFingerprint: fingerprint(before), controlBeforeFingerprint: fingerprint(controlBefore), attempts,
    barrierKey: `advance-worker:${f.companyId}:${f.profileId}` })
  // Persist exact operation IDs before sending anything, so a lost response never
  // encourages retrying with a newly generated operation ID.
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  outputOwned = true
  console.log(JSON.stringify({ ready: true, project, mode, requestDelayMs, barrierKey: report.barrierKey, at: new Date().toISOString() }))
  await delay(requestDelayMs)
  const responses = await Promise.all(attempts.map((attempt, i) => rpc(tokens[i], method, attempt.body)))
  report.responses = responses.map(publicResponse)
  assert(responses.every(response => !response.transportError), 'Indeterminate response: inspect stored operation IDs and database state; do not replay with new IDs')
  const successful = responses.filter(response => response.status === 200 && response.data?.changed === true)
  assert(successful.length === 1, 'Exactly one new financial event must commit')
  if (mode === 'payout-retry') {
    assert(responses.every(response => response.status === 200) && responses.filter(response => response.data.changed === false).length === 1,
      'Same operation must return one insertion and one exact replay')
    assert(isDeepStrictEqual(responses[0].data.payment, responses[1].data.payment), 'Both responses must return the same immutable payment')
  } else {
    const expected = mode === 'settlement-overlap' ? 'ADVANCE_SETTLEMENT_EXCEEDED' : mode === 'shared-limit' ? 'ADVANCE_LIMIT_EXCEEDED' : 'ADVANCE_STALE'
    assert(responses.filter(response => isError(response, expected)).length === 1, `Losing operation must return ${expected}`)
  }
  const after = await snapshot(tokens[1], f.companyId)
  const afterRequest = after.requests.find(row => row.id === f.requestId)
  if (mode === 'settlement-overlap') {
    assert(isDeepStrictEqual(after.requests, before.requests) && isDeepStrictEqual(after.payments, before.payments), 'Settlement must not rewrite requests or payments')
    const additions = after.settlements.filter(row => !before.settlements.some(old => old.id === row.id))
    assert(additions.length === 1 && additions[0].worker_advance_id === f.paymentId && cents(additions[0].amount) === amount,
      'Exactly one complete settlement must be added')
    assert(isDeepStrictEqual(after.settlements.filter(row => before.settlements.some(old => old.id === row.id)), before.settlements),
      'Existing settlement history changed')
    assert(sum(after.settlements.filter(row => row.worker_advance_id === f.paymentId)) <= cents(payment.amount), 'Settlement exceeded paid amount')
  } else {
    const additions = after.payments.filter(row => !before.payments.some(old => old.id === row.id))
    assert(additions.length === 1 && cents(additions[0].amount) === amount && additions[0].company_id === f.companyId
      && additions[0].profile_id === f.profileId && additions[0].payroll_month === `${f.issuedOn.slice(0, 7)}-01`, 'Exactly one canonical scoped payment must be added')
    assert(isDeepStrictEqual(after.payments.filter(row => before.payments.some(old => old.id === row.id)), before.payments), 'Existing payment history changed')
    assert(isDeepStrictEqual(after.requests.filter(row => row.id !== f.requestId), before.requests.filter(row => row.id !== f.requestId)), 'Unrelated request changed')
    assert(isDeepStrictEqual(after.settlements, before.settlements), 'Payout must not create a settlement')
    assert(sum(after.payments.filter(row => row.advance_request_id === f.requestId)) <= cents(request.amount), 'Approved amount exceeded')
    assert(afterRequest.requested_amount === request.requested_amount && afterRequest.amount === request.amount, 'Request or approved amount rewritten')
    const stableRequest = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['status', 'paid_at', 'updated_at', 'revision'].includes(key)))
    assert(isDeepStrictEqual(stableRequest(afterRequest), stableRequest(request)), 'Request identity, currency or approval evidence changed')
    if (additions[0].advance_request_id === null) assert(isDeepStrictEqual(afterRequest, request), 'Manual payout changed the unrelated request')
    else assert(Number(afterRequest.revision) === Number(request.revision) + 1, 'Linked payout must commit exactly one request revision')
  }
  assert(isDeepStrictEqual(after.companySettings, before.companySettings) && isDeepStrictEqual(after.workerSettings, before.workerSettings), 'Settings changed during race')
  const winner = responses.findIndex(response => response.status === 200 && response.data.changed === true)
  const retry = await rpc(tokens[0], method, attempts[winner].body)
  assert(retry.status === 200 && retry.data.changed === false, 'Original operation must be retryable after commit')
  const eventKey = mode === 'settlement-overlap' ? 'settlement' : 'payment'
  assert(isDeepStrictEqual(retry.data[eventKey], responses[winner].data[eventKey]), 'Replay must preserve original identity, amount and timestamp')
  assert(isDeepStrictEqual(await snapshot(tokens[0], f.companyId), after), 'Exact replay changed persisted state')
  const amountKey = mode === 'settlement-overlap' ? 'settlement_amount' : 'payment_amount'
  const mismatch = await rpc(tokens[1], method, { ...attempts[winner].body, [amountKey]: decimal(amount + 1) })
  assert(isError(mismatch, 'ADVANCE_OPERATION_CONFLICT'), 'Same operation with changed payload must conflict')
  if (mode === 'payout-overlap') {
    const loser = 1 - winner
    const overpayment = await rpc(tokens[1], method, { ...attempts[loser].body, expected_revision: Number(afterRequest.revision) })
    assert(isError(overpayment, 'ADVANCE_BALANCE_EXCEEDED'), 'Fresh-revision retry must still respect approved balance')
    report.freshRevisionOverpaymentRejected = true
  }
  const wrongTenant = await rpc(tokens[1], method, { ...attempts[winner].body,
    ...(mode === 'settlement-overlap' ? {} : { target_request_id: f.requestId }),
    target_company_id: f.controlCompanyId, operation_id: randomUUID() })
  assert(isError(wrongTenant, 'ADVANCE_NOT_FOUND') || isError(wrongTenant, 'ADVANCE_WORKER_UNAVAILABLE'), 'Wrong company scope must reject the target')
  const final = await snapshot(tokens[0], f.companyId)
  const controlAfter = await snapshot(tokens[1], f.controlCompanyId)
  assert(isDeepStrictEqual(final, after), 'Rejected retries or wrong-tenant call changed target state')
  assert(isDeepStrictEqual(controlAfter, controlBefore), 'Control tenant state changed')
  Object.assign(report, { assertionsPassed: true, winner: attempts[winner].label, committedFinancialEvents: 1,
    originalRetryPreserved: true, changedPayloadRejected: true, wrongTenantRejected: true,
    afterFingerprint: fingerprint(final), controlAfterFingerprint: fingerprint(controlAfter), controlTenantUnchanged: true,
    responses: responses.map(publicResponse) })
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Unknown verification failure'
  process.exitCode = 1
} finally {
  const logout = await Promise.allSettled(tokens.map(token => fetch(`${url}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  })))
  report.loggedOutSessions = logout.filter(result => result.status === 'fulfilled' && result.value.ok).length
  report.passed = Boolean(report.assertionsPassed) && report.loggedOutSessions === tokens.length && tokens.length === 2
  report.finishedAt = new Date().toISOString()
  if (!report.passed) process.exitCode = 1
  if (outputOwned) await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
