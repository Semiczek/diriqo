'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useI18n } from '@/components/I18nProvider'
import { deleteJobSafelyAction, detachCustomerFromJobAction } from '@/app/jobs/actions'
import {
  cardTitleStyle,
  mutedTextStyle,
  secondaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'

type JobDangerZoneProps = {
  jobId: string
  hasCustomer: boolean
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const errorRecord = error as {
      message?: unknown
      details?: unknown
      hint?: unknown
      code?: unknown
    }
    const messageParts = [
      typeof errorRecord.message === 'string' ? errorRecord.message : null,
      typeof errorRecord.details === 'string' ? errorRecord.details : null,
      typeof errorRecord.hint === 'string' ? errorRecord.hint : null,
      typeof errorRecord.code === 'string' ? `Kód: ${errorRecord.code}` : null,
    ].filter(Boolean)

    if (messageParts.length > 0) {
      return messageParts.join(' ')
    }
  }

  return fallback
}

export default function JobDangerZone({
  jobId,
  hasCustomer,
}: JobDangerZoneProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { dictionary } = useI18n()
  const t = dictionary.jobs.detail.dangerZone

  const [isDetachingCustomer, setIsDetachingCustomer] = useState(false)
  const [isDeletingJob, setIsDeletingJob] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleDetachCustomer() {
    const confirmed = window.confirm(t.detachConfirm)
    if (!confirmed) return

    try {
      setIsDetachingCustomer(true)
      setMessage(null)
      setErrorMessage(null)

      const response = await detachCustomerFromJobAction(jobId)

      if (!response.ok) {
        throw new Error(response.error)
      }

      setMessage(t.detachSuccess)
      router.refresh()
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, t.detachError))
    } finally {
      setIsDetachingCustomer(false)
    }
  }

  async function handleDeleteJob() {
    const confirmed = window.confirm(t.deleteConfirm)
    if (!confirmed) return

    try {
      setIsDeletingJob(true)
      setMessage(null)
      setErrorMessage(null)

      const response = await deleteJobSafelyAction(jobId)

      if (!response.ok) {
        throw new Error(response.error)
      }

      const query = searchParams.toString()
      router.push(query ? `/jobs?${query}` : '/jobs')
      router.refresh()
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, t.deleteError))
      setIsDeletingJob(false)
    }
  }

  return (
    <div style={{ ...sectionCardStyle, marginTop: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: menuOpen ? '14px' : 0 }}>
        <div>
          <h2 style={{ ...cardTitleStyle, fontSize: '20px', marginBottom: '6px' }}>{t.title}</h2>
          <div style={mutedTextStyle}>{t.description}</div>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
          style={{ ...secondaryButtonStyle, cursor: 'pointer' }}
        >
          {menuOpen ? t.hideActions : t.showActions}
        </button>
      </div>

      {menuOpen ? (
        <div style={{ display: 'grid', gap: '10px' }}>
          <div style={actionRowStyle}>
            <div>
              <div style={actionTitleStyle}>{t.detachCustomer}</div>
              <div style={mutedTextStyle}>
                {hasCustomer ? t.detachCustomerDescription : t.noCustomerAssigned}
              </div>
            </div>
            <button
              type="button"
              onClick={handleDetachCustomer}
              disabled={!hasCustomer || isDetachingCustomer || isDeletingJob}
              style={{
                ...smallActionButtonStyle,
                color: !hasCustomer ? '#94a3b8' : '#0f172a',
                cursor: !hasCustomer || isDetachingCustomer || isDeletingJob ? 'not-allowed' : 'pointer',
                opacity: !hasCustomer ? 0.72 : 1,
              }}
            >
              {isDetachingCustomer ? t.detachingCustomer : t.detachCustomer}
            </button>
          </div>

          <div style={actionRowStyle}>
            <div>
              <div style={{ ...actionTitleStyle, color: '#991b1b' }}>{t.deleteJob}</div>
              <div style={mutedTextStyle}>{t.deleteJobDescription}</div>
            </div>
            <button
              type="button"
              onClick={handleDeleteJob}
              disabled={isDeletingJob || isDetachingCustomer}
              style={{
                ...smallActionButtonStyle,
                borderColor: 'rgba(248, 113, 113, 0.42)',
                color: '#b91c1c',
                cursor: isDeletingJob || isDetachingCustomer ? 'not-allowed' : 'pointer',
              }}
            >
              {isDeletingJob ? t.deletingJob : t.deleteJob}
            </button>
          </div>

          {message && (
            <p style={successMessageStyle}>
              {message}
            </p>
          )}

          {errorMessage && (
            <p style={errorMessageStyle}>
              {errorMessage}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

const actionRowStyle = {
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  padding: '12px',
  borderRadius: '16px',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  background: 'rgba(248, 250, 252, 0.82)',
} as const

const actionTitleStyle = {
  color: '#0f172a',
  fontSize: '15px',
  fontWeight: 850,
  marginBottom: '3px',
} as const

const smallActionButtonStyle = {
  ...secondaryButtonStyle,
  minHeight: '36px',
  padding: '8px 12px',
  borderRadius: '12px',
  boxShadow: 'none',
} as const

const successMessageStyle = {
  margin: 0,
  fontSize: 14,
  color: '#166534',
  fontWeight: 700,
} as const

const errorMessageStyle = {
  margin: 0,
  fontSize: 14,
  color: '#b91c1c',
  fontWeight: 700,
} as const
