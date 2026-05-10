export const PLAN_KEYS = ['starter', 'growth', 'business', 'custom', 'website_addon'] as const
export const MAIN_PLAN_KEYS = ['starter', 'growth', 'business', 'custom'] as const
export const ADD_ON_KEYS = ['website_addon'] as const
export const CHECKOUT_PLAN_KEYS = ['starter', 'growth', 'business'] as const

export type PlanKey = (typeof PLAN_KEYS)[number]
export type MainPlanKey = (typeof MAIN_PLAN_KEYS)[number]
export type AddOnKey = (typeof ADD_ON_KEYS)[number]
export type CheckoutPlanKey = (typeof CHECKOUT_PLAN_KEYS)[number]
export type StripePriceEnvKey =
  | 'STRIPE_PRICE_STARTER'
  | 'STRIPE_PRICE_GROWTH'
  | 'STRIPE_PRICE_BUSINESS'

export type PlanConfig = {
  key: PlanKey
  name: string
  workerLimit: number | null
  priceMonthly: number | null
  setupPrice: number | null
  currency: 'EUR'
  stripePriceEnvKey: StripePriceEnvKey | null
  billingKind: 'subscription' | 'add_on'
  recommended?: boolean
}

export const plans: Record<PlanKey, PlanConfig> = {
  starter: {
    key: 'starter',
    name: 'Starter',
    workerLimit: 5,
    priceMonthly: 19,
    setupPrice: null,
    currency: 'EUR',
    stripePriceEnvKey: 'STRIPE_PRICE_STARTER',
    billingKind: 'subscription',
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    workerLimit: 15,
    priceMonthly: 39,
    setupPrice: null,
    currency: 'EUR',
    stripePriceEnvKey: 'STRIPE_PRICE_GROWTH',
    billingKind: 'subscription',
    recommended: true,
  },
  business: {
    key: 'business',
    name: 'Business',
    workerLimit: 30,
    priceMonthly: 59,
    setupPrice: null,
    currency: 'EUR',
    stripePriceEnvKey: 'STRIPE_PRICE_BUSINESS',
    billingKind: 'subscription',
  },
  custom: {
    key: 'custom',
    name: 'Custom',
    workerLimit: null,
    priceMonthly: null,
    setupPrice: null,
    currency: 'EUR',
    stripePriceEnvKey: null,
    billingKind: 'subscription',
  },
  website_addon: {
    key: 'website_addon',
    name: 'Website add-on',
    workerLimit: null,
    priceMonthly: null,
    setupPrice: 999,
    currency: 'EUR',
    stripePriceEnvKey: null,
    billingKind: 'add_on',
  },
} satisfies Record<PlanKey, PlanConfig>

export const PLANS = plans
export const mainPlans = MAIN_PLAN_KEYS.map((planKey) => plans[planKey])
export const addOns = ADD_ON_KEYS.map((planKey) => plans[planKey])

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
  return isPlanKey(normalized) ? normalized : 'starter'
}

export function normalizeMainPlanKey(value: unknown): MainPlanKey {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return isMainPlanKey(normalized) ? normalized : 'starter'
}

export function normalizeCheckoutPlanKey(value: unknown): CheckoutPlanKey {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return isCheckoutPlanKey(normalized) ? normalized : 'starter'
}

export function getPlan(planKey: unknown): PlanConfig {
  return plans[normalizePlanKey(planKey)]
}

export function getWorkerLimit(planKey: unknown) {
  return getPlan(planKey).workerLimit
}

export function getStripePriceId(planKey: unknown) {
  const plan = getPlan(planKey)
  if (!plan.stripePriceEnvKey) return null

  return process.env[plan.stripePriceEnvKey]?.trim() || null
}

export function getPlanKeyByStripePriceId(priceId: string | null | undefined): CheckoutPlanKey | null {
  const normalizedPriceId = priceId?.trim()
  if (!normalizedPriceId) return null

  for (const planKey of CHECKOUT_PLAN_KEYS) {
    const envKey = plans[planKey].stripePriceEnvKey
    if (envKey && process.env[envKey]?.trim() === normalizedPriceId) {
      return planKey
    }
  }

  return null
}
