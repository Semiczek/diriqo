import 'server-only'

import { redirect } from 'next/navigation'

import type { ActiveCompanyContext } from '@/lib/active-company'
import {
  PLANS,
  getPlan,
  getStripePriceId,
  getWorkerLimit,
  mainPlans,
  normalizePlanKey,
  type CheckoutPlanKey,
  type PlanConfig,
  type PlanKey,
} from '@/lib/plans'
import {
  getActiveWorkerCount,
  getCompanySubscription,
  getSubscriptionAccessState,
  getTrialDaysLeft,
  getOrCreateTrialSubscription,
  hasActiveSubscription,
  isSubscriptionUsable,
  isTrialActive,
  type CompanySubscription,
  type SubscriptionAccessState,
  type SubscriptionStatus,
} from '@/lib/subscription'

export {
  PLAN_KEYS,
  memberLimitMessage,
  normalizeBillingInterval,
} from '@/lib/billing-shared'

export {
  PLANS,
  getActiveWorkerCount,
  getCompanySubscription,
  getOrCreateTrialSubscription,
  getPlan,
  getStripePriceId,
  getSubscriptionAccessState,
  getTrialDaysLeft,
  getWorkerLimit,
  hasActiveSubscription,
  isSubscriptionUsable,
  isTrialActive,
  mainPlans,
  normalizePlanKey,
}

export type {
  CompanySubscription,
  PlanConfig,
  PlanKey,
  SubscriptionAccessState,
  SubscriptionStatus,
}

export type BillingPlan = PlanConfig
export type BillingPlanKey = PlanKey
export type { CheckoutPlanKey }

export function getBillingPlans() {
  return mainPlans
}

export async function getActiveMemberCount(companyId: string) {
  return getActiveWorkerCount(companyId)
}

export function resolveBillingAccess(subscription: CompanySubscription | null) {
  const usable = isSubscriptionUsable(subscription)

  return {
    allowed: usable,
    usable,
    warning: subscription?.status === 'past_due' || subscription?.status === 'canceled',
    locked: !usable,
    reason: usable ? 'ok' : subscription?.status ?? 'missing',
    trialDaysLeft: getTrialDaysLeft(subscription),
  }
}

export function ensureBillingAccessForPage(
  activeCompany: ActiveCompanyContext,
  subscription: CompanySubscription | null
) {
  const access = resolveBillingAccess(subscription)
  const role = (activeCompany.role ?? '').trim().toLowerCase()
  const isBillingAdmin = role === 'company_admin' || role === 'super_admin'

  if (access.allowed) {
    return access
  }

  if (isBillingAdmin) {
    redirect('/billing?locked=1')
  }

  redirect('/billing/locked')
}
