'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MessageFeedItem } from '@/lib/email/types'

type JobCommunicationSectionProps = {
  jobId: string
  customerId: string | null
  contactId: string | null
  defaultToEmail: string | null
  defaultToName: string | null
  defaultSubject: string
  feedItems: MessageFeedItem[]
}

function formatDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getDirectionLabel(direction: MessageFeedItem['direction']) {
  return direction === 'outbound' ? 'Odesláno' : 'Přijato'
}

function getDirectionStyles(direction: MessageFeedItem['direction']): React.CSSProperties {
  if (direction === 'outbound') {
    return {
      backgroundColor: '#dbeafe',
      color: '#1d4ed8',
      border: '1px solid #bfdbfe',
    }
  }

  return {
    backgroundColor: '#dcfce7',
    color: '#166534',
    border: '1px solid #bbf7d0',
  }
}

function getStatusLabel(item: MessageFeedItem) {
  if (item.direction === 'inbound') {
    if (item.status === 'fallback_matched') return 'Fallback match'
    if (item.status === 'unmatched') return 'Nespárováno'
    return 'Spárováno'
  }

  if (item.status === 'delivered') return 'Doručeno'
  if (item.status === 'failed') return 'Chyba'
  if (item.status === 'bounced') return 'Nedoručeno'
  if (item.status === 'queued') return 'Ve frontě'
  return 'Odesláno'
}

function getBodyText(item: MessageFeedItem) {
  return item.bodyText?.trim() || item.preview?.trim() || 'Bez obsahu e-mailu.'
}

function getAddressLabel(item: MessageFeedItem) {
  return item.direction === 'outbound' ? 'Komu' : 'Od'
}

function getSenderLabel(item: MessageFeedItem) {
  if (item.direction !== 'outbound') return null

  if (item.senderName && item.senderProfileId) {
    return `${item.senderName} (ID: ${item.senderProfileId})`
  }

  if (item.senderProfileId) {
    return `ID: ${item.senderProfileId}`
  }

  return item.senderName ?? null
}

async function loadJobFeed(jobId: string) {
  const response = await fetch(`/api/mail/feed?entityType=job&entityId=${encodeURIComponent(jobId)}`, {
    method: 'GET',
    cache: 'no-store',
  })

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; feedItems?: MessageFeedItem[] }
    | null

  if (!response.ok || !payload?.ok || !Array.isArray(payload.feedItems)) {
    return null
  }

  return payload.feedItems
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function loadJobFeedUntilMessageAppears(jobId: string, expectedSubject: string, expectedEmail: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextFeed = await loadJobFeed(jobId)

    if (
      nextFeed?.some(
        (item) =>
          item.direction === 'outbound' &&
          item.subject === expectedSubject &&
          item.email.toLowerCase() === expectedEmail.toLowerCase(),
      )
    ) {
      return nextFeed
    }

    if (attempt < 4) {
      await sleep(700)
    }
  }

  return null
}

export default function JobCommunicationSection({
  jobId,
  customerId,
  contactId,
  defaultToEmail,
  defaultToName,
  defaultSubject,
  feedItems,
}: JobCommunicationSectionProps) {
  const [feed, setFeed] = useState<MessageFeedItem[]>(feedItems)
  const [toEmail, setToEmail] = useState(defaultToEmail ?? '')
  const [toName, setToName] = useState(defaultToName ?? '')
  const [subject, setSubject] = useState(defaultSubject)
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState<string | null>(null)

  const canSend = useMemo(() => {
    return toEmail.trim().length > 0 && subject.trim().length > 0 && message.trim().length > 0
  }, [message, subject, toEmail])

  useEffect(() => {
    setFeed((current) => {
      if (feedItems.length === 0 && current.length > 0) {
        return current
      }

      return feedItems
    })
  }, [feedItems])

  useEffect(() => {
    let cancelled = false

    async function refreshFeed() {
      try {
        const nextFeed = await loadJobFeed(jobId)

        if (!cancelled && nextFeed) {
          setFeed((current) => {
            if (nextFeed.length === 0 && current.length > 0) {
              return current
            }

            return nextFeed
          })
        }
      } catch (error) {
        console.error('[EMAIL] Failed to refresh communication feed', error)
      }
    }

    void refreshFeed()

    return () => {
      cancelled = true
    }
  }, [jobId])

  async function handleSend() {
    if (!canSend || sending) return

    setSending(true)
    setSendError(null)
    setSendSuccess(null)

    const subjectValue = subject.trim()
    const emailValue = toEmail.trim()
    const messageValue = message.trim()

    try {
      const response = await fetch('/api/mail/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          relatedEntityType: 'job',
          relatedEntityId: jobId,
          customerId,
          contactId,
          messageType: 'manual',
          toEmail: emailValue,
          toName: toName.trim() || null,
          subject: subjectValue,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap;">${messageValue
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br />')}</div>`,
          text: messageValue,
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Nepodařilo se odeslat email.')
      }

      const happenedAt = new Date().toISOString()
      const optimisticItem: MessageFeedItem = {
        id: `local-${happenedAt}`,
        direction: 'outbound',
        email: emailValue,
        name: toName.trim() || null,
        subject: subjectValue,
        preview: messageValue,
        bodyText: messageValue,
        status: 'sent',
        happenedAt,
      }

      setFeed((current) =>
        [...current, optimisticItem].sort(
          (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
        ),
      )

      setSendSuccess('Email byl odeslán a uložen do komunikace.')
      setMessage('')

      try {
        const persistedFeed = await loadJobFeedUntilMessageAppears(jobId, subjectValue, emailValue)

        if (persistedFeed) {
          setFeed(persistedFeed)
        }
      } catch (error) {
        console.error('[EMAIL] Failed to refetch communication feed after send', error)
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Nepodařilo se odeslat email.')
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '16px',
        backgroundColor: '#fff',
        padding: '20px',
        marginTop: '20px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          marginBottom: expanded ? '16px' : 0,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#111827' }}>Komunikace</h2>
          <p style={{ margin: '6px 0 0 0', color: '#6b7280', fontSize: '14px' }}>
            {feed.length === 0 ? 'Zatím žádná e-mailová komunikace.' : `${feed.length} zpráv v komunikaci.`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          style={{
            border: '1px solid #d1d5db',
            borderRadius: '999px',
            padding: '10px 15px',
            backgroundColor: expanded ? '#111827' : '#ffffff',
            color: expanded ? '#ffffff' : '#111827',
            fontWeight: 800,
            cursor: 'pointer',
          }}
        >
          {expanded ? 'Skrýt komunikaci' : 'Napsat e-mail'}
        </button>
      </div>

      {expanded ? (
        <>
      <div
        style={{
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '16px',
          backgroundColor: '#f9fafb',
          marginBottom: '18px',
          display: 'grid',
          gap: '12px',
        }}
      >
        <div style={{ fontWeight: 700, color: '#111827' }}>Odeslat email</div>

        <div
          style={{
            display: 'grid',
            gap: '12px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <label style={{ display: 'grid', gap: '6px', fontSize: '14px', color: '#374151' }}>
            Komu
            <input
              value={toEmail}
              onChange={(event) => setToEmail(event.target.value)}
              placeholder="zakaznik@firma.cz"
              style={{
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                padding: '10px 12px',
                backgroundColor: '#fff',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: '6px', fontSize: '14px', color: '#374151' }}>
            Jméno
            <input
              value={toName}
              onChange={(event) => setToName(event.target.value)}
              placeholder="Jméno příjemce"
              style={{
                border: '1px solid #d1d5db',
                borderRadius: '10px',
                padding: '10px 12px',
                backgroundColor: '#fff',
              }}
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: '6px', fontSize: '14px', color: '#374151' }}>
          Předmět
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: '10px',
              padding: '10px 12px',
              backgroundColor: '#fff',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: '6px', fontSize: '14px', color: '#374151' }}>
          Zpráva
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={6}
            placeholder="Napište zprávu pro zákazníka..."
            style={{
              border: '1px solid #d1d5db',
              borderRadius: '10px',
              padding: '10px 12px',
              backgroundColor: '#fff',
              resize: 'vertical',
            }}
          />
        </label>

        {sendError ? <div style={{ color: '#b91c1c', fontSize: '14px' }}>{sendError}</div> : null}
        {sendSuccess ? <div style={{ color: '#166534', fontSize: '14px' }}>{sendSuccess}</div> : null}

        <div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend || sending}
            style={{
              border: 'none',
              borderRadius: '10px',
              padding: '11px 16px',
              fontWeight: 700,
              backgroundColor: !canSend || sending ? '#d1d5db' : '#111827',
              color: '#fff',
              cursor: !canSend || sending ? 'not-allowed' : 'pointer',
            }}
          >
            {sending ? 'Odesílání...' : 'Odeslat email'}
          </button>
        </div>
      </div>

      {feed.length === 0 ? (
        <div
          style={{
            border: '1px dashed #d1d5db',
            borderRadius: '12px',
            padding: '18px',
            color: '#6b7280',
            backgroundColor: '#f9fafb',
          }}
        >
          U této zakázky zatím není žádná emailová komunikace.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '12px' }}>
          {feed.map((item) => (
            <article
              key={`${item.direction}-${item.id}`}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '14px',
                display: 'grid',
                gap: '8px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span
                    style={{
                      ...getDirectionStyles(item.direction),
                      borderRadius: '999px',
                      padding: '5px 10px',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    {getDirectionLabel(item.direction)}
                  </span>

                  <span style={{ color: '#6b7280', fontSize: '13px' }}>{getStatusLabel(item)}</span>
                </div>

                <div style={{ color: '#6b7280', fontSize: '13px' }}>{formatDateTime(item.happenedAt)}</div>
              </div>

              <div style={{ color: '#111827', fontWeight: 700 }}>{item.subject || '(Bez předmětu)'}</div>
              <div style={{ color: '#4b5563', fontSize: '14px' }}>{item.email}</div>
              <div style={{ color: '#374151', fontSize: '14px' }}>{item.preview || 'Bez náhledu obsahu.'}</div>
            </article>
          ))}
        </div>
      )}
        </>
      ) : null}
    </section>
  )
}
