// Authorized Diriqo TEST project only; never run against another environment.
// Usage: node scripts/test-invoice-number-concurrency.mjs --fixture=<private.json>
//   --output=<evidence.json> --request-delay-ms=15000
// Private input: {email,password,fixture:{companyId,invoiceA,invoiceB,number}}.
// The synthetic email must be invoice-number-concurrency-...@example.invalid.
// Root prepares two drafts, holds both rows FOR UPDATE in a separate SQL session,
// and proves two blocked backend PIDs before releasing that barrier. This script
// alone proves two Auth/HTTP sessions, not simultaneous database execution.
// Credentials stay in the private input; access tokens stay in memory. No emails.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { isDeepStrictEqual } from 'node:util'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const project = 'wfcpfraxiuhuglnuaxqj'
const url = `https://${project}.supabase.co`
const conflictMessage = 'duplicate key value violates unique constraint "invoices_company_number_uidx"'
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const i = arg.indexOf('=')
  assert(i > 0, 'Arguments must use --name=value')
  return [arg.slice(0, i), arg.slice(i + 1)]
}))
assert(args['--fixture'] && args['--output'], 'Provide --fixture and --output paths')
assert(path.resolve(args['--fixture']) !== path.resolve(args['--output']), 'Evidence must not overwrite credentials')
const requestDelayMs = Number(args['--request-delay-ms'] ?? 15000)
assert(Number.isInteger(requestDelayMs) && requestDelayMs >= 0 && requestDelayMs <= 45000,
  'Request delay must be an integer from 0 to 45000ms')
const auth = JSON.parse(await fs.readFile(args['--fixture'], 'utf8'))
assert(typeof auth.email === 'string' && /^invoice-number-concurrency-[^@]+@example\.invalid$/.test(auth.email),
  'Dedicated synthetic account required')
assert(typeof auth.password === 'string' && auth.password.length > 0, 'Private fixture password required')
const f = auth.fixture
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
assert(f && [f.companyId, f.invoiceA, f.invoiceB].every(value => typeof value === 'string' && uuid.test(value)),
  'Fixture requires company and invoice UUIDs')
assert(f.invoiceA !== f.invoiceB, 'Two different invoice rows required')
assert(typeof f.number === 'string' && f.number.trim() === f.number && f.number.length > 0 && f.number.length <= 200,
  'Fixture requires a short nonblank shared invoice number')
const env = Object.fromEntries((await fs.readFile(path.join(root, '.env.local'), 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, '')]))
assert(env.NEXT_PUBLIC_SUPABASE_URL === url, 'Wrong test project')
assert(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Missing public Supabase API key')
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Connection: 'close' }
const tokens = []
const sessionIds = []
let userId
let report
try {
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify({ email: auth.email, password: auth.password }),
      signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Synthetic login failed (HTTP ${response.status})`)
    const session = await response.json()
    assert(typeof session.access_token === 'string' && session.user?.id, 'Incomplete synthetic Auth session')
    tokens.push(session.access_token)
    assert(!userId || userId === session.user.id, 'Both logins must use the same synthetic user')
    userId = session.user.id
    // Decode only to record session identity; authorization is performed by Supabase.
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'))
    assert(claims.role === 'authenticated' && typeof claims.session_id === 'string', 'Expected authenticated session')
    sessionIds.push(claims.session_id)
  }
  assert(sessionIds[0] !== sessionIds[1], 'Two distinct Auth sessions required')
  const ids = [f.invoiceA, f.invoiceB]
  async function readRows(token) {
    const query = new URLSearchParams({ select: '*', company_id: `eq.${f.companyId}`, id: `in.(${ids.join(',')})`, order: 'id.asc' })
    const response = await fetch(`${url}/rest/v1/invoices?${query}`, {
      headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Fixture read failed (HTTP ${response.status})`)
    const rows = await response.json()
    assert(Array.isArray(rows) && rows.length === 2, 'Both fixture invoices must be visible')
    assert(rows.every(row => ids.includes(row.id) && row.company_id === f.companyId && row.status === 'draft' && row.issued_at === null),
      'Only unissued drafts in the configured synthetic company may be tested')
    return rows
  }
  const before = await readRows(tokens[0])
  assert(before.every(row => row.invoice_number !== f.number), 'Shared test number must differ from both original numbers')
  console.log(JSON.stringify({ ready: true, project, requestDelayMs, at: new Date().toISOString() }))
  await delay(requestDelayMs)
  async function patch(index) {
    const started = new Date().toISOString()
    const start = performance.now()
    const label = index === 0 ? 'A' : 'B'
    try {
      const query = new URLSearchParams({ id: `eq.${ids[index]}`, company_id: `eq.${f.companyId}`, status: 'eq.draft' })
      const response = await fetch(`${url}/rest/v1/invoices?${query}`, {
        method: 'PATCH', headers: { ...headers, Authorization: `Bearer ${tokens[index]}`, Prefer: 'return=representation' },
        body: JSON.stringify({ invoice_number: f.number, note: `invoice-number-concurrency:${label}` }),
        signal: AbortSignal.timeout(45000),
      })
      const data = await response.json()
      // Retain only expected metadata, never PostgreSQL's conflicting-key details.
      return { label, started, finished: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start),
        status: response.status, success: response.status === 200 && Array.isArray(data) && data.length === 1 && data[0].id === ids[index],
        conflict: response.status === 409 && data.code === '23505' && data.message === conflictMessage }
    } catch {
      return { label, started, finished: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start), transportError: true }
    }
  }
  // Each helper catches its own transport failure, so both settle before logout.
  const responses = await Promise.all([patch(0), patch(1)])
  assert(responses.filter(r => r.success).length === 1, 'Expected exactly one successful PATCH')
  assert(responses.filter(r => r.conflict).length === 1, 'Expected exactly one 409/23505 from the invoice-number unique index')
  const winner = responses.findIndex(r => r.success)
  const loser = 1 - winner
  const after = await readRows(tokens[1])
  assert(after.filter(row => row.invoice_number === f.number).length === 1, 'Final rows must have exactly one shared number')
  assert(after.find(row => row.id === ids[winner]).note === `invoice-number-concurrency:${winner === 0 ? 'A' : 'B'}`,
    'Winning PATCH must persist its own note')
  assert(isDeepStrictEqual(after.find(row => row.id === ids[loser]), before.find(row => row.id === ids[loser])),
    'Rejected PATCH must leave the entire losing invoice unchanged')
  report = { project, twoAuthenticatedHttpSessions: true, distinctAuthSessions: true, role: 'authenticated',
    requestDelayMs, successCount: 1, errorCount: 1, errorCode: '23505', errorMessage: conflictMessage,
    responses, winner: winner === 0 ? 'A' : 'B', finalSharedNumberCount: 1, losingInvoiceUnchanged: true,
    databaseOverlapEvidence: 'Must be supplied separately by the owner barrier session' }
} finally {
  const logout = await Promise.allSettled(tokens.map(token => fetch(`${url}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  })))
  const loggedOutSessions = logout.filter(r => r.status === 'fulfilled' && r.value.ok).length
  if (report) {
    report.loggedOutSessions = loggedOutSessions
    report.passed = loggedOutSessions === tokens.length
    await fs.writeFile(args['--output'], JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
    assert(report.passed, 'One or more synthetic Auth sessions could not be logged out')
  }
}
