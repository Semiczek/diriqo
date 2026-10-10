import 'server-only'

import type Stripe from 'stripe'
import type { createSupabaseAdminClient } from '../supabase-admin'
import {
  isModuleCheckoutEnabled, parseModuleCheckoutOffer, validateModuleCheckoutPrice,
} from './module-checkout'

type Dependencies = { admin: ReturnType<typeof createSupabaseAdminClient>; stripe: Pick<Stripe, 'prices'> }
const columns = 'id,offer_key,product,stripe_price_id,unit_amount,currency,livemode,capabilities,policy_version,history_days,is_published'

/** A sale price is shown only from a published immutable offer that agrees with Stripe. No draft fallback. */
export async function loadModuleOfferCatalog({ admin, stripe }: Dependencies) {
  if (!isModuleCheckoutEnabled()) return { enabled: false, offers: [] }
  const rows = await admin.from('module_offers').select(columns, { count: 'exact' })
    .eq('livemode', false).eq('is_published', true).order('offer_key').range(0, 99)
  if (rows.error || !Array.isArray(rows.data) || rows.count !== rows.data.length || rows.data.length > 100) {
    throw new Error('Module catalog unavailable')
  }
  const ids = new Set<string>()
  const offers = []
  for (const value of rows.data) {
    const offer = parseModuleCheckoutOffer(value)
    if (ids.has(offer.id)) throw new Error('Duplicate module offer')
    ids.add(offer.id)
    const price = await stripe.prices.retrieve(offer.stripe_price_id, { expand: ['product'] })
    const billingInterval = validateModuleCheckoutPrice(offer, price)
    offers.push({
      id: offer.id, product: offer.product, offerKey: offer.offer_key,
      unitAmount: offer.unit_amount, currency: offer.currency, billingInterval,
    })
  }
  return { enabled: true, offers }
}
