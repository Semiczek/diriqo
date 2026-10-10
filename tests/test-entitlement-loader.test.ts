import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { loadTestEntitlementSnapshot, parseTestEntitlementRows } from '../lib/platform/test-entitlement-loader'
import { CAPABILITY_POLICY_VERSION, evaluateCapabilityEntitlement } from '../lib/platform/capabilities'

beforeEach(() => vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'test'))
afterEach(() => vi.unstubAllEnvs())

const row = (changes: Record<string, unknown> = {}) => ({
  id: 'test-grant-A', company_id: 'company-A', product: 'invoicing', register_id: null,
  policy_version: CAPABILITY_POLICY_VERSION, source_ref: 'owner-test/synthetic', origin: 'manual_grant',
  state: 'active', revoked: false, livemode: false, cancel_at_period_end: false,
  valid_from: '2026-10-01T00:00:00Z', valid_until: '2026-10-31T00:00:00Z', history_until: '2026-10-31T00:00:00Z',
  capabilities: ['invoicing.invoice.issue', 'invoicing.history.read'], grace_capabilities: [], grace_until: null,
  ...changes,
})

describe('test entitlement parser', () => {
  it('preserves a nonfinancial test origin and exact period without producing a paid grant', () => {
    const snapshot = parseTestEntitlementRows('company-A', [row()])
    expect(snapshot).toMatchObject({ status: 'ready', grants: [{ id: 'test-grant-A', origin: 'manual_grant', sourceRef: 'owner-test/synthetic' }] })
    const request = { snapshot, companyId: 'company-A', registerId: null, capability: 'invoicing.invoice.issue' }
    expect(evaluateCapabilityEntitlement({ ...request, now: Date.parse('2026-10-01T00:00:00Z') }).entitled).toBe(true)
    expect(evaluateCapabilityEntitlement({ ...request, now: Date.parse('2026-09-30T23:59:59Z') }).entitled).toBe(false)
    expect(evaluateCapabilityEntitlement({ ...request, now: Date.parse('2026-10-31T00:00:00Z') }).entitled).toBe(false)
    expect(evaluateCapabilityEntitlement({ ...request, now: Date.parse('2026-10-10T00:00:00Z'), companyId: 'company-B' }).entitled).toBe(false)
    expect(evaluateCapabilityEntitlement({ ...request, now: Date.parse('2026-10-31T00:00:00Z'), capability: 'invoicing.history.read' }).entitled).toBe(false)
  })

  it('retains revoked audit rows without authorizing them', () => {
    const snapshot = parseTestEntitlementRows('company-A', [row({ revoked: true })])
    expect(snapshot).toMatchObject({ status: 'ready', grants: [{ revoked: true }] })
    expect(evaluateCapabilityEntitlement({ snapshot, companyId: 'company-A', registerId: null,
      capability: 'invoicing.invoice.issue', now: Date.parse('2026-10-10T00:00:00Z') }).entitled).toBe(false)
  })

  it.each([
    { company_id: 'company-B' }, { livemode: true }, { livemode: 'false' }, { origin: 'paid' }, { origin: 'trial' },
    { source_ref: ' ' }, { id: '' }, { product: 'unknown' }, { state: 'grace' }, { revoked: 'false' },
    { policy_version: 'future-policy' }, { register_id: 'register-A' },
    { valid_from: 'invalid' }, { valid_from: '2026-10-01' },
    { valid_until: '2026-11-01T00:00:00Z', history_until: '2026-11-01T00:00:00Z' },
    { valid_until: '2026-10-01T00:00:00Z' }, { history_until: '2026-11-01T00:00:00Z' },
    { grace_until: '2026-11-01T00:00:00Z' }, { grace_capabilities: ['invoicing.invoice.issue'] },
    { cancel_at_period_end: true }, { capabilities: [] }, { capabilities: [null] },
    { capabilities: ['invoicing.invoice.issue', 'invoicing.invoice.issue'] },
    { capabilities: ['unknown.operation'] }, { capabilities: ['core.jobs.create'] },
    { product: 'pos', register_id: null, capabilities: ['pos.sale.create'] },
  ])('fails closed on malformed or foreign grant %j', (changes) => {
    expect(parseTestEntitlementRows('company-A', [row(changes)])).toEqual({ status: 'unavailable' })
  })

  it('accepts a correctly scoped POS row only for its register', () => {
    const snapshot = parseTestEntitlementRows('company-A', [row({ product: 'pos', register_id: 'register-A', capabilities: ['pos.sale.create'] })])
    const request = { snapshot, companyId: 'company-A', capability: 'pos.sale.create', now: Date.parse('2026-10-10T00:00:00Z') }
    expect(evaluateCapabilityEntitlement({ ...request, registerId: 'register-A' }).entitled).toBe(true)
    expect(evaluateCapabilityEntitlement({ ...request, registerId: 'register-B' }).entitled).toBe(false)
    expect(evaluateCapabilityEntitlement({ ...request, registerId: null }).entitled).toBe(false)
  })

  it.each([null, {}, '[]', [null], [[]], [row(), row()]])('rejects malformed or duplicate snapshots %j', (rows) => {
    expect(parseTestEntitlementRows('company-A', rows)).toEqual({ status: 'unavailable' })
  })

  it('has an explicit snapshot size limit and accepts an empty ledger', () => {
    expect(parseTestEntitlementRows('company-A', [])).toEqual({ status: 'ready', grants: [] })
    expect(parseTestEntitlementRows('company-A', Array.from({ length: 10_001 }, (_, i) => row({ id: `grant-${i}` })))).toEqual({ status: 'unavailable' })
    expect(parseTestEntitlementRows(' ', [])).toEqual({ status: 'unavailable' })
  })
})

function fixture(overrides: Record<string, unknown> = {}) {
  const records: Record<string, unknown> = {
    profiles: { id: 'profile-A', auth_user_id: 'auth-A', user_id: 'auth-A' },
    company_members: { company_id: 'company-A', profile_id: 'profile-A', is_active: true },
    ...overrides,
  }
  const filters: unknown[][] = []
  const auth = vi.fn().mockResolvedValue({ data: { user: { id: 'auth-A' } }, error: null })
  const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null })
  const from = vi.fn((table: string) => {
    const chain = {
      select: () => chain,
      eq: (...filter: unknown[]) => { filters.push([table, ...filter]); return chain },
      maybeSingle: async () => ({ data: records[table], error: null }),
    }
    return chain
  })
  const context = { companyId: 'company-A', profileId: 'profile-A', supabase: { auth: { getUser: auth }, from, rpc } }
  return { auth, rpc, from, filters, context: context as unknown as Parameters<typeof loadTestEntitlementSnapshot>[0] }
}

describe('test entitlement loader', () => {
  it('rechecks authenticated profile and active membership before the scoped RPC', async () => {
    const f = fixture()
    expect(await loadTestEntitlementSnapshot(f.context)).toMatchObject({ status: 'ready', grants: [{ origin: 'manual_grant' }] })
    expect(f.auth).toHaveBeenCalledOnce()
    expect(f.from.mock.calls).toEqual([['profiles'], ['company_members']])
    expect(f.filters).toEqual([
      ['profiles', 'id', 'profile-A'], ['company_members', 'company_id', 'company-A'],
      ['company_members', 'profile_id', 'profile-A'], ['company_members', 'is_active', true],
    ])
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('get_company_test_module_entitlements', { target_company_id: 'company-A' })
    expect(f.auth.mock.invocationCallOrder[0]).toBeLessThan(f.from.mock.invocationCallOrder[0])
    expect(f.from.mock.invocationCallOrder[1]).toBeLessThan(f.rpc.mock.invocationCallOrder[0])
  })

  it('never reads a test licence on a live deployment', async () => {
    vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'live')
    const f = fixture()
    expect(await loadTestEntitlementSnapshot(f.context)).toEqual({ status: 'ready', grants: [] })
    expect(f.auth).not.toHaveBeenCalled()
    expect(f.from).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it.each(['', 'invalid'])('fails closed without explicit billing mode %s', async (mode) => {
    vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', mode)
    const f = fixture()
    expect(await loadTestEntitlementSnapshot(f.context)).toEqual({ status: 'unavailable' })
    expect(f.auth).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { profiles: null }, { profiles: { id: 'profile-B', auth_user_id: 'auth-A' } },
    { profiles: { id: 'profile-A', auth_user_id: 'auth-other', user_id: 'auth-A' } },
    { profiles: { id: 'profile-A', auth_user_id: 'auth-A', user_id: 'auth-other' } },
    { profiles: { id: 'profile-A', auth_user_id: null, user_id: 'auth-A' } },
    { company_members: null },
    { company_members: { company_id: 'company-B', profile_id: 'profile-A', is_active: true } },
    { company_members: { company_id: 'company-A', profile_id: 'profile-B', is_active: true } },
    { company_members: { company_id: 'company-A', profile_id: 'profile-A', is_active: false } },
  ])('does not read grants for stale, mismatched or removed membership %j', async (overrides) => {
    const f = fixture(overrides)
    expect(await loadTestEntitlementSnapshot(f.context)).toEqual({ status: 'unavailable' })
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it.each([{ data: { user: null }, error: null }, { data: { user: { id: 'auth-A' } }, error: { message: 'invalid' } }])('requires verified auth before profile reads', async (auth) => {
    const f = fixture()
    f.auth.mockResolvedValue(auth)
    expect(await loadTestEntitlementSnapshot(f.context)).toEqual({ status: 'unavailable' })
    expect(f.from).not.toHaveBeenCalled()
    expect(f.rpc).not.toHaveBeenCalled()
  })

  it.each([
    { data: null, error: null }, { data: [row()], error: { message: 'private database detail' } },
    { data: [row({ company_id: 'company-B' })], error: null }, { data: [row({ livemode: true })], error: null },
  ])('does not expose or accept incomplete/foreign RPC output %j', async (response) => {
    const f = fixture()
    f.rpc.mockResolvedValue(response)
    expect(await loadTestEntitlementSnapshot(f.context)).toEqual({ status: 'unavailable' })
    expect(f.rpc).toHaveBeenCalledOnce()
  })

  it('fails closed on network failure without leaking details or retrying', async () => {
    const f = fixture()
    f.rpc.mockRejectedValue(new Error('private provider detail'))
    expect(await loadTestEntitlementSnapshot(f.context)).toEqual({ status: 'unavailable' })
    expect(f.rpc).toHaveBeenCalledOnce()
  })
})
