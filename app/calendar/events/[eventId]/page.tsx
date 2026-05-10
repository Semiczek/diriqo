'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import CalendarEventDangerZone from '@/components/CalendarEventDangerZone'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'
import { updateCalendarEventAction } from '../../actions'

type CalendarEventRow = {
  id: string
  title: string | null
  description: string | null
  start_at: string | null
  end_at: string | null
  company_id: string | null
  job_id: string | null
}

type Job = {
  id: string
  title: string | null
  company_id: string | null
}

type Profile = {
  id: string
  full_name: string | null
}

type Company = {
  id: string
  name: string | null
}

type AssignmentRow = {
  id: string
  event_id: string
  profile_id: string
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
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
  const params = useParams<{ eventId: string }>()
  const router = useRouter()
  const eventId = params?.eventId

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [event, setEvent] = useState<CalendarEventRow | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [jobId, setJobId] = useState('')

  const [jobs, setJobs] = useState<Job[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([])

  useEffect(() => {
    async function loadPage() {
      if (!eventId || typeof eventId !== 'string') {
        setError(dictionary.calendar.eventDetail.missingEventId)
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      setSuccess(null)

      const { data: eventData, error: eventError } = await supabase
        .from('calendar_events')
        .select('id, title, description, start_at, end_at, company_id, job_id')
        .eq('id', eventId)
        .single()

      if (eventError || !eventData) {
        setError(eventError?.message || dictionary.calendar.eventDetail.notFound)
        setLoading(false)
        return
      }

      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('id, title, company_id')
        .order('title', { ascending: true })

      if (jobsError) {
        setError(`${dictionary.calendar.eventDetail.loadJobsFailed}: ${jobsError.message}`)
        setLoading(false)
        return
      }

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .order('full_name', { ascending: true })

      if (profilesError) {
        setError(`${dictionary.calendar.eventDetail.loadWorkersFailed}: ${profilesError.message}`)
        setLoading(false)
        return
      }

      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select('id, name')
        .order('name', { ascending: true })

      if (companiesError) {
        setError(`${dictionary.calendar.eventDetail.loadCompaniesFailed}: ${companiesError.message}`)
        setLoading(false)
        return
      }

      const { data: assignmentsData, error: assignmentsError } = await supabase
        .from('calendar_event_assignments')
        .select('id, event_id, profile_id')
        .eq('event_id', eventId)

      if (assignmentsError) {
        setError(`${dictionary.calendar.eventDetail.loadAssignmentsFailed}: ${assignmentsError.message}`)
        setLoading(false)
        return
      }

      const selected = ((assignmentsData as AssignmentRow[]) || [])
        .map((item) => item.profile_id)
        .filter(Boolean)

      setEvent(eventData)
      setJobs(jobsData || [])
      setProfiles(profilesData || [])
      setCompanies(companiesData || [])
      setSelectedProfiles(selected)

      setTitle(eventData.title || '')
      setDescription(eventData.description || '')
      setStartAt(toDateTimeLocalValue(eventData.start_at))
      setEndAt(toDateTimeLocalValue(eventData.end_at))
      setCompanyId(eventData.company_id || '')
      setJobId(eventData.job_id || '')

      setLoading(false)
    }

    loadPage()
  }, [dictionary.calendar.eventDetail.loadAssignmentsFailed, dictionary.calendar.eventDetail.loadCompaniesFailed, dictionary.calendar.eventDetail.loadJobsFailed, dictionary.calendar.eventDetail.loadWorkersFailed, dictionary.calendar.eventDetail.missingEventId, dictionary.calendar.eventDetail.notFound, eventId])

  function toggleProfile(profileId: string) {
    setSelectedProfiles((prev) =>
      prev.includes(profileId)
        ? prev.filter((id) => id !== profileId)
        : [...prev, profileId]
    )
  }

  function handleJobChange(value: string) {
    setJobId(value)

    if (!value) return

    const selectedJob = jobs.find((job) => job.id === value)

    if (selectedJob?.company_id) {
      setCompanyId(selectedJob.company_id)
    }
  }

  const assignedProfilesPreview = useMemo(() => {
    if (selectedProfiles.length === 0) return []

    return profiles.filter((profile) => selectedProfiles.includes(profile.id))
  }, [profiles, selectedProfiles])

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!eventId || typeof eventId !== 'string') {
      setError(dictionary.calendar.eventDetail.missingEventId)
      return
    }

    setSaving(true)
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
      const updateResponse = await updateCalendarEventAction({
        eventId,
        title,
        description,
        startAt,
        endAt,
        companyId,
        jobId,
        selectedProfileIds: selectedProfiles,
      })

      if (!updateResponse.ok) {
        setError(`${dictionary.calendar.eventDetail.updateFailed}: ${updateResponse.error}`)
        setSaving(false)
        return
      }

      setEvent((prev) =>
        prev
          ? {
              ...prev,
              ...updateResponse.event,
            }
          : prev
      )

      setSuccess(dictionary.calendar.eventDetail.successSaved)
      setSaving(false)
      router.refresh()
    } catch (err: unknown) {
      setError(
        `${dictionary.calendar.eventDetail.unexpectedError}: ${getErrorMessage(
          err,
          dictionary.calendar.eventDetail.unexpectedError
        )}`
      )
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

            {success ? (
              <div
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

              <form onSubmit={handleSave} style={{ display: 'grid', gap: '16px' }}>
                <div style={{ display: 'grid', gap: '6px' }}>
                  <label>{dictionary.calendar.eventDetail.title}</label>
                  <input
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
                  <label>{dictionary.calendar.eventDetail.description}</label>
                  <textarea
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
                  <label>{dictionary.calendar.eventDetail.from}</label>
                  <input
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
                  <label>{dictionary.calendar.eventDetail.to}</label>
                  <input
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
                  <label>{dictionary.calendar.eventDetail.company}</label>
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    required
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                    }}
                  >
                    <option value="">{dictionary.calendar.eventDetail.selectCompany}</option>
                    {companies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name || dictionary.calendar.eventDetail.untitledEvent}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gap: '6px' }}>
                  <label>{dictionary.calendar.eventDetail.job}</label>
                  <select
                    value={jobId}
                    onChange={(e) => handleJobChange(e.target.value)}
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
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '12px',
                    background: saving ? '#9ca3af' : '#111827',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {saving
                    ? dictionary.calendar.eventDetail.saving
                    : dictionary.calendar.eventDetail.saveChanges}
                </button>
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

            <CalendarEventDangerZone eventId={event.id} />
          </>
        )}
      </main>
    </DashboardShell>
  )
}
