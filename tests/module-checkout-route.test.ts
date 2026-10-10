import { beforeEach, afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), company: vi.fn(), enabled: vi.fn(), create: vi.fn(), admin: vi.fn(), stripe: vi.fn(), catalog: vi.fn() }))
vi.mock('@/lib/server-guards', () => ({ requireAuthenticatedUser: mocks.auth, requireCompanyRole: mocks.company }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
vi.mock('@/lib/stripe', () => ({ getStripe: mocks.stripe }))
vi.mock('@/lib/platform/module-offer-catalog', () => ({ loadModuleOfferCatalog: mocks.catalog }))
vi.mock('@/lib/platform/module-checkout', () => ({
  isModuleCheckoutEnabled: mocks.enabled, createModuleCheckout: mocks.create,
  ModuleCheckoutError: class extends Error { constructor(readonly code: string, readonly status: number) { super(code) } },
}))
import { POST } from '../app/api/billing/modules/checkout/route'
import { GET } from '../app/api/billing/modules/catalog/route'
import { ModuleCheckoutError } from '../lib/platform/module-checkout'

const companyId = 'a0000000-0000-4000-8000-000000000001'
const offerId = 'b0000000-0000-4000-8000-000000000001'
const actor = 'c0000000-0000-4000-8000-000000000001'
function request(body: unknown = { offerId }, headers: Record<string, string> = {}) {
  return new Request('https://hostile-request-host.invalid/api/billing/modules/checkout', {
    method: 'POST', headers: { origin: 'https://diriqo.example', 'x-diriqo-company': companyId, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://diriqo.example/')
  mocks.auth.mockResolvedValue({ ok: true, value: { user: { id: actor } } })
  mocks.company.mockResolvedValue({ ok: true, value: { companyId } })
  mocks.enabled.mockReturnValue(true)
  mocks.stripe.mockReturnValue({ trusted: 'stripe' })
  mocks.admin.mockReturnValue({ trusted: 'database' })
  mocks.create.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_example', orderId: offerId })
  mocks.catalog.mockResolvedValue({ enabled: true, offers: [] })
})
afterEach(() => vi.unstubAllEnvs())

it('binds purchase to verified actor/company and configured return origin, never request host', async () => {
  const result = await POST(request())
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toBe('private, no-store')
  expect(mocks.company).toHaveBeenCalledWith('company_admin', 'super_admin')
  expect(mocks.create).toHaveBeenCalledWith({
    companyId, actorAuthUserId: actor, offerId, registerId: null, appUrl: 'https://diriqo.example',
  }, { stripe: { trusted: 'stripe' }, admin: { trusted: 'database' } })
})
it.each([POST, async () => GET()])('requires authenticated identity for commerce route %#', async (invoke) => {
  mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'Authentication required' })
  expect((await invoke(request())).status).toBe(401)
  expect(mocks.company).not.toHaveBeenCalled()
  expect(mocks.stripe).not.toHaveBeenCalled()
})
it.each([POST, async () => GET()])('requires fresh administrator membership for commerce route %#', async (invoke) => {
  mocks.company.mockResolvedValue({ ok: false, status: 403, error: 'Not allowed' })
  expect((await invoke(request())).status).toBe(403)
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.stripe).not.toHaveBeenCalled()
})
it('release-disabled POST never constructs a Stripe/admin client', async () => {
  mocks.enabled.mockReturnValue(false)
  expect((await POST(request())).status).toBe(503)
  expect(mocks.stripe).not.toHaveBeenCalled()
  expect(mocks.admin).not.toHaveBeenCalled()
})
it.each(['', 'null', 'https://attacker.example', 'https://diriqo.example.attacker.example'])('rejects untrusted origin %s', async (origin) => {
  expect((await POST(request({ offerId }, { origin }))).status).toBe(403)
  expect(mocks.create).not.toHaveBeenCalled()
})
it('rejects cross-site fetch and a stale company tab', async () => {
  expect((await POST(request({ offerId }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
  expect((await POST(request({ offerId }, { 'x-diriqo-company': 'other-company' }))).status).toBe(409)
  expect(mocks.create).not.toHaveBeenCalled()
})
it.each(['', 'http://public.example', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?redirect=x', 'https://example.com/#return'])('rejects unsafe configured origin %s', async (url) => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', url)
  expect((await POST(request())).status).toBe(503)
  expect(mocks.create).not.toHaveBeenCalled()
})
it.each([null, [], {}, { offerId: 123 }, { offerId: 'not-a-uuid' }, { offerId, companyId }, { offerId, priceId: 'price_tampered' }, { offerId, capabilities: ['pos.sale.create'] }, { offerId, amount: 1 }])('rejects client-side scope/pricing or malformed input %#', async (body) => {
  expect((await POST(request(body))).status).toBe(400)
  expect(mocks.create).not.toHaveBeenCalled()
})
it('rejects non-JSON and oversized input', async () => {
  expect((await POST(request({ offerId }, { 'content-type': 'text/plain' }))).status).toBe(415)
  expect((await POST(request({ offerId: 'x'.repeat(1200) }))).status).toBe(400)
})
it('reports a safe conflict and never leaks provider/database error details', async () => {
  mocks.create.mockRejectedValue(new ModuleCheckoutError('payment_pending', 409))
  const conflict = await POST(request())
  expect(conflict.status).toBe(409)
  expect((await conflict.json()).code).toBe('payment_pending')
  mocks.create.mockRejectedValue(new Error('secret_provider_detail'))
  const unavailable = await POST(request())
  expect(unavailable.status).toBe(503)
  expect(await unavailable.text()).not.toContain('secret_provider_detail')
})
it('disabled catalog returns scoped empty offers without needing billing secrets', async () => {
  mocks.enabled.mockReturnValue(false)
  const response = await GET()
  expect(await response.json()).toEqual({ companyId, enabled: false, offers: [] })
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(mocks.stripe).not.toHaveBeenCalled()
})
it('catalog preserves unavailable status instead of showing no available products', async () => {
  mocks.catalog.mockRejectedValue(new Error('private_failure'))
  const response = await GET()
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('private_failure')
})
it('returns catalog only for the server-selected company', async () => {
  const response = await GET()
  expect(await response.json()).toEqual({ companyId, enabled: true, offers: [] })
})
