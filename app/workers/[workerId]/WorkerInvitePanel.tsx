'use client'

import Image from 'next/image'
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
  email: string | null
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
  if (status === 'active') return 'Aktivní'
  if (status === 'expired') return 'Pozvánka vypršela'
  if (status === 'revoked') return 'Pozvánka zrušena'
  if (status === 'disabled') return 'Vypnuto'
  if (status === 'invited' || status === 'pending') return 'Pozvánka odeslána'
  return 'Nepozván'
}

export default function WorkerInvitePanel({
  workerId,
  workerName,
  phone,
  email,
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
  const hasContact = Boolean(phone || email)

  const createInvite = useCallback(async (mode: 'create' | 'resend', channel: 'whatsapp' | 'email') => {
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch('/api/worker-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId, mode, channel }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'Pozvánku se nepodařilo vytvořit.')
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
      if (channel === 'email' && payload.emailSent) {
        setNotice(`E-mailová pozvánka byla odeslána na ${payload.emailTo ?? email}.`)
      } else {
        setNotice('Pozvánka je připravená. WhatsApp se otevře s předvyplněnou zprávou.')
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pozvánku se nepodařilo vytvořit.')
    } finally {
      setBusy(false)
    }
  }, [email, workerId])

  useEffect(() => {
    if (!autoCreate || autoCreateStartedRef.current || invite.inviteLink || !hasContact) {
      return
    }

    autoCreateStartedRef.current = true
    void createInvite('create', phone ? 'whatsapp' : 'email')
  }, [autoCreate, createInvite, hasContact, invite.inviteLink, phone])

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
        throw new Error(payload.error || 'Pozvánku se nepodařilo zrušit.')
      }

      setInvite((current) => ({ ...current, status: 'revoked' }))
      setNotice('Pozvánka byla zrušena.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pozvánku se nepodařilo zrušit.')
    } finally {
      setBusy(false)
    }
  }

  async function copyValue(value: string | null, label: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setNotice(`${label} zkopírováno.`)
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
          <h2 style={cardTitleStyle}>Pozvat pracovníka</h2>
          <p style={{ margin: '8px 0 0', color: '#64748b', lineHeight: 1.5 }}>
            Připravte pozvánku do aplikace přes WhatsApp, e-mail, QR kód nebo přímý odkaz.
          </p>
        </div>
        <StatusPill tone={getStatusTone(invite.status)}>{getStatusLabel(invite.status)}</StatusPill>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginTop: 14 }}>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Pracovník</div>
          <div style={metaValueStyle}>{workerName}</div>
        </div>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Telefon</div>
          <div style={metaValueStyle}>{phone ?? '—'}</div>
        </div>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>E-mail</div>
          <div style={{ ...metaValueStyle, overflowWrap: 'anywhere' }}>{email ?? '—'}</div>
        </div>
        <div style={metaItemStyle}>
          <div style={metaLabelStyle}>Platnost pozvánky</div>
          <div style={metaValueStyle}>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleString('cs-CZ') : '—'}</div>
        </div>
      </div>

      {invite.inviteLink ? (
        <div style={{ ...metaItemStyle, marginTop: 10 }}>
          <div style={metaLabelStyle}>Odkaz pozvánky</div>
          <div style={{ ...metaValueStyle, overflowWrap: 'anywhere' }}>{invite.inviteLink}</div>
        </div>
      ) : null}

      {inviteMessage ? (
        <div style={{ ...metaItemStyle, marginTop: 10 }}>
          <div style={metaLabelStyle}>Text pozvánky</div>
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
            Otevřít WhatsApp
          </a>
        ) : (
          <button type="button" style={primaryButtonStyle} disabled={busy || !phone} onClick={() => createInvite('create', 'whatsapp')}>
            Vytvořit WhatsApp pozvánku
          </button>
        )}
        <button type="button" style={secondaryButtonStyle} disabled={busy || !email} onClick={() => createInvite('resend', 'email')}>
          Odeslat e-mailem
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !inviteMessage} onClick={() => copyValue(inviteMessage, 'Text')}>
          Zkopírovat text
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !invite.inviteLink} onClick={() => copyValue(invite.inviteLink, 'Odkaz')}>
          Zkopírovat odkaz
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !invite.inviteLink} onClick={toggleQr}>
          {showQr ? 'Skrýt QR' : 'Zobrazit QR'}
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !hasContact} onClick={() => createInvite('resend', phone ? 'whatsapp' : 'email')}>
          Obnovit pozvánku
        </button>
        <button type="button" style={secondaryButtonStyle} disabled={busy || !invite.inviteId || invite.status !== 'pending'} onClick={revokeInvite}>
          Zrušit pozvánku
        </button>
      </div>

      {showQr && qrDataUrl ? (
        <div style={{ marginTop: 16 }}>
          <Image src={qrDataUrl} alt="QR kód pozvánky pracovníka" width={220} height={220} unoptimized />
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
