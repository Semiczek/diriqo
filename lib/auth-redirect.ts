import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { Locale } from '@/lib/i18n/config'

type ProfileRow = {
  id: string
}

type MembershipRow = {
  company_id: string | null
}

export function getDefaultDashboardPath(locale?: Locale | null) {
  void locale
  return '/'
}

export async function userHasCompany(userId: string) {
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

  if (!profile?.id) {
    return false
  }

  const membershipsResponse = await supabase
    .from('company_members')
    .select('company_id')
    .eq('profile_id', profile.id)
    .eq('is_active', true)
    .limit(1)

  const membership = (membershipsResponse.data?.[0] as MembershipRow | undefined) ?? null

  return Boolean(membership?.company_id)
}

export async function getPostLoginRedirect(userId: string, locale?: Locale | null) {
  const hasCompany = await userHasCompany(userId)
  return hasCompany ? getDefaultDashboardPath(locale) : '/onboarding/company'
}
