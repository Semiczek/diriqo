import 'server-only'

import { redirect } from 'next/navigation'

import { hasPlatformAdminAccess } from '@/lib/platform/platform-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export type SuperadminContext = {
  authUserId: string
  profileId: string | null
  email: string | null
  name: string | null
}

export async function requireSuperAdmin(): Promise<SuperadminContext> {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user || !(await hasPlatformAdminAccess(supabase))) {
    redirect('/sign-in?error=no-hub-access')
  }

  // Profile is optional descriptive context, never the source of platform authority.
  const profile = await supabase.rpc('current_profile_id')
  return {
    authUserId: user.id,
    profileId: !profile.error && typeof profile.data === 'string' ? profile.data : null,
    email: user.email ?? null,
    name: null,
  }
}

export async function logSuperadminAction(input: {
  superadminAuthUserId: string
  superadminProfileId: string | null
  companyId?: string | null
  action: string
  reason?: string | null
  metadata?: Record<string, unknown> | null
}) {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('superadmin_audit_log').insert({
    superadmin_user_id: input.superadminProfileId,
    actor_auth_user_id: input.superadminAuthUserId,
    company_id: input.companyId ?? null,
    action: input.action,
    reason: input.reason ?? null,
    metadata: input.metadata ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }
}
