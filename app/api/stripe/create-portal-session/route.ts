import { NextRequest, NextResponse } from 'next/server'

import { getCompanySubscription } from '@/lib/subscription'
import { requireAuthenticatedUser, requireCompanyRole } from '@/lib/server-guards'
import { getStripe } from '@/lib/stripe'

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

  const activeCompany = activeCompanyResult.value
  const subscription = await getCompanySubscription(activeCompany.companyId)

  if (!subscription?.stripe_customer_id) {
    return NextResponse.json(
      { error: 'Stripe customer does not exist for this company yet.' },
      { status: 400 }
    )
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${getAppUrl(request)}/billing`,
  })

  return NextResponse.json({ url: session.url })
}
