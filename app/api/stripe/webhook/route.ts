import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

import { getBillingIntervalByStripePriceId, getPlanKeyByStripePriceId, normalizePlanKey } from '@/lib/plans'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getStripe } from '@/lib/stripe'
import type { SubscriptionStatus } from '@/lib/subscription'

export const runtime = 'nodejs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function getObjectId(value: unknown) {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.id === 'string') return value.id
  return ''
}

function getMetadata(value: unknown) {
  return isRecord(value) ? value : {}
}

function fromUnixTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null
}

function getSubscriptionItem(subscription: Stripe.Subscription) {
  return subscription.items.data[0] ?? null
}

function getSubscriptionPriceId(subscription: Stripe.Subscription) {
  return getSubscriptionItem(subscription)?.price?.id ?? null
}

function getSubscriptionPeriodStart(subscription: Stripe.Subscription) {
  const item = getSubscriptionItem(subscription) as
    | (Stripe.SubscriptionItem & { current_period_start?: number })
    | null
  const subscriptionRecord = subscription as unknown as Record<string, unknown>

  return fromUnixTimestamp(item?.current_period_start) ?? fromUnixTimestamp(subscriptionRecord.current_period_start)
}

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const item = getSubscriptionItem(subscription) as
    | (Stripe.SubscriptionItem & { current_period_end?: number })
    | null
  const subscriptionRecord = subscription as unknown as Record<string, unknown>

  return fromUnixTimestamp(item?.current_period_end) ?? fromUnixTimestamp(subscriptionRecord.current_period_end)
}

function mapStripeSubscriptionStatus(status: string): SubscriptionStatus {
  if (status === 'trialing') return 'trialing'
  if (status === 'active') return 'active'
  if (status === 'past_due') return 'past_due'
  if (status === 'canceled') return 'canceled'
  if (status === 'incomplete') return 'incomplete'
  if (status === 'incomplete_expired') return 'expired'
  if (status === 'unpaid' || status === 'paused') return 'past_due'

  return 'incomplete'
}

async function findCompanyId(input: {
  metadata: Record<string, unknown>
  stripeCustomerId: string
  stripeSubscriptionId: string
}) {
  const metadataCompanyId = getString(input.metadata.company_id)
  if (metadataCompanyId) return metadataCompanyId

  const admin = createSupabaseAdminClient()

  if (input.stripeSubscriptionId) {
    const { data, error } = await admin
      .from('company_subscriptions')
      .select('company_id')
      .eq('stripe_subscription_id', input.stripeSubscriptionId)
      .maybeSingle()

    if (!error && data?.company_id) return String(data.company_id)
  }

  if (input.stripeCustomerId) {
    const { data, error } = await admin
      .from('company_subscriptions')
      .select('company_id')
      .eq('stripe_customer_id', input.stripeCustomerId)
      .maybeSingle()

    if (!error && data?.company_id) return String(data.company_id)
  }

  return null
}

async function retrieveSubscription(subscriptionId: string) {
  if (!subscriptionId) return null

  return getStripe().subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price'],
  })
}

async function syncSubscription(
  subscription: Stripe.Subscription,
  fallbackMetadata: Record<string, unknown> = {}
) {
  const metadata = {
    ...fallbackMetadata,
    ...getMetadata(subscription.metadata),
  }
  const stripeCustomerId = getObjectId(subscription.customer)
  const stripeSubscriptionId = subscription.id
  const companyId = await findCompanyId({
    metadata,
    stripeCustomerId,
    stripeSubscriptionId,
  })

  if (!companyId) return

  const stripePriceId = getSubscriptionPriceId(subscription)
  const planKey = getPlanKeyByStripePriceId(stripePriceId) ?? normalizePlanKey(metadata.plan_key)
  const billingInterval =
    getBillingIntervalByStripePriceId(stripePriceId) ??
    (getString(metadata.billing_interval) === 'yearly' ? 'yearly' : 'monthly')
  const status = mapStripeSubscriptionStatus(subscription.status)
  const subscriptionRecord = subscription as unknown as Record<string, unknown>
  const payload: Record<string, unknown> = {
    company_id: companyId,
    plan_key: planKey,
    billing_interval: billingInterval,
    status,
    stripe_customer_id: stripeCustomerId || null,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_price_id: stripePriceId,
    current_period_start: getSubscriptionPeriodStart(subscription),
    current_period_end: getSubscriptionPeriodEnd(subscription),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString(),
  }
  const trialStart = fromUnixTimestamp(subscriptionRecord.trial_start)
  const trialEnd = fromUnixTimestamp(subscriptionRecord.trial_end)

  if (trialStart) payload.trial_started_at = trialStart
  if (trialEnd) payload.trial_ends_at = trialEnd

  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('company_subscriptions')
    .upsert(payload, { onConflict: 'company_id' })

  if (error) {
    throw new Error(error.message)
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const metadata = getMetadata(session.metadata)
  const companyId = getString(metadata.company_id)
  const stripeCustomerId = getObjectId(session.customer)
  const stripeSubscriptionId = getObjectId(session.subscription)

  if (companyId && stripeCustomerId) {
    const admin = createSupabaseAdminClient()
    const { error } = await admin
      .from('company_subscriptions')
      .update({
        stripe_customer_id: stripeCustomerId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)

    if (error) throw new Error(error.message)
  }

  const subscription = await retrieveSubscription(stripeSubscriptionId)
  if (subscription) {
    await syncSubscription(subscription, metadata)
  }
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const invoiceRecord = invoice as unknown as Record<string, unknown>
  const parent = isRecord(invoiceRecord.parent) ? invoiceRecord.parent : null
  const subscriptionDetails = isRecord(parent?.subscription_details)
    ? parent.subscription_details
    : null

  return (
    getObjectId(invoiceRecord.subscription) ||
    getObjectId(subscriptionDetails?.subscription)
  )
}

async function syncInvoiceSubscription(invoice: Stripe.Invoice) {
  const subscriptionId = getInvoiceSubscriptionId(invoice)
  const subscription = await retrieveSubscription(subscriptionId)

  if (subscription) {
    await syncSubscription(subscription)
    return true
  }

  return false
}

async function markInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const synced = await syncInvoiceSubscription(invoice)
  if (synced) return

  const admin = createSupabaseAdminClient()
  const stripeCustomerId = getObjectId(invoice.customer)
  if (!stripeCustomerId) return

  const { error } = await admin
    .from('company_subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_customer_id', stripeCustomerId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!webhookSecret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET is not configured.' }, { status: 500 })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event: Stripe.Event

  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature ?? '', webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid Stripe signature.' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object as Stripe.Subscription)
      break
    case 'invoice.payment_succeeded':
      await syncInvoiceSubscription(event.data.object as Stripe.Invoice)
      break
    case 'invoice.payment_failed':
      await markInvoicePaymentFailed(event.data.object as Stripe.Invoice)
      break
    default:
      break
  }

  return NextResponse.json({ received: true })
}
