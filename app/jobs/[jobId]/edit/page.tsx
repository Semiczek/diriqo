'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'

type JobRow = {
  id: string
  company_id: string | null
  parent_job_id: string | null
  title: string | null
  description: string | null
  status: string | null
  address: string | null
  price: number | null
  is_internal: boolean | null
  start_at: string | null
  end_at: string | null
  is_paid: boolean | null
  customer_id: string | null
  contact_id: string | null
}

type ParentJobOption = {
  id: string
  customer_id: string | null
  contact_id: string | null
  title: string | null
  description: string | null
  start_at: string | null
  end_at: string | null
  address: string | null
  price: number | null
  is_paid: boolean | null
}

type Customer = {
  id: string
  name: string | null
}

type CustomerContact = {
  id: string
  full_name: string | null
  role: string | null
  email: string | null
  phone: string | null
}

const INTERNAL_JOB_LABEL = 'Interní zakázka / vnitřní náklad'

const pageStyle: React.CSSProperties = {
  maxWidth: '1120px',
  margin: '0 auto',
  padding: '24px',
  fontFamily: 'Arial, Helvetica, sans-serif',
}

const heroStyle: React.CSSProperties = {
  borderRadius: '28px',
  padding: '28px',
  marginBottom: '18px',
  background:
    'linear-gradient(135deg, rgba(255,255,255,0.92), rgba(239,246,255,0.88) 48%, rgba(207,250,254,0.72))',
  border: '1px solid rgba(148,163,184,0.25)',
  boxShadow: '0 22px 55px rgba(15,23,42,0.09)',
}

const sectionCardStyle: React.CSSProperties = {
  borderRadius: '24px',
  padding: '22px',
  background: 'rgba(255,255,255,0.9)',
  border: '1px solid rgba(148,163,184,0.24)',
  boxShadow: '0 18px 42px rgba(15,23,42,0.07)',
}

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 16px',
  color: '#0f172a',
  fontSize: '22px',
  fontWeight: 900,
}

const fieldGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '16px',
}

const labelTextStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '7px',
  color: '#334155',
  fontWeight: 850,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '48px',
  padding: '12px 14px',
  borderRadius: '14px',
  border: '1px solid rgba(148,163,184,0.45)',
  backgroundColor: '#fff',
  color: '#0f172a',
  fontSize: '15px',
  outline: 'none',
}

const primaryButtonStyle: React.CSSProperties = {
  minHeight: '48px',
  padding: '12px 18px',
  borderRadius: '16px',
  border: 'none',
  background: 'linear-gradient(135deg, #7c3aed, #2563eb, #06b6d4)',
  color: '#fff',
  fontWeight: 900,
  cursor: 'pointer',
  boxShadow: '0 16px 36px rgba(37,99,235,0.24)',
}

const secondaryButtonStyle: React.CSSProperties = {
  minHeight: '44px',
  padding: '10px 14px',
  borderRadius: '14px',
  border: '1px solid rgba(148,163,184,0.4)',
  backgroundColor: 'rgba(255,255,255,0.9)',
  color: '#0f172a',
  fontWeight: 850,
  cursor: 'pointer',
}

function toDateTimeLocal(value: string | null) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const pad = (n: number) => String(n).padStart(2, '0')

  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function toIsoOrNull(value: string) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
}

function formatParentJobDate(value: string | null) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

export default function EditJobPage() {
  const { dictionary } = useI18n()
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creatingParent, setCreatingParent] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [statusLabel, setStatusLabel] = useState('-')
  const [dbStatus, setDbStatus] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [price, setPrice] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [isPaid, setIsPaid] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [contactId, setContactId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [parentJobId, setParentJobId] = useState('')
  const [parentJobSearch, setParentJobSearch] = useState('')
  const [originalParentJobId, setOriginalParentJobId] = useState('')
  const [childJobs, setChildJobs] = useState<ParentJobOption[]>([])
  const [propagateToChildren, setPropagateToChildren] = useState(false)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerContacts, setCustomerContacts] = useState<CustomerContact[]>([])
  const [parentJobOptions, setParentJobOptions] = useState<ParentJobOption[]>([])

  useEffect(() => {
    async function loadInitialData() {
      const { data: customersData, error } = await supabase
        .from('customers')
        .select('id, name')
        .order('name', { ascending: true })

      if (error) {
        setErrorMessage(`${dictionary.customers.errorPrefix}: ${error.message}`)
        setCustomers([])
        return
      }

      setCustomers(customersData ?? [])
    }

    void loadInitialData()
  }, [dictionary.customers.errorPrefix])

  useEffect(() => {
    async function loadJob() {
      setErrorMessage(null)

        const { data, error } = await supabase
          .from('jobs')
          .select('id, company_id, parent_job_id, title, description, status, address, price, is_internal, start_at, end_at, is_paid, customer_id, contact_id')
          .eq('id', jobId)
          .single()

      if (error || !data) {
        alert(`${dictionary.jobs.errorPrefix}: ${error?.message ?? dictionary.common.notSpecified}`)
        router.push(`/jobs/${jobId}`)
        return
      }

      const job = data as JobRow
      setTitle(job.title ?? '')
      setDescription(job.description ?? '')
      setDbStatus(job.status ?? null)
      if (!job.status) {
        setStatusLabel('-')
      } else if (job.status === 'done') {
        setStatusLabel(dictionary.jobs.done)
      } else if (job.status === 'in_progress') {
        setStatusLabel(dictionary.jobs.inProgress)
      } else if (job.status === 'future') {
        setStatusLabel(dictionary.jobs.future)
      } else {
        setStatusLabel(job.status)
      }
        setAddress(job.address ?? '')
        setPrice(job.price != null ? String(job.price) : '')
        setIsInternal(job.is_internal ?? false)
        setStartAt(toDateTimeLocal(job.start_at))
      setEndAt(toDateTimeLocal(job.end_at))
      setIsPaid(job.is_paid ?? false)
      setCustomerId(job.customer_id ?? '')
      setContactId(job.contact_id ?? '')
      setCompanyId(job.company_id ?? '')
      setParentJobId(job.parent_job_id ?? '')
      setOriginalParentJobId(job.parent_job_id ?? '')
      setLoading(false)
    }

    if (jobId) {
      void loadJob()
    }
  }, [dictionary.common.notSpecified, dictionary.jobs.done, dictionary.jobs.errorPrefix, dictionary.jobs.future, dictionary.jobs.inProgress, jobId, router])

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

      const selectedStillExists = data.some((contact) => contact.id === contactId)
      if (!selectedStillExists) {
        setContactId('')
      }
    }

    if (!loading) {
      void loadCustomerContacts()
    }
  }, [contactId, customerId, loading])

  useEffect(() => {
    async function loadParentJobOptions() {
      if (!companyId || !jobId || !customerId) {
        setParentJobOptions([])
        return
      }

      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_id, contact_id, title, description, start_at, end_at, address, price, is_paid')
        .eq('company_id', companyId)
        .is('parent_job_id', null)
        .neq('id', jobId)
        .eq('customer_id', customerId)
        .order('start_at', { ascending: true })

      if (error) {
        setParentJobOptions([])
        return
      }

      setParentJobOptions((data ?? []) as ParentJobOption[])
    }

    if (!loading) {
      void loadParentJobOptions()
    }
  }, [companyId, customerId, jobId, loading])

  useEffect(() => {
    async function loadChildJobs() {
      if (!jobId) {
        setChildJobs([])
        return
      }

      const { data, error } = await supabase
        .from('jobs')
        .select('id, customer_id, contact_id, title, description, start_at, end_at, address, price, is_paid')
        .eq('parent_job_id', jobId)
        .order('start_at', { ascending: true })

      if (error) {
        setChildJobs([])
        return
      }

      setChildJobs((data ?? []) as ParentJobOption[])
    }

    if (!loading) {
      void loadChildJobs()
    }
  }, [jobId, loading])

  const filteredParentJobOptions = useMemo(() => {
    return parentJobOptions.slice(0, 30)
  }, [parentJobOptions])

  const selectedParentJob = useMemo(() => {
    return parentJobOptions.find((job) => job.id === parentJobId) ?? null
  }, [parentJobId, parentJobOptions])

  const isGroupedChild = Boolean(originalParentJobId)
  const isParentWithChildren = childJobs.length > 0

  async function handleCreateParentSummaryJob() {
    if (!companyId) {
      setErrorMessage(dictionary.jobs.activeCompanyMissing)
      return
    }

    if (isParentWithChildren) {
      setErrorMessage('Tato zakázka už má navázané části. Nelze ji vložit pod další hlavní zakázku.')
      return
    }

    setCreatingParent(true)
    setErrorMessage(null)

    const startAtIso = toIsoOrNull(startAt)
    const endAtIso = toIsoOrNull(endAt)

    const { data: createdParent, error: createError } = await supabase
      .from('jobs')
      .insert({
        company_id: companyId,
        customer_id: customerId || null,
        contact_id: contactId || null,
        title: title.trim() || null,
        description: description.trim() || null,
        address: address.trim() || null,
        start_at: startAtIso,
        end_at: endAtIso,
        price: price !== '' ? Number(price) : null,
        is_internal: isInternal,
        status: dbStatus ?? 'future',
        is_paid: isPaid,
        parent_job_id: null,
      })
      .select('id, customer_id, contact_id, title, description, start_at, end_at, address, price, is_paid')
      .single()

    if (createError || !createdParent) {
      setErrorMessage(`${dictionary.jobs.errorPrefix}: ${createError?.message ?? 'Nepodařilo se vytvořit hlavní zakázku.'}`)
      setCreatingParent(false)
      return
    }

    const { error: linkError } = await supabase
      .from('jobs')
      .update({
        parent_job_id: createdParent.id,
        price: null,
        is_paid: false,
      })
      .eq('id', jobId)

    if (linkError) {
      setErrorMessage(`${dictionary.jobs.errorPrefix}: ${linkError.message}`)
      setCreatingParent(false)
      return
    }

    const newParentOption = createdParent as ParentJobOption
    setParentJobOptions((prev) => [newParentOption, ...prev.filter((item) => item.id !== newParentOption.id)])
    setParentJobId(newParentOption.id)
    setOriginalParentJobId(newParentOption.id)
    setPrice('')
    setIsPaid(false)
    setParentJobSearch('')
    setCreatingParent(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErrorMessage(null)

    const startAtIso = toIsoOrNull(startAt)
    const endAtIso = toIsoOrNull(endAt)

    if (startAt && !startAtIso) {
      setErrorMessage(dictionary.jobs.invalidStart)
      setSaving(false)
      return
    }

    if (endAt && !endAtIso) {
      setErrorMessage(dictionary.jobs.invalidEnd)
      setSaving(false)
      return
    }

    if (startAtIso && endAtIso && new Date(endAtIso) < new Date(startAtIso)) {
      setErrorMessage(dictionary.jobs.endMustBeAfterStart)
      setSaving(false)
      return
    }

    if (parentJobId && parentJobId === jobId) {
      setErrorMessage('Zakázka nemůže být sama sobě hlavní zakázkou.')
      setSaving(false)
      return
    }

    if (isParentWithChildren && parentJobId) {
      setErrorMessage('Zakázku s navázanými částmi nejde vložit pod další hlavní zakázku.')
      setSaving(false)
      return
    }

    const shouldBeChild = Boolean(parentJobId)
    const selectedParentForSave = parentJobOptions.find((job) => job.id === parentJobId) ?? null

    const response = await fetch(`/api/jobs/${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
        body: JSON.stringify({
          title: title.trim() || null,
          description: description.trim() || null,
          status: dbStatus,
          address: address.trim() || null,
          price: shouldBeChild ? null : price !== '' ? Number(price) : null,
          is_internal: isInternal,
          start_at: startAtIso,
          end_at: endAtIso,
        is_paid: shouldBeChild ? false : isPaid,
        customer_id: shouldBeChild ? selectedParentForSave?.customer_id ?? (customerId || null) : customerId || null,
        contact_id: shouldBeChild ? selectedParentForSave?.contact_id ?? (contactId || null) : contactId || null,
        parent_job_id: parentJobId || null,
        propagate_to_children: isParentWithChildren && !parentJobId ? propagateToChildren : false,
      }),
    })

    const result = (await response.json().catch(() => null)) as { error?: string } | null

    if (!response.ok) {
      setErrorMessage(
        `${dictionary.jobs.errorPrefix}: ${result?.error ?? dictionary.common.notSpecified}`
      )
      setSaving(false)
      return
    }

    router.push(`/jobs/${jobId}`)
  }

  async function handleDetachFromParent() {
    const confirmed = window.confirm('Odpojit tuto zakázku od hlavní zakázky? Zůstane jako samostatná jednodenní zakázka.')
    if (!confirmed) return

    setSaving(true)
    setErrorMessage(null)

    const { error } = await supabase
      .from('jobs')
      .update({ parent_job_id: null })
      .eq('id', jobId)

    if (error) {
      setErrorMessage(`${dictionary.jobs.errorPrefix}: ${error.message}`)
      setSaving(false)
      return
    }

    setParentJobId('')
    setOriginalParentJobId('')
    setSaving(false)
  }

  if (loading) {
    return (
      <DashboardShell activeItem="jobs">
        <main style={pageStyle}>
          <p>{dictionary.jobs.loading}</p>
        </main>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell activeItem="jobs">
      <main style={pageStyle}>
        <section style={heroStyle}>
          <Link
            href={`/jobs/${jobId}`}
            style={{
              display: 'inline-flex',
              marginBottom: '14px',
              color: '#475569',
              textDecoration: 'none',
              fontWeight: 900,
            }}
          >
            ← Zpět na detail
          </Link>
          <div style={{ color: '#475569', fontSize: '13px', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Zakázky
          </div>
          <h1 style={{ margin: '8px 0 8px', color: '#0f172a', fontSize: '44px', lineHeight: 1.05 }}>
            Upravit zakázku
          </h1>
          <p style={{ margin: 0, color: '#475569', fontSize: '17px', fontWeight: 650 }}>
            Uprav základní údaje, termín, místo a cenu bez zbytečné techniky.
          </p>
        </section>

        {errorMessage && (
          <div style={{ marginBottom: '16px', padding: '14px 16px', borderRadius: '16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontWeight: 800 }}>
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '18px' }}>
          <section style={sectionCardStyle}>
            <h2 style={sectionTitleStyle}>Nastavení zakázky</h2>
            <div style={fieldGridStyle}>
          <label>
            <div style={labelTextStyle}>{dictionary.jobs.customer}</div>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value)
                setParentJobId('')
                setParentJobSearch('')
              }}
              style={inputStyle}
            >
              <option value="">{dictionary.jobs.noCustomerOption}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name ?? dictionary.jobs.noName}</option>
              ))}
            </select>
          </label>

          <label>
            <div style={labelTextStyle}>{dictionary.jobs.contactPerson}</div>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!customerId} style={{ ...inputStyle, backgroundColor: customerId ? '#fff' : '#f8fafc', color: customerId ? '#0f172a' : '#64748b' }}>
              <option value="">{customerId ? dictionary.jobs.noContactPerson : dictionary.jobs.chooseCustomerFirst}</option>
              {customerContacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name ?? dictionary.customers.unnamedContact}
                  {contact.role ? ` - ${contact.role}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div style={labelTextStyle}>{dictionary.jobs.titleLabel}</div>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </label>
            </div>
          </section>

          <section style={sectionCardStyle}>
            <h2 style={sectionTitleStyle}>Termín a místo</h2>
            <div style={fieldGridStyle}>
          <label>
            <div style={labelTextStyle}>{dictionary.jobs.startJob}</div>
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={inputStyle} />
          </label>

          <label>
            <div style={labelTextStyle}>{dictionary.jobs.expectedEnd}</div>
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={inputStyle} />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            <div style={labelTextStyle}>{dictionary.jobs.addressLabel}</div>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} style={inputStyle} />
          </label>
            </div>
          </section>

          <section style={sectionCardStyle}>
            <h2 style={sectionTitleStyle}>Finance</h2>
            <div style={fieldGridStyle}>
          <label>
            <div style={labelTextStyle}>{dictionary.jobs.price}</div>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={Boolean(parentJobId)}
              style={{ ...inputStyle, backgroundColor: parentJobId ? '#f8fafc' : '#fff', color: parentJobId ? '#64748b' : '#0f172a' }}
            />
            {parentJobId ? (
              <div style={{ marginTop: '7px', color: '#64748b', fontSize: '13px', fontWeight: 700 }}>
                Cena je vedená na hlavní zakázce.
              </div>
            ) : null}
          </label>
            </div>
          </section>

          <details
            style={{
              ...sectionCardStyle,
              padding: 0,
              overflow: 'hidden',
            }}
          >
            <summary
              style={{
                padding: '20px 22px',
                cursor: 'pointer',
                color: '#0f172a',
                fontSize: '22px',
                fontWeight: 900,
                listStyle: 'none',
              }}
            >
              Pokročilé
            </summary>
            <div style={{ display: 'grid', gap: '18px', padding: '0 22px 22px' }}>
          <label>
            <div style={labelTextStyle}>{dictionary.jobs.descriptionLabel}</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inputStyle, minHeight: '96px', resize: 'vertical' }} />
          </label>

          <label>
            <div style={labelTextStyle}>{dictionary.jobs.detail.workState}</div>
            <input type="text" value={statusLabel} readOnly style={{ ...inputStyle, backgroundColor: '#f8fafc', color: '#64748b' }} />
          </label>

          <label>
            <div style={labelTextStyle}>Seskupení zakázky</div>
            <div style={{ display: 'grid', gap: '10px' }}>
              {isParentWithChildren ? (
                <div style={{ padding: '12px 14px', borderRadius: '14px', border: '1px solid #bfdbfe', backgroundColor: '#eff6ff', color: '#1f2937', fontSize: '14px', fontWeight: 700 }}>
                  Tato zakázka má {childJobs.length} navázaných částí.
                </div>
              ) : null}

              {isGroupedChild ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '12px 14px', borderRadius: '14px', border: '1px solid #e5e7eb', backgroundColor: '#fff' }}>
                  <span style={{ color: '#4b5563', fontSize: '14px', fontWeight: 700 }}>Zakázka je připojená k hlavní zakázce.</span>
                  <button
                    type="button"
                    onClick={handleDetachFromParent}
                    disabled={saving}
                    style={{ ...secondaryButtonStyle, cursor: saving ? 'not-allowed' : 'pointer' }}
                  >
                    Odpojit od sloučení
                  </button>
                </div>
              ) : null}

              <input
                type="text"
                value={parentJobSearch}
                onChange={(e) => setParentJobSearch(e.target.value)}
                placeholder="Vyber hlavní zakázku níže"
                disabled
                style={{ ...inputStyle, backgroundColor: '#f8fafc', color: '#64748b' }}
              />

              <div
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '14px',
                  backgroundColor: '#f9fafb',
                  padding: '12px 14px',
                  fontSize: '14px',
                }}
              >
                <strong>Vybraná hlavní zakázka:</strong>{' '}
                {selectedParentJob ? (
                  <>
                    {selectedParentJob.title ?? dictionary.jobs.untitledJob}
                    {selectedParentJob.start_at ? ` | ${formatParentJobDate(selectedParentJob.start_at)}` : ''}
                    {selectedParentJob.address ? ` | ${selectedParentJob.address}` : ''}
                  </>
                ) : (
                  'Samostatná zakázka'
                )}
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setParentJobId('')}
                  disabled={isParentWithChildren}
                  style={secondaryButtonStyle}
                >
                  Bez seskupení
                </button>
                <div style={{ color: '#64748b', fontSize: '13px', display: 'flex', alignItems: 'center', fontWeight: 800 }}>
                  Možností: {filteredParentJobOptions.length}
                </div>
                <button
                  type="button"
                  onClick={handleCreateParentSummaryJob}
                  disabled={creatingParent || isParentWithChildren}
                  style={{ ...secondaryButtonStyle, backgroundColor: creatingParent || isParentWithChildren ? '#e2e8f0' : '#0f172a', color: creatingParent || isParentWithChildren ? '#64748b' : '#fff', cursor: creatingParent || isParentWithChildren ? 'not-allowed' : 'pointer' }}
                >
                  {creatingParent ? 'Vytvářím...' : 'Vytvořit hlavní zakázku'}
                </button>
              </div>

              <div
                style={{
                  border: '1px solid #d1d5db',
                  borderRadius: '16px',
                  maxHeight: '280px',
                  overflowY: 'auto',
                  backgroundColor: '#fff',
                }}
              >
                {filteredParentJobOptions.length === 0 ? (
                  <div style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>
                    Žádná hlavní zakázka není k dispozici.
                  </div>
                ) : (
                  filteredParentJobOptions.map((parentJob, index) => {
                    const isSelected = parentJob.id === parentJobId

                    return (
                      <button
                        key={parentJob.id}
                        type="button"
                        disabled={isParentWithChildren}
                        onClick={() => {
                          setParentJobId(parentJob.id)
                          setPrice('')
                          setIsPaid(false)
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '12px',
                          border: 'none',
                          borderTop: index === 0 ? 'none' : '1px solid #f3f4f6',
                          backgroundColor: isSelected ? '#eff6ff' : '#fff',
                          cursor: isParentWithChildren ? 'not-allowed' : 'pointer',
                          display: 'grid',
                          gap: '4px',
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#111827' }}>
                          {parentJob.title ?? dictionary.jobs.untitledJob}
                        </div>
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>
                          {parentJob.start_at ? formatParentJobDate(parentJob.start_at) : 'Bez data'}
                          {parentJob.address ? ` | ${parentJob.address}` : ''}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </label>

          {isParentWithChildren && !parentJobId ? (
            <label
              style={{
                display: 'grid',
                gap: '8px',
                padding: '14px',
                borderRadius: '16px',
                border: '1px solid #dbe3ea',
                backgroundColor: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={propagateToChildren}
                  onChange={(e) => setPropagateToChildren(e.target.checked)}
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <div style={{ fontWeight: 700 }}>Promítnout změny do dílčích částí</div>
                </div>
              </div>
            </label>
          ) : null}

            <label>
              <div style={labelTextStyle}>{dictionary.jobs.payment}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}>
                <input type="checkbox" checked={isPaid} disabled={Boolean(parentJobId)} onChange={(e) => setIsPaid(e.target.checked)} />
                <span>{dictionary.jobs.paidLabel}</span>
              </div>
            </label>

            <label>
              <div style={labelTextStyle}>{INTERNAL_JOB_LABEL}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderRadius: '14px', border: '1px solid #d1d5db', backgroundColor: '#fff' }}>
                <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                <span>Označit jako interní práci firmy.</span>
              </div>
            </label>
            </div>
          </details>

            <button type="submit" disabled={saving} style={{ ...primaryButtonStyle, justifySelf: 'start', opacity: saving ? 0.7 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? dictionary.jobs.saving : dictionary.common.save}
          </button>
        </form>
      </main>
    </DashboardShell>
  )
}
