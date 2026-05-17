'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getCompanyCountryConfig } from '@/lib/company-country-config'
import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { OnboardingMode, UserOnboardingState } from '@/lib/user-onboarding'

function formText(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(formData: FormData, key: string) {
  const value = formText(formData, key)
  return value ? value : null
}

function optionalBusinessIdentifier(formData: FormData, key: string) {
  const value = optionalText(formData, key)
  if (!value) return null

  if (value.length > 64 || !/^[\p{L}\p{N}\s./-]+$/u.test(value)) {
    redirectWithOnboardingError('required')
  }

  return value
}

function redirectWithOnboardingError(error: string): never {
  redirect(`/onboarding/company?error=${encodeURIComponent(error)}`)
}

const onboardingAllowedRoles = ['super_admin', 'company_admin', 'manager', 'worker'] as const

function normalizeMode(value: FormDataEntryValue | null): OnboardingMode {
  return value === 'quick' || value === 'detailed' || value === 'skipped' ? value : 'skipped'
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function getOnboardingActionContext() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/sign-in')
  }

  const activeCompany = await getActiveCompanyContext({ allowedRoles: onboardingAllowedRoles })

  if (!activeCompany) {
    redirect('/onboarding/company')
  }

  return { supabase, userId: user.id, activeCompany }
}

async function getExistingOnboardingState(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  companyId: string
) {
  const { data } = await supabase
    .from('user_onboarding_state')
    .select('id, onboarding_completed, onboarding_mode, completed_tutorials, dismissed_help_pages')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .maybeSingle()

  return (data ?? null) as Pick<UserOnboardingState, 'id' | 'onboarding_completed' | 'onboarding_mode'> & {
    completed_tutorials?: unknown
    dismissed_help_pages?: unknown
  } | null
}

async function saveOnboardingState(input: {
  userId: string
  profileId: string
  companyId: string
  onboardingCompleted?: boolean
  onboardingMode?: OnboardingMode | null
  completedTutorials?: string[]
  dismissedHelpPages?: string[]
}) {
  const supabase = await createSupabaseServerClient()
  const existing = await getExistingOnboardingState(supabase, input.userId, input.companyId)
  const row = {
    user_id: input.userId,
    profile_id: input.profileId,
    company_id: input.companyId,
    onboarding_completed: input.onboardingCompleted ?? existing?.onboarding_completed ?? true,
    onboarding_mode: input.onboardingMode ?? existing?.onboarding_mode ?? null,
    completed_tutorials: input.completedTutorials ?? toStringArray(existing?.completed_tutorials),
    dismissed_help_pages: input.dismissedHelpPages ?? toStringArray(existing?.dismissed_help_pages),
  }

  if (existing?.id) {
    return supabase.from('user_onboarding_state').update(row).eq('id', existing.id)
  }

  return supabase.from('user_onboarding_state').insert(row)
}

export async function createCompanyOnboarding(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/sign-in')
  }

  const companyName = formText(formData, 'company_name')
  const countryCode = formText(formData, 'country_code').toUpperCase()
  const countryConfig = getCompanyCountryConfig(countryCode)
  const language = formText(formData, 'language') || countryConfig.defaultLanguage
  const currency = (formText(formData, 'currency') || countryConfig.defaultCurrency).toUpperCase()
  const registrationNumber = optionalBusinessIdentifier(formData, 'registration_number')
  const taxNumber = optionalBusinessIdentifier(formData, 'tax_number')

  if (companyName.length < 2) {
    redirectWithOnboardingError('company-name')
  }

  if (!countryCode || !language || !currency) {
    redirectWithOnboardingError('required')
  }

  const { data: companyId, error } = await supabase.rpc('create_onboarding_company', {
    input_company_name: companyName,
    input_country_code: countryCode,
    input_language: language,
    input_currency: currency,
    input_registration_number: registrationNumber,
    input_tax_number: taxNumber,
    input_address: optionalText(formData, 'address'),
    input_phone: optionalText(formData, 'phone'),
    input_email: optionalText(formData, 'company_email'),
  })

  if (error || typeof companyId !== 'string') {
    const message = error?.message ?? ''

    if (message.includes('company_name_required')) {
      redirectWithOnboardingError('company-name')
    }

    redirectWithOnboardingError('create')
  }

  const cookieStore = await cookies()
  cookieStore.set({
    name: 'active_company_id',
    value: companyId,
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })

  redirect('/onboarding')
}

export const createFirstCompany = createCompanyOnboarding

export async function chooseOnboardingMode(formData: FormData) {
  const { userId, activeCompany } = await getOnboardingActionContext()
  const mode = normalizeMode(formData.get('mode'))

  await saveOnboardingState({
    userId,
    profileId: activeCompany.profileId,
    companyId: activeCompany.companyId,
    onboardingCompleted: true,
    onboardingMode: mode,
  })

  if (mode === 'quick') {
    redirect('/?tour=quick')
  }

  if (mode === 'detailed') {
    redirect('/?tour=detailed')
  }

  redirect('/')
}

export async function markTutorialCompletedAction(tutorialId: string) {
  const cleanTutorialId = tutorialId.trim().slice(0, 80)
  if (!cleanTutorialId) return

  const { supabase, userId, activeCompany } = await getOnboardingActionContext()
  const existing = await getExistingOnboardingState(supabase, userId, activeCompany.companyId)
  const completedTutorials = Array.from(
    new Set([...toStringArray(existing?.completed_tutorials), cleanTutorialId])
  )

  await saveOnboardingState({
    userId,
    profileId: activeCompany.profileId,
    companyId: activeCompany.companyId,
    onboardingCompleted: true,
    completedTutorials,
  })
}

export async function dismissHelpPageAction(pageKey: string) {
  const cleanPageKey = pageKey.trim().slice(0, 80)
  if (!cleanPageKey) return

  const { supabase, userId, activeCompany } = await getOnboardingActionContext()
  const existing = await getExistingOnboardingState(supabase, userId, activeCompany.companyId)
  const dismissedHelpPages = Array.from(
    new Set([...toStringArray(existing?.dismissed_help_pages), cleanPageKey])
  )

  await saveOnboardingState({
    userId,
    profileId: activeCompany.profileId,
    companyId: activeCompany.companyId,
    onboardingCompleted: true,
    dismissedHelpPages,
  })
}
