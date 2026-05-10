import {
  CHECKOUT_PLAN_KEYS,
  PLAN_KEYS,
  normalizeCheckoutPlanKey,
  type CheckoutPlanKey,
  type PlanKey,
} from '@/lib/plans'

export { CHECKOUT_PLAN_KEYS, PLAN_KEYS }

export const BILLING_INTERVALS = ['monthly'] as const

export type BillingPlanKey = PlanKey
export type { CheckoutPlanKey }
export type BillingInterval = (typeof BILLING_INTERVALS)[number]
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'incomplete'

export function normalizePlanKey(value: unknown): CheckoutPlanKey {
  return normalizeCheckoutPlanKey(value)
}

export function normalizeBillingInterval(value: unknown): BillingInterval {
  void value
  return 'monthly'
}

export function memberLimitMessage(maxMembers: number, locale: 'cs' | 'en' = 'cs') {
  void maxMembers
  void locale
  return 'You have reached the worker limit for your current plan. Upgrade your plan to add more workers.'
}
