'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'

import { buildInviteMessage, buildWhatsAppInviteUrl } from '@/lib/invites/whatsapp'
import {
  cardTitleStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionCardStyle,
  StatusPill,
} from '@/components/SaasPageLayout'

type InviteState = {
  inviteId: string | null
  inviteLink: string | null
  inviteMessage: string | null
  whatsappUrl: string | null
  status: string
  expiresAt: string | null
}

type Props = {
  workerId: string
  workerName: string
  phone: string | null
  locale: string
  initialInvite: InviteState
  autoCreate?: boolean
  framed?: boolean
}

function getStatusTone(status: string) {
  if (status === 'active') return 'green'
  if (status === 'expired' || status === 'revoked') return 'orange'
  if (status === 'disabled') return 'red'
  if (status === 'invited' || status === 'pending') return 'blue'
  return 'gray'
}

function getStatusLabel(status: string) {
  if (status === 'active') return 'Active'
  if (status === 'expired') return 'Invite expired'
  if (status === 'revoked') return 'Invite revoked'
  if (status === 'disabled') return 'Disabled'
  if (status === 'invited' || status === 'pending') return 'Invited'
  return 'Not invited'
}

export default function WorkerInvitePanel({
  workerId,
  workerName,
  phone,
  locale,
  initialInvite,
  autoCreate = false,
  framed = true,
}: Props) {
  const [invite, setInvite] = useState(initialInvite)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const autoCreateStartedRef = useRef(false)

  const fallbackMessage = useMemo(() => {
    if (!invite.inviteLink) return null
    return buildInviteMessage({ inviteLink: invite.inviteLink, locale })
  }, [invite.inviteLink, locale])

  const fallbackWhatsappUrl = useMemo(() => {
    if (!phone || !fallbackMessage) return null
    return buildWhatsAppInviteUrl(phone, fallbackMessage)
  }, [fallbackMessage, phone])

  const inviteMessage = invite.inviteMessage ?? fallbackMessage
  const whatsappUrl = invite.whatsappUrl ?? fallbackWhatsappUrl

  const createInvite = useCallback(async (mode: 'create' | 'resend') => {
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch('/api/worker-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId, mode }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Invite failed')
      }

      const nextInviteLink = typeof payload.inviteLink === 'string' ? payload.inviteLink : null

      setInvite({
        inviteId: payload.inviteId,
        inviteLink: nextInviteLink,
        inviteMessage: payload.inviteMessage,
        whatsappUrl: payload.whatsappUrl,
        status: payload.status,
        expiresAt: payload.expiresAt,
      })
      if (nextInviteLink) {
        setQrDataUrl(await QRCode.toDataURL(nextInviteLink, { margin: 1, width: 220 }))
        setShowQr(true)
      } else {
        setQrDataUrl(null)
        setShowQr(false)
      }
      setNotice(
        mode === 'resend'
          ? 'WhatsApp invite resent. Click Open WhatsApp to review and send the message.'
          : 'WhatsApp invite created. Click Open WhatsApp to review and send the message.'
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invite failed')
    } finally {
      setBusy(false)
    }
  }, [workerId])

  useEffect(() => {
    if (!autoCreate || autoCreateStartedRef.current || invite.inviteLink || !phone) {
      return
    }

    autoCreateStartedRef.current = true
    void createInvite('create')
  }, [autoCreate, createInvite, invite.inviteLink, phone])

  async function revokeInvite() {
    if (!invite.inviteId) return
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch(`/api/worker-invites/${invite.inviteId}`, {
        method: 'DELETE',
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Revoke failed')
      }

      setInvite((current) => ({ ...current, status: 'revoked' }))
      setNotice('Invite revoked.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Revoke failed')
    } finally {
      setBusy(false)
    }
  }

  async function copyValue(value: string | null, label: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setNotice(`${label} copied.`)
  }

  async function toggleQr() {
    if (!invite.inviteLink) return
    if (!qrDataUrl) {
      setQrDataUrl(await QRCode.toDataURL(invite.inviteLink, { margin: 1, width: 220 }))
    }
    setShowQr((value) => !value)
  }

  return (
    <section style={framed ? sectionCardStyle : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h2 style={cardTitleStyle}>Invite worker</h2>
          <p style={{ margin: '8px 0 0', color: '#64748b', lineHeight: 1.5 }}>
            Create a WhatsApp invite link for this worker. WhatsApp opens with a prepared message; sending still needs one tap in WhatsApp.
          </p>
        </div>
        <StatusPill tone={getStatusTone(invite.status)}>{getStatusLabel(invite.status)}</StatusPill>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 14 }}>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Worker</div>
          <div style={metaValueStyle}>{workerName}</div>
        </div>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Phone</div>
          <div style={metaValueStyle}>{phone ?? '-'}</div>
        </div>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Invite expiry</div>
          <div style={metaValueStyle}>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : '-'}</div>
        </div>
      </div>

      {invite.inviteLink ? (
        <div style={{ ...metaItemStyle, marginTop: 10 }}>
          <div style={metaLabelStyle}>Invite link</div>
          <div style={{ ...metaValueStyle, overflowWrap: 'anywhere' }}>{invite.inviteLink}</div>
        </div>
      ) : null}

      {inviteMessage ? (
        <div style={{ ...metaItemStyle, marginTop: 10 }}>
          <div style={metaLabelStyle}>WhatsApp message preview</div>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              color: '#0f172a',
              font: 'inherit',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {inviteMessage}
          </pre>
        </div>
      ) : null}

      {notice ? <div style={noticeStyle}>{notice}</div> : null}
      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {whatsappUrl ? (
          <a href={whatsappUrl} target="_blank" rel="noreferrer" style={primaryButtonStyle}>
            Open WhatsApp
          </a>
        ) : (
          <button type="button" style={primaryButtonStyle} disabled={busy || !phone} onClick={() => createInvite('create')}>
            Create WhatsApp invite
          </button>
        )}
        <button type="button" style={secondaryButtonStyle} disabled={busy || !inviteMessage} onClick={() => copyValue(inviteMessage, 'Message')}>
          Copy WhatsApp message
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !invite.inviteLink} onClick={() => copyValue(invite.inviteLink, 'Link')}>
          Copy invite link
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !invite.inviteLink} onClick={toggleQr}>
          {showQr ? 'Hide QR' : 'Show QR'}
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !phone} onClick={() => createInvite('resend')}>
          Resend invite
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !invite.inviteId || invite.status !== 'pending'} onClick={revokeInvite}>
          Revoke invite
        </button>
      </div>

      {showQr && qrDataUrl ? (
        <div style={{ marginTop: 16 }}>
          <img src={qrDataUrl} alt="Worker invite QR code" width={220} height={220} />
        </div>
      ) : null}
    </section>
  )
}

const noticeStyle = {
  marginTop: 12,
  borderRadius: 12,
  border: '1px solid #bbf7d0',
  background: '#f0fdf4',
  color: '#166534',
  padding: '10px 12px',
  fontSize: 14,
  fontWeight: 750,
} as const

const errorStyle = {
  marginTop: 12,
  borderRadius: 12,
  border: '1px solid #fecaca',
  background: '#fef2f2',
  color: '#991b1b',
  padding: '10px 12px',
  fontSize: 14,
  fontWeight: 750,
} as const
