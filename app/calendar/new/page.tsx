'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardShell from '../../../components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { createCalendarEventAction } from '@/app/calendar/actions'
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
  const quickTasks = [
    t.quickPaySupplier,
    t.quickCallCustomer,
    t.quickOrderMaterial,
    t.quickQualityCheck,
  ]

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
  }, [t.loadCompaniesFailed, t.loadJobsFailed, t.loadProfilesFailed])

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

      const result = await createCalendarEventAction({
        title,
        description,
        startAt,
        endAt,
        jobId,
        companyId,
        selectedProfileIds: selectedProfiles,
      })

      if (!result.ok) {
        setDebugError(result.error || t.createFailed)
        setLoading(false)
        return
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
      <div className="calendar-new-page">
        <section className="calendar-new-hero">
          <div>
            <div className="calendar-new-eyebrow">{dictionary.calendar.title}</div>
            <h1>{t.title}</h1>
            <p>{t.pageSubtitle}</p>
          </div>
          <button type="button" onClick={() => router.push('/calendar')}>
            {t.backToCalendar}
          </button>
        </section>

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

        <form onSubmit={handleSubmit} className="calendar-new-form">
          <section className="calendar-new-card primary">
            <div>
              <h2>{t.mainSectionTitle}</h2>
              <p>{t.mainSectionDescription}</p>
            </div>
            <div className="calendar-quick-grid">
              {quickTasks.map((task) => (
                <button key={task} type="button" onClick={() => setTitle(task)}>
                  {task}
                </button>
              ))}
            </div>
            <label>{t.eventTitle}</label>
            <input
              type="text"
              placeholder={t.titlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />

            <label>{t.description}</label>
            <textarea
              placeholder={t.notePlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
            />
          </section>

          <section className="calendar-new-card">
            <div>
              <h2>{t.scheduleTitle}</h2>
              <p>{t.scheduleDescription}</p>
            </div>
            <div className="calendar-new-two">
              <div>
                <label>{t.from}</label>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  required
                />
              </div>

              <div>
                <label>{t.to}</label>
                <input
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  required
                />
              </div>
            </div>
          </section>

          <section className="calendar-new-card">
            <div>
              <h2>{t.relationsTitle}</h2>
              <p>{t.relationsDescription}</p>
            </div>

            <div className="calendar-new-two">
              <div>
                <label>{t.company}</label>
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  required
                >
                  <option value="">{t.selectCompanyOption}</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name || t.unnamedCompany}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>{t.job}</label>
                <select
                  value={jobId}
                  onChange={(e) => handleJobChange(e.target.value)}
                >
                  <option value="">{t.noJob}</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title || t.unnamedJob}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label>{t.workers}</label>
              <div className="calendar-worker-grid">
                {profiles.map((profile) => (
                  <label key={profile.id}>
                    <input
                      type="checkbox"
                      checked={selectedProfiles.includes(profile.id)}
                      onChange={() => toggleProfile(profile.id)}
                    />
                    <span>{profile.full_name || t.unnamedWorker}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <div className="calendar-new-actions">
            <button type="button" onClick={() => router.push('/calendar')}>
              {dictionary.common.cancel}
            </button>
            <button type="submit" disabled={loading}>
              {loading ? t.saving : t.create}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .calendar-new-page {
          max-width: 1040px;
          margin: 0 auto;
        }

        .calendar-new-hero,
        .calendar-new-card {
          border: 1px solid rgba(226,232,240,0.92);
          border-radius: 26px;
          background: rgba(255,255,255,0.92);
          box-shadow: 0 16px 40px rgba(15,23,42,0.07);
        }

        .calendar-new-hero {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 22px;
          padding: 30px;
          background: linear-gradient(135deg, rgba(250,245,255,0.98), rgba(239,246,255,0.96), rgba(236,254,255,0.92));
        }

        .calendar-new-eyebrow {
          display: inline-flex;
          margin-bottom: 12px;
          padding: 7px 12px;
          border: 1px solid rgba(124,58,237,0.22);
          border-radius: 999px;
          background: rgba(255,255,255,0.72);
          color: #5b21b6;
          font-size: 13px;
          font-weight: 900;
        }

        .calendar-new-hero h1 {
          margin: 0;
          color: #0f172a;
          font-size: 44px;
          font-weight: 950;
          letter-spacing: 0;
        }

        .calendar-new-hero p,
        .calendar-new-card p {
          margin: 10px 0 0;
          color: #64748b;
          font-size: 16px;
          line-height: 1.5;
        }

        .calendar-new-hero button,
        .calendar-new-actions button,
        .calendar-quick-grid button {
          min-height: 46px;
          border: 1px solid #d1d5db;
          border-radius: 999px;
          background: #fff;
          color: #111827;
          padding: 10px 16px;
          font-weight: 900;
          cursor: pointer;
        }

        .calendar-new-form {
          display: grid;
          gap: 18px;
        }

        .calendar-new-card {
          display: grid;
          gap: 16px;
          padding: 24px;
        }

        .calendar-new-card.primary {
          border-top: 2px solid rgba(124,58,237,0.25);
        }

        .calendar-new-card h2 {
          margin: 0;
          color: #0f172a;
          font-size: 24px;
          font-weight: 950;
        }

        .calendar-new-card label {
          display: grid;
          gap: 7px;
          color: #475569;
          font-size: 14px;
          font-weight: 900;
        }

        .calendar-new-card input,
        .calendar-new-card textarea,
        .calendar-new-card select {
          width: 100%;
          min-height: 50px;
          border: 1px solid #cbd5e1;
          border-radius: 15px;
          background: #fff;
          color: #0f172a;
          padding: 12px 14px;
          font-size: 16px;
          outline: none;
        }

        .calendar-new-card textarea {
          resize: vertical;
        }

        .calendar-new-card input:focus,
        .calendar-new-card textarea:focus,
        .calendar-new-card select:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 4px rgba(37,99,235,0.1);
        }

        .calendar-quick-grid,
        .calendar-new-two,
        .calendar-worker-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .calendar-quick-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .calendar-quick-grid button {
          border-color: rgba(124,58,237,0.18);
          background: linear-gradient(135deg, rgba(124,58,237,0.08), rgba(6,182,212,0.08));
          color: #334155;
        }

        .calendar-worker-grid label {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 10px;
          min-height: 46px;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: #f8fafc;
          padding: 10px 12px;
        }

        .calendar-worker-grid input {
          width: auto;
          min-height: auto;
          box-shadow: none;
        }

        .calendar-new-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          flex-wrap: wrap;
        }

        .calendar-new-actions button[type="submit"] {
          border-color: transparent;
          background: linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%);
          color: #fff;
          box-shadow: 0 16px 34px rgba(37,99,235,0.22);
        }

        .calendar-new-actions button:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        @media (max-width: 768px) {
          .calendar-new-hero,
          .calendar-new-card {
            border-radius: 20px;
            padding: 18px;
          }

          .calendar-new-hero {
            align-items: stretch;
            flex-direction: column;
          }

          .calendar-new-hero h1 {
            font-size: 36px;
          }

          .calendar-quick-grid,
          .calendar-new-two,
          .calendar-worker-grid {
            grid-template-columns: 1fr;
          }

          .calendar-new-actions button {
            width: 100%;
          }
        }
      `}</style>
    </DashboardShell>
  )
}
