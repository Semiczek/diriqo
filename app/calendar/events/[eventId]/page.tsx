'use client'

import { startTransition, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import CalendarEventDangerZone from '@/components/CalendarEventDangerZone'
import { useI18n } from '@/components/I18nProvider'
import type { CalendarEvent, CalendarSnapshot } from '@/lib/calendar/types'
import { readCalendarEditorAction, updateCalendarEventAction } from '../../actions'

type Job = {
  id: string
  title: string | null
  company_id: string | null
}

type Profile = {
  id: string
  full_name: string | null
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function CalendarEventDetailPage() {
  const { dictionary } = useI18n()
  const t = dictionary.calendar.eventDetail
  const params = useParams<{ eventId: string }>()
  const router = useRouter()
  const eventId = params?.eventId

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [conflict, setConflict] = useState<CalendarSnapshot | null>(null)
  const [needsReconcile, setNeedsReconcile] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const writeInFlight = useRef(false)

  const [event, setEvent] = useState<CalendarEvent | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [jobId, setJobId] = useState('')

  const [jobs, setJobs] = useState<Job[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [companyName, setCompanyName] = useState('')
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([])
  const showLoadError = useEffectEvent(() => setError(t.loadEventFailed))
  const showMissingEvent = useEffectEvent(() => setError(t.missingEventId))
  const showNotFound = useEffectEvent(() => setError(t.notFound))

  const applySnapshot = useCallback((snapshot: CalendarSnapshot) => {
    setEvent(snapshot.event)
    setSelectedProfiles(snapshot.assigned_profile_ids)
    setTitle(snapshot.event.title || '')
    setDescription(snapshot.event.description || '')
    setStartAt(toDateTimeLocalValue(snapshot.event.start_at))
    setEndAt(toDateTimeLocalValue(snapshot.event.end_at))
    setCompanyId(snapshot.event.company_id || '')
    setJobId(snapshot.event.job_id || '')
    setConflict(null)
    setNeedsReconcile(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadPage() {
      if (!eventId || typeof eventId !== 'string') {
        showMissingEvent()
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      setSuccess(null)
      setEvent(null)
      try {
        const result = await readCalendarEditorAction({ eventId })
        if (cancelled) return
        if (!result.ok) {
          setError(result.error)
          return
        }
        if (!result.data.snapshot) {
          showNotFound()
          return
        }
        setJobs(result.data.jobs)
        setProfiles(result.data.profiles)
        setCompanyName(result.data.companyName || '')
        applySnapshot(result.data.snapshot)
      } catch {
        if (!cancelled) showLoadError()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    startTransition(() => { void loadPage() })
    return () => { cancelled = true }
  }, [applySnapshot, eventId])

  function toggleProfile(profileId: string) {
    setSelectedProfiles((prev) =>
      prev.includes(profileId)
        ? prev.filter((id) => id !== profileId)
        : [...prev, profileId]
    )
  }

  function handleConflict(current?: CalendarSnapshot) {
    setConflict(current || null)
    setNeedsReconcile(true)
    setSuccess(null)
    setError(t.conflictDetected)
  }

  function handleUncertainResult(message = t.uncertainSave) {
    setNeedsReconcile(true)
    setSuccess(null)
    setError(message)
  }

  async function handleLoadLatest() {
    if (writeInFlight.current || deleting || reloading || !eventId) return
    if (!window.confirm(t.confirmLoadLatest)) return
    setReloading(true)
    setSuccess(null)
    try {
      const result = await readCalendarEditorAction({ eventId })
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.data.companyId !== companyId) {
        setError(t.companyChanged)
        return
      }
      if (!result.data.snapshot) {
        setError(t.notFound)
        return
      }
      setJobs(result.data.jobs)
      setProfiles(result.data.profiles)
      setCompanyName(result.data.companyName || '')
      applySnapshot(result.data.snapshot)
      setError(null)
    } catch {
      setError(t.loadEventFailed)
    } finally {
      setReloading(false)
    }
  }

  const assignedProfilesPreview = useMemo(() => {
    if (selectedProfiles.length === 0) return []

    return profiles.filter((profile) => selectedProfiles.includes(profile.id))
  }, [profiles, selectedProfiles])
  const unavailableProfileIds = selectedProfiles.filter((id) => !profiles.some((profile) => profile.id === id))

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (writeInFlight.current || deleting || reloading || needsReconcile || !event || event.id !== eventId) return

    if (!eventId || typeof eventId !== 'string') {
      setError(dictionary.calendar.eventDetail.missingEventId)
      return
    }

    setError(null)
    setSuccess(null)

    const start = new Date(startAt)
    const end = new Date(endAt)

    if (!title.trim()) {
      setError(dictionary.calendar.eventDetail.titleRequired)
      setSaving(false)
      return
    }

    if (!startAt || !endAt) {
      setError(dictionary.calendar.eventDetail.startEndRequired)
      setSaving(false)
      return
    }

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError(dictionary.calendar.eventDetail.invalidDateTime)
      setSaving(false)
      return
    }

    if (end <= start) {
      setError(dictionary.calendar.eventDetail.endMustBeAfterStart)
      setSaving(false)
      return
    }

    if (!companyId) {
      setError(dictionary.calendar.eventDetail.companyRequired)
      setSaving(false)
      return
    }

    try {
      writeInFlight.current = true
      setSaving(true)
      const updateResponse = await updateCalendarEventAction({
        eventId,
        expectedRevision: event.revision,
        title,
        description,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        companyId,
        jobId,
        selectedProfileIds: selectedProfiles,
      })

      if (!updateResponse.ok) {
        if (updateResponse.code === 'conflict') {
          handleConflict(updateResponse.current)
        } else if (updateResponse.code === 'unknown' || updateResponse.code === 'unavailable') {
          handleUncertainResult()
        } else {
          setError(`${t.updateFailed}: ${updateResponse.error}`)
        }
        return
      }

      setEvent(updateResponse.event)
      setSuccess(dictionary.calendar.eventDetail.successSaved)
      router.refresh()
    } catch {
      handleUncertainResult()
    } finally {
      writeInFlight.current = false
      setSaving(false)
    }
  }

  const isInternalStandaloneEvent = !jobId

  return (
    <DashboardShell activeItem="calendar">
      <main
        style={{
          maxWidth: '900px',
          color: '#111827',
        }}
      >
        <Link
          href="/calendar"
          style={{
            display: 'inline-block',
            marginBottom: '24px',
            color: '#2563eb',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {dictionary.calendar.eventDetail.backToCalendar}
        </Link>

        {loading ? (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '12px',
              background: '#fff',
              padding: '20px',
            }}
          >
            {dictionary.calendar.eventDetail.loading}
          </div>
        ) : error && !event ? (
          <div
            style={{
              border: '1px solid #fecaca',
              borderRadius: '12px',
              background: '#fff',
              padding: '20px',
              color: '#b91c1c',
            }}
          >
            {error}
          </div>
        ) : !event ? (
          <div
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '12px',
              background: '#fff',
              padding: '20px',
            }}
          >
            {dictionary.calendar.eventDetail.notFound}
          </div>
        ) : (
          <>
            <section
              style={{
                marginBottom: '24px',
                padding: '24px',
                backgroundColor: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '16px',
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  marginBottom: '12px',
                  padding: '6px 10px',
                  borderRadius: '999px',
                  fontSize: '13px',
                  fontWeight: 700,
                  backgroundColor: isInternalStandaloneEvent ? '#f3f4f6' : '#dbeafe',
                  color: isInternalStandaloneEvent ? '#374151' : '#1d4ed8',
                }}
              >
                {isInternalStandaloneEvent
                  ? dictionary.calendar.eventDetail.internalEvent
                  : dictionary.calendar.eventDetail.linkedToJob}
              </div>

              <h1
                style={{
                  margin: '0 0 12px 0',
                  fontSize: '36px',
                  lineHeight: '1.2',
                  color: '#111827',
                }}
              >
                {event.title || dictionary.calendar.eventDetail.untitledEvent}
              </h1>

              <p
                style={{
                  margin: 0,
                  color: '#4b5563',
                  fontSize: '16px',
                  lineHeight: '1.6',
                }}
              >
                {event.description || dictionary.calendar.eventDetail.noDescription}
              </p>
            </section>

            {error ? (
              <div
                role="alert"
                style={{
                  marginBottom: '16px',
                  padding: '12px 16px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '10px',
                  color: '#b91c1c',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {error}
              </div>
            ) : null}

            {needsReconcile ? (
              <section aria-label={t.currentSavedVersion} style={{ marginBottom: '16px', padding: '16px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '12px' }}>
                <p style={{ marginTop: 0 }}>{t.draftPreserved}</p>
                {conflict ? (
                  <div style={{ marginBottom: '16px' }}>
                    <strong>{t.currentSavedVersion}</strong>
                    <p>{conflict.event.title || t.untitledEvent}</p>
                    <p>{t.from}: {formatDateTime(conflict.event.start_at)} · {t.to}: {formatDateTime(conflict.event.end_at)}</p>
                    <p>{t.workers}: {conflict.assigned_profile_ids.length
                      ? conflict.assigned_profile_ids.map((id) => profiles.find((profile) => profile.id === id)?.full_name || t.unnamedWorker).join(', ')
                      : t.noAssignedWorkers}</p>
                  </div>
                ) : null}
                <button type="button" disabled={reloading || saving || deleting} onClick={() => startTransition(() => { void handleLoadLatest() })} style={{ padding: '10px 14px', background: '#111827', color: '#fff', border: 'none', borderRadius: '8px', cursor: reloading ? 'wait' : 'pointer', fontWeight: 600 }}>
                  {reloading ? t.loading : t.loadLatest}
                </button>
              </section>
            ) : null}

            {success ? (
              <div
                role="status"
                style={{
                  marginBottom: '16px',
                  padding: '12px 16px',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: '10px',
                  color: '#065f46',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {success}
              </div>
            ) : null}

            <section
              style={{
                marginBottom: '24px',
                border: '1px solid #e5e7eb',
                borderRadius: '16px',
                background: '#fff',
                padding: '24px',
              }}
            >
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  marginTop: 0,
                  marginBottom: '16px',
                  color: '#111827',
                }}
              >
                {dictionary.calendar.eventDetail.editEvent}
              </h2>

              <form onSubmit={(event) => startTransition(() => { void handleSave(event) })} style={{ display: 'grid', gap: '16px' }}>
                <fieldset disabled={saving || deleting || reloading} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: '16px' }}>
                <div style={{ display: 'grid', gap: '6px' }}>
                  <label htmlFor="calendar-title">{dictionary.calendar.eventDetail.title}</label>
                  <input
                    id="calendar-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gap: '6px' }}>
                  <label htmlFor="calendar-description">{dictionary.calendar.eventDetail.description}</label>
                  <textarea
                    id="calendar-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gap: '6px' }}>
                  <label htmlFor="calendar-start">{dictionary.calendar.eventDetail.from}</label>
                  <input
                    id="calendar-start"
                    type="datetime-local"
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    required
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gap: '6px' }}>
                  <label htmlFor="calendar-end">{dictionary.calendar.eventDetail.to}</label>
                  <input
                    id="calendar-end"
                    type="datetime-local"
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    required
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gap: '6px' }}>
                  <label htmlFor="calendar-company">{dictionary.calendar.eventDetail.company}</label>
                  <input
                    id="calendar-company"
                    value={companyName || dictionary.calendar.newEvent.unnamedCompany}
                    readOnly
                    aria-readonly="true"
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gap: '6px' }}>
                  <label htmlFor="calendar-job">{dictionary.calendar.eventDetail.job}</label>
                  <select
                    id="calendar-job"
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                    }}
                  >
                    <option value="">{dictionary.calendar.eventDetail.noJob}</option>
                    {jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title || dictionary.calendar.untitledJob}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gap: '8px' }}>
                  <label>{dictionary.calendar.eventDetail.workers}</label>
                  <div style={{ display: 'grid', gap: '6px' }}>
                    {profiles.map((profile) => (
                      <label
                        key={profile.id}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedProfiles.includes(profile.id)}
                          onChange={() => toggleProfile(profile.id)}
                        />
                        {profile.full_name || dictionary.calendar.eventDetail.unnamedWorker}
                      </label>
                    ))}
                    {unavailableProfileIds.map((profileId) => (
                      <label key={profileId} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" checked onChange={() => toggleProfile(profileId)} />
                        {t.unavailableWorker}
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving || deleting || reloading || needsReconcile}
                  style={{
                    padding: '12px',
                    background: saving || deleting || reloading || needsReconcile ? '#9ca3af' : '#111827',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: saving || deleting || reloading || needsReconcile ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {saving
                    ? dictionary.calendar.eventDetail.saving
                    : dictionary.calendar.eventDetail.saveChanges}
                </button>
                </fieldset>
              </form>
            </section>

            <section style={{ marginBottom: '24px' }}>
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  marginBottom: '16px',
                  color: '#111827',
                }}
              >
                {dictionary.calendar.eventDetail.assignedWorkersOverview}
              </h2>

              {assignedProfilesPreview.length > 0 ? (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {assignedProfilesPreview.map((profile) => (
                    <div
                      key={profile.id}
                      style={{
                        border: '1px solid #e5e7eb',
                        borderRadius: '12px',
                        padding: '16px',
                        backgroundColor: '#ffffff',
                        color: '#111827',
                      }}
                    >
                      <strong>{dictionary.calendar.eventDetail.workers}:</strong>{' '}
                      {profile.full_name || dictionary.calendar.eventDetail.unnamedWorker}
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#6b7280' }}>
                  {dictionary.calendar.eventDetail.noAssignedWorkers}
                </p>
              )}
            </section>

            <section style={{ marginBottom: '24px' }}>
              <h2
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  marginBottom: '16px',
                  color: '#111827',
                }}
              >
                {dictionary.calendar.eventDetail.technicalInfo}
              </h2>

              <div
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '16px',
                  backgroundColor: '#ffffff',
                  color: '#111827',
                }}
              >
                <div style={{ marginBottom: '8px' }}>
                  <strong>{dictionary.calendar.eventDetail.eventId}:</strong> {event.id}
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <strong>{dictionary.calendar.eventDetail.companyId}:</strong> {event.company_id || '—'}
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <strong>{dictionary.calendar.eventDetail.jobId}:</strong> {event.job_id || '—'}
                </div>

                <div style={{ marginBottom: '8px' }}>
                  <strong>{dictionary.calendar.eventDetail.from}:</strong> {formatDateTime(event.start_at)}
                </div>

                <div>
                  <strong>{dictionary.calendar.eventDetail.to}:</strong> {formatDateTime(event.end_at)}
                </div>
              </div>
            </section>

            <CalendarEventDangerZone
              key={`${event.id}:${event.revision}`}
              eventId={event.id}
              companyId={companyId}
              expectedRevision={event.revision}
              disabled={saving || reloading || needsReconcile}
              onConflict={handleConflict}
              onUncertainResult={handleUncertainResult}
              onBusyChange={setDeleting}
            />
          </>
        )}
      </main>
    </DashboardShell>
  )
}
