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
  const validation = evaluateInviteRow(invite)

  if (!validation.ok || !invite?.id || !invite.worker_profile_id) {
    return NextResponse.json(validation, { status: validation.ok ? 200 : 400 })
  }

  const now = new Date().toISOString()
  const { error: inviteError } = await admin
    .from('worker_invites')
    .update({
      status: 'used',
      used_at: now,
    })
    .eq('id', invite.id)
    .eq('status', 'pending')

  if (inviteError) {
    return NextResponse.json({ ok: false, status: 'invalid', error: inviteError.message }, { status: 500 })
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      worker_status: 'active',
      activated_at: now,
      device_registered_at: now,
      last_seen_at: now,
    })
    .eq('id', invite.worker_profile_id)

  if (profileError) {
    return NextResponse.json({ ok: false, status: 'invalid', error: profileError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    mobileDeepLink: `diriqo://invite/${encodeURIComponent(token)}`,
    workerWebFallback: `/invite/${encodeURIComponent(token)}`,
  })
}
