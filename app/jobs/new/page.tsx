'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useRouter } from 'next/navigation'

import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { createJobsAction } from '@/app/jobs/actions'
import { supabase } from '@/lib/supabase'
import { getIntlLocale } from '@/lib/i18n/config'

type Profile = { id: string; full_name: string | null }
type Customer = { id: string; name: string | null }
type CustomerContact = {
  id: string
  full_name: string | null
  role: string | null
  email: string | null
  phone: string | null
}

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

function formatWorkDayLabel(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function generateWorkDays(start: Date | null, end: Date | null, locale: string): GeneratedWorkDay[] {
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
      label: formatWorkDayLabel(cursor, locale),
      startAt: occurrenceStart,
      endAt: occurrenceEnd,
    })

    cursor = new Date(cursor)
    cursor.setDate(cursor.getDate() + 1)
  }

  return days
}

function formatLocalTime(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const pageStyle: CSSProperties = {
  display: 'grid',
  gap: '18px',
  width: '100%',
  maxWidth: '980px',
  margin: '0 auto',
  padding: '2px 0 48px',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: '16px',
  flexWrap: 'wrap',
  padding: '22px',
  borderRadius: '22px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255,255,255,0.88)',
  boxShadow: '0 18px 44px rgba(15, 23, 42, 0.08)',
}

const eyebrowStyle: CSSProperties = {
  margin: '0 0 7px',
  color: '#2563eb',
  fontSize: '12px',
  fontWeight: 900,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
}

const titleStyle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: '34px',
  lineHeight: 1.1,
  fontWeight: 900,
}

const backLinkStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '40px',
  padding: '9px 14px',
  borderRadius: '999px',
  border: '1px solid rgba(148, 163, 184, 0.36)',
  backgroundColor: '#ffffff',
  color: '#0f172a',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: 850,
}

const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: '14px',
  padding: '20px',
  borderRadius: '22px',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255,255,255,0.92)',
  boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
}

export default function NewJobPage() {
  const router = useRouter()
  const { dictionary, locale } = useI18n()
  const dateLocale = getIntlLocale(locale)

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
  const [formError, setFormError] = useState<string | null>(null)

  const generatedWorkDays = useMemo(
    () => generateWorkDays(parseDateTimeLocal(startAt), parseDateTimeLocal(endAt), dateLocale),
    [dateLocale, endAt, startAt]
  )

  function handleStartAtInput(value: string) {
    setStartAt(value)
    const parsedDate = parseDateTimeLocal(value)
    if (parsedDate) setRepeatWeekday(String(parsedDate.getDay()))
  }

  function handleEndAtInput(value: string) {
    setEndAt(value)
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      if (generatedWorkDays.length === 0 || isRecurringWeekly) {
        setSelectedWorkDates([])
        return
      }

      const validDateKeys = new Set(generatedWorkDays.map((day) => day.dateKey))
      setSelectedWorkDates((current) => {
        const keptDates = current.filter((dateKey) => validDateKeys.has(dateKey))
        return keptDates.length > 0 ? keptDates : generatedWorkDays.map((day) => day.dateKey)
      })
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [generatedWorkDays, isRecurringWeekly])

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
    const form = e.currentTarget as HTMLFormElement
    const formData = new FormData(form)
    const getSubmittedValue = (name: string, fallback: string) => {
      const formValue = formData.get(name)
      if (typeof formValue === 'string' && formValue.trim() !== '') return formValue

      const field = form.elements.namedItem(name)
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      ) {
        return field.value || fallback
      }

      return typeof formValue === 'string' ? formValue : fallback
    }

    const submittedCustomerId = getSubmittedValue('customerId', customerId).trim()
    const submittedContactId = getSubmittedValue('contactId', contactId).trim()
    const submittedTitle = getSubmittedValue('title', title).trim()
    const submittedDescription = getSubmittedValue('description', description)
    const submittedAddress = getSubmittedValue('address', address)
    const submittedPrice = getSubmittedValue('price', price)
    const submittedStartAt = getSubmittedValue('startAt', startAt)
    const submittedEndAt = getSubmittedValue('endAt', endAt)
    const submittedRepeatWeekday = getSubmittedValue('repeatWeekday', repeatWeekday)
    const submittedRepeatUntil = getSubmittedValue('repeatUntil', repeatUntil)
    const submittedAssignedProfiles = formData
      .getAll('assignedProfileIds')
      .map((value) => String(value).trim())
      .filter(Boolean)

    setFormError(null)
    setLoading(true)

    if (!companyId) {
      setFormError(dictionary.jobs.activeCompanyMissing)
      setLoading(false)
      return
    }

    if (!submittedTitle) {
      setFormError(dictionary.jobs.newPage.titleRequired)
      setLoading(false)
      return
    }

    if (!isInternal && !submittedCustomerId) {
      setFormError(
        customers.length === 0
          ? dictionary.jobs.newPage.customerRequiredCreateFirst
          : dictionary.jobs.newPage.customerRequiredSelect
      )
      setLoading(false)
      return
    }

    const selectedAssignedProfiles = Array.from(
      new Set([...submittedAssignedProfiles, ...assignedProfiles.map((profileId) => profileId.trim())].filter(Boolean))
    )

    if (selectedAssignedProfiles.length === 0) {
      setFormError(
        profiles.length === 0
          ? dictionary.jobs.newPage.workerRequiredCreateFirst
          : dictionary.jobs.newPage.workerRequiredSelect
      )
      setLoading(false)
      return
    }

    if (!submittedStartAt || !submittedEndAt) {
      setFormError(dictionary.jobs.newPage.startEndRequired)
      setLoading(false)
      return
    }

    const normalizedPrice = submittedPrice.replace(',', '.').trim()
    const parsedPrice = normalizedPrice ? Number(normalizedPrice) : null

    if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setFormError(dictionary.jobs.newPage.priceInvalid)
      setLoading(false)
      return
    }

    const parsedStartAt = parseDateTimeLocal(submittedStartAt)
    const parsedEndAt = parseDateTimeLocal(submittedEndAt)
    const generatedWorkDaysForSubmit = generateWorkDays(parsedStartAt, parsedEndAt, dateLocale)

    if (submittedStartAt && !parsedStartAt) {
      setFormError(dictionary.jobs.invalidStart)
      setLoading(false)
      return
    }

    if (submittedEndAt && !parsedEndAt) {
      setFormError(dictionary.jobs.invalidEnd)
      setLoading(false)
      return
    }

    if (parsedStartAt && parsedEndAt && parsedEndAt <= parsedStartAt) {
      setFormError(dictionary.jobs.endMustBeAfterStart)
      setLoading(false)
      return
    }

    if (isRecurringWeekly) {
      if (!parsedStartAt || !parsedEndAt) {
        setFormError(dictionary.jobs.recurringNeedsDates)
        setLoading(false)
        return
      }

      if (!submittedRepeatUntil) {
        setFormError(dictionary.jobs.repeatUntilRequired)
        setLoading(false)
        return
      }
    }

    const shouldSplitIntoDailyJobs =
      !isRecurringWeekly && generatedWorkDaysForSubmit.length > 1 && parsedStartAt && parsedEndAt

    if (shouldSplitIntoDailyJobs && selectedWorkDates.length === 0) {
      setFormError(dictionary.jobs.newPage.workDatesRequired)
      setLoading(false)
      return
    }

    const selectedDailyJobs = shouldSplitIntoDailyJobs
      ? generatedWorkDaysForSubmit
          .filter((day) => selectedWorkDates.includes(day.dateKey))
          .map((day) => ({
            dateKey: day.dateKey,
            startAt: day.startAt.toISOString(),
            endAt: day.endAt.toISOString(),
          }))
      : []

    const result = await createJobsAction({
      customerId: submittedCustomerId,
      contactId: submittedContactId,
      title: submittedTitle,
      description: submittedDescription,
      address: submittedAddress,
      price: submittedPrice,
      startAt: submittedStartAt,
      endAt: submittedEndAt,
      isPaid,
      isInternal,
      isRecurringWeekly,
      repeatWeekday: submittedRepeatWeekday,
      repeatUntil: submittedRepeatUntil,
      selectedDailyJobs,
      assignedProfileIds: selectedAssignedProfiles,
    })

    if (!result.ok) {
      setFormError(`${dictionary.jobs.createJobError}: ${result.error}`)
      setLoading(false)
      return
    }

    router.push(result.redirectTo)
    router.refresh()
  }

  return (
    <DashboardShell activeItem="jobs">
      <main style={pageStyle}>
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>{dictionary.jobs.title}</p>
            <h1 style={titleStyle}>{dictionary.jobs.newJobTitle}</h1>
          </div>
          <Link href="/jobs" style={backLinkStyle}>
            ← {dictionary.jobs.backToJobs}
          </Link>
        </header>

        <form className="job-create-form" onSubmit={handleSubmit} style={{ ...sectionStyle, gap: '14px' }}>
          {formError ? (
            <div
              role="alert"
              style={{
                border: '1px solid #fecaca',
                background: '#fef2f2',
                color: '#991b1b',
                borderRadius: '12px',
                padding: '12px 14px',
                fontSize: '14px',
                fontWeight: 750,
              }}
            >
              {formError}
            </div>
          ) : null}

          {customers.length === 0 || profiles.length === 0 ? (
            <div
              style={{
                border: '1px solid #bfdbfe',
                background: '#eff6ff',
                color: '#1e3a8a',
                borderRadius: '12px',
                padding: '12px 14px',
                fontSize: '14px',
                display: 'grid',
                gap: '6px',
              }}
            >
              {customers.length === 0 ? (
                <div>
                  {dictionary.jobs.newPage.createCustomerFirst}{' '}
                  <Link href="/customers/new" style={{ color: '#1d4ed8', fontWeight: 850 }}>
                    {dictionary.jobs.newPage.addCustomer}
                  </Link>
                </div>
              ) : null}
              {profiles.length === 0 ? (
                <div>
                  {dictionary.jobs.newPage.createWorkerNext}{' '}
                  <Link href="/workers/new" style={{ color: '#1d4ed8', fontWeight: 850 }}>
                    {dictionary.jobs.newPage.addWorker}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <label>
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.customer}</div>
            <select name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: 'white' }}>
              <option value="">{dictionary.jobs.noCustomerOption}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name ?? dictionary.jobs.noName}</option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.contactPerson}</div>
            <select name="contactId" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!customerId} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: customerId ? 'white' : '#f9fafb' }}>
              <option value="">{customerId ? dictionary.jobs.noContactPerson : dictionary.jobs.chooseCustomerFirst}</option>
              {customerContacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.full_name ?? dictionary.jobs.untitledWorker}{contact.role ? ` - ${contact.role}` : ''}</option>
              ))}
            </select>
          </label>

          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.titleLabel}</div><input name="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} required style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.descriptionLabel}</div><textarea name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.addressLabel}</div><input name="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.price}</div><input name="price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.startJob}</div><input name="startAt" type="datetime-local" value={startAt} onInput={(e) => handleStartAtInput(e.currentTarget.value)} onChange={(e) => handleStartAtInput(e.currentTarget.value)} required style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
          <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.expectedEnd}</div><input name="endAt" type="datetime-local" value={endAt} onInput={(e) => handleEndAtInput(e.currentTarget.value)} onChange={(e) => handleEndAtInput(e.currentTarget.value)} required style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>

          {!isRecurringWeekly && generatedWorkDays.length > 1 ? (
            <div style={{ border: '1px solid #d1d5db', borderRadius: '12px', padding: '12px', backgroundColor: '#fff', display: 'grid', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{dictionary.jobs.newPage.workDaysInRange}</div>
                  <div style={{ color: '#6b7280', fontSize: '13px' }}>
                    {dictionary.jobs.newPage.workDaysDescription}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkDates(generatedWorkDays.map((day) => day.dateKey))}
                    style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {dictionary.jobs.newPage.selectAll}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkDates([])}
                    style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 600 }}
                  >
                    {dictionary.jobs.newPage.clearAll}
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
                      {formatLocalTime(day.startAt, dateLocale)} - {formatLocalTime(day.endAt, dateLocale)}
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
                <select name="repeatWeekday" value={repeatWeekday} onChange={(e) => setRepeatWeekday(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: 'white' }}>
                  {WEEKDAY_VALUES.map((value) => (
                    <option key={value} value={String(value)}>{new Intl.DateTimeFormat(dateLocale, { weekday: 'long' }).format(new Date(2026, 0, value === 0 ? 11 : value + 4))}</option>
                  ))}
                </select>
              </label>
              <label><div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.repeatUntil}</div><input name="repeatUntil" type="date" value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db' }} /></label>
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
              <div style={{ marginBottom: '6px', fontWeight: 600 }}>{dictionary.jobs.internalJobLabel}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}>
                <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                <span>{dictionary.jobs.internalJobDescription}</span>
              </div>
            </label>

          <div>
            <div style={{ marginBottom: '10px', fontWeight: 600 }}>{dictionary.jobs.workers}</div>
            <div style={{ display: 'grid', gap: '10px' }}>
              {assignedProfiles.map((selectedId, index) => (
                <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select name="assignedProfileIds" value={selectedId} onChange={(e) => updateAssignedProfile(index, e.target.value)} style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', backgroundColor: 'white' }}>
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
