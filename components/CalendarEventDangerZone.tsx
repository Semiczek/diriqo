'use client'

import { startTransition, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCalendarEventAction } from '@/app/calendar/actions'
import { useI18n } from '@/components/I18nProvider'
import type { CalendarSnapshot } from '@/lib/calendar/types'

type CalendarEventDangerZoneProps = {
  eventId: string
  companyId: string
  expectedRevision: string
  disabled?: boolean
  onConflict: (current?: CalendarSnapshot) => void
  onUncertainResult: (message?: string) => void
  onBusyChange: (busy: boolean) => void
}

export default function CalendarEventDangerZone({
  eventId,
  companyId,
  expectedRevision,
  disabled = false,
  onConflict,
  onUncertainResult,
  onBusyChange,
}: CalendarEventDangerZoneProps) {
  const router = useRouter()
  const { dictionary } = useI18n()
  const t = dictionary.calendar.eventDetail
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const writeInFlight = useRef(false)

  async function handleDeleteEvent() {
    if (disabled || writeInFlight.current) return
    const confirmed = window.confirm(t.confirmDelete)

    if (!confirmed) return

    let deleted = false
    try {
      writeInFlight.current = true
      setIsDeleting(true)
      onBusyChange(true)
      setErrorMessage(null)

      const response = await deleteCalendarEventAction({ eventId, companyId, expectedRevision })

      if (!response.ok) {
        if (response.code === 'conflict') {
          onConflict(response.current)
        } else if (response.code === 'unknown' || response.code === 'unavailable') {
          setErrorMessage(t.uncertainDelete)
          onUncertainResult(t.uncertainDelete)
        } else {
          setErrorMessage(response.error)
        }
        return
      }

      deleted = true
      router.push('/calendar')
      router.refresh()
    } catch {
      setErrorMessage(t.uncertainDelete)
      onUncertainResult(t.uncertainDelete)
    } finally {
      if (!deleted) {
        writeInFlight.current = false
        setIsDeleting(false)
        onBusyChange(false)
      }
    }
  }

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: '1px solid #fecaca',
        borderRadius: 12,
        background: '#fff5f5',
      }}
    >
      <h3
        style={{
          margin: '0 0 12px 0',
          fontSize: 18,
          fontWeight: 700,
          color: '#991b1b',
        }}
      >
        {t.dangerZone}
      </h3>

      <p
        style={{
          margin: '0 0 16px 0',
          fontSize: 14,
          color: '#7f1d1d',
          lineHeight: 1.5,
        }}
      >
        {t.deleteDescription}
      </p>

      <button
        type="button"
        onClick={() => startTransition(() => { void handleDeleteEvent() })}
        disabled={isDeleting || disabled}
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid #dc2626',
          background: '#dc2626',
          color: '#ffffff',
          cursor: isDeleting || disabled ? 'not-allowed' : 'pointer',
          fontWeight: 700,
        }}
      >
        {isDeleting ? t.deleting : t.deleteEvent}
      </button>

      {errorMessage && (
        <p
          role="alert"
          style={{
            marginTop: 12,
            marginBottom: 0,
            fontSize: 14,
            color: '#b91c1c',
            fontWeight: 600,
          }}
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}
