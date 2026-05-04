import Link from 'next/link'
import { redirect } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { getRequestDictionary } from '@/lib/i18n/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type EditWorkShiftPageProps = {
  params: Promise<{
    shiftId: string
  }>
  searchParams?: Promise<{
    error?: string
  }>
}

type WorkShiftRow = {
  id: string
  profile_id: string | null
  company_id: string | null
  job_id: string | null
  job_hours_override: number | null
  shift_date: string | null
  started_at: string | null
  ended_at: string | null
  hours_override: number | null
  note: string | null
  profiles: {
    id: string
    full_name: string | null
    email: string | null
  } | null
}

type JobOptionRow = {
  id: string
  title: string | null
  start_at: string | null
}

type CompanyMemberRow = {
  company_id: string | null
}

function getShiftMonthRange(shift: Pick<WorkShiftRow, 'shift_date' | 'started_at' | 'ended_at'>) {
  const sourceValue = shift.shift_date ?? shift.started_at ?? shift.ended_at
  if (!sourceValue) return null

  const sourceDate = new Date(sourceValue)
  if (Number.isNaN(sourceDate.getTime())) return null

  const monthStart = new Date(sourceDate.getFullYear(), sourceDate.getMonth(), 1)
  const nextMonthStart = new Date(sourceDate.getFullYear(), sourceDate.getMonth() + 1, 1)

  return {
    monthStart: monthStart.toISOString(),
    nextMonthStart: nextMonthStart.toISOString(),
  }
}

function isMissingWorkShiftAssignmentColumn(message: string | undefined) {
  const lowerMessage = (message ?? '').toLowerCase()
  return (
    lowerMessage.includes('work_shifts.job_id') ||
    lowerMessage.includes('work_shifts.job_hours_override')
  )
}

function getErrorMessage(
  errorCode: string | undefined,
  t: Awaited<ReturnType<typeof getRequestDictionary>>['workShiftEdit']
) {
  if (!errorCode) return null

  if (errorCode === 'missing-id') return t.missingId
  if (errorCode === 'update-failed') return t.updateFailed
  if (errorCode === 'invalid-date') return t.invalidDate
  if (errorCode === 'missing-job-hours') return t.missingJobHours
  if (errorCode === 'invalid-job-hours') return t.invalidJobHours
  if (errorCode === 'unexpected') return t.unexpected

  return t.genericError
}

function formatDateInput(value: string | null) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${year}-${month}-${day}`
}

function formatDateTimeLocalInput(value: string | null) {
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

function formatInputNumber(value: number | null) {
  if (value == null) return ''
  return String(value)
}

function getWorkerLabel(shift: WorkShiftRow) {
  if (shift.profiles?.full_name?.trim()) return shift.profiles.full_name.trim()
  if (shift.profiles?.email?.trim()) return shift.profiles.email.trim()
  return 'Bez jména'
}

export default async function EditWorkShiftPage({
  params,
  searchParams,
}: EditWorkShiftPageProps) {
  const dictionary = await getRequestDictionary()
  const t = dictionary.workShiftEdit
  const { shiftId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const errorMessage = getErrorMessage(resolvedSearchParams?.error, t)

  const supabase = await createSupabaseServerClient()

  let supportsJobAssignment = true

  let shiftResponse = await supabase
    .from('work_shifts')
    .select(`
      id,
      profile_id,
      company_id,
      job_id,
      job_hours_override,
      shift_date,
      started_at,
      ended_at,
      hours_override,
      note,
      profiles (
        id,
        full_name,
        email
      )
    `)
    .eq('id', shiftId)
    .maybeSingle()

  if (shiftResponse.error && isMissingWorkShiftAssignmentColumn(shiftResponse.error.message)) {
    supportsJobAssignment = false
    shiftResponse = await supabase
      .from('work_shifts')
      .select(`
        id,
        profile_id,
        company_id,
        shift_date,
        started_at,
        ended_at,
        hours_override,
        note,
        profiles (
          id,
          full_name,
          email
        )
      `)
      .eq('id', shiftId)
      .maybeSingle()
  }

  if (shiftResponse.error || !shiftResponse.data) {
    return (
      <DashboardShell activeItem="workers">
        <main
          style={{
            maxWidth: '900px',
            fontFamily: 'Arial, Helvetica, sans-serif',
            color: '#111827',
          }}
        >
          <div
            style={{
              border: '1px solid #fdba74',
              background: '#fff7ed',
              color: '#9a3412',
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            {t.notFound}
          </div>
        </main>
      </DashboardShell>
    )
  }

  const shift = {
    ...(shiftResponse.data as unknown as Omit<WorkShiftRow, 'job_id'> & {
      job_id?: string | null
      job_hours_override?: number | null
    }),
    job_id:
      shiftResponse.data &&
      typeof shiftResponse.data === 'object' &&
      'job_id' in shiftResponse.data &&
      typeof (shiftResponse.data as { job_id?: unknown }).job_id === 'string'
        ? ((shiftResponse.data as { job_id?: string | null }).job_id ?? null)
        : null,
    job_hours_override:
      shiftResponse.data &&
      typeof shiftResponse.data === 'object' &&
      'job_hours_override' in shiftResponse.data &&
      (typeof (shiftResponse.data as { job_hours_override?: unknown }).job_hours_override ===
        'number' ||
        typeof (shiftResponse.data as { job_hours_override?: unknown }).job_hours_override ===
          'string')
        ? Number(
            (shiftResponse.data as { job_hours_override?: number | string | null })
              .job_hours_override
          )
        : null,
  } as WorkShiftRow

  const companyMemberResponse = shift.profile_id
    ? await supabase
        .from('company_members')
        .select('company_id')
        .eq('profile_id', shift.profile_id)
        .eq('is_active', true)
        .maybeSingle()
    : { data: null, error: null }

  if (companyMemberResponse.error) {
    return (
      <DashboardShell activeItem="workers">
        <main
          style={{
            maxWidth: '900px',
            fontFamily: 'Arial, Helvetica, sans-serif',
            color: '#111827',
          }}
        >
          <div
            style={{
              border: '1px solid #fdba74',
              background: '#fff7ed',
              color: '#9a3412',
              borderRadius: '16px',
              padding: '24px',
            }}
          >
            {t.workerCompanyLoadFailed}: {companyMemberResponse.error.message}
          </div>
        </main>
      </DashboardShell>
    )
  }

  const companyMember = (companyMemberResponse.data ?? null) as CompanyMemberRow | null
  const jobsCompanyId = shift.company_id ?? companyMember?.company_id ?? null
  const shiftMonthRange = getShiftMonthRange(shift)

  const jobsResponse =
    jobsCompanyId && supportsJobAssignment
      ? await (() => {
          let query = supabase
            .from('jobs')
            .select('id, title, start_at')
            .eq('company_id', jobsCompanyId)

          if (shiftMonthRange) {
            const monthFilter = `and(start_at.gte.${shiftMonthRange.monthStart},start_at.lt.${shiftMonthRange.nextMonthStart})`
            const currentJobFilter = shift.job_id ? `id.eq.${shift.job_id}` : null
            query = query.or(currentJobFilter ? `${monthFilter},${currentJobFilter}` : monthFilter)
          }

          return query.order('start_at', { ascending: false })
        })()
      : { data: [], error: null }

  const jobs = (jobsResponse.data ?? []) as JobOptionRow[]

  async function updateShift(formData: FormData) {
    'use server'

    const shiftIdValue = String(formData.get('shiftId') ?? '').trim()
    const profileId = String(formData.get('profileId') ?? '').trim()
    const shiftDateRaw = String(formData.get('shift_date') ?? '').trim()
    const jobIdRaw = String(formData.get('job_id') ?? '').trim()
    const jobHoursOverrideRaw = String(formData.get('job_hours_override') ?? '').trim()
    const startedAtRaw = String(formData.get('started_at') ?? '').trim()
    const endedAtRaw = String(formData.get('ended_at') ?? '').trim()
    const hoursOverrideRaw = String(formData.get('hours_override') ?? '').trim()
    const note = String(formData.get('note') ?? '').trim()

    if (!shiftIdValue) {
      redirect('/workers?error=missing-id')
    }

    const shiftDate = shiftDateRaw === '' ? null : shiftDateRaw
    const jobId = jobIdRaw === '' ? null : jobIdRaw
    const startedAt = startedAtRaw === '' ? null : new Date(startedAtRaw).toISOString()
    const endedAt = endedAtRaw === '' ? null : new Date(endedAtRaw).toISOString()
    const hoursOverride =
      hoursOverrideRaw === '' ? null : Number(hoursOverrideRaw.replace(',', '.'))
    const jobHoursOverride =
      jobHoursOverrideRaw === '' ? null : Number(jobHoursOverrideRaw.replace(',', '.'))

    if (
      (startedAtRaw !== '' && !startedAt) ||
      (endedAtRaw !== '' && !endedAt) ||
      (hoursOverrideRaw !== '' && Number.isNaN(hoursOverride)) ||
      (jobHoursOverrideRaw !== '' && Number.isNaN(jobHoursOverride))
    ) {
      redirect(`/work-shifts/${shiftIdValue}/edit?error=invalid-date`)
    }

    if (jobId && jobHoursOverride == null) {
      redirect(`/work-shifts/${shiftIdValue}/edit?error=missing-job-hours`)
    }

    if (jobHoursOverride != null && jobHoursOverride < 0) {
      redirect(`/work-shifts/${shiftIdValue}/edit?error=invalid-job-hours`)
    }

    const supabase = await createSupabaseServerClient()

    const updatePayload = supportsJobAssignment
      ? {
          job_id: jobId,
          job_hours_override: jobId ? jobHoursOverride : null,
          shift_date: shiftDate,
          started_at: startedAt,
          ended_at: endedAt,
          hours_override: hoursOverride,
          note: note === '' ? null : note,
        }
      : {
          shift_date: shiftDate,
          started_at: startedAt,
          ended_at: endedAt,
          hours_override: hoursOverride,
          note: note === '' ? null : note,
        }

    const { error } = await supabase
      .from('work_shifts')
      .update(updatePayload)
      .eq('id', shiftIdValue)

    if (error) {
      redirect(`/work-shifts/${shiftIdValue}/edit?error=update-failed`)
    }

    if (profileId) {
      redirect(`/workers/${profileId}`)
    }

    redirect('/workers')
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '14px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '8px',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid #d1d5db',
    borderRadius: '12px',
    padding: '12px 14px',
    fontSize: '16px',
    color: '#111827',
    background: '#ffffff',
    outline: 'none',
  }

  const textAreaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: '120px',
    resize: 'vertical',
  }

  return (
    <DashboardShell activeItem="workers">
      <main
        style={{
          maxWidth: '900px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111827',
        }}
      >
        <div style={{ marginBottom: '24px' }}>
          <Link
            href={shift.profile_id ? `/workers/${shift.profile_id}` : '/workers'}
            style={{
              display: 'inline-block',
              color: '#374151',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            {t.back}
          </Link>
        </div>

        <section
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            background: '#ffffff',
            padding: '24px',
          }}
        >
          <div style={{ marginBottom: '24px' }}>
            <h1
              style={{
                margin: 0,
                fontSize: '36px',
                lineHeight: '1.2',
                color: '#111827',
              }}
            >
              {t.title}
            </h1>

            <p
              style={{
                margin: '10px 0 0 0',
                fontSize: '15px',
                color: '#6b7280',
              }}
            >
              {t.worker}: {getWorkerLabel(shift)}
            </p>
          </div>

          {errorMessage ? (
            <div
              style={{
                marginBottom: '20px',
                border: '1px solid #fdba74',
                background: '#fff7ed',
                color: '#9a3412',
                borderRadius: '12px',
                padding: '14px 16px',
                fontSize: '14px',
              }}
            >
              {errorMessage}
            </div>
          ) : null}

          <form action={updateShift}>
            <input type="hidden" name="shiftId" value={shift.id} />
            <input type="hidden" name="profileId" value={shift.profile_id ?? ''} />

            <div
              style={{
                display: 'grid',
                gap: '18px',
              }}
            >
              <div>
                <label htmlFor="shift_date" style={labelStyle}>
                  {t.shiftDate}
                </label>
                <input
                  id="shift_date"
                  name="shift_date"
                  type="date"
                  defaultValue={formatDateInput(shift.shift_date)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="job_id" style={labelStyle}>
                  {t.job}
                </label>
                <select
                  id="job_id"
                  name="job_id"
                  defaultValue={shift.job_id ?? ''}
                  style={inputStyle}
                >
                  <option value="">{t.noJob}</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title ?? t.unnamedJob}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="job_hours_override" style={labelStyle}>
                  {t.jobHours}
                </label>
                <input
                  id="job_hours_override"
                  name="job_hours_override"
                  type="number"
                  step="0.01"
                  defaultValue={formatInputNumber(shift.job_hours_override)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="started_at" style={labelStyle}>
                  {t.start}
                </label>
                <input
                  id="started_at"
                  name="started_at"
                  type="datetime-local"
                  defaultValue={formatDateTimeLocalInput(shift.started_at)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="ended_at" style={labelStyle}>
                  {t.end}
                </label>
                <input
                  id="ended_at"
                  name="ended_at"
                  type="datetime-local"
                  defaultValue={formatDateTimeLocalInput(shift.ended_at)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="hours_override" style={labelStyle}>
                  {t.manualHours}
                </label>
                <input
                  id="hours_override"
                  name="hours_override"
                  type="number"
                  step="0.01"
                  defaultValue={formatInputNumber(shift.hours_override)}
                  style={inputStyle}
                />
              </div>

              <div>
                <label htmlFor="note" style={labelStyle}>
                  {t.note}
                </label>
                <textarea
                  id="note"
                  name="note"
                  defaultValue={shift.note ?? ''}
                  style={textAreaStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '12px',
                flexWrap: 'wrap',
                marginTop: '24px',
              }}
            >
              <button
                type="submit"
                style={{
                  border: 'none',
                  borderRadius: '12px',
                  background: '#111827',
                  color: '#ffffff',
                  padding: '12px 16px',
                  fontSize: '15px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {t.saveChanges}
              </button>

              <Link
                href={shift.profile_id ? `/workers/${shift.profile_id}` : '/workers'}
                style={{
                  display: 'inline-block',
                  borderRadius: '12px',
                  border: '1px solid #d1d5db',
                  background: '#ffffff',
                  color: '#111827',
                  padding: '12px 16px',
                  fontSize: '15px',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                {t.cancel}
              </Link>
            </div>
          </form>
        </section>
      </main>
    </DashboardShell>
  )
}


