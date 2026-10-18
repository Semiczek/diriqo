// Authorized Diriqo TEST only. Two Auth sessions settle ONE synthetic issued invoice.
// Usage: node scripts/test-invoice-settlement-concurrency.mjs --fixture=<private.json>
//   --output=<evidence.json> --case=paid-paid|paid-cancel|cancel-paid
//   --request-delay-ms=15000 --stagger-ms=3000
// Private JSON: {email,password,fixture:{companyId,invoiceId,jobIds:[uuid,uuid]}}.
// Email: invoice-settlement-concurrency-...@example.invalid. Use a NEW issued
// invoice per run; both active jobs must be due and belong to that invoice/customer.
// Owner separately holds the invoice FOR UPDATE and observes two distinct waiting
// DB backends (including the blocking chain/order) before releasing its barrier.
// HTTP timing alone is not DB-overlap proof. First named operation must win.
// Issued/paid/cancelled test history is RETAINED in its dedicated synthetic tenant;
// never disable the history guard to clean up. Sessions are still logged out.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const project = 'wfcpfraxiuhuglnuaxqj'
const url = `https://${project}.supabase.co`
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const separator = arg.indexOf('=')
  assert(separator > 0, 'Use --name=value arguments')
  return [arg.slice(0, separator), arg.slice(separator + 1)]
}))
assert(args['--fixture'] && args['--output'], 'Provide private fixture and evidence output paths')
assert(path.resolve(args['--fixture']) !== path.resolve(args['--output']), 'Do not overwrite credentials with evidence')
const mode = args['--case']
assert(['paid-paid', 'paid-cancel', 'cancel-paid'].includes(mode), 'Select paid-paid, paid-cancel or cancel-paid')
const requestDelayMs = Number(args['--request-delay-ms'] ?? 15000)
const staggerMs = Number(args['--stagger-ms'] ?? 3000)
assert(Number.isInteger(requestDelayMs) && requestDelayMs >= 0 && requestDelayMs <= 45000, 'Delay must be 0..45000ms')
assert(Number.isInteger(staggerMs) && staggerMs >= 0 && staggerMs <= 10000, 'Stagger must be 0..10000ms')
const auth = JSON.parse(await fs.readFile(args['--fixture'], 'utf8'))
assert(typeof auth.email === 'string' && /^invoice-settlement-concurrency-[^@]+@example\.invalid$/.test(auth.email),
  'Dedicated synthetic account required')
assert(typeof auth.password === 'string' && auth.password.length > 0, 'Private fixture password required')
const f = auth.fixture
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
assert(f && Array.isArray(f.jobIds) && f.jobIds.length === 2
  && [f.companyId, f.invoiceId, ...f.jobIds].every(value => typeof value === 'string' && uuid.test(value)),
  'Company, invoice and two job UUIDs required')
assert(f.jobIds[0] !== f.jobIds[1], 'Two different job IDs required')
const jobIds = [...f.jobIds].sort()
const env = Object.fromEntries((await fs.readFile(path.join(root, '.env.local'), 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, '')]))
assert(env.NEXT_PUBLIC_SUPABASE_URL === url, 'Wrong test project')
assert(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Missing public Supabase API key')
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Connection: 'close' }
const tokens = []
const sessionIds = []
const actions = mode.split('-')
const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))
const same = isDeepStrictEqual
let userId
let report
try {
  for (let index = 0; index < 2; index++) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify({ email: auth.email, password: auth.password }),
      signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Synthetic login failed (HTTP ${response.status})`)
    const session = await response.json()
    assert(typeof session.access_token === 'string' && session.user?.id, 'Incomplete Auth response')
    tokens.push(session.access_token)
    assert(!userId || userId === session.user.id, 'Both sessions must belong to the same synthetic user')
    userId = session.user.id
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'))
    assert(claims.role === 'authenticated' && typeof claims.session_id === 'string', 'Expected authenticated session')
    sessionIds.push(claims.session_id)
  }
  assert(sessionIds[0] !== sessionIds[1], 'Two different Auth sessions required')
  async function readState(token) {
    const requestHeaders = { ...headers, Authorization: `Bearer ${token}` }
    const responses = await Promise.all([
      fetch(`${url}/rest/v1/rpc/get_invoice_edit_snapshot`, {
        method: 'POST', headers: requestHeaders,
        body: JSON.stringify({ target_company_id: f.companyId, target_invoice_id: f.invoiceId }),
        signal: AbortSignal.timeout(30000),
      }),
      fetch(`${url}/rest/v1/invoice_jobs?invoice_id=eq.${f.invoiceId}&company_id=eq.${f.companyId}&select=*&order=job_id.asc`,
        { headers: requestHeaders, signal: AbortSignal.timeout(30000) }),
      fetch(`${url}/rest/v1/jobs?company_id=eq.${f.companyId}&id=in.(${jobIds.join(',')})&select=*&order=id.asc`,
        { headers: requestHeaders, signal: AbortSignal.timeout(30000) }),
    ])
    assert(responses.every(response => response.status === 200), 'Independent state reads must succeed')
    const [snapshot, links, jobs] = await Promise.all(responses.map(response => response.json()))
    assert(snapshot.invoice?.id === f.invoiceId && snapshot.invoice.company_id === f.companyId,
      'Snapshot must belong to the configured tenant and invoice')
    assert(typeof snapshot.revision === 'string' && /^[a-f0-9]{64}$/.test(snapshot.revision), 'Expected opaque SHA256 revision')
    assert(Array.isArray(snapshot.items) && snapshot.items.length > 0, 'Synthetic invoice requires accounting items')
    assert(Array.isArray(links) && links.length === 2 && same(links.map(link => link.job_id), jobIds)
      && links.every(link => link.invoice_id === f.invoiceId && link.company_id === f.companyId
        && link.customer_id === snapshot.invoice.customer_id), 'Exactly the configured two invoice links required')
    assert(Array.isArray(jobs) && jobs.length === 2 && same(jobs.map(job => job.id), jobIds)
      && jobs.every(job => job.company_id === f.companyId && job.customer_id === snapshot.invoice.customer_id),
    'Exactly the configured two same-customer jobs required')
    return { ...snapshot, links, jobs }
  }
  const before = await readState(tokens[0])
  assert(before.invoice.status === 'issued' && before.invoice.issued_at && before.invoice.invoice_number
    && before.invoice.paid_at === null && before.invoice.cancelled_at === null, 'Use a fresh synthetic issued invoice')
  assert(before.invoice.pohoda_export_status === 'not_exported' && before.invoice.pohoda_exported_at === null
    && before.invoice.pohoda_external_id === null, 'No exported fixture may be tested')
  assert(before.links.every(link => link.is_active) && before.jobs.every(job => job.billing_status === 'due'
    && !job.is_paid && job.paid_at === null && job.invoiced_at === before.invoice.issued_at
    && job.due_date === before.invoice.due_date), 'Both jobs must be the complete due projection of this invoice')
  console.log(JSON.stringify({ ready: true, project, mode, requestDelayMs, staggerMs, at: new Date().toISOString() }))
  await delay(requestDelayMs)
  async function settle(index) {
    const action = actions[index]
    const started = new Date().toISOString()
    const start = performance.now()
    try {
      const rpc = action === 'paid' ? 'mark_invoice_paid_atomic' : 'cancel_invoice_atomic'
      const response = await fetch(`${url}/rest/v1/rpc/${rpc}`, {
        method: 'POST', headers: { ...headers, Authorization: `Bearer ${tokens[index]}` },
        body: JSON.stringify({ target_company_id: f.companyId, target_invoice_id: f.invoiceId,
          expected_revision: before.revision }), signal: AbortSignal.timeout(45000),
      })
      const data = await response.json()
      const success = response.status === 200 && data.invoice_id === f.invoiceId
        && data.status === (action === 'paid' ? 'paid' : 'cancelled') && typeof data.changed === 'boolean'
        && Array.isArray(data.job_ids)
      const knownError = ['INVOICE_CANCEL_PAID', 'INVOICE_INVALID_STATE', 'INVOICE_SETTLEMENT_STALE'].includes(data.message)
      return { label: index === 0 ? 'A' : 'B', action, started, finished: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - start), status: response.status, success,
        ...(success ? { changed: data.changed, paidAt: data.paid_at, cancelledAt: data.cancelled_at,
          jobIdsCorrect: same(data.job_ids, data.changed ? jobIds : []) }
          : { errorCode: typeof data.code === 'string' && /^[A-Z0-9]{5}$/.test(data.code) ? data.code : 'unexpected',
            errorMessage: knownError ? data.message : 'unexpected' }) }
    } catch {
      return { label: index === 0 ? 'A' : 'B', action, started, finished: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - start), transportError: true }
    }
  }
  // Let both requests settle even on a timeout before revoking either session.
  const responses = await Promise.all([settle(0), (async () => { await delay(staggerMs); return settle(1) })()])
  console.log(JSON.stringify({ responses }))
  const [first, second] = responses
  assert(first.success && first.changed === true && first.jobIdsCorrect, 'First operation must make the one complete transition')
  if (mode === 'paid-paid') {
    assert(second.success && second.changed === false && second.jobIdsCorrect
      && second.paidAt === first.paidAt && second.cancelledAt === null, 'Second payment must be an exact timestamp-preserving no-op')
  } else {
    const expectedError = mode === 'paid-cancel' ? 'INVOICE_CANCEL_PAID' : 'INVOICE_INVALID_STATE'
    assert(!second.success && second.status === 400 && second.errorCode === '23514'
      && second.errorMessage === expectedError, 'Opposing operation must be rejected for the committed terminal state')
  }
  const after = await readState(tokens[1])
  const paidWins = actions[0] === 'paid'
  assert(after.invoice.status === (paidWins ? 'paid' : 'cancelled') && after.revision !== before.revision,
    'Final invoice must reflect the first complete transition')
  assert(same(after.items, before.items)
    && same(omit(after.invoice, ['status', 'paid_at', 'cancelled_at', 'updated_at']),
      omit(before.invoice, ['status', 'paid_at', 'cancelled_at', 'updated_at'])), 'Accounting snapshot and item rows must remain immutable')
  assert(after.invoice.paid_at === first.paidAt && after.invoice.cancelled_at === first.cancelledAt,
    'Stored settlement timestamps must exactly match the winning response')
  for (let index = 0; index < after.jobs.length; index++) {
    const job = after.jobs[index]
    const previous = before.jobs[index]
    const changedFields = paidWins ? ['billing_status', 'is_paid', 'paid_at']
      : ['billing_status', 'is_paid', 'paid_at', 'invoiced_at', 'due_date']
    assert(same(omit(job, changedFields), omit(previous, changedFields)), 'Unrelated job fields must remain unchanged')
    assert(paidWins ? job.billing_status === 'paid' && job.is_paid === true && job.paid_at === first.paidAt
      : job.billing_status === 'waiting_for_invoice' && job.is_paid === false && job.paid_at === null
        && job.invoiced_at === null && job.due_date === null, 'Both final jobs must reflect the same complete operation')
  }
  assert(same(after.links.map(link => omit(link, ['is_active'])), before.links.map(link => omit(link, ['is_active'])))
    && after.links.every(link => link.is_active === paidWins), 'All links must retain identity and the correct terminal activity')
  report = { project, mode, twoAuthenticatedHttpSessions: true, distinctAuthSessions: true,
    role: 'authenticated', requestDelayMs, staggerMs, sameExpectedRevision: true, responses,
    orderedFirstOperationWon: true, completeInvoiceJobsAndLinks: true, immutableFinancialSnapshot: true,
    stableRetryTimestamp: mode === 'paid-paid', finalStatus: after.invoice.status,
    retainedSyntheticHistory: true, fixtureCleanup: 'History retained in the dedicated synthetic test company',
    databaseOverlapEvidence: 'Must be supplied separately by the owner barrier session' }
} finally {
  const logout = await Promise.allSettled(tokens.map(token => fetch(`${url}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  })))
  const loggedOutSessions = logout.filter(result => result.status === 'fulfilled' && result.value.ok).length
  if (report) {
    report.loggedOutSessions = loggedOutSessions
    report.passed = loggedOutSessions === tokens.length
    await fs.writeFile(args['--output'], JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
    assert(report.passed, 'One or more synthetic Auth sessions could not be logged out')
  }
}
