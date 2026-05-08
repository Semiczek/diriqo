'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { COMPANY_MODULE_KEYS } from '@/lib/company-settings-shared'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function formText(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function isMissingColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? ''
  return error?.code === '42703' || error?.code === 'PGRST204' || message.includes('column')
}

export async function createFirstCompany(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect('/login')
  }

  const companyName = formText(formData, 'company_name')
  const fullName = formText(formData, 'full_name') || user.email || 'Admin'
  const supportEmail = formText(formData, 'support_email') || user.email || 'support@diriqo.com'
  const currency = formText(formData, 'currency') || 'CZK'

  if (companyName.length < 2) {
    redirect('/onboarding?error=company-name')
  }

  const admin = createSupabaseAdminClient()

  let profileResponse = await admin
    .from('profiles')
    .select('id')
    .or(`auth_user_id.eq.${user.id},user_id.eq.${user.id}`)
    .limit(1)

  if (profileResponse.error) {
    throw new Error(profileResponse.error.message)
  }

  let profileId = profileResponse.data?.[0]?.id as string | undefined

  if (!profileId && user.email) {
    profileResponse = await admin
      .from('profiles')
      .select('id')
      .eq('email', user.email)
      .limit(1)

    if (profileResponse.error) throw new Error(profileResponse.error.message)
    profileId = profileResponse.data?.[0]?.id as string | undefined
  }

  if (!profileId) {
    const { data, error } = await admin
      .from('profiles')
      .insert({
        auth_user_id: user.id,
        user_id: user.id,
        full_name: fullName,
        email: user.email ?? null,
        default_hourly_rate: 0,
      })
      .select('id')
      .single()

    if (error || !data?.id) throw new Error(error?.message ?? 'Profil se nepodařilo vytvořit.')
    profileId = data.id
  }

  const baseCompany = {
    name: companyName,
    email: supportEmail,
    currency,
    locale: 'cs-CZ',
    timezone: 'Europe/Prague',
  }
  const trialCompany = {
    ...baseCompany,
    plan_key: 'trial',
    trial_started_at: new Date().toISOString(),
    trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    support_email: supportEmail,
    is_demo: false,
  }

  let companyInsert = await admin.from('companies').insert(trialCompany).select('id').single()

  if (companyInsert.error && isMissingColumn(companyInsert.error)) {
    companyInsert = await admin.from('companies').insert(baseCompany).select('id').single()
  }

  if (companyInsert.error || !companyInsert.data?.id) {
    throw new Error(companyInsert.error?.message ?? 'Firmu se nepodařilo vytvořit.')
  }

  const companyId = companyInsert.data.id as string

  const requiredWrites = await Promise.all([
    admin.from('company_members').insert({
      company_id: companyId,
      profile_id: profileId,
      role: 'company_admin',
      is_active: true,
    }),
    admin.from('company_settings').upsert({
      company_id: companyId,
      require_job_check: true,
      allow_multi_day_jobs: true,
      require_before_after_photos: false,
      require_checklist_completion: false,
      require_work_time_tracking: true,
      default_job_status_after_worker_done: 'waiting_check',
    }),
    admin.from('company_payroll_settings').upsert({
      company_id: companyId,
      default_worker_type: 'employee',
      default_pay_type: 'monthly',
      advances_enabled: true,
      advance_limit_type: 'monthly_amount',
      advance_frequency: 'monthly',
      default_contractor_cost_mode: 'hourly',
    }),
    admin.from('company_billing_settings').upsert({
      company_id: companyId,
      billing_enabled: false,
      default_invoice_due_days: 14,
      default_vat_rate: 21,
      is_vat_payer: false,
      invoice_prefix: 'FV',
      next_invoice_number: 1,
    }),
  ])

  const failedWrite = requiredWrites.find((write) => write.error)
  if (failedWrite?.error) throw new Error(failedWrite.error.message)

  await admin.from('company_modules').upsert(
    COMPANY_MODULE_KEYS.map((module_key) => ({
      company_id: companyId,
      module_key,
      is_enabled: module_key !== 'public_leads',
    })),
    { onConflict: 'company_id,module_key' },
  )

  await admin.from('mailboxes').upsert(
    {
      company_id: companyId,
      name: 'Support',
      email_address: supportEmail,
      provider_type: 'resend',
      is_active: true,
    },
    { onConflict: 'company_id,email_address' },
  )

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
