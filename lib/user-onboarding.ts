import 'server-only'

import { getActiveCompanyContext, type ActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type OnboardingMode = 'skipped' | 'quick' | 'detailed'

export type UserOnboardingState = {
  id: string
  user_id: string
  profile_id: string | null
  company_id: string | null
  onboarding_completed: boolean
  onboarding_mode: OnboardingMode | null
  completed_tutorials: string[]
  dismissed_help_pages: string[]
}

type ProfileRow = {
  id: string
}

type MembershipRow = {
  company_id: string | null
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeState(row: Record<string, unknown> | null): UserOnboardingState | null {
  if (!row?.id || !row.user_id) return null

  return {
    id: String(row.id),
    user_id: String(row.user_id),
    profile_id: row.profile_id ? String(row.profile_id) : null,
    company_id: row.company_id ? String(row.company_id) : null,
    onboarding_completed: Boolean(row.onboarding_completed),
    onboarding_mode: ['skipped', 'quick', 'detailed'].includes(String(row.onboarding_mode))
      ? (String(row.onboarding_mode) as OnboardingMode)
      : null,
    completed_tutorials: asStringArray(row.completed_tutorials),
    dismissed_help_pages: asStringArray(row.dismissed_help_pages),
  }
}

export async function getProfileIdForAuthUser(userId: string) {
  const supabase = await createSupabaseServerClient()
  let profileResponse = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', userId)
    .limit(1)

  let profile = (profileResponse.data?.[0] as ProfileRow | undefined) ?? null

  if (!profile?.id) {
    profileResponse = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', userId)
      .limit(1)

    profile = (profileResponse.data?.[0] as ProfileRow | undefined) ?? null
  }

  return profile?.id ?? null
}

export async function getFirstCompanyIdForProfile(profileId: string) {
  const supabase = await createSupabaseServerClient()
  const membershipsResponse = await supabase
    .from('company_members')
    .select('company_id')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .limit(1)

  const membership = (membershipsResponse.data?.[0] as MembershipRow | undefined) ?? null
  return membership?.company_id ?? null
}

export async function getUserOnboardingState(userId: string, companyId: string | null) {
  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('user_onboarding_state')
    .select('id, user_id, profile_id, company_id, onboarding_completed, onboarding_mode, completed_tutorials, dismissed_help_pages')
    .eq('user_id', userId)

  query = companyId ? query.eq('company_id', companyId) : query.is('company_id', null)

  const { data } = await query.maybeSingle()
  return normalizeState((data ?? null) as Record<string, unknown> | null)
}

export async function shouldShowOnboardingChoice(userId: string) {
  const profileId = await getProfileIdForAuthUser(userId)
  if (!profileId) return false

  const companyId = await getFirstCompanyIdForProfile(profileId)
  if (!companyId) return false

  const state = await getUserOnboardingState(userId, companyId)
  return !state?.onboarding_completed
}

export async function getActiveUserOnboardingContext(): Promise<{
  userId: string
  activeCompany: ActiveCompanyContext
  state: UserOnboardingState | null
} | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  const activeCompany = await getActiveCompanyContext({
    allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'],
  })

  if (!activeCompany) return null

  return {
    userId: user.id,
    activeCompany,
    state: await getUserOnboardingState(user.id, activeCompany.companyId),
  }
}
