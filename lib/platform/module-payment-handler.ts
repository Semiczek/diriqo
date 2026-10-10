import 'server-only'

import type Stripe from 'stripe'
import type { createSupabaseAdminClient } from '../supabase-admin'
import { validatePaidModuleInvoice } from './module-payment-validation'
import { readModuleBillingMode } from './module-billing-mode'

export const MODULE_BILLING_FLOW = 'diriqo_modules_v1'
export const MODULE_ORDER_METADATA_KEY = 'module_order_id'

type Dependencies = {
  stripe: Pick<Stripe, 'invoices' | 'subscriptions'>
  admin: ReturnType<typeof createSupabaseAdminClient>
}
type Row = Record<string, unknown>

export class ModulePaymentError extends Error {
  constructor(readonly code: string) {
    super(`Module payment rejected: ${code}`)
    this.name = 'ModulePaymentError'
  }
}

function row(value: unknown): Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Row : {}
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
function id(value: unknown): string { return typeof value === 'string' ? value : text(row(value).id) }
function entries(value: unknown): Row[] { return Array.isArray(value) ? value.map(row) : [] }
function fail(code: string): never { throw new ModulePaymentError(code) }

function invoiceSubscription(invoice: Row): string {
  return id(row(row(invoice.parent).subscription_details).subscription) || id(invoice.subscription)
}
function metadataRows(object: Row): Row[] {
  return [row(object.metadata), row(row(row(object.parent).subscription_details).metadata)]
}
function moduleMarker(metadata: Row): boolean {
  return text(metadata.billing_flow).startsWith('diriqo_modules') || Boolean(metadata[MODULE_ORDER_METADATA_KEY])
}
function linePrice(line: Row): string {
  return id(row(row(line.pricing).price_details).price) || id(line.price)
}
function subscriptionPrices(subscription: Row): string[] {
  return entries(row(subscription.items).data).map((item) => id(item.price)).filter(Boolean)
}
function decimalInteger(value: unknown): number {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : NaN
  if (typeof value !== 'string' || !/^\d+(?:\.0+)?$/.test(value)) return NaN
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : NaN
}
function hasAdjustments(value: unknown): boolean {
  return value != null && (!Array.isArray(value) || value.length !== 0)
}
function checkMetadata(metadata: Row, orderId: string, required: boolean) {
  if ((required || 'billing_flow' in metadata) && metadata.billing_flow !== MODULE_BILLING_FLOW) fail('billing_flow_mismatch')
  if ((required || MODULE_ORDER_METADATA_KEY in metadata) && metadata[MODULE_ORDER_METADATA_KEY] !== orderId) fail('order_metadata_mismatch')
}

const ORDER_COLUMNS = 'id,company_id,offer_id,stripe_customer_id,stripe_subscription_id,register_id'
const OFFER_COLUMNS = 'id,product,stripe_price_id,currency,unit_amount,livemode,capabilities,policy_version,history_days,is_published'

/**
 * The caller must verify the raw webhook signature first. All API calls here are reads.
 * A true result prevents every legacy plan mutation, even for pending module payments.
 * A rejected/missing binding throws so the webhook can retry after operator repair.
 */
export async function handleModulePaymentEvent(
  event: Stripe.Event,
  { stripe, admin }: Dependencies,
): Promise<{ handled: boolean; entitlementId?: string }> {
  const invoiceEvent = event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed'
  const subscriptionEvent = ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)
  const checkoutEvent = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)
  if (!invoiceEvent && !subscriptionEvent && !checkoutEvent) return { handled: false }

  const object = row(event.data.object)
  let invoice: Row = {}
  let lineList: Row = {}
  let subscription = subscriptionEvent ? object : {}
  let subscriptionId = subscriptionEvent ? id(object) : invoiceEvent ? invoiceSubscription(object) : id(object.subscription)

  // Retrieve full line data separately: the invoice's embedded lines can be truncated.
  if (invoiceEvent) {
    if (!id(object)) fail('missing_invoice_id')
    invoice = row(await stripe.invoices.retrieve(id(object)))
    if (invoice.id !== object.id) fail('invoice_identity_mismatch')
    subscriptionId = invoiceSubscription(invoice)
    const [lines, canonicalSubscription] = await Promise.all([
      stripe.invoices.listLineItems(id(invoice), { limit: 100 }),
      subscriptionId ? stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] }) : Promise.resolve(null),
    ])
    lineList = row(lines)
    subscription = row(canonicalSubscription)
  } else if (checkoutEvent && subscriptionId) {
    subscription = row(await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] }))
  }

  const lines = entries(lineList.data)
  // An unseen page could contain a module price; never fall back to legacy from
  // a truncated invoice, even when the visible rows carry no module marker.
  if (invoiceEvent && lineList.has_more !== false) fail('unsupported_invoice_lines')
  const metadata = [...metadataRows(object), ...metadataRows(invoice), row(subscription.metadata), ...lines.map((line) => row(line.metadata))]
  const prices = [...new Set([...subscriptionPrices(subscription), ...lines.map(linePrice).filter(Boolean)])]
  let boundOrder: Row | null = null
  if (subscriptionId) {
    const response = await admin.from('module_purchase_orders').select(ORDER_COLUMNS)
      .eq('stripe_subscription_id', subscriptionId).maybeSingle()
    if (response.error) fail('order_lookup_failed')
    boundOrder = response.data ? row(response.data) : null
  }
  const knownOffers = await Promise.all(prices.map(async (priceId) => {
    const response = await admin.from('module_offers').select(OFFER_COLUMNS).eq('stripe_price_id', priceId).maybeSingle()
    if (response.error) fail('offer_lookup_failed')
    return response.data ? row(response.data) : null
  }))
  const isModule = Boolean(boundOrder) || metadata.some(moduleMarker) || knownOffers.some(Boolean)
  if (!isModule) return { handled: false }
  const expectedMode = readModuleBillingMode()
  if (expectedMode === null || event.livemode !== expectedMode) fail('runtime_billing_mode_mismatch')
  if (event.type !== 'invoice.payment_succeeded') return { handled: true }

  // Only a settled invoice can grant time. Subscription/Checkout statuses never do.
  if (event.account) fail('connected_account_unsupported')
  if (!subscriptionId || subscription.id !== subscriptionId) fail('missing_subscription')
  const orderId = text(row(subscription.metadata)[MODULE_ORDER_METADATA_KEY])
  if (!orderId) fail('missing_order_metadata')
  checkMetadata(row(subscription.metadata), orderId, true)
  checkMetadata(row(row(row(invoice.parent).subscription_details).metadata), orderId, true)
  checkMetadata(row(invoice.metadata), orderId, false)
  if (boundOrder && boundOrder.id !== orderId) fail('bound_order_mismatch')
  let order = boundOrder
  if (!order) {
    const response = await admin.from('module_purchase_orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle()
    if (response.error) fail('order_lookup_failed')
    order = response.data ? row(response.data) : null
  }
  if (!order) fail('missing_order')
  const offerResponse = await admin.from('module_offers').select(OFFER_COLUMNS).eq('id', order.offer_id).maybeSingle()
  if (offerResponse.error || !offerResponse.data) fail('missing_offer')
  const offer = row(offerResponse.data)

  if (lineList.has_more !== false || lines.length !== 1) fail('unsupported_invoice_lines')
  const line = lines[0]
  const lineParent = row(line.parent)
  const lineDetails = row(lineParent.subscription_item_details)
  const items = entries(row(subscription.items).data)
  if (row(subscription.items).has_more !== false || items.length !== 1) fail('unsupported_subscription_items')
  const item = items[0]
  const price = row(item.price)
  if (lineParent.type !== 'subscription_item_details' || id(lineDetails.subscription) !== subscriptionId
    || id(lineDetails.subscription_item) !== id(item) || id(line.invoice) !== id(invoice)) fail('line_binding_mismatch')
  if (line.subscription != null && id(line.subscription) !== subscriptionId) fail('line_binding_mismatch')
  if (linePrice(line) !== id(price) || item.quantity !== 1) fail('subscription_price_mismatch')
  checkMetadata(row(line.metadata), orderId, false)

  if (event.livemode !== invoice.livemode || event.livemode !== subscription.livemode
    || event.livemode !== line.livemode || event.livemode !== price.livemode) fail('provider_mode_mismatch')
  if (id(invoice.customer) !== id(subscription.customer)) fail('provider_customer_mismatch')
  if (invoice.currency !== line.currency || invoice.currency !== price.currency) fail('provider_currency_mismatch')
  if (invoice.amount_remaining !== 0 || invoice.paid_out_of_band === true
    || (invoice.amount_paid_off_stripe != null && invoice.amount_paid_off_stripe !== 0)) fail('invoice_not_settled_on_stripe')
  if (hasAdjustments(invoice.discounts) || hasAdjustments(invoice.total_discount_amounts)
    || hasAdjustments(invoice.total_pretax_credit_amounts) || hasAdjustments(invoice.total_taxes)
    || hasAdjustments(line.discounts) || hasAdjustments(line.discount_amounts)
    || hasAdjustments(line.pretax_credit_amounts) || hasAdjustments(line.taxes)) fail('unsupported_adjustments')
  if ((invoice.shipping_cost != null && row(invoice.shipping_cost).amount_total !== 0)
    || (invoice.starting_balance != null && invoice.starting_balance !== 0)
    || (invoice.ending_balance != null && invoice.ending_balance !== 0)) fail('unsupported_adjustments')
  if (line.quantity_decimal != null && decimalInteger(line.quantity_decimal) !== 1) fail('unsupported_quantity')
  const unitAmount = decimalInteger(row(line.pricing).unit_amount_decimal)
  const priceUnitAmount = price.unit_amount ?? decimalInteger(price.unit_amount_decimal)
  if (unitAmount !== offer.unit_amount || priceUnitAmount !== offer.unit_amount
    || (line.subtotal != null && line.subtotal !== offer.unit_amount)
    || invoice.total !== offer.unit_amount) fail('unit_amount_mismatch')

  const validated = validatePaidModuleInvoice({
    order: { id: order.id, companyId: order.company_id, offerId: order.offer_id,
      customerId: order.stripe_customer_id, subscriptionId: order.stripe_subscription_id, registerId: order.register_id },
    offer: { id: offer.id, product: offer.product, priceId: offer.stripe_price_id, currency: offer.currency,
      unitAmount: offer.unit_amount, livemode: offer.livemode, policyVersion: offer.policy_version,
      capabilities: offer.capabilities, historyDays: offer.history_days },
    receipt: { eventId: event.id, eventType: event.type, livemode: event.livemode,
      invoiceId: invoice.id, invoiceStatus: invoice.status, customerId: id(invoice.customer),
      subscriptionId, invoiceLineId: line.id, priceId: linePrice(line), currency: invoice.currency,
      quantity: line.quantity, amountPaid: invoice.amount_paid, amountDue: invoice.amount_due,
      lineAmount: line.amount, periodStart: row(line.period).start, periodEnd: row(line.period).end,
      proration: lineDetails.proration },
  })
  if (!validated.ok) fail(validated.reason)
  const receipt = validated.receipt
  const applied = await admin.rpc('apply_paid_module_invoice', {
    p_order_id: receipt.orderId, p_event_id: receipt.eventId, p_livemode: receipt.livemode,
    p_invoice_id: receipt.invoiceId, p_invoice_line_id: receipt.invoiceLineId,
    p_customer_id: receipt.customerId, p_subscription_id: receipt.subscriptionId, p_price_id: receipt.priceId,
    p_currency: receipt.currency, p_quantity: receipt.quantity, p_line_amount: receipt.lineAmount,
    p_amount_paid: receipt.amountPaid, p_amount_due: receipt.amountDue,
    p_period_start: receipt.periodStart, p_period_end: receipt.periodEnd,
  })
  if (applied.error || typeof applied.data !== 'string' || !applied.data) fail('receipt_apply_failed')
  return { handled: true, entitlementId: applied.data }
}
