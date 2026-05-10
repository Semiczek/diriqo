'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireCompanyRoleDalContext } from '@/lib/dal/auth'

function formText(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function parseMoney(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

async function upsertOnboardingState(
  input: {
    dismissedAt?: string | null
    lastOpenedAt?: string | null
    firstWorkerCreated?: boolean
  } = {}
) {
  const { supabase, companyId } = await requireCompanyRoleDalContext('company_admin', 'super_admin')
  const payload: Record<string, string | boolean | null> = {
    company_id: companyId,
    updated_at: new Date().toISOString(),
  }

  if ('dismissedAt' in input) payload.dismissed_at = input.dismissedAt ?? null
  if ('lastOpenedAt' in input) payload.last_opened_at = input.lastOpenedAt ?? null
  if ('firstWorkerCreated' in input) payload.first_worker_created = Boolean(input.firstWorkerCreated)

  const { error } = await supabase
    .from('company_onboarding')
    .upsert(payload, { onConflict: 'company_id' })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/')
}

export async function dismissCompanyOnboardingAction() {
  await upsertOnboardingState({
    dismissedAt: new Date().toISOString(),
  })
}

export async function reopenCompanyOnboardingAction() {
  await upsertOnboardingState({
    dismissedAt: null,
    lastOpenedAt: new Date().toISOString(),
  })
}

export async function useMeAsWorkerAction(formData: FormData) {
  const { supabase, companyId, profileId } = await requireCompanyRoleDalContext(
    'company_admin',
    'super_admin'
  )
  const fullName = formText(formData, 'full_name')
  const hourlyRate = parseMoney(formText(formData, 'default_hourly_rate'))
  const workerTypeRaw = formText(formData, 'worker_type')
  const workerType = workerTypeRaw === 'contractor' ? 'contractor' : 'employee'

  if (!fullName || hourlyRate === null || hourlyRate <= 0) {
    redirect('/?onboarding=open&onboarding_error=worker-rate')
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      default_hourly_rate: hourlyRate,
      hourly_rate: hourlyRate,
      worker_type: workerType,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (profileError) {
    redirect('/?onboarding=open&onboarding_error=worker-save')
  }

  const { error: memberError } = await supabase
    .from('company_members')
    .update({
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('profile_id', profileId)

  if (memberError) {
    redirect('/?onboarding=open&onboarding_error=worker-save')
  }

  await upsertOnboardingState({
    dismissedAt: null,
    lastOpenedAt: new Date().toISOString(),
    firstWorkerCreated: true,
  })

  revalidatePath('/workers')
  revalidatePath(`/workers/${profileId}`)
  redirect('/?onboarding=open')
}
