import {
  CAPABILITY_POLICY_VERSION, getCapability, isProductCode,
  type CapabilityCode, type ProductCode,
} from './capabilities'

/** Provider fields normalized by the signed-webhook handler, never by a public client. */
export type ModulePaymentReceipt = Readonly<{
  eventId: string
  eventType: string
  livemode: boolean
  invoiceId: string
  invoiceStatus: string
  customerId: string
  subscriptionId: string
  invoiceLineId: string
  priceId: string
  currency: string
  quantity: number
  amountPaid: number
  amountDue: number
  lineAmount: number
  /** UTC Unix seconds, half-open interval [periodStart, periodEnd). */
  periodStart: number
  periodEnd: number
  proration: boolean
}>

/** Immutable, published offer loaded from server-owned storage, not request metadata. */
export type ModulePaymentOffer = Readonly<{
  id: string
  product: ProductCode
  priceId: string
  currency: string
  unitAmount: number
  livemode: boolean
  policyVersion: typeof CAPABILITY_POLICY_VERSION
  capabilities: readonly CapabilityCode[]
  historyDays: number
}>

/** Persisted purchase intent resolved through a verified provider binding by the handler. */
export type ModulePaymentOrder = Readonly<{
  id: string
  companyId: string
  offerId: string
  customerId: string
  subscriptionId: string | null
  registerId: string | null
}>

export type PaidModuleInvoiceInput = Readonly<{
  receipt: ModulePaymentReceipt
  offer: ModulePaymentOffer
  order: ModulePaymentOrder
}>

/** Explicit DTO only: never spreads provider metadata or passes client capability arrays to an RPC. */
export type ValidatedModulePaymentReceipt = Readonly<ModulePaymentReceipt & {
  eventType: 'invoice.payment_succeeded'
  invoiceStatus: 'paid'
  quantity: 1
  proration: false
  /** JSON tuple [invoiceId, invoiceLineId], stable across duplicate provider events. */
  receiptKey: string
  orderId: string
  companyId: string
  offerId: string
  product: ProductCode
  registerId: string | null
  policyVersion: typeof CAPABILITY_POLICY_VERSION
  /** UTC Unix seconds, computed from the immutable offer, not event metadata. */
  historyUntil: number
}>

export type ModulePaymentValidationReason =
  | 'malformed_input' | 'invalid_order' | 'invalid_offer' | 'unknown_product'
  | 'invalid_capabilities' | 'unsupported_policy' | 'invalid_receipt'
  | 'unsupported_event' | 'invoice_not_paid' | 'mode_mismatch'
  | 'order_offer_mismatch' | 'customer_mismatch' | 'subscription_mismatch'
  | 'price_mismatch' | 'currency_mismatch' | 'unsupported_quantity'
  | 'unsupported_proration' | 'amount_mismatch' | 'invalid_period' | 'invalid_scope'

export type ModulePaymentValidationResult =
  | Readonly<{ ok: true; receipt: ValidatedModulePaymentReceipt }>
  | Readonly<{ ok: false; reason: ModulePaymentValidationReason }>

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const identifier = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 255 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
const amount = (value: unknown): value is number => safeInteger(value) && value > 0
// Allows conversion to JS milliseconds without overflow or an invalid Date.
const MAX_UNIX_SECONDS = 8_640_000_000_000
const timestamp = (value: unknown): value is number => safeInteger(value) && value >= 0 && value <= MAX_UNIX_SECONDS
const currency = (value: unknown): string | null => typeof value === 'string' && /^[a-zA-Z]{3}$/.test(value)
  ? value.toLowerCase() : null

/**
 * Validates one non-prorated recurring module payment against trusted server records.
 * v1 excludes discounts, extra tax/fees, credits and multi-line invoices: amountDue
 * must equal the offer's unit amount. This does not implement a complete billing model.
 *
 * The handler MUST first verify the webhook signature and retrieve canonical provider
 * objects plus the immutable order/offer. This function cannot prove those origins or
 * whether an offer was published. DB processing must recheck bindings, event dedupe,
 * semantic receipt uniqueness, order state and atomic application of the paid period.
 * It does not check product dependencies, membership, refunds or subscription lifecycle.
 */
export function validatePaidModuleInvoice(input: unknown): ModulePaymentValidationResult {
  const reject = (reason: ModulePaymentValidationReason): ModulePaymentValidationResult => ({ ok: false, reason })
  if (!record(input) || !record(input.receipt) || !record(input.order) || !record(input.offer)) {
    return reject('malformed_input')
  }
  const { receipt, order, offer } = input
  if (!identifier(order.id) || !identifier(order.companyId) || !identifier(order.offerId)
    || !identifier(order.customerId) || !(order.subscriptionId === null || identifier(order.subscriptionId))
    || !(order.registerId === null || identifier(order.registerId))) return reject('invalid_order')

  const offerCurrency = currency(offer.currency)
  if (!identifier(offer.id) || !identifier(offer.priceId) || !offerCurrency || !amount(offer.unitAmount)
    || typeof offer.livemode !== 'boolean' || !safeInteger(offer.historyDays) || offer.historyDays < 0) {
    return reject('invalid_offer')
  }
  if (!isProductCode(offer.product)) return reject('unknown_product')
  if (offer.policyVersion !== CAPABILITY_POLICY_VERSION) return reject('unsupported_policy')
  if (!Array.isArray(offer.capabilities) || offer.capabilities.length === 0
    || new Set(offer.capabilities).size !== offer.capabilities.length) return reject('invalid_capabilities')
  const scope = offer.product === 'pos' ? 'register' : 'company'
  for (const code of offer.capabilities) {
    const capability = getCapability(code)
    if (!capability || capability.product !== offer.product || capability.scope !== scope) {
      return reject('invalid_capabilities')
    }
  }
  if ((scope === 'register' && !identifier(order.registerId))
    || (scope === 'company' && order.registerId !== null)) return reject('invalid_scope')
  if (order.offerId !== offer.id) return reject('order_offer_mismatch')

  const receiptCurrency = currency(receipt.currency)
  if (!identifier(receipt.eventId) || !identifier(receipt.invoiceId) || !identifier(receipt.invoiceLineId)
    || !identifier(receipt.customerId) || !identifier(receipt.subscriptionId) || !identifier(receipt.priceId)
    || !receiptCurrency || typeof receipt.livemode !== 'boolean' || typeof receipt.proration !== 'boolean') {
    return reject('invalid_receipt')
  }
  if (receipt.eventType !== 'invoice.payment_succeeded') return reject('unsupported_event')
  if (receipt.invoiceStatus !== 'paid') return reject('invoice_not_paid')
  if (receipt.livemode !== offer.livemode) return reject('mode_mismatch')
  if (receipt.customerId !== order.customerId) return reject('customer_mismatch')
  if (order.subscriptionId !== null && receipt.subscriptionId !== order.subscriptionId) return reject('subscription_mismatch')
  if (receipt.priceId !== offer.priceId) return reject('price_mismatch')
  if (receiptCurrency !== offerCurrency) return reject('currency_mismatch')
  if (receipt.quantity !== 1) return reject('unsupported_quantity')
  if (receipt.proration !== false) return reject('unsupported_proration')
  if (!amount(receipt.amountPaid) || !amount(receipt.amountDue) || !amount(receipt.lineAmount)
    || receipt.amountPaid < receipt.amountDue || receipt.amountDue !== offer.unitAmount
    || receipt.lineAmount !== offer.unitAmount) return reject('amount_mismatch')
  if (!timestamp(receipt.periodStart) || !timestamp(receipt.periodEnd)
    || receipt.periodEnd <= receipt.periodStart) return reject('invalid_period')
  const historyUntil = receipt.periodEnd + offer.historyDays * 86_400
  if (!timestamp(historyUntil)) return reject('invalid_period')

  return { ok: true, receipt: {
    eventId: receipt.eventId, eventType: 'invoice.payment_succeeded', livemode: receipt.livemode,
    invoiceId: receipt.invoiceId, invoiceStatus: 'paid', customerId: receipt.customerId,
    subscriptionId: receipt.subscriptionId, invoiceLineId: receipt.invoiceLineId,
    priceId: receipt.priceId, currency: receiptCurrency, quantity: 1,
    amountPaid: receipt.amountPaid, amountDue: receipt.amountDue, lineAmount: receipt.lineAmount,
    periodStart: receipt.periodStart, periodEnd: receipt.periodEnd, proration: false,
    receiptKey: JSON.stringify([receipt.invoiceId, receipt.invoiceLineId]),
    orderId: order.id, companyId: order.companyId, offerId: offer.id,
    product: offer.product, registerId: order.registerId,
    policyVersion: CAPABILITY_POLICY_VERSION, historyUntil,
  } }
}
