import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// Node 24 can test the real TS source without installing packages into this checkout.
// The production server-only poison pill is replaced only inside this test process.
const isVitest = process.env.VITEST === 'true'
const { test } = isVitest ? await import('vitest') : await import('node:test')
if (isVitest) {
  const { vi } = await import('vitest')
  vi.doMock('server-only', () => ({}))
} else {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const ownModule = /\/lib\/platform\/(entitlement-loader|legacy-entitlements)\.ts$/.test(context.parentURL ?? '')
      if (ownModule && specifier === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
      if (ownModule && specifier.startsWith('./') && !specifier.endsWith('.ts')) {
        return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context)
      }
      return nextResolve(specifier, context)
    },
  })
}
const { mapLegacyEntitlements } = await import('../lib/platform/legacy-entitlements.ts')
const { loadLegacyEntitlementSnapshot } = await import('../lib/platform/entitlement-loader.ts')
const { evaluateCapabilityEntitlement } = await import('../lib/platform/capabilities.ts')

const NOW = Date.parse('2026-10-10T12:00:00Z')
const END = Date.parse('2026-11-01T00:00:00Z')
const DAY = 86_400_000
const subscription = (changes = {}) => ({
  id: 'sub-A', company_id: 'company-A', plan_key: 'starter', status: 'active',
  current_period_start: '2026-10-01T00:00:00Z', current_period_end: '2026-11-01T00:00:00Z',
  trial_started_at: '2026-10-01T00:00:00Z', trial_ends_at: '2026-10-08T00:00:00Z',
  cancel_at_period_end: false, ...changes,
})
const modules = () => ['jobs', 'workers', 'shifts', 'quotes', 'calendar', 'finance', 'photos', 'invoices']
  .map((module_key) => ({ company_id: 'company-A', module_key, is_enabled: true }))
const map = (changes = {}, rows = modules(), now = NOW) => mapLegacyEntitlements('company-A', subscription(changes), rows, now)
const eligible = (snapshot, capability, now = NOW, extra = {}) => evaluateCapabilityEntitlement({
  snapshot, capability, companyId: 'company-A', registerId: null, now, ...extra,
}).entitled

function client(overrides = {}) {
  const calls = []
  const data = {
    profiles: { id: 'profile-A', auth_user_id: 'auth-A', user_id: 'auth-A' },
    company_members: { company_id: 'company-A', profile_id: 'profile-A', is_active: true },
    company_subscriptions: subscription(), company_modules: modules(), ...overrides,
  }
  const supabase = {
    auth: { getUser: async () => {
      calls.push({ auth: 'getUser' })
      return data.auth ?? { data: { user: { id: 'auth-A' } }, error: null }
    } },
    from(table) {
      const call = { table, filters: [] }
      calls.push(call)
      const result = () => {
        if (data[table] instanceof Error) throw data[table]
        return data[table]?.error ? data[table] : { data: data[table], error: null }
      }
      const query = {
        select(columns) { call.columns = columns; return query },
        eq(column, value) { call.filters.push([column, value]); return query },
        maybeSingle() { return Promise.resolve().then(result) },
        then(resolve, reject) { return Promise.resolve().then(result).then(resolve, reject) },
      }
      return query
    },
  }
  return { calls, context: { supabase, companyId: 'company-A', profileId: 'profile-A', role: 'super_admin' } }
}

test('all four known EUR tiers retain explicit existing core and invoicing without new addons', () => {
  for (const plan_key of ['starter', 'growth', 'business', 'scale']) {
    const { snapshot, reason } = map({ plan_key })
    assert.equal(reason, 'mapped')
    assert.deepEqual(snapshot.grants.map((grant) => grant.product), ['diriqo_core', 'invoicing'])
    for (const code of ['core.jobs.create', 'core.quotes.create', 'core.advances.pay', 'invoicing.invoice.issue']) {
      assert.equal(eligible(snapshot, code), true)
    }
    for (const code of ['inventory.receipt.post', 'fleet.trip.record', 'smart_quotes.ocr.request',
      'invoicing.ocr.request', 'ai_assistant.conversation.run', 'core.handover.confirm', 'pos.sale.create']) {
      assert.equal(eligible(snapshot, code), false)
    }
  }
})

test('legacy invoice switch does not disable simple quotes or grant smart quotes', () => {
  const rows = modules().map((row) => row.module_key === 'invoices' ? { ...row, is_enabled: false } : row)
  const result = map({}, rows)
  assert.equal(eligible(result.snapshot, 'core.quotes.create'), true)
  assert.equal(eligible(result.snapshot, 'invoicing.invoice.issue'), false)
  assert.equal(eligible(result.snapshot, 'smart_quotes.template.manage'), false)
})

test('unknown, aliased and prototype plan names cannot become starter', () => {
  for (const plan_key of ['team', 'enterprise', 'custom', '', 'STARTER', 'constructor', '__proto__', null]) {
    assert.equal(map({ plan_key }).reason, 'unrecognized_plan')
    assert.equal(map({ plan_key }).snapshot.status, 'unavailable')
  }
})

test('missing subscription is an empty successful snapshot, not a free trial', () => {
  const result = mapLegacyEntitlements('company-A', null, modules(), NOW)
  assert.deepEqual(result.snapshot, { status: 'ready', grants: [] })
  assert.equal(result.reason, 'missing_subscription')
})

test('database rows cannot cross company scope', () => {
  assert.equal(map({ company_id: 'company-B' }).snapshot.status, 'unavailable')
  const rows = modules()
  rows[0].company_id = 'company-B'
  assert.equal(map({}, rows).snapshot.status, 'unavailable')
  assert.equal(eligible(map().snapshot, 'core.jobs.create', NOW, { companyId: 'company-B' }), false)
})

test('incomplete, duplicate or wrongly typed module rows are unavailable without implicit enables', () => {
  for (const rows of [null, [], modules().slice(1), [...modules(), modules()[0]],
    modules().map((row) => ({ ...row, is_enabled: 'true' }))]) {
    assert.equal(map({}, rows).reason, 'invalid_module_rows')
  }
})

test('unknown module toggles confer no capabilities and explicit false remains false', () => {
  const rows = modules().map((row) => ({ ...row, is_enabled: false }))
  rows.push({ company_id: 'company-A', module_key: 'pos', is_enabled: true })
  assert.deepEqual(map({}, rows).snapshot, { status: 'ready', grants: [] })
})

test('missing, unbounded, timezone-less and invalid periods require migration review', () => {
  for (const changes of [
    { current_period_end: null }, { current_period_start: null }, { current_period_end: 'tomorrow' },
    { current_period_end: '2026-11-01T00:00:00' }, { current_period_end: '2026-10-01T00:00:00Z' },
    { cancel_at_period_end: 'false' },
  ]) assert.equal(map(changes).reason, 'invalid_period')
  for (const now of [NaN, Infinity, -1, '2026']) assert.equal(map({}, modules(), now).reason, 'invalid_period')
})

test('unknown or incomplete subscription state does not restore access', () => {
  for (const status of ['incomplete', 'suspended', 'grace_period', 'constructor', 'ACTIVE', null]) {
    assert.equal(map({ status }).reason, 'unsupported_subscription_state')
  }
})

test('scheduled cancellation and canceled legacy subscriptions retain the paid term only', () => {
  for (const changes of [{ cancel_at_period_end: true }, { status: 'canceled' }]) {
    const { snapshot } = map(changes)
    assert.equal(snapshot.grants[0].cancelAtPeriodEnd, true)
    assert.equal(eligible(snapshot, 'core.jobs.create', END - 1), true)
    assert.equal(eligible(snapshot, 'core.jobs.create', END), false)
    assert.equal(eligible(snapshot, 'core.history.read', END), false)
  }
})

test('legacy past-due keeps paid remainder and exactly the existing three-day grace', () => {
  assert.equal(eligible(map({ status: 'past_due' }, modules(), END - 1).snapshot, 'core.jobs.create', END - 1), true)
  const { snapshot } = map({ status: 'past_due' }, modules(), END)
  assert.equal(eligible(snapshot, 'core.jobs.create', END), true)
  assert.equal(eligible(snapshot, 'core.jobs.create', END + 3 * DAY - 1), true)
  assert.equal(eligible(snapshot, 'core.jobs.create', END + 3 * DAY), false)
  assert.equal(eligible(snapshot, 'core.history.export', END + 3 * DAY), false)
})

test('trial keeps its original dates and explicit origin, with no new 30-day reset', () => {
  const trialEnd = Date.parse('2026-10-08T00:00:00Z')
  const { snapshot } = map({ status: 'trialing' })
  assert.equal(snapshot.grants[0].origin, 'trial')
  assert.equal(snapshot.grants[0].validUntil, trialEnd)
  assert.equal(eligible(snapshot, 'core.jobs.create', trialEnd - 1), true)
  assert.equal(eligible(snapshot, 'core.jobs.create', trialEnd), false)
})

test('renewals use distinct grant IDs and do not rewrite prior-event identity', () => {
  const first = map().snapshot.grants.find((grant) => grant.product === 'invoicing')
  const renewed = map({ current_period_start: '2026-11-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z' }).snapshot
  assert.notEqual(renewed.grants.find((grant) => grant.product === 'invoicing').id, first.id)
  const event = { eventId: 'invoice-A', entitlementId: first.id, companyId: 'company-A', registerId: null,
    capability: 'invoicing.invoice.issue', occurredAt: NOW }
  assert.equal(eligible({ status: 'ready', grants: [first] }, 'invoicing.payment.settle', END + DAY, { priorEvent: event }), true)
  assert.equal(eligible(renewed, 'invoicing.payment.settle', END + DAY, { priorEvent: event }), false)
  assert.equal(eligible({ status: 'ready', grants: [first] }, 'invoicing.payment.settle', NOW), false)
})

test('loader reads only after verified auth/profile and active company membership', async () => {
  const fixture = client()
  const result = await loadLegacyEntitlementSnapshot(fixture.context)
  assert.equal(result.reason, 'mapped')
  assert.equal(fixture.calls[0].auth, 'getUser')
  for (const table of ['company_members', 'company_subscriptions', 'company_modules']) {
    assert.ok(fixture.calls.find((call) => call.table === table).filters.some(([key, value]) => key === 'company_id' && value === 'company-A'))
  }
  assert.equal(fixture.calls.some((call) => call.table === 'subscriptions'), false)
})

test('no auth cannot read profile, membership or billing rows', async () => {
  const fixture = client({ auth: { data: { user: null }, error: null } })
  assert.equal((await loadLegacyEntitlementSnapshot(fixture.context)).reason, 'authentication_required')
  assert.equal(fixture.calls.length, 1)
})

test('profile mismatch or conflicting auth links cannot load billing', async () => {
  for (const profiles of [null, { id: 'profile-A', auth_user_id: 'auth-B', user_id: 'auth-A' },
    { id: 'profile-B', auth_user_id: 'auth-A', user_id: 'auth-A' }]) {
    const fixture = client({ profiles })
    assert.equal((await loadLegacyEntitlementSnapshot(fixture.context)).reason, 'membership_required')
    assert.equal(fixture.calls.some((call) => call.table === 'company_subscriptions'), false)
  }
})

test('revoked or cross-company membership denies even a supplied super_admin role', async () => {
  for (const company_members of [null, { company_id: 'company-A', profile_id: 'profile-A', is_active: false },
    { company_id: 'company-B', profile_id: 'profile-A', is_active: true }]) {
    const fixture = client({ company_members })
    const result = await loadLegacyEntitlementSnapshot(fixture.context)
    assert.equal(result.reason, 'membership_required')
    assert.equal(result.snapshot.status, 'unavailable')
    assert.equal(fixture.calls.some((call) => call.table === 'company_subscriptions'), false)
  }
})

test('query errors and thrown network errors deny without fallback grants or raw errors', async () => {
  for (const table of ['profiles', 'company_members', 'company_subscriptions', 'company_modules']) {
    for (const value of [{ data: null, error: { message: 'sensitive backend info' } }, new Error('sensitive backend info')]) {
      const result = await loadLegacyEntitlementSnapshot(client({ [table]: value }).context)
      assert.equal(result.reason, 'data_unavailable')
      assert.equal(result.snapshot.status, 'unavailable')
      assert.equal(JSON.stringify(result).includes('sensitive'), false)
    }
  }
})

test('loader does not retain a snapshot after membership revocation between calls', async () => {
  const active = client()
  assert.equal((await loadLegacyEntitlementSnapshot(active.context)).snapshot.status, 'ready')
  const revoked = client({ company_members: null })
  assert.equal((await loadLegacyEntitlementSnapshot(revoked.context)).snapshot.status, 'unavailable')
})
