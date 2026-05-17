'use server'

import { revalidatePath } from 'next/cache'

import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function grantSupportAccessAction() {
  const activeCompanyResult = await requireCompanyRole('company_admin')

  if (!activeCompanyResult.ok) {
    throw new Error(activeCompanyResult.error)
  }

  const activeCompany = activeCompanyResult.value
  const supabase = await createSupabaseServerClient()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from('support_access_grants').insert({
    company_id: activeCompany.companyId,
    granted_by: activeCompany.profileId,
    expires_at: expiresAt,
      reason: 'Firemní admin povolil Diriqo support přístup na 24 hodin.',
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/billing')
  revalidatePath('/settings/billing')
}
