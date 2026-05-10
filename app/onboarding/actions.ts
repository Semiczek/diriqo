'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getCompanyCountryConfig } from '@/lib/company-country-config'
import { createSupabaseServerClient } from '@/lib/supabase-server'

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

  redirect('/')
}

export const createFirstCompany = createCompanyOnboarding
