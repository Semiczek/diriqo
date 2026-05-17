import {
  CHECKOUT_PLAN_KEYS,
  PLAN_KEYS,
  type BillingInterval,
  normalizeCheckoutPlanKey,
  type CheckoutPlanKey,
  type PlanKey,
} from '@/lib/plans'

export { CHECKOUT_PLAN_KEYS, PLAN_KEYS }

export const BILLING_INTERVALS = ['monthly', 'yearly'] as const

export type BillingPlanKey = PlanKey
export type { CheckoutPlanKey }
export type { BillingInterval }
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
  return typeof value === 'string' && value.trim().toLowerCase() === 'yearly' ? 'yearly' : 'monthly'
}

export function memberLimitMessage(maxMembers: number, locale: 'cs' | 'en' = 'cs') {
  void maxMembers
  void locale
  return 'You have reached the worker limit for your current plan. Upgrade your plan to add more workers.'
}
