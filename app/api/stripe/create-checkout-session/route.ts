import { NextRequest, NextResponse } from 'next/server'

import { normalizeBillingInterval } from '@/lib/billing-shared'
import { getStripePriceId, normalizePlanKey } from '@/lib/plans'
import { getOrCreateTrialSubscription } from '@/lib/subscription'
import { requireAuthenticatedUser, requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getStripe } from '@/lib/stripe'

type CheckoutBody = {
  plan_key?: unknown
  billing_interval?: unknown
}

function getAppUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')

  return request.nextUrl.origin
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthenticatedUser()
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const activeCompanyResult = await requireCompanyRole('company_admin', 'super_admin')
  if (!activeCompanyResult.ok) {
    return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
  }

  const body = (await request.json().catch(() => ({}))) as CheckoutBody
  const planKey = normalizePlanKey(body.plan_key)
  const billingInterval = normalizeBillingInterval(body.billing_interval)

  const priceId = getStripePriceId(planKey, billingInterval)
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price id is missing for ${planKey} ${billingInterval}.` },
      { status: 500 }
    )
  }

  const { user } = authResult.value
  const activeCompany = activeCompanyResult.value
  const subscription = await getOrCreateTrialSubscription(activeCompany.companyId)
  const stripe = getStripe()
  const admin = createSupabaseAdminClient()
  let stripeCustomerId = subscription?.stripe_customer_id ?? null

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: activeCompany.profileEmail ?? undefined,
      name: activeCompany.companyName ?? undefined,
      metadata: {
        company_id: activeCompany.companyId,
        user_id: user.id,
      },
    })

    stripeCustomerId = customer.id

    const { error } = await admin
      .from('company_subscriptions')
      .update({
        stripe_customer_id: stripeCustomerId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', activeCompany.companyId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const appUrl = getAppUrl(request)
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    client_reference_id: activeCompany.companyId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    metadata: {
      company_id: activeCompany.companyId,
      user_id: user.id,
      plan_key: planKey,
      billing_interval: billingInterval,
    },
    subscription_data: {
      metadata: {
        company_id: activeCompany.companyId,
        user_id: user.id,
        plan_key: planKey,
        billing_interval: billingInterval,
      },
    },
    success_url: `${appUrl}/settings/company?checkout=success`,
    cancel_url: `${appUrl}/settings/company?checkout=cancel`,
  })

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe checkout session did not return a URL.' }, { status: 502 })
  }

  return NextResponse.json({ url: session.url })
}
