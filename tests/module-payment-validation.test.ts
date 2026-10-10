import { describe, expect, test } from 'vitest'
import { CAPABILITY_POLICY_VERSION } from '../lib/platform/capabilities'
import {
  validatePaidModuleInvoice, type PaidModuleInvoiceInput,
} from '../lib/platform/module-payment-validation'

// Synthetic provider values only. These tests do not verify signatures or call Stripe/DB.
const fixture = {
  receipt: {
    eventId: 'evt_paid_A', eventType: 'invoice.payment_succeeded', livemode: false,
    invoiceId: 'in_A', invoiceStatus: 'paid', customerId: 'cus_A', subscriptionId: 'sub_A',
    invoiceLineId: 'il_A', priceId: 'price_invoicing_test', currency: 'czk', quantity: 1,
    amountPaid: 19900, amountDue: 19900, lineAmount: 19900,
    periodStart: 1790812800, periodEnd: 1793491200, proration: false,
  },
  offer: {
    id: 'offer-invoicing-v1', product: 'invoicing', priceId: 'price_invoicing_test',
    currency: 'czk', unitAmount: 19900, livemode: false,
    policyVersion: CAPABILITY_POLICY_VERSION,
    capabilities: ['invoicing.invoice.issue', 'invoicing.payment.settle', 'invoicing.history.read'],
    historyDays: 90,
  },
  order: {
    id: 'order-A', companyId: 'company-A', offerId: 'offer-invoicing-v1',
    customerId: 'cus_A', subscriptionId: 'sub_A', registerId: null,
  },
} as const satisfies PaidModuleInvoiceInput

function input(changes: {
  receipt?: Record<string, unknown>
  offer?: Record<string, unknown>
  order?: Record<string, unknown>
} = {}) {
  return {
    receipt: { ...fixture.receipt, ...changes.receipt },
    offer: { ...fixture.offer, ...changes.offer },
    order: { ...fixture.order, ...changes.order },
  }
}

function accepted(value: unknown) {
  const result = validatePaidModuleInvoice(value)
  if (!result.ok) throw new Error(`Expected accepted payment, received ${result.reason}`)
  return result.receipt
}

test('a paid invoice yields one explicit company-bound receipt, not capability grants', () => {
  const result = accepted(input())
  expect(result).toMatchObject({
    companyId: 'company-A', orderId: 'order-A', offerId: 'offer-invoicing-v1', product: 'invoicing',
    registerId: null, currency: 'czk', quantity: 1, policyVersion: CAPABILITY_POLICY_VERSION,
    receiptKey: '["in_A","il_A"]', historyUntil: fixture.receipt.periodEnd + 90 * 86400,
  })
  expect(result).not.toHaveProperty('capabilities')
  expect(result).not.toHaveProperty('metadata')
})

test('untrusted provider metadata cannot select another company, price, period or module', () => {
  const result = accepted(input({ receipt: {
    companyId: 'company-B', orderId: 'order-B', offerId: 'offer-pos', product: 'pos',
    capabilities: ['pos.sale.create'], historyUntil: Number.MAX_SAFE_INTEGER,
    metadata: { company_id: 'company-B', price_id: 'price_pos', module: 'pos' },
  } }))
  expect(result.companyId).toBe('company-A')
  expect(result.orderId).toBe('order-A')
  expect(result.priceId).toBe('price_invoicing_test')
  expect(result.product).toBe('invoicing')
  expect(result.historyUntil).toBe(fixture.receipt.periodEnd + 90 * 86400)
  expect(result).not.toHaveProperty('capabilities')
})

test.each([
  [{ customerId: 'cus_B' }, 'customer_mismatch'],
  [{ subscriptionId: 'sub_B' }, 'subscription_mismatch'],
  [{ priceId: 'price_unknown' }, 'price_mismatch'],
  [{ currency: 'eur' }, 'currency_mismatch'],
] as const)('a receipt cannot cross its immutable order/offer binding: %j', (receipt, reason) => {
  expect(validatePaidModuleInvoice(input({ receipt }))).toEqual({ ok: false, reason })
})

test('different immutable order offer cannot be satisfied by a valid invoice for another offer', () => {
  expect(validatePaidModuleInvoice(input({ order: { offerId: 'offer-B' } }))).toEqual({ ok: false, reason: 'order_offer_mismatch' })
})

test('first payment may bind an unbound subscription; renewal must match the saved subscription', () => {
  expect(accepted(input({ order: { subscriptionId: null } })).subscriptionId).toBe('sub_A')
  const renewal = accepted(input({ receipt: {
    eventId: 'evt_renewal', invoiceId: 'in_renewal', invoiceLineId: 'il_renewal',
    periodStart: fixture.receipt.periodEnd, periodEnd: fixture.receipt.periodEnd + 30 * 86400,
  } }))
  expect(renewal.companyId).toBe('company-A')
  expect(renewal.subscriptionId).toBe('sub_A')
  expect(renewal.periodStart).toBe(fixture.receipt.periodEnd)
  expect(renewal.receiptKey).not.toBe(accepted(input()).receiptKey)
})

test('semantic receipt key survives distinct retry event IDs and distinguishes invoice lines', () => {
  const first = accepted(input())
  const retry = accepted(input({ receipt: { eventId: 'evt_second_notification' } }))
  const other = accepted(input({ receipt: { invoiceLineId: 'il_B' } }))
  expect(retry.receiptKey).toBe(first.receiptKey)
  expect(retry.eventId).not.toBe(first.eventId)
  expect(other.receiptKey).not.toBe(first.receiptKey)
  expect(accepted(input({ receipt: { invoiceId: 'a,b', invoiceLineId: 'c' } })).receiptKey)
    .not.toBe(accepted(input({ receipt: { invoiceId: 'a', invoiceLineId: 'b,c' } })).receiptKey)
})

test('live and test receipts only match offers from the same mode', () => {
  expect(accepted(input()).livemode).toBe(false)
  expect(accepted(input({ receipt: { livemode: true }, offer: { livemode: true } })).livemode).toBe(true)
  expect(validatePaidModuleInvoice(input({ receipt: { livemode: true } }))).toEqual({ ok: false, reason: 'mode_mismatch' })
  expect(validatePaidModuleInvoice(input({ offer: { livemode: true } }))).toEqual({ ok: false, reason: 'mode_mismatch' })
})

test.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.updated', 'invoice.paid', 'invoice.payment_failed', '', null])(
  'a non-payment-succeeded event never activates a module: %s', (eventType) => {
    expect(validatePaidModuleInvoice(input({ receipt: { eventType } }))).toEqual({ ok: false, reason: 'unsupported_event' })
  },
)

test.each(['draft', 'open', 'void', 'uncollectible', 'PAID', true, null])(
  'unpaid or malformed invoice status is rejected: %s', (invoiceStatus) => {
    expect(validatePaidModuleInvoice(input({ receipt: { invoiceStatus } }))).toEqual({ ok: false, reason: 'invoice_not_paid' })
  },
)

test.each([
  { amountPaid: 19899 }, { amountPaid: 0 }, { amountDue: 0 }, { lineAmount: 0 },
  { amountPaid: 1.5 }, { amountPaid: '19900' }, { amountDue: true },
  { amountDue: 18900, amountPaid: 18900 }, // Invoice-level discount without changing gross line amount.
  { amountDue: 24079, amountPaid: 24079 }, // Additional tax/fees are outside v1.
  { lineAmount: 19899 }, { amountPaid: Infinity }, { lineAmount: -19900 },
  { amountPaid: Number.MAX_SAFE_INTEGER + 1 },
])('invalid, partial, discounted or tax-adjusted payment is rejected: %j', (receipt) => {
  expect(validatePaidModuleInvoice(input({ receipt }))).toEqual({ ok: false, reason: 'amount_mismatch' })
})

test('a verified overpayment can cover the amount due but does not purchase extra units', () => {
  const result = accepted(input({ receipt: { amountPaid: 20000 } }))
  expect(result.amountPaid).toBe(20000)
  expect(result.quantity).toBe(1)
})

test.each([0, 2, -1, 1.1, '1', true, null, NaN])('only one purchased unit is supported: %s', (quantity) => {
  expect(validatePaidModuleInvoice(input({ receipt: { quantity } }))).toEqual({ ok: false, reason: 'unsupported_quantity' })
})

test('proration is rejected explicitly', () => {
  expect(validatePaidModuleInvoice(input({ receipt: { proration: true } }))).toEqual({ ok: false, reason: 'unsupported_proration' })
})

test.each([
  { periodStart: -1 }, { periodEnd: 0 }, { periodStart: '1790812800' },
  { periodEnd: fixture.receipt.periodStart }, { periodStart: fixture.receipt.periodEnd + 1 },
  { periodEnd: NaN }, { periodEnd: Infinity }, { periodStart: 1790812800.1 },
  { periodEnd: Number.MAX_SAFE_INTEGER },
])('invalid or unsafe paid intervals are rejected: %j', (receipt) => {
  expect(validatePaidModuleInvoice(input({ receipt }))).toEqual({ ok: false, reason: 'invalid_period' })
})

test('history horizon cannot overflow timestamp conversion and zero extra days is explicit', () => {
  expect(validatePaidModuleInvoice(input({ offer: { historyDays: Number.MAX_SAFE_INTEGER } })))
    .toEqual({ ok: false, reason: 'invalid_period' })
  expect(accepted(input({ offer: { historyDays: 0 } })).historyUntil).toBe(fixture.receipt.periodEnd)
})

test.each(['constructor', '__proto__', 'new_module', 'POS', null])('unknown product is rejected: %s', (product) => {
  expect(validatePaidModuleInvoice(input({ offer: { product } }))).toEqual({ ok: false, reason: 'unknown_product' })
})

test.each([
  [], ['constructor'], ['invoicing.unknown'], ['pos.sale.create'],
  ['invoicing.invoice.issue', 'invoicing.invoice.issue'], ['invoicing.invoice.issue', 'core.quotes.create'], null,
])('capabilities must be known, unique and belong to exactly the offer product: %j', (capabilities) => {
  expect(validatePaidModuleInvoice(input({ offer: { capabilities } }))).toEqual({ ok: false, reason: 'invalid_capabilities' })
})

test('unknown capability policy cannot be guessed or substituted', () => {
  expect(validatePaidModuleInvoice(input({ offer: { policyVersion: 'future-v2' } })))
    .toEqual({ ok: false, reason: 'unsupported_policy' })
})

test('POS needs an explicit logical register; company products cannot borrow register scope', () => {
  const offer = { product: 'pos', capabilities: ['pos.sale.create', 'pos.sale.settle'] }
  expect(validatePaidModuleInvoice(input({ offer }))).toEqual({ ok: false, reason: 'invalid_scope' })
  expect(accepted(input({ offer, order: { registerId: 'register-A' } })).registerId).toBe('register-A')
  expect(validatePaidModuleInvoice(input({ order: { registerId: 'register-A' } }))).toEqual({ ok: false, reason: 'invalid_scope' })
})

test('separate paid modules in the same company remain separate receipts', () => {
  const invoices = accepted(input())
  const inventory = accepted(input({
    order: { id: 'order-inventory', offerId: 'offer-inventory', subscriptionId: 'sub_inventory' },
    offer: { id: 'offer-inventory', product: 'inventory', priceId: 'price_inventory', unitAmount: 29900,
      capabilities: ['inventory.receipt.post', 'inventory.history.read'] },
    receipt: { eventId: 'evt_inventory', invoiceId: 'in_inventory', invoiceLineId: 'il_inventory',
      subscriptionId: 'sub_inventory', priceId: 'price_inventory', amountDue: 29900, amountPaid: 29900, lineAmount: 29900 },
  }))
  expect(inventory.companyId).toBe(invoices.companyId)
  expect(inventory.product).toBe('inventory')
  expect(invoices.product).toBe('invoicing')
  expect(inventory.receiptKey).not.toBe(invoices.receiptKey)
  expect(inventory).not.toHaveProperty('capabilities')
})

describe('runtime inputs cannot rely on TypeScript or JavaScript truthiness', () => {
  test.each([null, [], '', 1, true, {}, { receipt: fixture.receipt }, Object.create(fixture)])(
    'malformed root is rejected: %j', (value) => {
      expect(validatePaidModuleInvoice(value)).toEqual({ ok: false, reason: 'malformed_input' })
    },
  )

  test.each([
    { companyId: '' }, { companyId: ' company-A' }, { id: 1 }, { offerId: false },
    { customerId: 'cus_A\n' }, { subscriptionId: undefined }, { registerId: undefined },
  ])('malformed immutable order is rejected: %j', (order) => {
    expect(validatePaidModuleInvoice(input({ order }))).toEqual({ ok: false, reason: 'invalid_order' })
  })

  test.each([
    { livemode: 'false' }, { unitAmount: '19900' }, { unitAmount: 0 }, { unitAmount: -1 },
    { unitAmount: NaN }, { currency: 'czkk' }, { historyDays: -1 }, { historyDays: 0.1 },
    { historyDays: '90' }, { id: '' }, { priceId: 'price bad\n' },
  ])('malformed canonical offer is rejected: %j', (offer) => {
    expect(validatePaidModuleInvoice(input({ offer }))).toEqual({ ok: false, reason: 'invalid_offer' })
  })

  test.each([
    { livemode: 'false' }, { proration: 0 }, { proration: 'false' }, { currency: true },
    { invoiceId: '' }, { eventId: 1 }, { invoiceLineId: null }, { priceId: ' price_test' },
  ])('malformed provider receipt is rejected: %j', (receipt) => {
    expect(validatePaidModuleInvoice(input({ receipt }))).toEqual({ ok: false, reason: 'invalid_receipt' })
  })

  test('currency normalizes casing only, not whitespace or unknown aliases', () => {
    expect(accepted(input({ receipt: { currency: 'CZK' }, offer: { currency: 'CzK' } })).currency).toBe('czk')
    expect(validatePaidModuleInvoice(input({ receipt: { currency: ' czk ' } }))).toEqual({ ok: false, reason: 'invalid_receipt' })
  })
})
