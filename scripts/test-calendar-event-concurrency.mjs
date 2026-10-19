// Diriqo TEST only. Consumes explicit pre-created synthetic fixtures; no setup,
// DDL, owner connection, license change, fixture deletion or automatic retry.
// Usage and private JSON schema: docs/calendar-concurrency-harness-20261018.md.
// A separate owner session must hold the target event row and record the two
// authenticator waiters (including transitive blockers). Timing is not DB proof.
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
const supportedArgs = new Set(['--fixture', '--output', '--env-file', '--request-delay-ms'])
const args = {}
for (const arg of process.argv.slice(2)) {
  const separator = arg.indexOf('=')
  const key = arg.slice(0, separator)
  assert(separator > 0 && supportedArgs.has(key) && !(key in args), 'Use unique supported --name=value arguments')
  args[key] = arg.slice(separator + 1)
}
assert(args['--fixture'] && args['--output'], 'Explicit private fixture and new evidence paths required')
const fixturePath = path.resolve(args['--fixture'])
const output = path.resolve(args['--output'])
const envPath = path.resolve(args['--env-file'] || path.join(root, '.env.local'))
assert(output.toLowerCase() !== fixturePath.toLowerCase() && output.toLowerCase() !== envPath.toLowerCase(),
  'Evidence must not overwrite credential files')
const requestDelayMs = Number(args['--request-delay-ms'] ?? 15000)
assert(Number.isInteger(requestDelayMs) && requestDelayMs >= 0 && requestDelayMs <= 45000, 'Delay must be 0..45000ms')
let privateFixture
try { privateFixture = JSON.parse(await fs.readFile(fixturePath, 'utf8')) } catch {
  throw new Error('Private fixture cannot be read or parsed; no request was sent')
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const validId = value => typeof value === 'string' && uuid.test(value)
const validRevision = value => typeof value === 'string' && value.length <= 19 && /^(0|[1-9][0-9]*)$/.test(value)
  && BigInt(value) <= 9223372036854775807n
assert(Array.isArray(privateFixture.users) && privateFixture.users.length === 2, 'Two explicit synthetic users required')
const users = ['a', 'b'].map(label => privateFixture.users.find(user => user?.label === label))
for (const user of users) {
  assert(user && /^calendar-[^@]+@example\.invalid$/.test(user.email), 'Dedicated calendar synthetic accounts required')
  assert(typeof user.password === 'string' && user.password.length > 0, 'Private fixture password required')
  assert(validId(user.authUserId) && validId(user.profileId), 'Expected actor Auth and profile identities required')
}
assert(users[0].email !== users[1].email && users[0].authUserId !== users[1].authUserId
  && users[0].profileId !== users[1].profileId, 'Two distinct administrator identities required')
const f = privateFixture.fixture
assert(f?.project === project, 'Wrong fixture project')
assert([f.companyId, f.controlCompanyId, f.eventId, f.controlEventId].every(validId), 'Fixture company and event UUIDs required')
assert(f.companyId !== f.controlCompanyId && f.eventId !== f.controlEventId, 'Separate target and control fixtures required')
assert(typeof f.companyName === 'string' && f.companyName.startsWith('Synthetic calendar concurrency ')
  && typeof f.controlCompanyName === 'string' && f.controlCompanyName.startsWith('Synthetic calendar control '), 'Exact synthetic company names required')
assert(validRevision(f.expectedRevision), 'Explicit known decimal-string expectedRevision required')
assert(Array.isArray(f.workers) && f.workers.length === 2 && f.workers.every(validId) && f.workers[0] !== f.workers[1],
  'Two distinct synthetic assignment profiles required')

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function normalizeTime(value) {
  assert(typeof value === 'string' && /(Z|[+-][0-9]{2}:[0-9]{2})$/.test(value), 'Explicit timestamp with timezone required')
  const parsed = new Date(value)
  assert(Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= 1900 && parsed.getUTCFullYear() <= 9999, 'Timestamp outside supported range')
  return parsed.toISOString()
}
function normalizePayload(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Complete explicit payload required')
  const keys = ['title', 'description', 'start_at', 'end_at', 'job_id', 'assigned_profile_ids']
  assert(Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key)), 'Payload must contain exactly the six calendar input fields')
  assert(typeof input.title === 'string' && input.title === input.title.trim()
    && [...input.title].length >= 1 && [...input.title].length <= 300, 'Trimmed title of 1..300 characters required')
  assert(input.description === null || (typeof input.description === 'string' && input.description === input.description.trim()
    && input.description.length > 0 && [...input.description].length <= 10000), 'Description must be null or trimmed text of at most 10000 characters')
  assert(input.job_id === null || validId(input.job_id), 'Job must be null or a fixture UUID')
  assert(Array.isArray(input.assigned_profile_ids) && input.assigned_profile_ids.length <= 500
    && input.assigned_profile_ids.every(validId) && new Set(input.assigned_profile_ids).size === input.assigned_profile_ids.length,
    'Unique assigned profile UUIDs required')
  const start = normalizeTime(input.start_at)
  const end = normalizeTime(input.end_at)
  assert(Date.parse(end) > Date.parse(start), 'Event end must follow start')
  return { title: input.title, description: input.description, start_at: start, end_at: end,
    job_id: input.job_id, assigned_profile_ids: [...input.assigned_profile_ids].sort() }
}
const payloads = ['A', 'B'].map(label => normalizePayload(f.attempts?.[label]))
assert(payloads[0].start_at !== payloads[1].start_at && payloads[0].end_at !== payloads[1].end_at
  && payloads[0].title !== payloads[1].title, 'Attempts must have distinct titles and event times')
assert(isDeepStrictEqual(payloads[0].assigned_profile_ids, [f.workers[0]])
  && isDeepStrictEqual(payloads[1].assigned_profile_ids, [f.workers[1]]), 'A and B must assign their respective distinct fixture worker')
const env = Object.fromEntries((await fs.readFile(envPath, 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, '')]))
assert(env.NEXT_PUBLIC_SUPABASE_URL === url, 'Wrong Supabase project URL')
assert(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Missing public Supabase API key')
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Connection: 'close' }
const tokens = []
const sessionIds = []
const attempts = payloads.map((input, index) => ({ label: index === 0 ? 'A' : 'B', body: {
  p_company_id: f.companyId, p_event_id: f.eventId, p_expected_revision: f.expectedRevision, p_input: input,
} }))
const report = { project, passed: false, mode: 'calendar-event-overlap', startedAt: new Date().toISOString(), requestDelayMs,
  databaseOverlapEvidence: 'REQUIRED_SEPARATE_OWNER_ROW_LOCK_BARRIER',
  companyId: f.companyId, eventId: f.eventId, expectedRevision: f.expectedRevision, attempts }
// Reserve a new file before login and persist exact candidates before any write.
// A previous output is never overwritten, including after an uncertain response.
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })

async function jsonResponse(response) {
  try { return await response.json() } catch { throw new Error('Remote response was not valid JSON') }
}
async function get(token, table, query) {
  const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, {
    headers: { ...headers, Authorization: `Bearer ${token}`, Prefer: 'count=exact', Range: '0-20' },
    signal: AbortSignal.timeout(30000),
  })
  assert(response.status === 200 || response.status === 206, `Fixture ${table} read failed (HTTP ${response.status})`)
  const rows = await jsonResponse(response)
  const total = response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1]
  assert(Array.isArray(rows) && total !== undefined && Number(total) === rows.length && rows.length <= 20,
    'A complete small synthetic result is required; paginated or truncated data is not proof')
  return rows
}
async function rpc(token, name, body, timeout = 30000) {
  const started = new Date().toISOString()
  const start = performance.now()
  try {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    })
    return { status: response.status, data: await jsonResponse(response), started,
      finished: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start) }
  } catch {
    return { status: null, transportError: true, started, finished: new Date().toISOString(), elapsedMs: Math.round(performance.now() - start) }
  }
}
function normalizedSnapshot(value) {
  assert(value?.event && validId(value.event.id) && validId(value.event.company_id)
    && validRevision(value.event.revision), 'Complete scoped snapshot with an exact revision required')
  const input = normalizePayload({ title: value.event.title, description: value.event.description,
    start_at: value.event.start_at, end_at: value.event.end_at, job_id: value.event.job_id,
    assigned_profile_ids: value.assigned_profile_ids })
  return { event: { id: value.event.id, company_id: value.event.company_id, title: input.title,
    description: input.description, start_at: input.start_at, end_at: input.end_at, job_id: input.job_id,
    revision: value.event.revision }, assigned_profile_ids: input.assigned_profile_ids }
}
async function eventSnapshot(token, companyId, eventId) {
  const response = await rpc(token, 'get_calendar_event_snapshot', { p_company_id: companyId, p_event_id: eventId })
  assert(response.status === 200 && !response.transportError, 'Authenticated calendar snapshot failed')
  const value = normalizedSnapshot(response.data)
  assert(value.event.company_id === companyId && value.event.id === eventId, 'Snapshot identity mismatch')
  return value
}
async function companySnapshot(token, companyId) {
  // Revision is read as a string through RPC, not as a potentially rounded
  // PostgREST bigint JSON number. Other header fields are retained in full.
  const rows = await get(token, 'calendar_events', { select: 'id,company_id,title,description,start_at,starts_at,end_at,ends_at,job_id,location,created_at,updated_at',
    company_id: `eq.${companyId}`, order: 'id.asc' })
  assert(rows.length > 0 && rows.every(row => row.company_id === companyId), 'Nonempty scoped synthetic calendar required')
  const result = []
  for (const header of rows) result.push({ header, snapshot: await eventSnapshot(token, companyId, header.id) })
  return result
}
const publicResponse = response => ({ status: response.status, started: response.started, finished: response.finished,
  elapsedMs: response.elapsedMs, transportError: Boolean(response.transportError),
  errorCode: response.status !== 200 && /^[A-Z0-9]+$/.test(response.data?.code ?? '') ? response.data.code : undefined,
  errorMessage: response.status !== 200 && /^[A-Z_]+$/.test(response.data?.message ?? '') ? response.data.message : undefined })

try {
  for (const user of users) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers, body: JSON.stringify({ email: user.email, password: user.password }), signal: AbortSignal.timeout(30000),
    })
    assert(response.status === 200, `Synthetic login failed (HTTP ${response.status})`)
    const session = await jsonResponse(response)
    assert(typeof session.access_token === 'string', 'Incomplete Auth token response')
    tokens.push(session.access_token)
    assert(session.user?.id === user.authUserId, 'Unexpected Auth user identity')
    let claims
    try { claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8')) } catch {
      throw new Error('Invalid Auth token claims')
    }
    assert(claims.role === 'authenticated' && claims.sub === user.authUserId && validId(claims.session_id), 'Authenticated session identity required')
    sessionIds.push(claims.session_id)
    const profiles = await get(session.access_token, 'profiles', { select: 'id,auth_user_id,is_active', id: `eq.${user.profileId}` })
    assert(profiles.length === 1 && profiles[0].auth_user_id === user.authUserId && profiles[0].is_active === true, 'Active expected actor profile required')
    for (const companyId of [f.companyId, f.controlCompanyId]) {
      const memberships = await get(session.access_token, 'company_members', {
        select: 'company_id,profile_id,role,is_active', company_id: `eq.${companyId}`, profile_id: `eq.${user.profileId}`,
      })
      assert(memberships.length === 1 && memberships[0].is_active === true
        && ['company_admin', 'super_admin'].includes(memberships[0].role), 'Both actors must be active administrators in both synthetic companies')
    }
  }
  assert(sessionIds[0] !== sessionIds[1], 'Two distinct Auth sessions required')
  for (const [id, name] of [[f.companyId, f.companyName], [f.controlCompanyId, f.controlCompanyName]]) {
    const rows = await get(tokens[0], 'companies', { select: 'id,name', id: `eq.${id}` })
    assert(rows.length === 1 && rows[0].id === id && rows[0].name === name, 'Exact synthetic company identity required')
  }
  const before = await companySnapshot(tokens[0], f.companyId)
  const controlBefore = await companySnapshot(tokens[1], f.controlCompanyId)
  const target = before.find(row => row.header.id === f.eventId)
  assert(target && target.snapshot.event.revision === f.expectedRevision, 'Target event must match the explicit expected revision')
  assert(controlBefore.some(row => row.header.id === f.controlEventId), 'Named control event must exist')
  const secondView = await eventSnapshot(tokens[1], f.companyId, f.eventId)
  assert(isDeepStrictEqual(secondView, target.snapshot), 'Both administrators must start from the same complete snapshot')
  assert(payloads.every(input => input.start_at !== target.snapshot.event.start_at && input.end_at !== target.snapshot.event.end_at),
    'Each candidate must genuinely move the original event')
  Object.assign(report, { twoAuthenticatedHttpSessions: true, distinctAuthSessions: true, distinctActors: true,
    beforeFingerprint: fingerprint(before), controlBeforeFingerprint: fingerprint(controlBefore),
    targetBeforeSnapshot: target.snapshot, targetBeforeHeader: target.header,
    targetEventCount: before.length, controlEventCount: controlBefore.length })
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ready: true, project, requestDelayMs, companyId: f.companyId, eventId: f.eventId,
    expectedRevision: f.expectedRevision, at: new Date().toISOString(), ownerBarrierRequired: true }))
  await delay(requestDelayMs)
  const responses = await Promise.all(attempts.map((attempt, index) =>
    rpc(tokens[index], 'update_calendar_event_atomic', attempt.body, 60000)))
  report.responses = responses.map(publicResponse)
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n')
  assert(responses.every(response => !response.transportError), 'Indeterminate write response: preserve the fixture and reconcile its stored revision/payloads; do not replay')
  assert(responses.filter(response => response.status === 200).length === 1
    && responses.filter(response => response.status === 409 && response.data?.code === 'PT409'
      && response.data?.message === 'CALENDAR_STALE').length === 1,
    'Expected exactly one HTTP 200 and one CALENDAR_STALE HTTP 409/PT409')
  const winner = responses.findIndex(response => response.status === 200)
  const winningSnapshot = normalizedSnapshot(responses[winner].data)
  assert(winningSnapshot.event.id === f.eventId && winningSnapshot.event.company_id === f.companyId
    && BigInt(winningSnapshot.event.revision) > BigInt(f.expectedRevision), 'Winner must retain identity and advance the revision')
  assert(isDeepStrictEqual({ title: winningSnapshot.event.title, description: winningSnapshot.event.description,
    start_at: winningSnapshot.event.start_at, end_at: winningSnapshot.event.end_at,
    job_id: winningSnapshot.event.job_id, assigned_profile_ids: winningSnapshot.assigned_profile_ids }, payloads[winner]),
    'The winner must contain its complete header and assignment set; mixtures are invalid')
  const after = await companySnapshot(tokens[0], f.companyId)
  const controlAfter = await companySnapshot(tokens[1], f.controlCompanyId)
  const finalTarget = after.find(row => row.header.id === f.eventId)
  assert(finalTarget && isDeepStrictEqual(finalTarget.snapshot, winningSnapshot), 'Persisted target must equal the full winning RPC snapshot')
  assert(isDeepStrictEqual(after.filter(row => row.header.id !== f.eventId), before.filter(row => row.header.id !== f.eventId)),
    'An unrelated event or its assignments changed')
  assert(isDeepStrictEqual(controlAfter, controlBefore), 'Control company calendar changed')
  for (const field of ['id', 'company_id', 'location', 'created_at']) {
    assert(isDeepStrictEqual(finalTarget.header[field], target.header[field]), 'Stable original header fields changed')
  }
  assert(normalizeTime(finalTarget.header.start_at) === payloads[winner].start_at
    && normalizeTime(finalTarget.header.starts_at) === payloads[winner].start_at
    && normalizeTime(finalTarget.header.end_at) === payloads[winner].end_at
    && normalizeTime(finalTarget.header.ends_at) === payloads[winner].end_at, 'Both persisted time aliases must match the winner')
  Object.assign(report, { assertionsPassed: true, winner: attempts[winner].label,
    winningSnapshot, afterFingerprint: fingerprint(after), controlAfterFingerprint: fingerprint(controlAfter),
    controlTenantUnchanged: true, unrelatedEventsUnchanged: true, noMixedAssignments: true,
    newRevision: winningSnapshot.event.revision, attemptedWrites: 2, automaticRetries: 0 })
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Unknown verification failure'
  process.exitCode = 1
} finally {
  const logout = await Promise.allSettled(tokens.map(token => fetch(`${url}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  })))
  report.loggedOutSessions = logout.filter(result => result.status === 'fulfilled' && result.value.ok).length
  report.passed = Boolean(report.assertionsPassed) && tokens.length === 2 && report.loggedOutSessions === 2
  report.finishedAt = new Date().toISOString()
  if (!report.passed) process.exitCode = 1
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed, project, winner: report.winner,
    loggedOutSessions: report.loggedOutSessions, failure: report.failure, databaseOverlapEvidence: report.databaseOverlapEvidence }))
}
