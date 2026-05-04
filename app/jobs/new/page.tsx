'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'

type Profile = { id: string; full_name: string | null }
type Customer = { id: string; name: string | null }
type CustomerContact = {
  id: string
  full_name: string | null
  role: string | null
  email: string | null
  phone: string | null
}

const INTERNAL_JOB_LABEL = 'Interní zakázka / vnitřní náklad'

const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] as const

type GeneratedWorkDay = {
  dateKey: string
  label: string
  startAt: Date
  endAt: Date
}

function parseDateTimeLocal(value: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function getLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

function makeDateOnDay(dateKey: string, sourceTime: Date) {
  const [year, month, day] = dateKey.split('-').map(Number)

  return new Date(
    year,
    month - 1,
    day,
    sourceTime.getHours(),
    sourceTime.getMinutes(),
    sourceTime.getSeconds(),
    sourceTime.getMilliseconds()
  )
}

function isDifferentLocalDay(start: Date | null, end: Date | null) {
  if (!start || !end) return false
  return getLocalDateKey(start) !== getLocalDateKey(end)
}

function formatWorkDayLabel(date: Date) {
  return new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function generateWorkDays(start: Date | null, end: Date | null): GeneratedWorkDay[] {
  if (!start || !end || end <= start || !isDifferentLocalDay(start, end)) return []

  const days: GeneratedWorkDay[] = []
  const endDateKey = getLocalDateKey(end)
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())

  while (getLocalDateKey(cursor) <= endDateKey) {
    const dateKey = getLocalDateKey(cursor)
    const occurrenceStart = makeDateOnDay(dateKey, start)
    let occurrenceEnd = makeDateOnDay(dateKey, end)

    if (occurrenceEnd <= occurrenceStart) {
      occurrenceEnd = new Date(occurrenceEnd)
      occurrenceEnd.setDate(occurrenceEnd.getDate() + 1)
    }

    days.push({
      dateKey,
      label: formatWorkDayLabel(cursor),
      startAt: occurrenceStart,
      endAt: occurrenceEnd,
    })

    cursor = new Date(cursor)
    cursor.setDate(cursor.getDate() + 1)
  }

  return days
}

function formatLocalTime(date: Date) {
  return new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getNextOccurrenceOnWeekday(date: Date, weekday: number) {
  const next = new Date(date)
  const diff = (weekday - next.getDay() + 7) % 7
  next.setDate(next.getDate() + diff)
  return next
}

export default function NewJobPage() {
  const router = useRouter()
  const { dictionary } = useI18n()

  const weekdayOptions = [
    dictionary.calendar ? null : null,
  ]

  const localizedWeekdays = [
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
    { value: 0, label: 'Sunday' },
  ].map((item) => {
    const labels: Record<number, string> = {
      1: new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(2026, 0, 5)),
      2: new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(2026, 0, 6)),
      3: new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(2026, 0, 7)),
      4: new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(2026, 0, 8)),
      5: new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(2026, 0, 9)),
      6: new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(2026, 0, 10)),
      0: new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date(2026, 0, 11)),
    }
    return { value: item.value, label: labels[item.value] }
  })

  const [companyId, setCompanyId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [address, setAddress] = useState('')
  const [price, setPrice] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [isPaid, setIsPaid] = useState(false)
  const [isInternal, setIsInternal] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [contactId, setContactId] = useState('')
  const [isRecurringWeekly, setIsRecurringWeekly] = useState(false)
  const [repeatWeekday, setRepeatWeekday] = useState('1')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerContacts, setCustomerContacts] = useState<CustomerContact[]>([])
  const [assignedProfiles, setAssignedProfiles] = useState<string[]>([''])
  const [selectedWorkDates, setSelectedWorkDates] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const generatedWorkDays = generateWorkDays(parseDateTimeLocal(startAt), parseDateTimeLocal(endAt))

  useEffect(() => {
    if (generatedWorkDays.length === 0 || isRecurringWeekly) {
      setSelectedWorkDates([])
      return
    }

    const validDateKeys = new Set(generatedWorkDays.map((day) => day.dateKey))
    setSelectedWorkDates((current) => {
      const keptDates = current.filter((dateKey) => validDateKeys.has(dateKey))
      return keptDates.length > 0 ? keptDates : generatedWorkDays.map((day) => day.dateKey)
    })
  }, [endAt, generatedWorkDays.length, isRecurringWeekly, startAt])

  useEffect(() => {
    async function loadInitialData() {
      const activeCompanyResponse = await fetch('/api/active-company', { cache: 'no-store' })
      const activeCompanyPayload = (await activeCompanyResponse.json()) as { companyId?: string | null }

      if (!activeCompanyResponse.ok || !activeCompanyPayload.companyId) {
        return
      }

      const activeCompanyId = activeCompanyPayload.companyId
      setCompanyId(activeCompanyId)

      const [{ data: membersData, error: membersError }, { data: customersData, error: customersError }] =
        await Promise.all([
          supabase
            .from('company_members')
            .select(`
              profile_id,
              profiles (
                id,
                full_name
              )
            `)
            .eq('company_id', activeCompanyId)
            .eq('is_active', true),
          supabase.from('customers').select('id, name').eq('company_id', activeCompanyId).order('name', { ascending: true }),
        ])

      if (!membersError && membersData) {
        const normalizedProfiles = membersData
          .map((member) => {
            const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles
            if (!profile?.id) return null
            return { id: profile.id, full_name: profile.full_name ?? null }
          })
          .filter((profile): profile is Profile => Boolean(profile))

        setProfiles(normalizedProfiles)
      }

      if (!customersError && customersData) {
        setCustomers(customersData)
      }
    }

    void loadInitialData()
  }, [])

  useEffect(() => {
    async function loadCustomerContacts() {
      if (!customerId) {
        setCustomerContacts([])
        setContactId('')
        return
      }

      const { data, error } = await supabase
        .from('customer_contacts')
        .select('id, full_name, role, email, phone')
        .eq('customer_id', customerId)
        .order('full_name', { ascending: true })

      if (error || !data) {
        setCustomerContacts([])
        setContactId('')
        return
      }

      setCustomerContacts(data)
      setContactId('')
    }

    void loadCustomerContacts()
  }, [customerId])

  function updateAssignedProfile(index: number, value: string) {
    const updated = [...assignedProfiles]
    updated[index] = value
    setAssignedProfiles(updated)
  }

  function addAssignedProfileRow() {
    setAssignedProfiles([...assignedProfiles, ''])
  }

  function removeAssignedProfileRow(index: number) {
    if (assignedProfiles.length === 1) {
      setAssignedProfiles([''])
      return
    }

    setAssignedProfiles(assignedProfiles.filter((_, i) => i !== index))
  }

  function toggleWorkDate(dateKey: string) {
    setSelectedWorkDates((current) =>
      current.includes(dateKey)
        ? current.filter((item) => item !== dateKey)
        : [...current, dateKey].sort()
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    if (!companyId) {
      alert(dictionary.jobs.activeCompanyMissing)
      setLoading(false)
      return
    }

    const parsedStartAt = parseDateTimeLocal(startAt)
    const parsedEndAt = parseDateTimeLocal(endAt)

    if (startAt && !parsedStartAt) {
      alert(dictionary.jobs.invalidStart)
      setLoading(false)
      return
    }

    if (endAt && !parsedEndAt) {
      alert(dictionary.jobs.invalidEnd)
      setLoading(false)
      return
    }

    if (parsedStartAt && parsedEndAt && parsedEndAt <= parsedStartAt) {
      alert(dictionary.jobs.endMustBeAfterStart)
      setLoading(false)
      return
    }

    if (isRecurringWeekly) {
      if (!parsedStartAt || !parsedEndAt) {
        alert(dictionary.jobs.recurringNeedsDates)
        setLoading(false)
        return
      }

      if (!repeatUntil) {
        alert(dictionary.jobs.repeatUntilRequired)
        setLoading(false)
        return
      }
    }

    const durationMs = parsedStartAt && parsedEndAt ? parsedEndAt.getTime() - parsedStartAt.getTime() : null

    const baseJobValues = {
      company_id: companyId,
      customer_id: customerId || null,
      contact_id: contactId || null,
      title,
      description,
      address,
      status: 'done',
      is_internal: isInternal,
    }

    const shouldSplitIntoDailyJobs =
      !isRecurringWeekly && generatedWorkDays.length > 1 && parsedStartAt && parsedEndAt

    if (shouldSplitIntoDailyJobs && selectedWorkDates.length === 0) {
      alert('Vyberte alespoň jeden den, kdy se bude na zakázce pracovat.')
      setLoading(false)
      return
    }

    const jobsToInsert = (() => {
      if (!isRecurringWeekly || !parsedStartAt || !parsedEndAt || !repeatUntil || durationMs == null) {
        return [{
          ...baseJobValues,
          price: price ? Number(price) : null,
          start_at: startAt || null,
          end_at: endAt || null,
          is_paid: isPaid,
          parent_job_id: null,
        }]
      }

      const weekday = Number(repeatWeekday)
      const repeatUntilDate = new Date(`${repeatUntil}T23:59:59`)
      const firstOccurrenceStart = getNextOccurrenceOnWeekday(parsedStartAt, weekday)
      firstOccurrenceStart.setHours(parsedStartAt.getHours(), parsedStartAt.getMinutes(), parsedStartAt.getSeconds(), parsedStartAt.getMilliseconds())

      const generatedJobs = []
      let occurrenceStart = new Date(firstOccurrenceStart)

      while (occurrenceStart <= repeatUntilDate) {
        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs)
        generatedJobs.push({
          ...baseJobValues,
          price: price ? Number(price) : null,
          start_at: occurrenceStart.toISOString(),
          end_at: occurrenceEnd.toISOString(),
          is_paid: isPaid,
          parent_job_id: null,
        })
        occurrenceStart = new Date(occurrenceStart)
        occurrenceStart.setDate(occurrenceStart.getDate() + 7)
      }

      return generatedJobs
    })()

    const selectedDailyJobs = generatedWorkDays.filter((day) => selectedWorkDates.includes(day.dateKey))

    const { data: jobs, error: jobError } = shouldSplitIntoDailyJobs
      ? await (async () => {
          const { data: parentJob, error: parentError } = await supabase
            .from('jobs')
            .insert({
              ...baseJobValues,
              price: price ? Number(price) : null,
              start_at: parsedStartAt.toISOString(),
              end_at: parsedEndAt.toISOString(),
              is_paid: isPaid,
              parent_job_id: null,
            })
            .select()
            .single()

          if (parentError || !parentJob) {
            return { data: null, error: parentError }
          }

          const dailyJobsToInsert = selectedDailyJobs.map((day) => ({
            ...baseJobValues,
            price: null,
            start_at: day.startAt.toISOString(),
            end_at: day.endAt.toISOString(),
            is_paid: false,
            parent_job_id: parentJob.id,
          }))

          const { data: childJobs, error: childError } = await supabase
            .from('jobs')
            .insert(dailyJobsToInsert)
            .select()

          if (childError || !childJobs) {
            return { data: null, error: childError }
          }

          return { data: [parentJob, ...childJobs], error: null }
        })()
      : await supabase.from('jobs').insert(jobsToInsert).select()

    if (jobError || !jobs || jobs.length === 0) {
      alert(`${dictionary.jobs.createJobError}: ${jobError?.message ?? 'Unknown error'}`)
      setLoading(false)
      return
    }

    const uniqueSelectedProfiles = [...new Set(assignedProfiles.filter(Boolean))]
    const jobsForAssignments = shouldSplitIntoDailyJobs ? jobs.filter((job) => job.parent_job_id) : jobs

    if (uniqueSelectedProfiles.length > 0 && jobsForAssignments.length > 0) {
      const assignments = jobsForAssignments.flatMap((job) =>
        uniqueSelectedProfiles.map((profileId) => ({
          job_id: job.id,
          profile_id: profileId,
          role_label: 'worker',
        }))
      )

      const { error: assignmentError } = await supabase.from('job_assignments').insert(assignments)

      if (assignmentError) {
        alert(`${dictionary.jobs.workersSaveError}: ${assignmentError.message}`)
        router.push('/jobs')
        return
      }
    }

    if (shouldSplitIntoDailyJobs) {
      router.push(`/jobs/${jobs[0].id}`)
      return
    }

    if (jobs.length === 1) {
      router.push(`/jobs/${jobs[0].id}`)
      return
    }

    router.push('/jobs')
  }

  return (
    <DashboardShell activeItem="jobs">
      <main style={{ maxWidth: '700px', fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <Link href="/jobs" style={{ display: 'inline-block', marginBottom: '24px', color: '#2563eb', textDecoration: 'none', fontWeight: '600' }}>
          {dictionary.jobs.backToJobs}
        </Link>

        <h1 style={{ marginBottom: '24px' }}>{dictionary.jobs.newJobTitle}</h1>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '12px' }}>
          <label>
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.customer}</div>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: 'white' }}>
              <option value="">{dictionary.jobs.noCustomerOption}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name ?? dictionary.jobs.noName}</option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.contactPerson}</div>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!customerId} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: customerId ? 'white' : '#f9fafb' }}>
              <option value="">{customerId ? dictionary.jobs.noContactPerson : dictionary.jobs.chooseCustomerFirst}</option>
              {customerContacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.full_name ?? dictionary.jobs.untitledWorker}{contact.role ? ` - ${contact.role}` : ''}</option>
              ))}
            </select>
          </label>

          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.titleLabel}</div><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.descriptionLabel}</div><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.addressLabel}</div><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.price}</div><input type="number" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.startJob}</div><input type="datetime-local" value={startAt} onChange={(e) => { const nextValue = e.target.value; setStartAt(nextValue); const parsedDate = parseDateTimeLocal(nextValue); if (parsedDate) setRepeatWeekday(String(parsedDate.getDay())) }} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.expectedEnd}</div><input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>

          {!isRecurringWeekly && generatedWorkDays.length > 1 ? (
            <div style={{ border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px', backgroundColor: '#fff', display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Dny práce v rozsahu zakázky</div>
                  <div style={{ color: '#6b7280', fontSize: '13px' }}>
                    Vytvoří se hlavní zakázka a pod ní jednodenní zakázky pro vybrané dny.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkDates(generatedWorkDays.map((day) => day.dateKey))}
                    style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Vybrat vše
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkDates([])}
                    style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 600 }}
                  >
                    Zrušit vše
                  </button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                {generatedWorkDays.map((day) => (
                  <label
                    key={day.dateKey}
                    style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '9px 10px', borderRadius: '10px', border: '1px solid #e5e7eb', backgroundColor: selectedWorkDates.includes(day.dateKey) ? '#eff6ff' : '#f9fafb' }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedWorkDates.includes(day.dateKey)}
                      onChange={() => toggleWorkDate(day.dateKey)}
                    />
                    <span style={{ fontWeight: 600 }}>{day.label}</span>
                    <span style={{ color: '#6b7280', fontSize: '13px' }}>
                      {formatLocalTime(day.startAt)} - {formatLocalTime(day.endAt)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <label>
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.recurrence}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}>
              <input type="checkbox" checked={isRecurringWeekly} onChange={(e) => setIsRecurringWeekly(e.target.checked)} />
              <span>{dictionary.jobs.repeatWeekly}</span>
            </div>
          </label>

          {isRecurringWeekly ? (
            <>
              <label>
                <div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.weekday}</div>
                <select value={repeatWeekday} onChange={(e) => setRepeatWeekday(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: 'white' }}>
                  {WEEKDAY_VALUES.map((value) => (
                    <option key={value} value={String(value)}>{new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(2026, 0, value === 0 ? 11 : value + 4))}</option>
                  ))}
                </select>
              </label>
              <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.repeatUntil}</div><input type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
            </>
          ) : null}

          <label>
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.payment}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}>
              <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} />
              <span>{dictionary.jobs.paidLabel}</span>
            </div>
          </label>

          <label>
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{INTERNAL_JOB_LABEL}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}>
              <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
              <span>Označit jako interní práci firmy, například úklid dílny nebo stěhování.</span>
            </div>
          </label>

          <div>
            <div style={{ marginBottom: '10px', fontWeight: 600 }}>{dictionary.jobs.workers}</div>
            <div style={{ display: 'grid', gap: '10px' }}>
              {assignedProfiles.map((selectedId, index) => (
                <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select value={selectedId} onChange={(e) => updateAssignedProfile(index, e.target.value)} style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: 'white' }}>
                    <option value="">{dictionary.jobs.selectWorker}</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.full_name ?? dictionary.jobs.untitledWorker}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeAssignedProfileRow(index)} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer' }}>
                    {dictionary.jobs.remove}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addAssignedProfileRow} style={{ marginTop: '10px', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 600 }}>
              {dictionary.jobs.addAnotherPerson}
            </button>
          </div>

          <button type="submit" disabled={loading || !companyId} style={{ padding: '12px 16px', borderRadius: '8px', border: 'none', backgroundColor: loading || !companyId ? '#6b7280' : 'black', color: 'white', fontWeight: 600, cursor: loading || !companyId ? 'default' : 'pointer' }}>
            {loading ? dictionary.jobs.saving : dictionary.jobs.createJob}
          </button>
        </form>
      </main>
    </DashboardShell>
  )
}
