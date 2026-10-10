import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { loadPaidEntitlementSnapshot, parsePaidEntitlementRows } from '../lib/platform/paid-entitlement-loader'
import { CAPABILITY_POLICY_VERSION, evaluateCapabilityEntitlement } from '../lib/platform/capabilities'
import { readModuleBillingMode } from '../lib/platform/module-billing-mode'

beforeEach(() => vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'test'))
afterEach(() => vi.unstubAllEnvs())

const row = (changes = {}) => ({
  id: 'grant-A', company_id: 'company-A', product: 'invoicing', register_id: null, livemode: false,
  policy_version: CAPABILITY_POLICY_VERSION, source_ref: 'stripe/invoice/line', origin: 'paid', state: 'active',
  revoked: false, valid_from: '2026-10-01T00:00:00Z', valid_until: '2026-11-01T00:00:00Z',
  history_until: '2027-02-01T00:00:00Z', capabilities: ['invoicing.invoice.issue', 'invoicing.history.read'],
  grace_capabilities: [], grace_until: null, cancel_at_period_end: false, ...changes,
})

it('paid invoicing activates only the purchased product and period', () => {
  const snapshot = parsePaidEntitlementRows('company-A', [row()], false)
  const request = { snapshot, companyId: 'company-A', registerId: null, now: Date.parse('2026-10-10T00:00:00Z') }
  expect(evaluateCapabilityEntitlement({ ...request, capability: 'invoicing.invoice.issue' }).entitled).toBe(true)
  expect(evaluateCapabilityEntitlement({ ...request, capability: 'inventory.receipt.post' }).entitled).toBe(false)
  expect(evaluateCapabilityEntitlement({ ...request, capability: 'invoicing.invoice.issue', companyId: 'company-B' }).entitled).toBe(false)
  expect(evaluateCapabilityEntitlement({ ...request, capability: 'invoicing.invoice.issue', now: Date.parse('2026-11-01T00:00:00Z') }).entitled).toBe(false)
  expect(evaluateCapabilityEntitlement({ ...request, capability: 'invoicing.history.read', now: Date.parse('2026-11-01T00:00:00Z') }).entitled).toBe(true)
})

it.each([
  { company_id: 'company-B' }, { capabilities: ['inventory.receipt.post'] },
  { capabilities: ['unknown'] }, { capabilities: ['invoicing.invoice.issue', 'invoicing.invoice.issue'] },
  { register_id: 'register-other' }, { policy_version: 'future-version' }, { origin: 'manual_grant' },
  { revoked: 'false' }, { history_until: '2026-10-01T00:00:00Z' }, { valid_from: 'invalid' },
])('rejects malformed or mismatched persisted grant %j', (change) => {
  expect(parsePaidEntitlementRows('company-A', [row(change)], false)).toEqual({ status: 'unavailable' })
})

it('keeps revocation authoritative while retaining readable snapshot metadata', () => {
  const snapshot = parsePaidEntitlementRows('company-A', [row({ revoked: true })], false)
  expect(evaluateCapabilityEntitlement({ snapshot, companyId: 'company-A', registerId: null,
    now: Date.parse('2026-10-10T00:00:00Z'), capability: 'invoicing.history.read' }).entitled).toBe(false)
})

it('no paid records means no paid grants', () => {
  expect(parsePaidEntitlementRows('company-A', [], false)).toEqual({ status: 'ready', grants: [] })
})

it('separates test and live purchases for the same company', () => {
  expect(parsePaidEntitlementRows('company-A', [row()], true)).toEqual({ status: 'unavailable' })
  expect(parsePaidEntitlementRows('company-A', [row({ livemode: true })], false)).toEqual({ status: 'unavailable' })
  expect(parsePaidEntitlementRows('company-A', [row({ livemode: true })], true).status).toBe('ready')
})

it('requires an explicit server-owned billing mode', async () => {
  vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', '')
  expect(readModuleBillingMode()).toBeNull()
  const fixture = context()
  expect(await loadPaidEntitlementSnapshot(fixture.context)).toEqual({ status: 'unavailable' })
  expect(fixture.queried).toEqual([])
  vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'live')
  expect(readModuleBillingMode()).toBe(true)
})

function context(override: Record<string, unknown> = {}, apiRowCap = Infinity, reportedCount?: number | null) {
  const queried: string[] = []
  const filters: unknown[][] = []
  const ranges: number[][] = []
  const data: Record<string, unknown> = {
    profiles: { id: 'profile-A', auth_user_id: 'auth-A', user_id: 'auth-A' },
    company_members: { company_id: 'company-A', profile_id: 'profile-A', is_active: true },
    company_module_entitlements: [row()], ...override,
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth-A' } }, error: null }) },
    from: (table: string) => {
      queried.push(table)
      let start = 0, end = Infinity
      const chain = { select: () => chain, eq: (...filter: unknown[]) => { filters.push(filter); return chain },
        order: () => chain,
        range: (from: number, to: number) => { start = from; end = to; ranges.push([from, to]); return chain },
        maybeSingle: async () => ({ data: data[table], error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          const values = data[table]
          return Promise.resolve({
            data: Array.isArray(values) ? values.slice(start, Math.min(end + 1, start + apiRowCap)) : values,
            count: reportedCount !== undefined ? reportedCount : Array.isArray(values) ? values.length : null,
            error: null,
          }).then(resolve)
        },
      }
      return chain
    },
  }
  return { queried, filters, ranges, context: { supabase: client, companyId: 'company-A', profileId: 'profile-A' } as unknown as Parameters<typeof loadPaidEntitlementSnapshot>[0] }
}

it('loads persisted paid periods using the current authenticated membership', async () => {
  const fixture = context()
  expect((await loadPaidEntitlementSnapshot(fixture.context)).status).toBe('ready')
  expect(fixture.queried).toContain('company_module_entitlements')
  expect(fixture.filters).toContainEqual(['company_id', 'company-A'])
  expect(fixture.filters).toContainEqual(['livemode', false])
})

it('retrieves every paid period even below the requested server row cap', async () => {
  const rows = Array.from({ length: 502 }, (_, index) => row({ id: `grant-${String(index).padStart(4, '0')}` }))
  const fixture = context({ company_module_entitlements: rows }, 100)
  const snapshot = await loadPaidEntitlementSnapshot(fixture.context)
  expect(snapshot.status).toBe('ready')
  if (snapshot.status === 'ready') expect(snapshot.grants).toHaveLength(502)
  expect(fixture.ranges).toHaveLength(6)
  expect(fixture.ranges[5][0]).toBe(500)
})

it.each([null, 10_001, 2])('refuses incomplete or oversized ledger count %j', async (count) => {
  const fixture = context({}, Infinity, count)
  expect(await loadPaidEntitlementSnapshot(fixture.context)).toEqual({ status: 'unavailable' })
})

it.each([
  { profiles: { id: 'profile-A', auth_user_id: 'other', user_id: 'auth-A' } },
  { company_members: null },
  { company_members: { company_id: 'company-B', profile_id: 'profile-A', is_active: true } },
  { company_members: { company_id: 'company-A', profile_id: 'profile-A', is_active: false } },
])('rechecks identity/membership before paid data %j', async (change) => {
  const fixture = context(change)
  expect(await loadPaidEntitlementSnapshot(fixture.context)).toEqual({ status: 'unavailable' })
  expect(fixture.queried).not.toContain('company_module_entitlements')
})
