'use server'

import { redirect } from 'next/navigation'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { logSuperadminAction, requireSuperAdmin } from '@/lib/superadmin'

export async function attemptSupportEntryAction(formData: FormData) {
  const companyId = String(formData.get('company_id') ?? '').trim()
  const superadmin = await requireSuperAdmin()

  if (!companyId) {
    redirect('/admin/companies')
  }

  await logSuperadminAction({
    superadminProfileId: superadmin.profileId,
    companyId,
    action: 'company_entry_attempted',
  })

  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('support_access_grants')
    .select('id')
    .eq('company_id', companyId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  if (!data?.id) {
    redirect(`/admin/companies/${companyId}?support=denied`)
  }

  await logSuperadminAction({
    superadminProfileId: superadmin.profileId,
    companyId,
    action: 'company_entry_succeeded',
    metadata: {
      support_access_grant_id: data.id,
    },
  })

  redirect(`/admin/companies/${companyId}?support=allowed`)
}
