import 'server-only'

import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import type { createSupabaseAdminClient } from '../supabase-admin'
import { CAPABILITY_POLICY_VERSION, getCapability, type CapabilityCode } from './capabilities'
import { readModuleBillingMode } from './module-billing-mode'
import { MODULE_BILLING_FLOW, MODULE_ORDER_METADATA_KEY } from './module-payment-handler'

const PRODUCTS = ['diriqo_core', 'inventory', 'invoicing', 'smart_quotes', 'fleet'] as const
type CheckoutProduct = (typeof PRODUCTS)[number]
type Row = Record<string, unknown>
export type ModuleCheckoutOffer = Readonly<{
  id: string; offer_key: string; product: CheckoutProduct; stripe_price_id: string
  currency: string; unit_amount: number; livemode: false; is_published: true
  capabilities: readonly CapabilityCode[]; policy_version: typeof CAPABILITY_POLICY_VERSION; history_days: number
}>
export type ModuleCheckoutInput = Readonly<{
  companyId: string; actorAuthUserId: string; offerId: string; registerId: null
  /** Trusted server configuration, never the request Host header or a client redirect. */
  appUrl: string
}>
export type ModuleCheckoutDependencies = {
  stripe: Pick<Stripe, 'prices' | 'customers' | 'checkout'>
  admin: ReturnType<typeof createSupabaseAdminClient>
}
export type ModuleCheckoutErrorCode =
  | 'checkout_unavailable' | 'invalid_request' | 'offer_unavailable' | 'price_unavailable'
  | 'customer_mismatch' | 'customer_adjustments' | 'invalid_binding' | 'checkout_review_required'
  | 'payment_pending' | 'checkout_expired' | 'dependency_required' | 'already_active'
  | 'offer_conflict' | 'admin_required' | 'storage_unavailable' | 'provider_unavailable'

export class ModuleCheckoutError extends Error {
  constructor(readonly code: ModuleCheckoutErrorCode, readonly status: number) {
    super(`Module checkout unavailable: ${code}`)
    this.name = 'ModuleCheckoutError'
  }
}
function fail(code: ModuleCheckoutErrorCode, status: number): never { throw new ModuleCheckoutError(code, status) }
function row(value: unknown): value is Row {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 255 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const objectId = (value: unknown): unknown => row(value) ? value.id : value
const empty = (value: unknown) => value == null || (Array.isArray(value) && value.length === 0)

/** Explicit sandbox opt-in. A live billing deployment still cannot start checkout. */
export function isModuleCheckoutEnabled(): boolean {
  return process.env.DIRIQO_MODULE_CHECKOUT_ENABLED === 'true' && readModuleBillingMode() === false
}

/** Shared by the catalog and checkout; these values must come from canonical server storage. */
export function parseModuleCheckoutOffer(value: unknown): ModuleCheckoutOffer {
  if (!row(value) || !uuid(value.id) || !identifier(value.offer_key) || !identifier(value.stripe_price_id)
    || typeof value.product !== 'string' || !(PRODUCTS as readonly string[]).includes(value.product)
    || value.is_published !== true || value.livemode !== false
    || typeof value.currency !== 'string' || !['czk', 'eur'].includes(value.currency)
    || !positiveInteger(value.unit_amount) || value.policy_version !== CAPABILITY_POLICY_VERSION
    || typeof value.history_days !== 'number' || !Number.isSafeInteger(value.history_days) || value.history_days < 0
    || !Array.isArray(value.capabilities) || value.capabilities.length === 0
    || new Set(value.capabilities).size !== value.capabilities.length
    || value.capabilities.some((code) => {
      const definition = getCapability(code)
      return !definition || definition.product !== value.product || definition.scope !== 'company'
    })) fail('offer_unavailable', 409)
  return {
    id: value.id, offer_key: value.offer_key, product: value.product as CheckoutProduct,
    stripe_price_id: value.stripe_price_id, currency: value.currency, unit_amount: value.unit_amount,
    livemode: false, is_published: true, capabilities: [...value.capabilities] as CapabilityCode[],
    policy_version: CAPABILITY_POLICY_VERSION, history_days: value.history_days,
  }
}

/** V1 supports only a fixed, licensed, monthly/yearly recurring price, without billing adjustments. */
export function validateModuleCheckoutPrice(offer: ModuleCheckoutOffer, value: unknown): 'month' | 'year' {
  if (!row(value) || value.id !== offer.stripe_price_id || value.object !== 'price' || value.active !== true
    || value.livemode !== offer.livemode || value.currency !== offer.currency || value.unit_amount !== offer.unit_amount
    || value.type !== 'recurring' || value.billing_scheme !== 'per_unit'
    || value.custom_unit_amount !== null || value.transform_quantity !== null || value.tiers_mode !== null || !empty(value.tiers)
    || (value.unit_amount_decimal != null && (typeof value.unit_amount_decimal !== 'string'
      || !/^\d+(?:\.0+)?$/.test(value.unit_amount_decimal) || Number(value.unit_amount_decimal) !== offer.unit_amount))
    || ![null, 'unspecified', 'exclusive'].includes(value.tax_behavior as null | string)
    || !row(value.recurring) || !['month', 'year'].includes(value.recurring.interval as string)
    || value.recurring.interval_count !== 1 || value.recurring.usage_type !== 'licensed'
    || value.recurring.trial_period_days != null
    || !row(value.product) || !identifier(value.product.id) || value.product.object !== 'product'
    || value.product.deleted === true || value.product.active !== true || value.product.livemode !== offer.livemode) {
    fail('price_unavailable', 409)
  }
  return value.recurring.interval as 'month' | 'year'
}

function appOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.trim() !== value || /[\\\u0000-\u0020\u007f]/.test(value)) fail('invalid_request', 400)
  let url: URL
  try { url = new URL(value) } catch { return fail('invalid_request', 400) }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    fail('invalid_request', 400)
  }
  return url.origin
}

function hostedUrl(value: unknown, sessionId: string): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\u0000-\u0020\u007f]/.test(value)) fail('invalid_binding', 503)
  let url: URL
  try { url = new URL(value) } catch { return fail('invalid_binding', 503) }
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password
    || ![`/c/pay/${sessionId}`, `/pay/${sessionId}`].includes(url.pathname)) fail('invalid_binding', 503)
  return value
}

function validateCustomer(value: unknown, customerId: string, companyId: string): void {
  if (typeof customerId !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(customerId)
    || !row(value) || value.id !== customerId || value.object !== 'customer' || value.deleted === true || value.livemode !== false
    || !row(value.metadata) || value.metadata.company_id !== companyId || value.metadata.billing_flow !== MODULE_BILLING_FLOW) {
    fail('customer_mismatch', 409)
  }
  // Credits and inherited discounts cannot satisfy the strict paid-invoice contract in this version.
  if (value.balance !== 0 || !empty(value.discount) || !empty(value.discounts)
    || (value.invoice_credit_balance != null && (!row(value.invoice_credit_balance)
      || Object.values(value.invoice_credit_balance).some((amount) => amount !== 0)))) fail('customer_adjustments', 409)
}

type Attempt = {
  orderId: string; createdAt: number; expiresAt: number; sessionId: string | null
  sessionUrl: string | null; state: 'preparing' | 'open' | 'complete' | 'expired'
}
function seconds(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0+)?(?:Z|\+00:00)$/.test(value)) return NaN
  const result = Date.parse(value) / 1000
  return Number.isSafeInteger(result) && result > 0 ? result : NaN
}
function parseAttempt(value: unknown, input: ModuleCheckoutInput, offer: ModuleCheckoutOffer, customerId: string): Attempt {
  if (!row(value) || !uuid(value.order_id) || !uuid(value.actor_auth_user_id)
    || value.company_id !== input.companyId || value.offer_id !== offer.id || value.product !== offer.product
    || value.register_id !== null || value.livemode !== false || value.stripe_customer_id !== customerId
    || !['preparing', 'open', 'complete', 'expired'].includes(value.state as string)) fail('invalid_binding', 503)
  const createdAt = seconds(value.created_at)
  const expiresAt = seconds(value.expires_at)
  if (!Number.isSafeInteger(createdAt) || expiresAt !== createdAt + 3600
    || createdAt > Math.floor(Date.now() / 1000) + 60) fail('invalid_binding', 503)
  const state = value.state as Attempt['state']
  if (state === 'preparing') {
    if (value.stripe_session_id !== null || value.stripe_session_url !== null) fail('invalid_binding', 503)
    return { orderId: value.order_id, createdAt, expiresAt, sessionId: null, sessionUrl: null, state }
  }
  if (typeof value.stripe_session_id !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(value.stripe_session_id)) fail('invalid_binding', 503)
  return { orderId: value.order_id, createdAt, expiresAt, sessionId: value.stripe_session_id,
    sessionUrl: hostedUrl(value.stripe_session_url, value.stripe_session_id), state }
}

const OFFER_COLUMNS = 'id,offer_key,product,stripe_price_id,currency,unit_amount,livemode,is_published,capabilities,policy_version,history_days'
function storageFailure(error: unknown): never {
  const message = row(error) ? error.message : null
  if (message === 'module_checkout_admin_required') fail('admin_required', 403)
  if (message === 'module_checkout_dependency_required') fail('dependency_required', 409)
  if (message === 'module_checkout_already_active') fail('already_active', 409)
  if (message === 'module_checkout_offer_conflict') fail('offer_conflict', 409)
  if (message === 'module_checkout_offer_unavailable') fail('offer_unavailable', 409)
  return fail('storage_unavailable', 503)
}

/**
 * The parent route must authenticate getUser() and authorize an active company admin.
 * The service-only reservation RPC rechecks that actor and atomically enforces product
 * dependencies/duplicate scope. This function is not a public authorization entrypoint.
 * It never activates a module: only the verified paid-invoice handler can do that.
 */
export async function createModuleCheckout(
  input: ModuleCheckoutInput,
  { stripe, admin }: ModuleCheckoutDependencies,
): Promise<{ url: string; orderId: string }> {
  if (!isModuleCheckoutEnabled()) fail('checkout_unavailable', 503)
  if (!row(input) || !uuid(input.companyId) || !uuid(input.actorAuthUserId) || !uuid(input.offerId) || input.registerId !== null) {
    fail('invalid_request', 400)
  }
  const origin = appOrigin(input.appUrl)
  const rpc = async (name: string, args: Row): Promise<unknown> => {
    const result = await admin.rpc(name, args)
    if (result.error) storageFailure(result.error)
    return result.data
  }
  try {
    const loaded = await admin.from('module_offers').select(OFFER_COLUMNS).eq('id', input.offerId).maybeSingle()
    if (loaded.error) storageFailure(loaded.error)
    const offer = parseModuleCheckoutOffer(loaded.data)
    if (offer.id !== input.offerId) fail('invalid_binding', 503)
    validateModuleCheckoutPrice(offer, await stripe.prices.retrieve(offer.stripe_price_id, { expand: ['product'] }))

    const mapping = await admin.from('module_billing_customers').select('company_id,livemode,stripe_customer_id')
      .eq('company_id', input.companyId).eq('livemode', false).maybeSingle()
    if (mapping.error) storageFailure(mapping.error)
    let customerId: string
    if (mapping.data === null) {
      const created = await stripe.customers.create({ metadata: { company_id: input.companyId, billing_flow: MODULE_BILLING_FLOW } },
        { idempotencyKey: `module-customer:test:${input.companyId}` })
      validateCustomer(created, created.id, input.companyId)
      const winner = await rpc('bind_module_billing_customer', {
        p_company_id: input.companyId, p_livemode: false, p_customer_id: created.id,
      })
      if (typeof winner !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(winner)) fail('invalid_binding', 503)
      customerId = winner
    } else {
      if (!row(mapping.data) || mapping.data.company_id !== input.companyId || mapping.data.livemode !== false
        || typeof mapping.data.stripe_customer_id !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(mapping.data.stripe_customer_id)) {
        fail('invalid_binding', 503)
      }
      customerId = mapping.data.stripe_customer_id
    }
    validateCustomer(await stripe.customers.retrieve(customerId), customerId, input.companyId)
    let attempt = parseAttempt(await rpc('reserve_module_checkout', {
      p_company_id: input.companyId, p_offer_id: offer.id, p_register_id: null,
      p_livemode: false, p_actor_auth_user_id: input.actorAuthUserId,
    }), input, offer, customerId)
    const metadata = { billing_flow: MODULE_BILLING_FLOW, [MODULE_ORDER_METADATA_KEY]: attempt.orderId, company_id: input.companyId }
    let session: Stripe.Checkout.Session
    const expand = ['line_items.data.price']
    if (attempt.sessionId) {
      session = await stripe.checkout.sessions.retrieve(attempt.sessionId, { expand })
    } else {
      // Never release an unknown provider outcome based on our local clock, even after 24h.
      if (attempt.expiresAt - Math.floor(Date.now() / 1000) < 1800) fail('checkout_review_required', 409)
      const suffix = [...createHash('sha256').update(attempt.orderId).digest().subarray(0, 8)]
        .map((byte) => String.fromCharCode(97 + byte % 26)).join('')
      session = await stripe.checkout.sessions.create({
        mode: 'subscription', customer: customerId, client_reference_id: input.companyId,
        line_items: [{ price: offer.stripe_price_id, quantity: 1 }], currency: offer.currency,
        metadata, subscription_data: { metadata }, expires_at: attempt.expiresAt,
        success_url: `${origin}/billing/modules?checkout=returned`, cancel_url: `${origin}/billing/modules?checkout=cancelled`,
        allow_promotion_codes: false, automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false },
        integration_identifier: `diriqo_modules_v1_${suffix}`, expand,
      }, { idempotencyKey: `module-checkout:${attempt.orderId}` })
    }
    if (!row(session) || typeof session.id !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(session.id)
      || (attempt.sessionId !== null && session.id !== attempt.sessionId)
      || session.livemode !== false || session.mode !== 'subscription' || objectId(session.customer) !== customerId
      || session.client_reference_id !== input.companyId || session.expires_at !== attempt.expiresAt
      || !row(session.metadata) || Object.entries(metadata).some(([key, value]) => session.metadata?.[key] !== value)
      || !['open', 'complete', 'expired'].includes(session.status as string)
      || session.currency !== offer.currency || session.amount_subtotal !== offer.unit_amount || session.amount_total !== offer.unit_amount
      || session.automatic_tax?.enabled !== false || session.total_details?.amount_discount !== 0
      || session.total_details?.amount_tax !== 0 || session.total_details?.amount_shipping !== 0
      || !session.line_items || session.line_items.has_more !== false || session.line_items.data.length !== 1) fail('invalid_binding', 503)
    const line = session.line_items.data[0]
    if (objectId(line.price) !== offer.stripe_price_id || line.quantity !== 1 || line.currency !== offer.currency
      || line.amount_subtotal !== offer.unit_amount || line.amount_total !== offer.unit_amount) fail('invalid_binding', 503)
    // An idempotent provider retry can return a terminal session whose hosted URL is
    // already gone, after our first save failed. Retain the reservation for operator
    // reconciliation; never fabricate its URL or release the scope for another charge.
    if (attempt.sessionId === null && session.status !== 'open' && session.url === null) fail('checkout_review_required', 409)
    const url = session.status === 'open' || attempt.sessionId === null ? hostedUrl(session.url, session.id) : attempt.sessionUrl!
    if (attempt.sessionId === null) {
      const saved = parseAttempt(await rpc('record_module_checkout_session', {
        p_order_id: attempt.orderId, p_session_id: session.id, p_session_url: url, p_expires_at: attempt.expiresAt,
      }), input, offer, customerId)
      if (saved.orderId !== attempt.orderId || saved.expiresAt !== attempt.expiresAt
        || saved.sessionId !== session.id || saved.sessionUrl !== url) fail('invalid_binding', 503)
      attempt = saved
    }
    if (session.status === 'complete' || session.status === 'expired') {
      const closed = parseAttempt(await rpc('close_module_checkout_session', {
        p_order_id: attempt.orderId, p_session_id: session.id, p_state: session.status,
      }), input, offer, customerId)
      if (closed.orderId !== attempt.orderId || closed.sessionId !== session.id || closed.state !== session.status
        || closed.expiresAt !== attempt.expiresAt) fail('invalid_binding', 503)
      fail(session.status === 'complete' ? 'payment_pending' : 'checkout_expired', 409)
    }
    if (attempt.state === 'complete') fail('payment_pending', 409)
    if (attempt.state !== 'open' || session.expires_at <= Math.floor(Date.now() / 1000)) fail('checkout_review_required', 409)
    return { url, orderId: attempt.orderId }
  } catch (error) {
    if (error instanceof ModuleCheckoutError) throw error
    throw new ModuleCheckoutError('provider_unavailable', 503)
  }
}
