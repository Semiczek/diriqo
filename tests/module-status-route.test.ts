import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), company: vi.fn(), load: vi.fn(), testLoad: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/server-guards', () => ({ requireAuthenticatedUser: mocks.auth, requireWorkerAccess: mocks.company }))
vi.mock('@/lib/platform/paid-entitlement-loader', () => ({ loadPaidEntitlementSnapshot: mocks.load }))
vi.mock('@/lib/platform/test-entitlement-loader', () => ({ loadTestEntitlementSnapshot: mocks.testLoad }))
vi.mock('@/lib/platform/module-operation-access', () => ({ getPaidCompanyCapabilityAccess: mocks.access }))
import { GET } from '../app/api/billing/modules/route'
import { CAPABILITY_POLICY_VERSION } from '../lib/platform/capabilities'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ ok: true, value: { supabase: {} } })
  mocks.company.mockResolvedValue({ ok: true, value: { companyId: 'company-A', profileId: 'profile-A' } })
  mocks.load.mockResolvedValue({ status: 'ready', grants: [] })
  mocks.testLoad.mockResolvedValue({ status: 'ready', grants: [] })
  mocks.access.mockResolvedValue({ allowed: true, enforced: false, reason: 'legacy' })
})
it('uses the server company and never caches purchase status', async () => {
  const response = await GET()
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(mocks.load).toHaveBeenCalledWith({ supabase: {}, companyId: 'company-A', profileId: 'profile-A' })
  const body = await response.json()
  expect(body.companyId).toBe('company-A')
  expect(body.products.every((p: { purchasedCapabilities: unknown[] }) => p.purchasedCapabilities.length === 0)).toBe(true)
  expect(body.products.every((p: { isPaidActive: boolean; paidUntil: string | null }) => !p.isPaidActive && p.paidUntil === null)).toBe(true)
  expect(body.products.find((p: { product: string }) => p.product === 'diriqo_core').legacyAccess).toBe(true)
  expect(body.products.find((p: { product: string }) => p.product === 'inventory').legacyAccess).toBe(false)
})

it('reports test access independently from payment and does not leak audit references', async () => {
  const now = Date.now()
  mocks.testLoad.mockResolvedValue({ status: 'ready', grants: [{
    id: 'private-test-grant', companyId: 'company-A', product: 'invoicing', registerId: null,
    origin: 'manual_grant', state: 'active', revoked: false, sourceRef: 'private-audit-reference',
    validFrom: now - 1000, validUntil: now + 100_000,
    capabilities: ['invoicing.invoice.issue'],
  }] })
  mocks.access.mockResolvedValue({ allowed: true, enforced: true, reason: 'test' })
  const body = await (await GET()).json()
  const invoice = body.products.find((p: { product: string }) => p.product === 'invoicing')
  expect(invoice.isTestActive).toBe(true)
  expect(invoice.testUntil).toBe(new Date(now + 100_000).toISOString())
  expect(invoice.isPaidActive).toBe(false)
  expect(invoice.paidUntil).toBeNull()
  expect(invoice.purchasedCapabilities).toEqual([])
  expect(invoice.legacyAccess).toBe(false)
  expect(JSON.stringify(body)).not.toContain('private-')
})

it.each(['expired', 'future', 'revoked'])('does not mark a %s test licence active', async (kind) => {
  const now = Date.now()
  mocks.testLoad.mockResolvedValue({ status: 'ready', grants: [{
    product: 'pos', registerId: 'test-register', origin: 'manual_grant', state: 'active', revoked: kind === 'revoked',
    validFrom: kind === 'future' ? now + 100_000 : now - 100_000,
    validUntil: kind === 'expired' ? now - 1000 : now + 200_000,
  }] })
  const body = await (await GET()).json()
  const pos = body.products.find((p: { product: string }) => p.product === 'pos')
  expect(pos.registerId).toBe('test-register')
  expect(pos.isTestActive).toBe(false)
  expect(pos.testUntil).toBeNull()
})

it('does not turn missing test storage or failed access authority into an inactive licence', async () => {
  mocks.testLoad.mockResolvedValue({ status: 'unavailable' })
  expect((await GET()).status).toBe(503)
  mocks.testLoad.mockResolvedValue({ status: 'ready', grants: [] })
  mocks.access.mockRejectedValue(new Error('private database error'))
  const response = await GET()
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('private database error')
})
it('reports only the purchased capability without exposing invoice or actor identifiers', async () => {
  const now = Date.now()
  mocks.load.mockResolvedValue({ status: 'ready', grants: [{
    id: 'private-grant-id', companyId: 'company-A', product: 'invoicing', registerId: null,
    policyVersion: CAPABILITY_POLICY_VERSION, origin: 'paid', sourceRef: 'private-invoice-reference',
    state: 'active', revoked: false, validFrom: now - 1000, validUntil: now + 100_000,
    historyUntil: now + 200_000, graceUntil: null, capabilities: ['invoicing.invoice.issue'],
    graceCapabilities: [], cancelAtPeriodEnd: false,
  }] })
  const body = await (await GET()).json()
  expect(body.products.find((p: { product: string }) => p.product === 'invoicing').purchasedCapabilities).toEqual(['invoicing.invoice.issue'])
  expect(body.products.find((p: { product: string }) => p.product === 'invoicing').isPaidActive).toBe(true)
  expect(body.products.find((p: { product: string }) => p.product === 'invoicing').paidUntil).toBe(new Date(now + 100_000).toISOString())
  expect(JSON.stringify(body)).not.toContain('private-')
  expect(body.products.find((p: { product: string }) => p.product === 'inventory').purchasedCapabilities).toEqual([])
})
it('requires authenticated identity', async () => {
  mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'Authentication required' })
  expect((await GET()).status).toBe(401)
  expect(mocks.company).not.toHaveBeenCalled()
  expect(mocks.load).not.toHaveBeenCalled()
})
it('requires current company access', async () => {
  mocks.company.mockResolvedValue({ ok: false, status: 403, error: 'Access required' })
  expect((await GET()).status).toBe(403)
  expect(mocks.load).not.toHaveBeenCalled()
})
it('does not disguise storage failure as no purchases', async () => {
  mocks.load.mockResolvedValue({ status: 'unavailable' })
  const response = await GET()
  expect(response.status).toBe(503)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})

it.each(['expired', 'future', 'revoked'])('does not label a %s period as an active paid licence', async (kind) => {
  const now = Date.now()
  mocks.load.mockResolvedValue({ status: 'ready', grants: [{
    id: 'grant', companyId: 'company-A', product: 'invoicing', registerId: null,
    policyVersion: CAPABILITY_POLICY_VERSION, origin: 'paid', sourceRef: 'receipt',
    state: 'active', revoked: kind === 'revoked',
    validFrom: kind === 'future' ? now + 100_000 : now - 100_000,
    validUntil: kind === 'expired' ? now - 1000 : now + 200_000,
    historyUntil: now + 300_000, graceUntil: null,
    capabilities: ['invoicing.invoice.issue', 'invoicing.history.read'],
    graceCapabilities: [], cancelAtPeriodEnd: false,
  }] })
  const body = await (await GET()).json()
  const product = body.products.find((p: { product: string }) => p.product === 'invoicing')
  expect(product.isPaidActive).toBe(false)
  expect(product.paidUntil).toBeNull()
  if (kind === 'expired') expect(product.purchasedCapabilities).toEqual(['invoicing.history.read'])
})
