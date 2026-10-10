import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type Stripe from 'stripe'

const mocks = vi.hoisted(() => ({
  stripe: vi.fn(), admin: vi.fn(), constructEvent: vi.fn(), retrieveInvoice: vi.fn(),
  listLines: vi.fn(), retrieveSubscription: vi.fn(), rpc: vi.fn(), legacyWrite: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/stripe', () => ({ getStripe: mocks.stripe }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))

import { handleModulePaymentEvent, MODULE_BILLING_FLOW } from '../lib/platform/module-payment-handler'
import { CAPABILITY_POLICY_VERSION } from '../lib/platform/capabilities'
import { POST } from '../app/api/stripe/webhook/route'

const ORDER_ID = '00000000-0000-4000-8000-000000000101'
const OFFER_ID = '00000000-0000-4000-8000-000000000201'
const COMPANY_ID = '00000000-0000-4000-8000-000000000301'
const GRANT_ID = '00000000-0000-4000-8000-000000000401'
type Row = Record<string, unknown>
const binding = () => ({ billing_flow: MODULE_BILLING_FLOW, module_order_id: ORDER_ID })
function subscriptionFixture() {
  return { id: 'sub_module', customer: 'cus_company', livemode: false, status: 'active', metadata: binding(),
    cancel_at_period_end: false,
    items: { has_more: false, data: [{ id: 'si_module', quantity: 1, current_period_start: 1_790_000_000,
      current_period_end: 1_792_678_400,
      price: { id: 'price_module', currency: 'czk', unit_amount: 49000, livemode: false } }] } }
}
function invoiceFixture() {
  return { id: 'in_module', customer: 'cus_company', livemode: false, status: 'paid', metadata: {} as Row,
    currency: 'czk', total: 49000, amount_due: 49000, amount_paid: 49000, amount_remaining: 0,
    discounts: [] as unknown[], total_discount_amounts: [] as unknown[], total_taxes: [] as unknown[],
    parent: { subscription_details: { subscription: 'sub_module', metadata: binding() as Row } },
    // Deliberately empty/truncated embedded lines: fulfillment must use listLineItems.
    lines: { data: [], has_more: true } }
}
function lineFixture() {
  return { id: 'il_module', invoice: 'in_module', livemode: false, currency: 'czk', quantity: 1,
    amount: 49000, subtotal: 49000, metadata: binding() as Row,
    period: { start: 1_790_000_000, end: 1_792_678_400 },
    pricing: { type: 'price_details', price_details: { price: 'price_module' }, unit_amount_decimal: '49000' },
    parent: { type: 'subscription_item_details', subscription_item_details: {
      subscription: 'sub_module', subscription_item: 'si_module', proration: false } },
    discount_amounts: [] as unknown[], taxes: [] as unknown[], discounts: [] as unknown[] }
}
const orderFixture = (): Row => ({ id: ORDER_ID, company_id: COMPANY_ID, offer_id: OFFER_ID,
  stripe_customer_id: 'cus_company', stripe_subscription_id: null, register_id: null })
const offerFixture = (): Row => ({ id: OFFER_ID, product: 'inventory', stripe_price_id: 'price_module',
  currency: 'czk', unit_amount: 49000, livemode: false, capabilities: ['inventory.receipt.post', 'inventory.history.read'],
  policy_version: CAPABILITY_POLICY_VERSION, history_days: 30, is_published: false })

let invoice: ReturnType<typeof invoiceFixture>
let subscription: ReturnType<typeof subscriptionFixture>
let line: ReturnType<typeof lineFixture>
let rows: Record<string, Row[]>
let lookups: string[]
let readError: string | null

function event(type = 'invoice.payment_succeeded', object: unknown = { id: 'in_module' }): Stripe.Event {
  return { id: 'evt_paid', type, livemode: false, data: { object } } as unknown as Stripe.Event
}
function dependencies(): Parameters<typeof handleModulePaymentEvent>[1] {
  return { stripe: mocks.stripe(), admin: mocks.admin() }
}
function request() {
  return new NextRequest('https://example.invalid/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 'synthetic-valid' }, body: '{"synthetic":true}',
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_synthetic')
  vi.stubEnv('STRIPE_PRICE_STARTER', 'price_legacy_starter')
  vi.stubEnv('STRIPE_PRICE_GROWTH_YEARLY', 'price_legacy_growth_yearly')
  vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'test')
  invoice = invoiceFixture(); subscription = subscriptionFixture(); line = lineFixture()
  rows = { module_purchase_orders: [orderFixture()], module_offers: [offerFixture()] }
  lookups = []; readError = null
  mocks.retrieveInvoice.mockImplementation(async () => invoice)
  mocks.listLines.mockImplementation(async () => ({ data: [line], has_more: false }))
  mocks.retrieveSubscription.mockImplementation(async () => subscription)
  mocks.constructEvent.mockImplementation(() => event())
  mocks.rpc.mockResolvedValue({ data: GRANT_ID, error: null })
  mocks.legacyWrite.mockResolvedValue({ error: null })
  mocks.stripe.mockReturnValue({
    webhooks: { constructEvent: mocks.constructEvent },
    invoices: { retrieve: mocks.retrieveInvoice, listLineItems: mocks.listLines },
    subscriptions: { retrieve: mocks.retrieveSubscription },
  })
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, from: (table: string) => {
    lookups.push(table)
    const filters: Array<[string, unknown]> = []
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
      maybeSingle: async () => ({
        data: (rows[table] ?? []).find((entry) => filters.every(([key, value]) => entry[key] === value)) ?? null,
        error: readError ? { message: readError } : null,
      }),
      upsert: mocks.legacyWrite,
      update: mocks.legacyWrite,
    }
    return query
  } })
})
afterEach(() => vi.unstubAllEnvs())

describe('canonical module invoice handler', () => {
  it('reads canonical objects and submits only verified receipt fields to the atomic RPC', async () => {
    expect(await handleModulePaymentEvent(event(), dependencies())).toEqual({ handled: true, entitlementId: GRANT_ID })
    expect(mocks.retrieveInvoice).toHaveBeenCalledWith('in_module')
    expect(mocks.listLines).toHaveBeenCalledWith('in_module', { limit: 100 })
    expect(mocks.retrieveSubscription).toHaveBeenCalledWith('sub_module', { expand: ['items.data.price'] })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('apply_paid_module_invoice', {
      p_order_id: ORDER_ID, p_event_id: 'evt_paid', p_livemode: false, p_invoice_id: 'in_module',
      p_invoice_line_id: 'il_module', p_customer_id: 'cus_company', p_subscription_id: 'sub_module',
      p_price_id: 'price_module', p_currency: 'czk', p_quantity: 1, p_line_amount: 49000,
      p_amount_paid: 49000, p_amount_due: 49000, p_period_start: 1_790_000_000, p_period_end: 1_792_678_400,
    })
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
  })

  it('lets the atomic RPC deduplicate the same invoice line across different event IDs', async () => {
    const first = await handleModulePaymentEvent(event(), dependencies())
    const duplicate = await handleModulePaymentEvent({ ...event(), id: 'evt_retry' } as Stripe.Event, dependencies())
    expect(first).toEqual(duplicate)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_event_id: 'evt_retry', p_invoice_id: 'in_module', p_invoice_line_id: 'il_module' })
  })

  it('allows renewal of an immutable order after offer unpublication', async () => {
    rows.module_purchase_orders[0].stripe_subscription_id = subscription.id
    expect(await handleModulePaymentEvent(event(), dependencies())).toMatchObject({ handled: true })
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it.each(['', 'live', 'unknown'])('denies sandbox receipts when the server mode is %j', async (mode) => {
    vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', mode)
    await expect(handleModulePaymentEvent(event(), dependencies())).rejects.toThrow('runtime_billing_mode_mismatch')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('accepts live receipts only when the server, offer, and every provider object agree', async () => {
    vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'live')
    rows.module_offers[0].livemode = true
    invoice.livemode = true; line.livemode = true; subscription.livemode = true
    subscription.items.data[0].price.livemode = true
    expect(await handleModulePaymentEvent({ ...event(), livemode: true } as Stripe.Event, dependencies()))
      .toMatchObject({ handled: true, entitlementId: GRANT_ID })
  })

  it.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed'])
  ('acknowledges %s without granting a module or touching legacy billing', async (type) => {
    const object = type.startsWith('customer.') ? subscription : type.startsWith('checkout.')
      ? { id: 'cs_module', metadata: binding(), subscription: 'sub_module', payment_status: 'paid' } : { id: 'in_module' }
    expect(await handleModulePaymentEvent(event(type, object), dependencies())).toEqual({ handled: true })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
  })

  it('acknowledges marked Checkout pending before a subscription exists', async () => {
    expect(await handleModulePaymentEvent(event('checkout.session.completed', {
      id: 'cs_pending', metadata: binding(), subscription: null, payment_status: 'unpaid',
    }), dependencies())).toEqual({ handled: true })
    expect(mocks.retrieveSubscription).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['invoice unpaid', () => { invoice.status = 'open'; invoice.amount_paid = 0 }],
    ['partial payment', () => { invoice.amount_paid = 48999 }],
    ['proration', () => { line.parent.subscription_item_details.proration = true }],
    ['invoice price', () => { line.pricing.price_details.price = 'price_other' }],
    ['customer mismatch', () => { invoice.customer = 'cus_other' }],
    ['currency mismatch', () => { invoice.currency = 'eur' }],
    ['line underpaid', () => { line.amount = 1 }],
    ['unit mismatch', () => { line.pricing.unit_amount_decimal = '49000.01' }],
    ['quantity', () => { line.quantity = 2 }],
    ['period', () => { line.period.end = line.period.start }],
    ['invoice extra fee', () => { invoice.total += 1 }],
    ['discount', () => { invoice.total_discount_amounts = [{ amount: 1 }] }],
    ['inclusive tax unsupported', () => { line.taxes = [{ amount: 1 }] }],
    ['line invoice binding', () => { line.invoice = 'in_other' }],
    ['line subscription binding', () => { line.parent.subscription_item_details.subscription = 'sub_other' }],
    ['line item binding', () => { line.parent.subscription_item_details.subscription_item = 'si_other' }],
    ['mode mismatch', () => { line.livemode = true }],
    ['metadata flow', () => { subscription.metadata.billing_flow = 'other_flow' }],
    ['metadata order', () => { invoice.parent.subscription_details.metadata.module_order_id = 'other_order' }],
    ['missing snapshot', () => { invoice.parent.subscription_details.metadata = {} }],
    ['bound order mismatch', () => { rows.module_purchase_orders[0].stripe_subscription_id = 'sub_other' }],
    ['missing order', () => { rows.module_purchase_orders = [] }],
    ['malformed capability', () => { rows.module_offers[0].capabilities = ['pos.sale.create'] }],
  ] as const)('rejects %s before any grant', async (_label, mutate) => {
    mutate()
    await expect(handleModulePaymentEvent(event(), dependencies())).rejects.toThrow('Module payment rejected:')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
  })

  it.each([
    { data: [], has_more: false },
    { data: [lineFixture()], has_more: true },
    { data: [lineFixture(), { ...lineFixture(), id: 'il_extra' }], has_more: false },
  ])('rejects incomplete or multi-line invoices', async (collection) => {
    mocks.listLines.mockResolvedValue(collection)
    await expect(handleModulePaymentEvent(event(), dependencies())).rejects.toThrow('unsupported_invoice_lines')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('does not permit module order lookup failures to fall through to legacy billing', async () => {
    readError = 'temporarily unavailable'
    await expect(handleModulePaymentEvent(event(), dependencies())).rejects.toThrow('order_lookup_failed')
  })

  it('surfaces an atomic RPC failure for webhook retry', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'conflicting receipt' } })
    await expect(handleModulePaymentEvent(event(), dependencies())).rejects.toThrow('receipt_apply_failed')
  })

  it.each(['bound_order', 'known_price'])('isolates an unmarked %s from legacy subscription updates', async (source) => {
    subscription.metadata = {} as ReturnType<typeof binding>
    if (source === 'bound_order') {
      rows.module_offers = []
      rows.module_purchase_orders[0].stripe_subscription_id = subscription.id
      subscription.items.data[0].price.id = 'price_legacy_starter'
    }
    expect(await handleModulePaymentEvent(event('customer.subscription.updated', subscription), dependencies())).toEqual({ handled: true })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('keeps an unmarked known module payment retryable until order metadata is repaired', async () => {
    subscription.metadata = {} as ReturnType<typeof binding>
    invoice.parent.subscription_details.metadata = {}
    line.metadata = {}
    await expect(handleModulePaymentEvent(event(), dependencies())).rejects.toThrow('missing_order_metadata')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('signed webhook route with real module dispatch', () => {
  it('rejects a bad signature before provider reads or any database access', async () => {
    mocks.constructEvent.mockImplementation(() => { throw new Error('bad signature') })
    const response = await POST(request())
    expect(response.status).toBe(400)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.retrieveInvoice).not.toHaveBeenCalled()
  })

  it('passes the untouched raw body and signature to Stripe verification', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.constructEvent).toHaveBeenCalledWith('{"synthetic":true}', 'synthetic-valid', 'whsec_synthetic')
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })

  it('acknowledges pending module Checkout without granting or executing the legacy path', async () => {
    mocks.constructEvent.mockReturnValue(event('checkout.session.completed', {
      id: 'cs_pending', metadata: binding(), subscription: null, payment_status: 'unpaid',
    }))
    expect((await POST(request())).status).toBe(200)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
    expect(lookups).not.toContain('company_subscriptions')
  })

  it('returns 500 for a missing immutable order so Stripe can retry after repair', async () => {
    rows.module_purchase_orders = []
    expect((await POST(request())).status).toBe(500)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
  })

  it('acknowledges repeated paid events with the same atomic grant result', async () => {
    expect((await POST(request())).status).toBe(200)
    expect((await POST(request())).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
  })

  it('does not trust active subscription status as proof of module payment', async () => {
    mocks.constructEvent.mockReturnValue(event('customer.subscription.updated', subscription))
    expect((await POST(request())).status).toBe(200)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
  })

  it('rejects an unmarked unknown price before legacy company lookup despite Starter metadata', async () => {
    rows = { module_purchase_orders: [], module_offers: [] }
    subscription.metadata = { company_id: COMPANY_ID, plan_key: 'starter' } as unknown as ReturnType<typeof binding>
    subscription.items.data[0].price.id = 'price_unknown_addon'
    mocks.constructEvent.mockReturnValue(event('customer.subscription.updated', subscription))
    expect((await POST(request())).status).toBe(500)
    expect(lookups).not.toContain('company_subscriptions')
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
  })

  it('cannot update the legacy customer from an unknown-price Checkout', async () => {
    rows = { module_purchase_orders: [], module_offers: [] }
    subscription.metadata = { company_id: COMPANY_ID } as unknown as ReturnType<typeof binding>
    subscription.items.data[0].price.id = 'price_unknown_addon'
    mocks.constructEvent.mockReturnValue(event('checkout.session.completed', {
      id: 'cs_unknown', customer: 'cus_company', subscription: 'sub_module', metadata: { company_id: COMPANY_ID },
    }))
    expect((await POST(request())).status).toBe(500)
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
    expect(lookups).not.toContain('company_subscriptions')
  })

  it('cannot mark a legacy plan past due from an unrelated customer-only invoice', async () => {
    rows = { module_purchase_orders: [], module_offers: [] }
    invoice.parent.subscription_details.subscription = ''
    invoice.parent.subscription_details.metadata = {}
    mocks.listLines.mockResolvedValue({ data: [], has_more: false })
    mocks.constructEvent.mockReturnValue(event('invoice.payment_failed', { id: invoice.id, customer: 'cus_company' }))
    expect((await POST(request())).status).toBe(200)
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
    expect(lookups).not.toContain('company_subscriptions')
  })

  it('refuses an unmarked truncated invoice before hidden module rows can fall through', async () => {
    rows = { module_purchase_orders: [], module_offers: [] }
    subscription.metadata = { company_id: COMPANY_ID } as unknown as ReturnType<typeof binding>
    subscription.items.data[0].price.id = 'price_legacy_starter'
    invoice.parent.subscription_details.metadata = {}
    line.metadata = {}
    line.pricing.price_details.price = 'price_legacy_starter'
    mocks.listLines.mockResolvedValue({ data: [line], has_more: true })
    expect((await POST(request())).status).toBe(500)
    expect(mocks.legacyWrite).not.toHaveBeenCalled()
  })

  it.each([
    ['price_legacy_starter', 'starter', 'monthly'],
    ['price_legacy_growth_yearly', 'growth', 'yearly'],
  ])('preserves the recognized legacy EUR plan %s', async (priceId, planKey, interval) => {
    vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', '')
    rows = { module_purchase_orders: [], module_offers: [] }
    subscription.metadata = { company_id: COMPANY_ID, plan_key: 'wrong_metadata' } as unknown as ReturnType<typeof binding>
    subscription.items.data[0].price.id = priceId
    subscription.items.data[0].price.currency = 'eur'
    mocks.constructEvent.mockReturnValue(event('customer.subscription.updated', subscription))
    expect((await POST(request())).status).toBe(200)
    expect(mocks.legacyWrite).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      company_id: COMPANY_ID, plan_key: planKey, billing_interval: interval, stripe_price_id: priceId, status: 'active',
    }), { onConflict: 'company_id' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
