import { NextRequest, NextResponse } from 'next/server'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { evaluateInviteRow, getInviteByToken } from '@/lib/invites/worker-invites'

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as { token?: string } | null
  const token = payload?.token?.trim()

  if (!token) {
    return NextResponse.json({ ok: false, status: 'invalid' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const invite = await getInviteByToken(admin, token)
  const result = evaluateInviteRow(invite)

  if (!result.ok && result.status === 'expired' && invite?.id) {
    await admin
      .from('worker_invites')
      .update({ status: 'expired' })
      .eq('id', invite.id)
      .eq('status', 'pending')
  }

  return NextResponse.json(result)
}
