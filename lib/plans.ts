export const PLAN_KEYS = ['starter', 'growth', 'business', 'scale'] as const
export const MAIN_PLAN_KEYS = PLAN_KEYS
export const CHECKOUT_PLAN_KEYS = PLAN_KEYS

export type PlanKey = (typeof PLAN_KEYS)[number]
export type MainPlanKey = (typeof MAIN_PLAN_KEYS)[number]
export type CheckoutPlanKey = (typeof CHECKOUT_PLAN_KEYS)[number]
export type StripePriceEnvKey =
  | 'STRIPE_PRICE_STARTER'
  | 'STRIPE_PRICE_STARTER_YEARLY'
  | 'STRIPE_PRICE_GROWTH'
  | 'STRIPE_PRICE_GROWTH_YEARLY'
  | 'STRIPE_PRICE_BUSINESS'
  | 'STRIPE_PRICE_BUSINESS_YEARLY'
  | 'STRIPE_PRICE_SCALE'
  | 'STRIPE_PRICE_SCALE_YEARLY'

export type BillingInterval = 'monthly' | 'yearly'

export type PlanConfig = {
  key: PlanKey
  name: string
  workerLimit: number | null
  priceMonthly: number
  priceYearly: number
  currency: 'EUR'
  stripePriceEnvKeys: Record<BillingInterval, StripePriceEnvKey>
  recommended?: boolean
}

export const plans: Record<PlanKey, PlanConfig> = {
  starter: {
    key: 'starter',
    name: 'Starter',
    workerLimit: 5,
    priceMonthly: 19,
    priceYearly: 190,
    currency: 'EUR',
    stripePriceEnvKeys: {
      monthly: 'STRIPE_PRICE_STARTER',
      yearly: 'STRIPE_PRICE_STARTER_YEARLY',
    },
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    workerLimit: 15,
    priceMonthly: 39,
    priceYearly: 390,
    currency: 'EUR',
    stripePriceEnvKeys: {
      monthly: 'STRIPE_PRICE_GROWTH',
      yearly: 'STRIPE_PRICE_GROWTH_YEARLY',
    },
    recommended: true,
  },
  business: {
    key: 'business',
    name: 'Business',
    workerLimit: 30,
    priceMonthly: 79,
    priceYearly: 790,
    currency: 'EUR',
    stripePriceEnvKeys: {
      monthly: 'STRIPE_PRICE_BUSINESS',
      yearly: 'STRIPE_PRICE_BUSINESS_YEARLY',
    },
  },
  scale: {
    key: 'scale',
    name: 'Scale',
    workerLimit: 50,
    priceMonthly: 149,
    priceYearly: 1490,
    currency: 'EUR',
    stripePriceEnvKeys: {
      monthly: 'STRIPE_PRICE_SCALE',
      yearly: 'STRIPE_PRICE_SCALE_YEARLY',
    },
  },
} satisfies Record<PlanKey, PlanConfig>

export const PLANS = plans
export const mainPlans = MAIN_PLAN_KEYS.map((planKey) => plans[planKey])

export function isPlanKey(value: unknown): value is PlanKey {
  return PLAN_KEYS.includes(String(value).trim().toLowerCase() as PlanKey)
}

export function isMainPlanKey(value: unknown): value is MainPlanKey {
  return MAIN_PLAN_KEYS.includes(String(value).trim().toLowerCase() as MainPlanKey)
}

export function isCheckoutPlanKey(value: unknown): value is CheckoutPlanKey {
  return CHECKOUT_PLAN_KEYS.includes(String(value).trim().toLowerCase() as CheckoutPlanKey)
}

export function normalizePlanKey(value: unknown): PlanKey {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'enterprise' || normalized === 'custom') return 'scale'
  return isPlanKey(normalized) ? normalized : 'starter'
}

export function normalizeMainPlanKey(value: unknown): MainPlanKey {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'enterprise' || normalized === 'custom') return 'scale'
  return isMainPlanKey(normalized) ? normalized : 'starter'
}

export function normalizeCheckoutPlanKey(value: unknown): CheckoutPlanKey {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'enterprise' || normalized === 'custom') return 'scale'
  return isCheckoutPlanKey(normalized) ? normalized : 'starter'
}

export function getPlan(planKey: unknown): PlanConfig {
  return plans[normalizePlanKey(planKey)]
}

export function getWorkerLimit(planKey: unknown) {
  return getPlan(planKey).workerLimit
}

export function getStripePriceId(planKey: unknown, interval: BillingInterval = 'monthly') {
  const plan = getPlan(planKey)
  const envKey = plan.stripePriceEnvKeys[interval]

  return process.env[envKey]?.trim() || null
}

export function getPlanKeyByStripePriceId(priceId: string | null | undefined): CheckoutPlanKey | null {
  const normalizedPriceId = priceId?.trim()
  if (!normalizedPriceId) return null

  for (const planKey of CHECKOUT_PLAN_KEYS) {
    const priceEnvKeys = plans[planKey].stripePriceEnvKeys

    for (const interval of ['monthly', 'yearly'] as const) {
      if (process.env[priceEnvKeys[interval]]?.trim() === normalizedPriceId) {
        return planKey
      }
    }
  }

  return null
}

export function getBillingIntervalByStripePriceId(priceId: string | null | undefined): BillingInterval | null {
  const normalizedPriceId = priceId?.trim()
  if (!normalizedPriceId) return null

  for (const planKey of CHECKOUT_PLAN_KEYS) {
    const priceEnvKeys = plans[planKey].stripePriceEnvKeys

    for (const interval of ['monthly', 'yearly'] as const) {
      if (process.env[priceEnvKeys[interval]]?.trim() === normalizedPriceId) {
        return interval
      }
    }
  }

  return null
}
