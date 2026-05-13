import { NextRequest, NextResponse } from 'next/server'

import { generateInviteToken } from '@/lib/invites/token'
import {
  createWorkerInviteRecord,
  revokePendingWorkerInvites,
} from '@/lib/invites/worker-invites'
import { buildInviteMessage, buildWhatsAppInviteUrl } from '@/lib/invites/whatsapp'
import { getRequestLocale } from '@/lib/i18n/server'
import { getPublicAppBaseUrl } from '@/lib/public-app-url'
import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type WorkerProfileRow = {
  id: string
  full_name: string | null
  phone: string | null
  worker_status?: string | null
}

async function loadWorkerForInvite(workerId: string, companyId: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('company_members')
    .select(`
      company_id,
      profile_id,
      role,
      is_active,
      profiles:profile_id (
        id,
        full_name,
        phone,
        worker_status
      )
    `)
    .eq('company_id', companyId)
    .eq('profile_id', workerId)
    .eq('role', 'worker')
    .maybeSingle()

  if (error) {
    throw error
  }

  const profile = Array.isArray(data?.profiles) ? data?.profiles[0] : data?.profiles
  return (profile ?? null) as WorkerProfileRow | null
}

function buildInvitePayload({
  request,
  token,
  phone,
  locale,
}: {
  request: NextRequest
  token: string
  phone: string
  locale: string
}) {
  const inviteLink = `${getPublicAppBaseUrl(request)}/invite/${encodeURIComponent(token)}`
  const inviteMessage = buildInviteMessage({ inviteLink, locale })

  return {
    inviteLink,
    inviteMessage,
    whatsappUrl: buildWhatsAppInviteUrl(phone, inviteMessage),
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireCompanyRole('company_admin', 'super_admin')

  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const payload = (await request.json().catch(() => null)) as {
    workerId?: string
    mode?: 'create' | 'resend'
  } | null
  const workerId = payload?.workerId?.trim()

  if (!workerId) {
    return NextResponse.json({ error: 'workerId is required' }, { status: 400 })
  }

  const worker = await loadWorkerForInvite(workerId, guard.value.companyId)

  if (!worker?.id) {
    return NextResponse.json({ error: 'Worker not found' }, { status: 404 })
  }

  if (!worker.phone) {
    return NextResponse.json({ error: 'Worker phone is required before invite' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  await revokePendingWorkerInvites(supabase, guard.value.companyId, worker.id)

  const token = generateInviteToken()
  const invite = await createWorkerInviteRecord({
    supabase,
    companyId: guard.value.companyId,
    workerProfileId: worker.id,
    phone: worker.phone,
    createdBy: guard.value.profileId,
    token,
  })

  await supabase
    .from('profiles')
    .update({
      worker_status: 'invited',
    })
    .eq('id', worker.id)

  const locale = await getRequestLocale()
  const invitePayload = buildInvitePayload({ request, token, phone: worker.phone, locale })

  return NextResponse.json({
    inviteId: invite.id,
    expiresAt: invite.expires_at,
    status: 'pending',
    worker: {
      id: worker.id,
      name: worker.full_name,
      phone: worker.phone,
    },
    ...invitePayload,
  })
}
