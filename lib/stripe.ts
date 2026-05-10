import 'server-only'

import Stripe from 'stripe'

let stripeClient: Stripe | null = null

export function getStripe() {
  if (stripeClient) return stripeClient

  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured.')
  }

  stripeClient = new Stripe(secretKey, {
    apiVersion: '2026-04-22.dahlia',
    appInfo: {
      name: 'Diriqo',
    },
  })

  return stripeClient
}
