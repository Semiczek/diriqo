import 'server-only'

import { cookies } from 'next/headers'

import { hasHubAccessRole } from '@/lib/hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type CompanyRelation =
    | {
      id: string | null
      name: string | null
      timezone?: string | null
    }[] 
  | {
      id: string | null
      name: string | null
      timezone?: string | null
    }
  | null

type MembershipRow = {
  id: string | null
  company_id: string | null
  profile_id: string | null
  role: string | null
  companies?: CompanyRelation
}

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
}

export type ActiveCompanyContext = {
  companyId: string
  companyName: string | null
  timeZone: string
  profileId: string
  profileName: string | null
  profileEmail: string | null
  role: string | null
  companyMemberships: {
    id: string | null
    companyId: string
    companyName: string | null
    role: string | null
    isActive: boolean
  }[]
}

function asSingleRelation<T>(value: T[] | T | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export async function getActiveCompanyContext(): Promise<ActiveCompanyContext | null> {
  const supabase = await createSupabaseServerClient()
  const cookieStore = await cookies()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return null
  }

  let profileResponse = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('auth_user_id', user.id)
    .limit(1)

  let profile = (profileResponse.data?.[0] as ProfileRow | undefined) ?? null
  let profileId = profile?.id ?? null

  if (!profileId) {
    profileResponse = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('user_id', user.id)
      .limit(1)

    profile = (profileResponse.data?.[0] as ProfileRow | undefined) ?? null
    profileId = profile?.id ?? null
  }

  if (!profileId) {
    return null
  }

  const membershipsResponse = await supabase
    .from('company_members')
    .select(
      `
        id,
        company_id,
        profile_id,
        role,
        companies (
          id,
          name,
          timezone
        )
      `
    )
    .eq('profile_id', profileId)
    .eq('is_active', true)

  const memberships = ((membershipsResponse.data ?? []) as MembershipRow[]).filter((membership) =>
    hasHubAccessRole(membership.role)
  )

  if (memberships.length === 0) {
    return null
  }

  const cookieCompanyId = cookieStore.get('active_company_id')?.value?.trim() ?? ''
  const membershipFromCookie =
    memberships.find((membership) => membership.company_id === cookieCompanyId) ?? null

  let membership = membershipFromCookie

  if (!membership && memberships.length > 1) {
    const companyIds = memberships
      .map((item) => item.company_id)
      .filter((value): value is string => Boolean(value))

    if (companyIds.length > 0) {
      const latestJobResponse = await supabase
        .from('jobs')
        .select('company_id, start_at, created_at')
        .in('company_id', companyIds)
        .order('start_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(1)

      const latestJobCompanyId = latestJobResponse.data?.[0]?.company_id ?? null

      if (latestJobCompanyId) {
        membership =
          memberships.find((item) => item.company_id === latestJobCompanyId) ?? null
      }
    }
  }

  if (!membership) {
    membership = memberships[0] ?? null
  }

  if (!membership?.company_id || !membership.profile_id) {
    return null
  }

  const company = asSingleRelation(membership.companies)
  const companyMemberships = memberships
    .filter((item) => Boolean(item.company_id))
    .map((item) => {
      const itemCompany = asSingleRelation(item.companies)
      const itemCompanyId = item.company_id ?? ''

      return {
        id: item.id,
        companyId: itemCompanyId,
        companyName: itemCompany?.name ?? null,
        role: item.role ?? null,
        isActive: itemCompanyId === membership?.company_id,
      }
    })

  return {
    companyId: membership.company_id,
    companyName: company?.name ?? null,
    timeZone: company?.timezone ?? 'Europe/Prague',
    profileId: membership.profile_id,
    profileName: profile?.full_name ?? null,
    profileEmail: profile?.email ?? null,
    role: membership.role ?? null,
    companyMemberships,
  }
}
