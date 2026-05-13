import { NextRequest, NextResponse } from 'next/server'

import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function DELETE(
  _request: NextRequest,
  context: {
    params: Promise<{
      inviteId: string
    }>
  }
) {
  const guard = await requireCompanyRole('company_admin', 'super_admin')

  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { inviteId } = await context.params

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('worker_invites')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
    })
    .eq('id', inviteId)
    .eq('company_id', guard.value.companyId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data?.id) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
