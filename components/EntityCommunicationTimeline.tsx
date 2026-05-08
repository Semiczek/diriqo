'use client'

import { useEffect, useState } from 'react'
import type { MessageFeedItem, RelatedEntityType } from '@/lib/email/types'

type EntityCommunicationTimelineProps = {
  entityType: RelatedEntityType
  entityId: string
  title?: string
  description?: string
  emptyLabel?: string
  feedItems: MessageFeedItem[]
}

type EmailFeedRefreshDetail = {
  entityType: RelatedEntityType
  entityId: string
  subject?: string
  email?: string
  preview?: string
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

async function loadEntityFeed(entityType: RelatedEntityType, entityId: string) {
  const response = await fetch(
    `/api/mail/feed?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
    {
      method: 'GET',
      cache: 'no-store',
    },
  )

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

async function loadEntityFeedUntilMessageAppears(
  entityType: RelatedEntityType,
  entityId: string,
  expectedSubject: string,
  expectedEmail: string,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextFeed = await loadEntityFeed(entityType, entityId)

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

export default function EntityCommunicationTimeline({
  entityType,
  entityId,
  title = 'Komunikace',
  description = 'Uložené odchozí i příchozí emaily navázané na tuto položku.',
  emptyLabel = 'Zatím tu není žádná emailová komunikace.',
  feedItems,
}: EntityCommunicationTimelineProps) {
  const [localFeed, setLocalFeed] = useState<MessageFeedItem[] | null>(null)
  const feed = localFeed ?? feedItems

  useEffect(() => {
    let cancelled = false

    async function loadFreshFeed() {
      try {
        const nextFeed = await loadEntityFeed(entityType, entityId)

        if (!cancelled && nextFeed) {
          setLocalFeed((current) => {
            const fallbackFeed = current ?? feedItems
            if (nextFeed.length === 0 && fallbackFeed.length > 0) {
              return fallbackFeed
            }

            return nextFeed
          })
        }
      } catch (error) {
        console.error('[EMAIL] Failed to refresh entity communication feed', error)
      }
    }

    void loadFreshFeed()

    return () => {
      cancelled = true
    }
  }, [entityId, entityType, feedItems])

  useEffect(() => {
    function handleFeedRefresh(event: Event) {
      const detail = (event as CustomEvent<EmailFeedRefreshDetail>).detail

      if (!detail || detail.entityType !== entityType || detail.entityId !== entityId) {
        return
      }

      const happenedAt = new Date().toISOString()

      if (detail.subject && detail.email) {
        const optimisticItem: MessageFeedItem = {
          id: `local-${happenedAt}`,
          direction: 'outbound',
          email: detail.email,
          name: null,
          subject: detail.subject,
          preview: detail.preview ?? '',
          bodyText: detail.preview ?? '',
          status: 'sent',
          happenedAt,
        }

        setLocalFeed((current) =>
          [...(current ?? feedItems), optimisticItem].sort(
            (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
          ),
        )

        void loadEntityFeedUntilMessageAppears(entityType, entityId, detail.subject, detail.email)
          .then((nextFeed) => {
            if (nextFeed) {
              setLocalFeed(nextFeed)
            }
          })
          .catch((error) => {
            console.error('[EMAIL] Failed to refetch entity communication feed after send', error)
          })

        return
      }

      void loadEntityFeed(entityType, entityId)
        .then((nextFeed) => {
          if (nextFeed) {
            setLocalFeed((current) => {
              const fallbackFeed = current ?? feedItems
              if (nextFeed.length === 0 && fallbackFeed.length > 0) {
                return fallbackFeed
              }

              return nextFeed
            })
          }
        })
        .catch((error) => {
          console.error('[EMAIL] Failed to handle entity feed refresh event', error)
        })
    }

    window.addEventListener('diriqo:email-feed-refresh', handleFeedRefresh as EventListener)

    return () => {
      window.removeEventListener('diriqo:email-feed-refresh', handleFeedRefresh as EventListener)
    }
  }, [entityId, entityType, feedItems])

  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '16px',
        backgroundColor: '#ffffff',
        padding: '24px',
        marginTop: '20px',
      }}
    >
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: '0 0 6px 0', fontSize: '24px' }}>{title}</h2>
        <p style={{ margin: 0, color: '#6b7280' }}>{description}</p>
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
          {emptyLabel}
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
              <div style={{ color: '#4b5563', fontSize: '14px' }}>
                <strong>{getAddressLabel(item)}:</strong>{' '}
                {item.name ? `${item.name} <${item.email}>` : item.email}
              </div>
              {getSenderLabel(item) ? (
                <div style={{ color: '#6b7280', fontSize: '13px' }}>
                  <strong>Odeslal:</strong> {getSenderLabel(item)}
                  {item.senderEmail ? ` | ${item.senderEmail}` : ''}
                </div>
              ) : null}
              <div style={{ color: '#374151', fontSize: '14px' }}>{item.preview || 'Bez náhledu obsahu.'}</div>
              <details
                style={{
                  borderTop: '1px solid #e5e7eb',
                  paddingTop: '10px',
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#1f2937' }}>
                  Zobrazit celý e-mail
                </summary>
                <div
                  style={{
                    marginTop: '10px',
                    padding: '12px',
                    borderRadius: '10px',
                    backgroundColor: '#f9fafb',
                    color: '#111827',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.6,
                    fontSize: '14px',
                  }}
                >
                  {getBodyText(item)}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
