'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardShell from '../../../components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '../../../lib/supabase'

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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

export default function NewCalendarEventPage() {
  const { dictionary } = useI18n()
  const t = dictionary.calendar.newEvent
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [jobId, setJobId] = useState<string>('')
  const [companyId, setCompanyId] = useState<string>('')

  const [jobs, setJobs] = useState<Job[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([])

  const [loading, setLoading] = useState(false)
  const [debugError, setDebugError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      setDebugError(null)

      const { data: jobsData, error: jobsError } = await supabase
        .from('jobs')
        .select('id, title, company_id')
        .order('title', { ascending: true })

      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .order('full_name', { ascending: true })

      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select('id, name')
        .order('name', { ascending: true })

      if (jobsError) {
        setDebugError(`${t.loadJobsFailed} ${jobsError.message}`)
        return
      }

      if (profilesError) {
        setDebugError(`${t.loadProfilesFailed} ${profilesError.message}`)
        return
      }

      if (companiesError) {
        setDebugError(`${t.loadCompaniesFailed} ${companiesError.message}`)
        return
      }

      setJobs(jobsData || [])
      setProfiles(profilesData || [])
      setCompanies(companiesData || [])

      if (companiesData && companiesData.length > 0) {
        setCompanyId(companiesData[0].id)
      }
    }

    loadData()
  }, [])

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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setDebugError(null)

    const start = new Date(startAt)
    const end = new Date(endAt)

    if (!startAt || !endAt) {
      setDebugError(t.fillStartEnd)
      setLoading(false)
      return
    }

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setDebugError(t.invalidDateTime)
      setLoading(false)
      return
    }

    if (end <= start) {
      setDebugError(t.endAfterStart)
      setLoading(false)
      return
    }

    try {
      if (!companyId) {
        setDebugError(t.selectCompany)
        setLoading(false)
        return
      }

      const startAtIso = new Date(startAt).toISOString()
      const endAtIso = new Date(endAt).toISOString()

      const { data: eventData, error: eventError } = await supabase
        .from('calendar_events')
        .insert([
          {
            title,
            description: description || null,
            start_at: startAtIso,
            end_at: endAtIso,
            job_id: jobId || null,
            company_id: companyId,
          },
        ])
        .select()
        .single()

      if (eventError || !eventData) {
        const message =
          eventError?.message || t.createFailed

        setDebugError(message)
        setLoading(false)
        return
      }

      if (selectedProfiles.length > 0) {
        const assignments = selectedProfiles.map((profileId) => ({
          event_id: eventData.id,
          profile_id: profileId,
        }))

        const { error: assignError } = await supabase
          .from('calendar_event_assignments')
          .insert(assignments)

        if (assignError) {
          setDebugError(`${t.workerAssignFailed} ${assignError.message}`)
          setLoading(false)
          return
        }
      }

      router.push('/calendar')
      router.refresh()
    } catch (error: unknown) {
      setDebugError(`${t.unexpectedError} ${getErrorMessage(error, t.unexpectedError)}`)
      setLoading(false)
    }
  }

  return (
    <DashboardShell activeItem="calendar">
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '24px' }}>
          {t.title}
        </h1>

        {debugError && (
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
            {debugError}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'grid', gap: '6px' }}>
            <label>{t.eventTitle}</label>
            <input
              type="text"
              placeholder={t.eventTitle}
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
            <label>{t.description}</label>
            <textarea
              placeholder={t.description}
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
            <label>{t.from}</label>
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
            <label>{t.to}</label>
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
            <label>{t.company}</label>
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
              <option value="">{t.selectCompanyOption}</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name || t.unnamedCompany}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gap: '6px' }}>
            <label>{t.job}</label>
            <select
              value={jobId}
              onChange={(e) => handleJobChange(e.target.value)}
              style={{
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
              }}
            >
              <option value="">{t.noJob}</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title || t.unnamedJob}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'grid', gap: '8px' }}>
            <label>{t.workers}</label>
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
                  {profile.full_name || t.unnamedWorker}
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px',
              background: loading ? '#9ca3af' : '#111827',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {loading ? t.saving : t.create}
          </button>
        </form>
      </div>
    </DashboardShell>
  )
}
