// Integration harness for the explicitly configured Diriqo TEST project only.
// Credentials live in a temporary local fixture file, never in arguments or output.
// Run after the SQL fixture setup. A separate SQL session can hold the advisory
// lock to prove that both HTTP requests occupy distinct blocked database sessions.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const i = arg.indexOf('='); return [arg.slice(0, i), arg.slice(i + 1)]
}))
assert(args['--fixture'], 'Provide --fixture=<local JSON path>')
assert(args['--output'], 'Provide --output=<evidence JSON path>')
const auth = JSON.parse(await fs.readFile(args['--fixture'], 'utf8'))
const f = auth.fixture
const env = Object.fromEntries((await fs.readFile(path.join(root, '.env.local'), 'utf8')).split(/\r?\n/)
  .map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map(([, key, value]) => [key, value.trim().replace(/^["']|["']$/g, '')]))
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'https://wfcpfraxiuhuglnuaxqj.supabase.co', 'Wrong test project')
assert(auth.email.startsWith('atomic-concurrency-') && auth.email.endsWith('@example.invalid'), 'Synthetic account required')
const headers = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Connection: 'close' }
const tokens = []
try {
  for (let i = 0; i < 2; i++) {
    const response = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers, body: JSON.stringify({ email: auth.email, password: auth.password }),
    })
    const session = await response.json()
    assert.equal(response.status, 200, 'Synthetic login failed: ' + (session.code ?? response.status) + ' ' + (session.msg ?? session.error_description ?? ''))
    assert.equal(session.user.id, f.user)
    assert(session.access_token)
    tokens.push(session.access_token)
  }
  async function rpc(token, operation, job, shift = null) {
    const started = new Date().toISOString()
    const response = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/rpc/mutate_my_job_work', {
      method: 'POST', headers: { ...headers, Authorization: 'Bearer ' + token },
      body: JSON.stringify({ target_company_id: f.a, operation, target_job_id: job, target_shift_id: shift }),
      signal: AbortSignal.timeout(60000),
    })
    return { started, finished: new Date().toISOString(), status: response.status, data: await response.json() }
  }
  const existingResponse = await fetch(env.NEXT_PUBLIC_SUPABASE_URL
    + '/rest/v1/work_shifts?select=id&company_id=eq.' + f.a + '&profile_id=eq.' + f.profile + '&ended_at=is.null&started_at=not.is.null',
    { headers: { ...headers, Authorization: 'Bearer ' + tokens[0] } })
  assert.equal(existingResponse.status, 200)
  for (const row of await existingResponse.json()) assert.equal((await rpc(tokens[0], 'stop', null, row.id)).status, 200)
  const mode = args['--case'] ?? 'same'
  const firstJob = mode === 'same' ? f.j1 : f.j2
  const secondJob = mode === 'same' ? f.j1 : f.j3
  const wait = Number(args['--delay'] ?? 0)
  assert(Number.isInteger(wait) && wait >= 0 && wait <= 45000)
  console.log(JSON.stringify({ ready: true, case: mode, requestDelayMs: wait, at: new Date().toISOString() }))
  await delay(wait)
  const responses = await Promise.all([
    rpc(tokens[0], 'start', firstJob),
    rpc(tokens[1], 'start', secondJob),
  ])
  if (mode === 'same') {
    assert(responses.every(r => r.status === 200))
    assert.equal(responses[0].data.shift_id, responses[1].data.shift_id)
    assert.deepEqual(responses.map(r => r.data.reused).sort(), [false, true])
  } else {
    assert.equal(responses.filter(r => r.status === 200).length, 1)
    assert.equal(responses.filter(r => r.data.message === 'WORK_ANOTHER_SHIFT_RUNNING').length, 1)
  }
  const report = { project: 'wfcpfraxiuhuglnuaxqj', case: mode, twoAuthenticatedHttpSessions: true, responses }
  await fs.writeFile(args['--output'], JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  await Promise.allSettled(tokens.map(token => fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/auth/v1/logout?scope=local', {
    method: 'POST', headers: { ...headers, Authorization: 'Bearer ' + token },
  })))
}
