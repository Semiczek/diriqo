import 'server-only'

import { redirect } from 'next/navigation'

import { getWorkerLimit, normalizePlanKey, type PlanKey } from '@/lib/plans'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'expired',
  'incomplete',
] as const

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export type CompanySubscription = {
  id: string
  company_id: string
  plan_key: PlanKey
  status: SubscriptionStatus
  trial_started_at: string | null
  trial_ends_at: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

export type SubscriptionAccessReason =
  | 'ok'
  | 'trialing'
  | 'past_due_grace'
  | 'trial_expired'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'incomplete'
  | 'missing'

export type SubscriptionAccessState = {
  subscription: CompanySubscription | null
  usable: boolean
  locked: boolean
  warning: boolean
  reason: SubscriptionAccessReason
  trialDaysLeft: number
}

const SUBSCRIPTION_SELECT =
  'id, company_id, plan_key, status, trial_started_at, trial_ends_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at'

function toDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function normalizeSubscription(row: unknown): CompanySubscription | null {
  if (!row || typeof row !== 'object') return null
  const value = row as CompanySubscription

  return {
    ...value,
    plan_key: normalizePlanKey(value.plan_key),
    status: SUBSCRIPTION_STATUSES.includes(value.status) ? value.status : 'incomplete',
    cancel_at_period_end: Boolean(value.cancel_at_period_end),
  }
}

export async function getCompanySubscription(companyId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('company_subscriptions')
    .select(SUBSCRIPTION_SELECT)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return normalizeSubscription(data)
}

export async function getOrCreateTrialSubscription(companyId: string) {
  const existing = await getCompanySubscription(companyId)
  if (existing) return existing

  const admin = createSupabaseAdminClient()
  const now = new Date()
  const trialEndsAt = addDays(now, 7)
  const { data, error } = await admin
    .from('company_subscriptions')
    .upsert(
      {
        company_id: companyId,
        plan_key: 'starter',
        status: 'trialing',
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEndsAt.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: 'company_id' }
    )
    .select(SUBSCRIPTION_SELECT)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return normalizeSubscription(data)
}

export function isTrialActive(subscription: CompanySubscription | null, now = new Date()) {
  if (!subscription || subscription.status !== 'trialing') return false
  const trialEndsAt = toDate(subscription.trial_ends_at)
  return Boolean(trialEndsAt && trialEndsAt >= now)
}

export function hasActiveSubscription(subscription: CompanySubscription | null, now = new Date()) {
  if (!subscription || subscription.status !== 'active') return false
  const currentPeriodEnd = toDate(subscription.current_period_end)
  return !currentPeriodEnd || currentPeriodEnd >= now
}

function isPastDueInGrace(subscription: CompanySubscription | null, now = new Date()) {
  if (!subscription || subscription.status !== 'past_due') return false
  const currentPeriodEnd = toDate(subscription.current_period_end)
  return Boolean(currentPeriodEnd && addDays(currentPeriodEnd, 3) >= now)
}

function isCanceledStillUsable(subscription: CompanySubscription | null, now = new Date()) {
  if (!subscription || subscription.status !== 'canceled') return false
  const currentPeriodEnd = toDate(subscription.current_period_end)
  return Boolean(currentPeriodEnd && currentPeriodEnd >= now)
}

export function isSubscriptionUsable(subscription: CompanySubscription | null, now = new Date()) {
  return (
    isTrialActive(subscription, now) ||
    hasActiveSubscription(subscription, now) ||
    isPastDueInGrace(subscription, now) ||
    isCanceledStillUsable(subscription, now)
  )
}

export function getTrialDaysLeft(subscription: CompanySubscription | null, now = new Date()) {
  if (!isTrialActive(subscription, now)) return 0
  const trialEndsAt = toDate(subscription?.trial_ends_at)
  if (!trialEndsAt) return 0

  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
}

export async function requireActiveSubscription(companyId: string) {
  const state = await getSubscriptionAccessState(companyId)

  if (!state.usable) {
    redirect('/billing?locked=1')
  }

  return state
}

export async function getSubscriptionAccessState(companyId: string): Promise<SubscriptionAccessState> {
  const subscription = await getCompanySubscription(companyId)
  const now = new Date()
  const trialDaysLeft = getTrialDaysLeft(subscription, now)

  if (!subscription) {
    return {
      subscription: null,
      usable: false,
      locked: true,
      warning: false,
      reason: 'missing',
      trialDaysLeft,
    }
  }

  if (isTrialActive(subscription, now)) {
    return {
      subscription,
      usable: true,
      locked: false,
      warning: trialDaysLeft <= 3,
      reason: 'trialing',
      trialDaysLeft,
    }
  }

  if (hasActiveSubscription(subscription, now)) {
    return {
      subscription,
      usable: true,
      locked: false,
      warning: false,
      reason: 'ok',
      trialDaysLeft,
    }
  }

  if (isPastDueInGrace(subscription, now)) {
    return {
      subscription,
      usable: true,
      locked: false,
      warning: true,
      reason: 'past_due_grace',
      trialDaysLeft,
    }
  }

  if (isCanceledStillUsable(subscription, now)) {
    return {
      subscription,
      usable: true,
      locked: false,
      warning: true,
      reason: 'canceled',
      trialDaysLeft,
    }
  }

  const reason: SubscriptionAccessReason =
    subscription.status === 'trialing'
      ? 'trial_expired'
      : subscription.status === 'active'
        ? 'expired'
        : subscription.status

  return {
    subscription,
    usable: false,
    locked: true,
    warning: false,
    reason,
    trialDaysLeft,
  }
}

export async function getActiveWorkerCount(companyId: string) {
  const supabase = await createSupabaseServerClient()
  const { count, error } = await supabase
    .from('company_members')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq('role', 'worker')

  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

export function getSubscriptionWorkerLimit(subscription: CompanySubscription | null) {
  return getWorkerLimit(subscription?.plan_key ?? 'starter')
}
