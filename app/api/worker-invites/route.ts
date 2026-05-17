import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'

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
  email: string | null
  phone: string | null
  worker_status?: string | null
}

type InviteDeliveryChannel = 'whatsapp' | 'email'

let resendClient: Resend | null = null

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
        email,
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
  phone: string | null
  locale: string
}) {
  const inviteLink = `${getPublicAppBaseUrl(request)}/invite/${encodeURIComponent(token)}`
  const inviteMessage = buildInviteMessage({ inviteLink, locale })

  return {
    inviteLink,
    inviteMessage,
    whatsappUrl: phone ? buildWhatsAppInviteUrl(phone, inviteMessage) : null,
  }
}

function getResendClient() {
  if (resendClient) return resendClient

  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('Chybí RESEND_API_KEY.')
  }

  resendClient = new Resend(apiKey)
  return resendClient
}

function getDefaultMailboxName() {
  return process.env.MAILBOX_DEFAULT_FROM_NAME?.trim() || 'Diriqo'
}

function getDefaultMailboxEmail() {
  const email = process.env.MAILBOX_DEFAULT_FROM_EMAIL?.trim()
  if (!email) {
    throw new Error('Chybí MAILBOX_DEFAULT_FROM_EMAIL.')
  }
  return email
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildWorkerInviteEmail({
  workerName,
  inviteLink,
  inviteMessage,
  locale,
}: {
  workerName: string | null
  inviteLink: string
  inviteMessage: string
  locale: string
}) {
  const isCzech = locale.toLowerCase().startsWith('cs')
  const subject = isCzech ? 'Pozvánka do Diriqo' : 'Invitation to Diriqo'
  const greetingName = workerName?.trim() || (isCzech ? 'pracovníku' : 'there')
  const intro = isCzech
    ? `Dobrý den ${greetingName},`
    : `Hello ${greetingName},`
  const actionText = isCzech ? 'Otevřít pozvánku' : 'Open invitation'
  const fallbackText = isCzech
    ? 'Pokud tlačítko nefunguje, zkopírujte tento odkaz do prohlížeče:'
    : 'If the button does not work, copy this link into your browser:'

  const html = `
    <div style="font-family: Arial, sans-serif; color: #0f172a; line-height: 1.55;">
      <p>${escapeHtml(intro)}</p>
      <p>${escapeHtml(inviteMessage).replace(/\n/g, '<br>')}</p>
      <p>
        <a href="${escapeHtml(inviteLink)}" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 12px 18px; border-radius: 10px; text-decoration: none; font-weight: 700;">
          ${escapeHtml(actionText)}
        </a>
      </p>
      <p style="color: #475569;">${escapeHtml(fallbackText)}</p>
      <p><a href="${escapeHtml(inviteLink)}">${escapeHtml(inviteLink)}</a></p>
    </div>
  `

  return {
    subject,
    text: `${intro}\n\n${inviteMessage}\n\n${fallbackText}\n${inviteLink}`,
    html,
  }
}

async function sendWorkerInviteEmail({
  email,
  workerName,
  inviteLink,
  inviteMessage,
  locale,
}: {
  email: string
  workerName: string | null
  inviteLink: string
  inviteMessage: string
  locale: string
}) {
  const resend = getResendClient()
  const message = buildWorkerInviteEmail({ workerName, inviteLink, inviteMessage, locale })

  const { error } = await resend.emails.send({
    from: `${getDefaultMailboxName()} <${getDefaultMailboxEmail()}>`,
    to: [email],
    subject: message.subject,
    html: message.html,
    text: message.text,
  })

  if (error) {
    throw new Error(error.message)
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
    channel?: InviteDeliveryChannel
  } | null
  const workerId = payload?.workerId?.trim()
  const channel = payload?.channel === 'email' || payload?.channel === 'whatsapp' ? payload.channel : null

  if (!workerId) {
    return NextResponse.json({ error: 'Chybí ID pracovníka.' }, { status: 400 })
  }

  const worker = await loadWorkerForInvite(workerId, guard.value.companyId)

  if (!worker?.id) {
    return NextResponse.json({ error: 'Pracovník nebyl nalezen.' }, { status: 404 })
  }

  if (!worker.phone && !worker.email) {
    return NextResponse.json({ error: 'Pracovník musí mít vyplněný telefon nebo e-mail.' }, { status: 400 })
  }

  if (channel === 'whatsapp' && !worker.phone) {
    return NextResponse.json({ error: 'Pro WhatsApp pozvánku musí mít pracovník vyplněný telefon.' }, { status: 400 })
  }

  if (channel === 'email' && !worker.email) {
    return NextResponse.json({ error: 'Pro e-mailovou pozvánku musí mít pracovník vyplněný e-mail.' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  await revokePendingWorkerInvites(supabase, guard.value.companyId, worker.id)

  const token = generateInviteToken()
  const invite = await createWorkerInviteRecord({
    supabase,
    companyId: guard.value.companyId,
    workerProfileId: worker.id,
    phone: worker.phone,
    contactFallback: worker.email,
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
  const shouldSendEmail = channel === 'email' || (!channel && !worker.phone && !!worker.email)

  if (shouldSendEmail && worker.email) {
    await sendWorkerInviteEmail({
      email: worker.email,
      workerName: worker.full_name,
      inviteLink: invitePayload.inviteLink,
      inviteMessage: invitePayload.inviteMessage,
      locale,
    })
  }

  return NextResponse.json({
    inviteId: invite.id,
    expiresAt: invite.expires_at,
    status: 'pending',
    emailSent: shouldSendEmail,
    emailTo: shouldSendEmail ? worker.email : null,
    worker: {
      id: worker.id,
      name: worker.full_name,
      email: worker.email,
      phone: worker.phone,
    },
    ...invitePayload,
  })
}
