import { beforeEach, afterEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { loadModuleOfferCatalog } from '../lib/platform/module-offer-catalog'
import { CAPABILITY_POLICY_VERSION } from '../lib/platform/capabilities'

const offer = {
  id: 'd0000000-0000-4000-8000-000000000001', offer_key: 'core-test-monthly', product: 'diriqo_core',
  stripe_price_id: 'price_private', unit_amount: 29900, currency: 'czk', livemode: false,
  capabilities: ['core.jobs.create'], policy_version: CAPABILITY_POLICY_VERSION, history_days: 90, is_published: true,
}
const price = {
  id: 'price_private', object: 'price', active: true, livemode: false, currency: 'czk', unit_amount: 29900,
  unit_amount_decimal: '29900', type: 'recurring', billing_scheme: 'per_unit', custom_unit_amount: null,
  transform_quantity: null, tiers_mode: null, tax_behavior: 'unspecified',
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', trial_period_days: null },
  product: { id: 'prod_private', object: 'product', active: true, livemode: false },
}
const from = vi.fn(), retrieve = vi.fn(), filter = vi.fn()
let rows: { error: unknown; data: unknown; count: number | null }
const deps = { admin: { from }, stripe: { prices: { retrieve } } } as unknown as Parameters<typeof loadModuleOfferCatalog>[0]
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DIRIQO_MODULE_CHECKOUT_ENABLED', 'true')
  vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'test')
  rows = { error: null, data: [structuredClone(offer)], count: 1 }
  retrieve.mockResolvedValue(structuredClone(price))
  from.mockImplementation((table) => {
    filter(table)
    const query = { select: () => query, eq: (...args: unknown[]) => { filter(...args); return query }, order: () => query, range: async () => rows }
    return query
  })
})
afterEach(() => vi.unstubAllEnvs())

it('publishes only provider-verified display prices without private billing identifiers', async () => {
  const result = await loadModuleOfferCatalog(deps)
  expect(result).toEqual({ enabled: true, offers: [{ id: offer.id, product: 'diriqo_core', offerKey: offer.offer_key, unitAmount: 29900, currency: 'czk', billingInterval: 'month' }] })
  expect(filter).toHaveBeenCalledWith('livemode', false)
  expect(filter).toHaveBeenCalledWith('is_published', true)
  expect(retrieve).toHaveBeenCalledWith('price_private', { expand: ['product'] })
  expect(JSON.stringify(result)).not.toContain('private')
  expect(JSON.stringify(result)).not.toContain('capabilities')
})
it.each(['live', '', 'invalid'])('disables catalog completely for %s mode without contacting providers', async mode => {
  vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', mode)
  expect(await loadModuleOfferCatalog(deps)).toEqual({ enabled: false, offers: [] })
  expect(from).not.toHaveBeenCalled()
  expect(retrieve).not.toHaveBeenCalled()
})
it('requires an explicit checkout opt-in even in test mode', async () => {
  vi.stubEnv('DIRIQO_MODULE_CHECKOUT_ENABLED', '')
  expect(await loadModuleOfferCatalog(deps)).toEqual({ enabled: false, offers: [] })
  expect(from).not.toHaveBeenCalled()
})
it.each([
  { error: new Error('private'), data: null, count: null },
  { error: null, data: [offer], count: 2 },
  { error: null, data: [offer], count: null },
  { error: null, data: Array.from({ length: 101 }, () => offer), count: 101 },
])('does not show a partial or unverified catalog %#', async value => {
  rows = value
  await expect(loadModuleOfferCatalog(deps)).rejects.toThrow()
  expect(retrieve).not.toHaveBeenCalled()
})
it('does not replace an empty real catalog with the proposed CZK pricing', async () => {
  rows = { error: null, data: [], count: 0 }
  expect(await loadModuleOfferCatalog(deps)).toEqual({ enabled: true, offers: [] })
  expect(retrieve).not.toHaveBeenCalled()
})
it.each([{ is_published: false }, { livemode: true }, { capabilities: ['pos.sale.create'] }, { currency: 'isk' }])('independently rejects a wrongly scoped offer %#', async patch => {
  rows.data = [{ ...offer, ...patch }]
  await expect(loadModuleOfferCatalog(deps)).rejects.toThrow()
  expect(retrieve).not.toHaveBeenCalled()
})
it('rejects a stored amount that differs from the provider price', async () => {
  retrieve.mockResolvedValue({ ...price, unit_amount: 49900 })
  await expect(loadModuleOfferCatalog(deps)).rejects.toThrow()
})
it('fails closed on a provider outage', async () => {
  retrieve.mockRejectedValue(new Error('provider down'))
  await expect(loadModuleOfferCatalog(deps)).rejects.toThrow()
})
it('rejects duplicate offers rather than rendering duplicate purchase controls', async () => {
  rows = { error: null, data: [offer, offer], count: 2 }
  await expect(loadModuleOfferCatalog(deps)).rejects.toThrow('Duplicate')
})
