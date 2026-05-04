import type { CSSProperties } from 'react'

export type QuoteStatus =
  | 'draft'
  | 'ready'
  | 'sent'
  | 'viewed'
  | 'waiting_followup'
  | 'revision_requested'
  | 'accepted'
  | 'rejected'
  | 'expired'

export function resolveQuoteStatus(
  status: string | null | undefined,
  validUntil?: string | null,
): QuoteStatus {
  const normalized = (status ?? '').trim().toLowerCase()

  if (
    normalized === 'draft' ||
    normalized === 'ready' ||
    normalized === 'sent' ||
    normalized === 'viewed' ||
    normalized === 'waiting_followup' ||
    normalized === 'revision_requested' ||
    normalized === 'accepted' ||
    normalized === 'rejected' ||
    normalized === 'expired'
  ) {
    if (normalized === 'expired') {
      return 'expired'
    }

    if (
      validUntil &&
      normalized !== 'accepted' &&
      normalized !== 'rejected' &&
      new Date(`${validUntil}T23:59:59`).getTime() < Date.now()
    ) {
      return 'expired'
    }

    return normalized
  }

  if (validUntil && new Date(`${validUntil}T23:59:59`).getTime() < Date.now()) {
    return 'expired'
  }

  return 'draft'
}

export function getQuoteStatusLabel(status: QuoteStatus) {
  if (status === 'ready') return 'Připraveno'
  if (status === 'sent') return 'Odesláno'
  if (status === 'viewed') return 'Zobrazeno'
  if (status === 'waiting_followup') return 'Má zájem'
  if (status === 'revision_requested') return 'Požadována úprava'
  if (status === 'accepted') return 'Schváleno'
  if (status === 'rejected') return 'Zamítnuto'
  if (status === 'expired') return 'Expirované'
  return 'Koncept'
}

export function getQuoteStatusStyle(status: QuoteStatus): CSSProperties {
  if (status === 'ready') {
    return { backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #bfdbfe' }
  }

  if (status === 'sent') {
    return { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }
  }

  if (status === 'viewed') {
    return { backgroundColor: '#ede9fe', color: '#6d28d9', border: '1px solid #ddd6fe' }
  }

  if (status === 'waiting_followup') {
    return { backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }
  }

  if (status === 'revision_requested') {
    return { backgroundColor: '#ffedd5', color: '#9a3412', border: '1px solid #fdba74' }
  }

  if (status === 'accepted') {
    return { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }
  }

  if (status === 'rejected') {
    return { backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }
  }

  if (status === 'expired') {
    return { backgroundColor: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' }
  }

  return { backgroundColor: '#f3f4f6', color: '#4b5563', border: '1px solid #d1d5db' }
}
