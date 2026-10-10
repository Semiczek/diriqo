import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  createModuleCheckout, isModuleCheckoutEnabled, ModuleCheckoutError,
  parseModuleCheckoutOffer, validateModuleCheckoutPrice,
  type ModuleCheckoutDependencies, type ModuleCheckoutInput,
} from '../lib/platform/module-checkout'
import { CAPABILITY_POLICY_VERSION } from '../lib/platform/capabilities'
import { MODULE_BILLING_FLOW } from '../lib/platform/module-payment-handler'

const COMPANY = '00000000-0000-4000-8000-000000000001'
const ACTOR = '00000000-0000-4000-8000-000000000002'
const OTHER_ACTOR = '00000000-0000-4000-8000-000000000003'
const OFFER = '00000000-0000-4000-8000-000000000004'
const ORDER = '00000000-0000-4000-8000-000000000005'
const FOREIGN_COMPANY = '00000000-0000-4000-8000-000000000006'
const NOW = 1_792_000_000
const URL = 'https://checkout.stripe.com/c/pay/cs_test_module#synthetic'
type Row = Record<string, unknown>
const metadata = () => ({ billing_flow: MODULE_BILLING_FLOW, company_id: COMPANY, module_order_id: ORDER })
const input = (): ModuleCheckoutInput => ({ companyId: COMPANY, actorAuthUserId: ACTOR, offerId: OFFER, registerId: null, appUrl: 'https://app.example.invalid' })
const offerFixture = (): Row => ({
  id: OFFER, offer_key: 'core-monthly-v1', product: 'diriqo_core', stripe_price_id: 'price_module',
  livemode: false, is_published: true, currency: 'czk', unit_amount: 49000,
  capabilities: ['core.jobs.create', 'core.history.read'], policy_version: CAPABILITY_POLICY_VERSION, history_days: 30,
})
const priceFixture = () => ({
  id: 'price_module', object: 'price', active: true, livemode: false, currency: 'czk', unit_amount: 49000,
  unit_amount_decimal: '49000', type: 'recurring', billing_scheme: 'per_unit', custom_unit_amount: null,
  transform_quantity: null, tiers_mode: null, tax_behavior: 'unspecified',
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', trial_period_days: null },
  product: { id: 'prod_module', object: 'product', active: true, livemode: false },
})
const customerFixture = () => ({ id: 'cus_company', object: 'customer', livemode: false, balance: 0, discount: null,
  metadata: { company_id: COMPANY, billing_flow: MODULE_BILLING_FLOW } })
const attemptFixture = (): Row => ({
  order_id: ORDER, company_id: COMPANY, product: 'diriqo_core', register_id: null, livemode: false, offer_id: OFFER,
  actor_auth_user_id: ACTOR, created_at: new Date(NOW * 1000).toISOString(), expires_at: new Date((NOW + 3600) * 1000).toISOString(),
  stripe_session_id: null, stripe_session_url: null, state: 'preparing', stripe_customer_id: 'cus_company',
})
const sessionFixture = () => ({
  id: 'cs_test_module', object: 'checkout.session', mode: 'subscription', status: 'open', livemode: false,
  customer: 'cus_company', client_reference_id: COMPANY, expires_at: NOW + 3600, metadata: metadata(),
  currency: 'czk', amount_subtotal: 49000, amount_total: 49000, automatic_tax: { enabled: false },
  total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 }, url: URL,
  line_items: { has_more: false, data: [{ price: { id: 'price_module' }, quantity: 1, currency: 'czk', amount_subtotal: 49000, amount_total: 49000 }] },
})
let offer: Row
let price: ReturnType<typeof priceFixture>
let customer: ReturnType<typeof customerFixture>
let mapping: Row | null
let attempt: Row
let session: ReturnType<typeof sessionFixture>
let deps: ModuleCheckoutDependencies
const retrievePrice = vi.fn(), createCustomer = vi.fn(), retrieveCustomer = vi.fn()
const createSession = vi.fn(), retrieveSession = vi.fn(), rpc = vi.fn(), from = vi.fn(), filters = vi.fn()
let readError: unknown

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers(); vi.setSystemTime(NOW * 1000)
  vi.stubEnv('DIRIQO_MODULE_CHECKOUT_ENABLED', 'true'); vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'test')
  offer = offerFixture(); price = priceFixture(); customer = customerFixture(); attempt = attemptFixture(); session = sessionFixture()
  mapping = { company_id: COMPANY, livemode: false, stripe_customer_id: 'cus_company' }; readError = null
  retrievePrice.mockImplementation(async () => structuredClone(price))
  retrieveCustomer.mockImplementation(async () => structuredClone(customer))
  createCustomer.mockImplementation(async () => structuredClone(customer))
  createSession.mockImplementation(async () => structuredClone(session))
  retrieveSession.mockImplementation(async () => structuredClone(session))
  from.mockImplementation((table: string) => {
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters(table, key, value); return query },
      maybeSingle: async () => ({ data: structuredClone(table === 'module_offers' ? offer : mapping), error: readError }) }
    return query
  })
  rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'bind_module_billing_customer') return { data: 'cus_company', error: null }
    if (name === 'record_module_checkout_session') attempt = { ...attempt,
      stripe_session_id: args.p_session_id, stripe_session_url: args.p_session_url, state: 'open' }
    if (name === 'close_module_checkout_session') attempt = { ...attempt, state: args.p_state }
    return { data: structuredClone(attempt), error: null }
  })
  deps = { stripe: { prices: { retrieve: retrievePrice }, customers: { create: createCustomer, retrieve: retrieveCustomer },
    checkout: { sessions: { create: createSession, retrieve: retrieveSession } } }, admin: { from, rpc } } as unknown as ModuleCheckoutDependencies
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
const run = (overrides: Partial<ModuleCheckoutInput> = {}) => createModuleCheckout({ ...input(), ...overrides }, deps)
const openAttempt = () => { attempt = { ...attempt, stripe_session_id: session.id, stripe_session_url: URL, state: 'open' } }

describe('explicit sandbox gate', () => {
  it.each([
    ['', 'test'], ['false', 'test'], ['TRUE', 'test'], ['true', ''], ['true', 'live'], ['true', 'unknown'],
  ])('refuses flag %j with billing mode %j before any provider/storage action', async (flag, mode) => {
    vi.stubEnv('DIRIQO_MODULE_CHECKOUT_ENABLED', flag); vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', mode)
    expect(isModuleCheckoutEnabled()).toBe(false)
    await expect(run()).rejects.toMatchObject({ code: 'checkout_unavailable', status: 503 })
    expect(from).not.toHaveBeenCalled(); expect(createSession).not.toHaveBeenCalled()
  })
  it('requires both exact configuration values', () => expect(isModuleCheckoutEnabled()).toBe(true))
})

describe('one canonical offer and price validator for catalog and checkout', () => {
  it.each([
    { is_published: false }, { is_published: 'true' }, { livemode: true }, { livemode: 0 }, { product: 'pos' },
    { product: 'ai_assistant' }, { product: 'future_module' }, { capabilities: ['inventory.receipt.post'] },
    { capabilities: ['core.unknown'] }, { capabilities: ['core.jobs.create', 'core.jobs.create'] }, { capabilities: [] },
    { capabilities: [true] }, { currency: 'CZK' }, { currency: 'czkk' }, { currency: 'isk' }, { currency: 'usd' }, { unit_amount: 0 }, { unit_amount: '49000' },
    { unit_amount: 0.5 }, { unit_amount: Number.MAX_SAFE_INTEGER + 1 }, { policy_version: 'unknown' },
    { history_days: -1 }, { history_days: 0.5 }, { id: 'client-offer' }, { stripe_price_id: '' }, { offer_key: '' },
  ])('rejects unsupported or malformed offer %j', (patch) => {
    expect(() => parseModuleCheckoutOffer({ ...offer, ...patch })).toThrow(ModuleCheckoutError)
  })
  it.each([
    ['diriqo_core', 'core.jobs.create'], ['inventory', 'inventory.receipt.post'], ['invoicing', 'invoicing.invoice.issue'],
    ['smart_quotes', 'smart_quotes.template.manage'], ['fleet', 'fleet.vehicle.manage'],
  ])('keeps %s independently scoped', (product, capability) => {
    expect(parseModuleCheckoutOffer({ ...offer, product, capabilities: [capability] }).product).toBe(product)
  })
  it.each([
    { id: 'price_other' }, { object: 'not-price' }, { active: false }, { livemode: true }, { currency: 'eur' },
    { unit_amount: 49001 }, { unit_amount_decimal: '49000.01' }, { type: 'one_time' }, { billing_scheme: 'tiered' },
    { custom_unit_amount: { minimum: 1 } }, { transform_quantity: { divide_by: 10 } }, { tiers_mode: 'volume' },
    { tiers: [{}] }, { tax_behavior: 'inclusive' }, { recurring: null }, { product: 'prod_module' },
    { product: { ...priceFixture().product, active: false } }, { product: { ...priceFixture().product, livemode: true } },
    { product: { ...priceFixture().product, deleted: true } },
  ])('rejects canonical price mismatch %j', (patch) => {
    expect(() => validateModuleCheckoutPrice(parseModuleCheckoutOffer(offer), { ...price, ...patch })).toThrow(ModuleCheckoutError)
  })
  it.each([{ interval: 'week' }, { interval_count: 2 }, { usage_type: 'metered' }, { trial_period_days: 14 }])('rejects recurring adjustment %j', (patch) => {
    expect(() => validateModuleCheckoutPrice(parseModuleCheckoutOffer(offer), { ...price, recurring: { ...price.recurring, ...patch } })).toThrow(ModuleCheckoutError)
  })
  it.each(['month', 'year'])('returns the canonical %s interval', (interval) => {
    expect(validateModuleCheckoutPrice(parseModuleCheckoutOffer(offer), { ...price, recurring: { ...price.recurring, interval } })).toBe(interval)
  })
  it('accepts separately configured EUR offers without using a legacy plan mapping', () => {
    expect(validateModuleCheckoutPrice(parseModuleCheckoutOffer({ ...offer, currency: 'eur' }), { ...price, currency: 'eur' })).toBe('month')
  })
})

describe('server-owned checkout orchestration', () => {
  it('reserves the company scope and saves the verified hosted session before returning it', async () => {
    expect(await run()).toEqual({ url: URL, orderId: ORDER })
    expect(retrievePrice).toHaveBeenCalledExactlyOnceWith('price_module', { expand: ['product'] })
    expect(filters).toHaveBeenCalledWith('module_billing_customers', 'company_id', COMPANY)
    expect(filters).toHaveBeenCalledWith('module_billing_customers', 'livemode', false)
    expect(rpc).toHaveBeenNthCalledWith(1, 'reserve_module_checkout', {
      p_company_id: COMPANY, p_offer_id: OFFER, p_register_id: null, p_livemode: false, p_actor_auth_user_id: ACTOR,
    })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'subscription', customer: 'cus_company', client_reference_id: COMPANY,
      line_items: [{ price: 'price_module', quantity: 1 }], currency: 'czk',
      metadata: metadata(), subscription_data: { metadata: metadata() }, expires_at: NOW + 3600,
      success_url: 'https://app.example.invalid/billing/modules?checkout=returned',
      cancel_url: 'https://app.example.invalid/billing/modules?checkout=cancelled',
      allow_promotion_codes: false, automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false },
      integration_identifier: expect.stringMatching(/^diriqo_modules_v1_[a-z]{8}$/),
    }), { idempotencyKey: `module-checkout:${ORDER}` })
    expect(createSession.mock.calls[0][0]).not.toHaveProperty('payment_method_types')
    expect(createSession.mock.calls[0][0].subscription_data).not.toHaveProperty('trial_period_days')
    expect(rpc).toHaveBeenLastCalledWith('record_module_checkout_session', {
      p_order_id: ORDER, p_session_id: session.id, p_session_url: URL, p_expires_at: NOW + 3600,
    })
    expect(from.mock.calls.map(([table]) => table)).toEqual(['module_offers', 'module_billing_customers'])
  })
  it('resumes the same canonical session on a duplicate request without creating another', async () => {
    const first = await run(); session.url = URL + 'canonical'
    expect(await run()).toEqual({ ...first, url: session.url })
    expect(createSession).toHaveBeenCalledOnce()
    expect(retrieveSession).toHaveBeenCalledExactlyOnceWith('cs_test_module', { expand: ['line_items.data.price'] })
  })
  it('uses the same Stripe body and idempotency key when persistence fails after provider creation', async () => {
    const implementation = rpc.getMockImplementation()!
    let failed = false
    rpc.mockImplementation(async (name, args) => {
      if (name === 'record_module_checkout_session' && !failed) { failed = true; return { data: null, error: { message: 'synthetic outage' } } }
      return implementation(name, args)
    })
    await expect(run()).rejects.toMatchObject({ code: 'storage_unavailable', status: 503 })
    expect(await run()).toEqual({ url: URL, orderId: ORDER })
    expect(createSession.mock.calls[1]).toEqual(createSession.mock.calls[0])
  })
  it('binds a new customer using a stable company key and uses the concurrently chosen winner', async () => {
    mapping = null
    createCustomer.mockResolvedValue({ ...customer, id: 'cus_newcandidate' })
    expect(await run()).toEqual({ url: URL, orderId: ORDER })
    expect(createCustomer).toHaveBeenCalledExactlyOnceWith({ metadata: { company_id: COMPANY, billing_flow: MODULE_BILLING_FLOW } },
      { idempotencyKey: `module-customer:test:${COMPANY}` })
    expect(rpc).toHaveBeenNthCalledWith(1, 'bind_module_billing_customer', { p_company_id: COMPANY, p_livemode: false, p_customer_id: 'cus_newcandidate' })
    expect(retrieveCustomer).toHaveBeenCalledExactlyOnceWith('cus_company')
    expect(createSession.mock.calls[0][0].customer).toBe('cus_company')
  })
  it('allows a second company admin to resume the first admin’s immutable audit reservation', async () => {
    attempt.actor_auth_user_id = OTHER_ACTOR
    expect(await run()).toEqual({ url: URL, orderId: ORDER })
    expect(rpc.mock.calls[0][1].p_actor_auth_user_id).toBe(ACTOR)
  })
  it.each(['http://app.example.invalid', 'javascript:alert(1)', 'https://user:secret@app.example.invalid',
    'https://app.example.invalid/other', 'https://app.example.invalid?redirect=evil', 'https://app.example.invalid#evil',
    ' https://app.example.invalid', 'https://app.example.invalid\\evil'])('rejects an unsafe or non-origin app URL %s before calls', async (appUrl) => {
    await expect(run({ appUrl })).rejects.toMatchObject({ code: 'invalid_request' })
    expect(from).not.toHaveBeenCalled()
  })
  it('permits configured localhost for local sandbox development', async () => {
    await run({ appUrl: 'http://localhost:3000/' })
    expect(createSession.mock.calls[0][0].success_url).toBe('http://localhost:3000/billing/modules?checkout=returned')
  })
  it.each([{ companyId: 'not-a-company' }, { actorAuthUserId: 'unknown' }, { offerId: 'price_from_client' }, { registerId: 'register' }])('rejects malformed input %j', async (patch) => {
    await expect(run(patch as Partial<ModuleCheckoutInput>)).rejects.toMatchObject({ code: 'invalid_request' })
    expect(createSession).not.toHaveBeenCalled()
  })
  it.each([{ company_id: FOREIGN_COMPANY }, { livemode: true }, { stripe_customer_id: '' }])('rejects a foreign or malformed customer mapping %j', async (patch) => {
    mapping = { ...mapping, ...patch }
    await expect(run()).rejects.toMatchObject({ code: 'invalid_binding' })
    expect(createSession).not.toHaveBeenCalled()
  })
  it.each([
    { id: 'cus_foreign' }, { livemode: true }, { deleted: true }, { metadata: { ...customerFixture().metadata, company_id: FOREIGN_COMPANY } },
    { metadata: { ...customerFixture().metadata, billing_flow: 'legacy' } },
  ])('rejects a provider customer binding mismatch %j', async (patch) => {
    retrieveCustomer.mockResolvedValue({ ...customer, ...patch })
    await expect(run()).rejects.toMatchObject({ code: 'customer_mismatch' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([{ balance: -1 }, { balance: 1 }, { discount: { id: 'di_discount' } }, { invoice_credit_balance: { czk: 100 } }])('blocks customer adjustments %j unsupported by invoice fulfillment', async (patch) => {
    retrieveCustomer.mockResolvedValue({ ...customer, ...patch })
    await expect(run()).rejects.toMatchObject({ code: 'customer_adjustments' })
    expect(createSession).not.toHaveBeenCalled()
  })
  it.each([
    { company_id: FOREIGN_COMPANY }, { offer_id: ACTOR }, { product: 'fleet' }, { livemode: true }, { stripe_customer_id: 'cus_foreign' },
    { register_id: ACTOR }, { actor_auth_user_id: 'invalid' }, { order_id: 'invalid' }, { expires_at: 'forever' },
    { created_at: new Date((NOW + 120) * 1000).toISOString(), expires_at: new Date((NOW + 3720) * 1000).toISOString() },
    { state: 'open' }, { stripe_session_id: 'cs_hidden' },
  ])('rechecks reservation scope and structure %j', async (patch) => {
    attempt = { ...attempt, ...patch }
    await expect(run()).rejects.toMatchObject({ code: 'invalid_binding' })
    expect(createSession).not.toHaveBeenCalled()
  })
  it.each([1801, 3601, 90000])('never recreates unknown provider outcomes after %s seconds', async (elapsed) => {
    vi.setSystemTime((NOW + elapsed) * 1000)
    await expect(run()).rejects.toMatchObject({ code: 'checkout_review_required', status: 409 })
    expect(createSession).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledOnce()
  })
  it('allows an existing open session within its final 30 minutes', async () => {
    openAttempt(); vi.setSystemTime((NOW + 2000) * 1000)
    expect(await run()).toEqual({ url: URL, orderId: ORDER })
    expect(createSession).not.toHaveBeenCalled()
  })
  it.each(['complete', 'expired'])('closes canonical %s state without a second purchase or entitlement write', async (state) => {
    openAttempt(); session.status = state; session.url = null as unknown as string
    await expect(run()).rejects.toMatchObject({ code: state === 'complete' ? 'payment_pending' : 'checkout_expired', status: 409 })
    expect(rpc).toHaveBeenLastCalledWith('close_module_checkout_session', { p_order_id: ORDER, p_session_id: 'cs_test_module', p_state: state })
    expect(createSession).not.toHaveBeenCalled()
    expect(rpc.mock.calls.some(([name]) => name === 'apply_paid_module_invoice')).toBe(false)
  })
  it.each(['complete', 'expired'])('retains an unrecorded terminal %s session with no URL for operator reconciliation', async (state) => {
    session.status = state; session.url = null as unknown as string
    await expect(run()).rejects.toMatchObject({ code: 'checkout_review_required', status: 409 })
    expect(rpc).toHaveBeenCalledOnce()
    expect(attempt.state).toBe('preparing')
  })
  it.each([
    { livemode: true }, { customer: 'cus_foreign' }, { client_reference_id: FOREIGN_COMPANY },
    { metadata: { ...metadata(), module_order_id: ACTOR } }, { metadata: { ...metadata(), company_id: FOREIGN_COMPANY } },
    { metadata: { ...metadata(), billing_flow: 'legacy' } }, { currency: 'eur' }, { amount_total: 1 }, { amount_subtotal: 1 },
    { expires_at: NOW + 3700 }, { status: 'unknown' }, { mode: 'payment' },
    { url: 'https://checkout.stripe.com.evil.invalid/c/pay/cs_test_module' }, { url: 'https://evil.invalid/c/pay/cs_test_module' },
    { url: 'https://checkout.stripe.com/c/pay/cs_foreign' }, { url: 'https://user:secret@checkout.stripe.com/c/pay/cs_test_module' },
    { automatic_tax: { enabled: true } }, { total_details: { amount_tax: 1, amount_discount: 0, amount_shipping: 0 } },
    { line_items: { has_more: true, data: sessionFixture().line_items.data } },
    { line_items: { has_more: false, data: [{ ...sessionFixture().line_items.data[0], quantity: 2 }] } },
    { line_items: { has_more: false, data: [{ ...sessionFixture().line_items.data[0], price: { id: 'price_foreign' } }] } },
  ])('refuses a mismatched canonical session %j before saving or redirecting', async (patch) => {
    createSession.mockResolvedValue({ ...session, ...patch })
    await expect(run()).rejects.toMatchObject({ code: 'invalid_binding' })
    expect(rpc).toHaveBeenCalledOnce()
  })
  it('rechecks foreign fields in the record RPC response', async () => {
    const implementation = rpc.getMockImplementation()!
    rpc.mockImplementation(async (name, args) => {
      const result = await implementation(name, args)
      return name === 'record_module_checkout_session' ? { ...result, data: { ...result.data, company_id: FOREIGN_COMPANY } } : result
    })
    await expect(run()).rejects.toMatchObject({ code: 'invalid_binding' })
  })
  it.each([
    ['module_checkout_admin_required', 'admin_required', 403], ['module_checkout_dependency_required', 'dependency_required', 409],
    ['module_checkout_already_active', 'already_active', 409], ['module_checkout_offer_conflict', 'offer_conflict', 409],
  ])('preserves safe reservation denial %s', async (message, code, status) => {
    rpc.mockResolvedValue({ data: null, error: { message } })
    await expect(run()).rejects.toMatchObject({ code, status })
    expect(createSession).not.toHaveBeenCalled()
  })
  it('does not leak provider secrets or raw database errors', async () => {
    retrievePrice.mockRejectedValue(new Error('sk_test_synthetic_private'))
    await expect(run()).rejects.toMatchObject({ code: 'provider_unavailable', message: 'Module checkout unavailable: provider_unavailable' })
    retrievePrice.mockResolvedValue(price); readError = { message: 'private database connection' }
    await expect(run()).rejects.toMatchObject({ code: 'storage_unavailable', message: 'Module checkout unavailable: storage_unavailable' })
  })
})
