import Image from 'next/image'
import { notFound } from 'next/navigation'

import InviteBridgeClient from '@/app/invite/[token]/InviteBridgeClient'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { evaluateInviteRow, getInviteByToken } from '@/lib/invites/worker-invites'
import { getPublicAppBaseUrl } from '@/lib/public-app-url'

type Props = {
  params: Promise<{
    token: string
  }>
}

export const dynamic = 'force-dynamic'

function getInvalidInviteMessage(status: 'expired' | 'revoked' | 'used' | 'invalid') {
  if (status === 'expired') {
    return 'This invite has expired. Ask your manager to resend it.'
  }

  return 'This invite is no longer valid.'
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params

  if (!token || token.length < 20) {
    notFound()
  }

  const admin = createSupabaseAdminClient()
  const invite = await getInviteByToken(admin, token)
  const validation = evaluateInviteRow(invite)
  const inviteLink = `${getPublicAppBaseUrl()}/invite/${encodeURIComponent(token)}`

  if (!validation.ok) {
    if (validation.status === 'expired' && invite?.id) {
      await admin
        .from('worker_invites')
        .update({ status: 'expired' })
        .eq('id', invite.id)
        .eq('status', 'pending')
    }

    return (
      <main style={pageStyle}>
        <section style={cardStyle}>
          <Logo />
          <h1 style={titleStyle}>Invite unavailable</h1>
          <p style={textStyle}>{getInvalidInviteMessage(validation.status)}</p>
        </section>
      </main>
    )
  }

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <Logo />
        <p style={eyebrowStyle}>Diriqo worker invite</p>
        <h1 style={titleStyle}>You&apos;ve been invited to join {validation.companyName ?? 'your company'} in Diriqo.</h1>
        <p style={textStyle}>
          {validation.workerName ? `${validation.workerName}, open the mobile app to continue.` : 'Open the mobile app to continue.'}
        </p>
        <div style={metaStyle}>
          <span>Phone</span>
          <strong>{validation.phoneMasked}</strong>
        </div>
        <InviteBridgeClient token={token} inviteLink={inviteLink} />
      </section>
    </main>
  )
}

function Logo() {
  return (
    <div style={logoWrapStyle}>
      <Image src="/diriqo-logo-full.png" alt="Diriqo" fill priority sizes="220px" style={{ objectFit: 'contain' }} />
    </div>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 18,
  background: '#f8fafc',
  color: '#0f172a',
} as const

const cardStyle = {
  width: 'min(100%, 540px)',
  borderRadius: 18,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  boxShadow: '0 20px 60px rgba(15, 23, 42, 0.1)',
  padding: 26,
} as const

const logoWrapStyle = {
  position: 'relative',
  width: 220,
  height: 88,
  marginBottom: 8,
} as const

const eyebrowStyle = {
  margin: '0 0 8px',
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
} as const

const titleStyle = {
  margin: 0,
  fontSize: 30,
  lineHeight: 1.12,
} as const

const textStyle = {
  margin: '12px 0 0',
  color: '#475569',
  fontSize: 15,
  lineHeight: 1.6,
} as const

const metaStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  marginTop: 16,
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
  padding: '10px 12px',
  color: '#475569',
  fontSize: 14,
} as const
