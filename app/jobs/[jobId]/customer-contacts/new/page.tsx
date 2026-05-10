'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { assignJobCustomerContactAction } from '../actions'

type CustomerContact = {
  id: string
  full_name: string | null
  role: string | null
}

type JobRow = {
  id: string
  title: string | null
  customer_id: string | null
}

type CustomerRow = {
  id: string
  name: string | null
}

export default function NewJobCustomerContactPage() {
  const { dictionary, locale } = useI18n()
  const text = useMemo(
    () =>
      locale === 'en'
        ? {
          loadJobFailed: 'Failed to load job',
          loadCustomerFailed: 'Failed to load customer',
          loadContactsFailed: 'Failed to load contacts',
          unexpectedLoadFailed: 'Unexpected error while loading the page.',
          unexpectedSaveFailed: 'Unexpected error while saving.',
          jobHasNoCustomer: 'This job has no assigned customer.',
          contactRequired: 'Select a contact person.',
          duplicateCheckFailed: 'Failed to check duplicates',
          contactAlreadyAssigned: 'This contact is already assigned to the job.',
          saveFailed: 'Failed to save contact.',
          loading: 'Loading...',
          backToDetail: 'Back to job detail',
          title: 'Assign contact to job',
          roleOnJob: 'Role on job',
          noContacts: '-- No contacts --',
          selectContact: '-- Select contact --',
          rolePlaceholder: 'E.g. site manager',
          saveContact: 'Save contact',
          saving: 'Saving...',
          back: 'Back',
          }
        : locale === 'de'
          ? {
            loadJobFailed: 'Auftrag konnte nicht geladen werden',
            loadCustomerFailed: 'Kunde konnte nicht geladen werden',
            loadContactsFailed: 'Kontakte konnten nicht geladen werden',
            unexpectedLoadFailed: 'Unerwarteter Fehler beim Laden der Seite.',
            unexpectedSaveFailed: 'Unerwarteter Fehler beim Speichern.',
            jobHasNoCustomer: 'Diesem Auftrag ist kein Kunde zugeordnet.',
            contactRequired: 'Kontaktperson auswählen.',
            duplicateCheckFailed: 'Duplikatprüfung fehlgeschlagen',
            contactAlreadyAssigned: 'Dieser Kontakt ist dem Auftrag bereits zugewiesen.',
            saveFailed: 'Kontakt konnte nicht gespeichert werden.',
            loading: 'Wird geladen...',
            backToDetail: 'Zurück zum Auftragsdetail',
            title: 'Kontakt dem Auftrag zuweisen',
            roleOnJob: 'Rolle im Auftrag',
            noContacts: '-- Keine Kontakte --',
            selectContact: '-- Kontakt auswählen --',
            rolePlaceholder: 'Z. B. Bauleiter',
            saveContact: 'Kontakt speichern',
            saving: 'Wird gespeichert...',
            back: 'Zurück',
            }
          : {
            loadJobFailed: 'Nepodařilo se načíst zakázku',
            loadCustomerFailed: 'Nepodařilo se načíst zákazníka',
            loadContactsFailed: 'Nepodařilo se načíst kontakty',
            unexpectedLoadFailed: 'Neočekávaná chyba při načítání stránky.',
            unexpectedSaveFailed: 'Neočekávaná chyba při ukládání.',
            jobHasNoCustomer: 'Tato zakázka nemá přiřazeného zákazníka.',
            contactRequired: 'Vyber kontaktní osobu.',
            duplicateCheckFailed: 'Nepodařilo se ověřit duplicitu',
            contactAlreadyAssigned: 'Tento kontakt už je u zakázky přiřazen.',
            saveFailed: 'Nepodařilo se uložit kontakt.',
            loading: 'Načítám...',
            backToDetail: 'Zpět na detail zakázky',
            title: 'Přiřadit kontakt k zakázce',
            roleOnJob: 'Role na zakázce',
            noContacts: '-- Žádné kontakty --',
            selectContact: '-- Vyber kontakt --',
            rolePlaceholder: 'Např. stavbyvedoucí',
            saveContact: 'Uložit kontakt',
            saving: 'Ukládám...',
            back: 'Zpět',
            },
    [locale]
  )
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string

  const [jobTitle, setJobTitle] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [contacts, setContacts] = useState<CustomerContact[]>([])
  const [customerContactId, setCustomerContactId] = useState('')
  const [roleLabel, setRoleLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function loadData() {
      setPageLoading(true)
      setError(null)

      try {
        const { data: job, error: jobError } = await supabase
          .from('jobs')
          .select('id, title, customer_id')
          .eq('id', jobId)
          .maybeSingle<JobRow>()

        if (!mounted) return

        if (jobError) {
          setError(`${text.loadJobFailed}: ${jobError.message}`)
          setPageLoading(false)
          return
        }

        if (!job) {
          setError(dictionary.jobs.detail.jobNotFound)
          setPageLoading(false)
          return
        }

        setJobTitle(job.title || dictionary.jobs.untitledJob)

        if (!job.customer_id) {
          setError(text.jobHasNoCustomer)
          setPageLoading(false)
          return
        }

        const [customerResponse, contactsResponse] = await Promise.all([
          supabase
            .from('customers')
            .select('id, name')
            .eq('id', job.customer_id)
            .maybeSingle<CustomerRow>(),

          supabase
            .from('customer_contacts')
            .select('id, full_name, role')
            .eq('customer_id', job.customer_id)
            .order('full_name', { ascending: true }),
        ])

        if (!mounted) return

        if (customerResponse.error) {
          setError(`${text.loadCustomerFailed}: ${customerResponse.error.message}`)
          setPageLoading(false)
          return
        }

        if (contactsResponse.error) {
          setError(`${text.loadContactsFailed}: ${contactsResponse.error.message}`)
          setPageLoading(false)
          return
        }

        setCustomerName(customerResponse.data?.name || dictionary.customers.detail.unnamedCustomer)
        setContacts((contactsResponse.data as CustomerContact[]) ?? [])
        setPageLoading(false)
      } catch (err) {
        if (!mounted) return

        setError(
          err instanceof Error
            ? `${dictionary.jobs.errorPrefix}: ${err.message}`
            : text.unexpectedLoadFailed
        )
        setPageLoading(false)
      }
    }

    loadData()

    return () => {
      mounted = false
    }
  }, [
    dictionary.customers.detail.unnamedCustomer,
    dictionary.jobs.detail.jobNotFound,
    dictionary.jobs.errorPrefix,
    dictionary.jobs.untitledJob,
    jobId,
    text,
  ])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (!customerContactId) {
      setError(text.contactRequired)
      setLoading(false)
      return
    }

    try {
      const existingResponse = await supabase
        .from('job_customer_contacts')
        .select('id')
        .eq('job_id', jobId)
        .eq('customer_contact_id', customerContactId)
        .maybeSingle()

      if (existingResponse.error) {
        setError(`${text.duplicateCheckFailed}: ${existingResponse.error.message}`)
        setLoading(false)
        return
      }

      if (existingResponse.data) {
        setError(text.contactAlreadyAssigned)
        setLoading(false)
        return
      }

      const result = await assignJobCustomerContactAction({
        jobId,
        customerContactId,
        roleLabel,
      })
      const insertResponse = { error: result.ok ? null : { message: result.error } }

      if (insertResponse.error) {
        setError(insertResponse.error.message || text.saveFailed)
        setLoading(false)
        return
      }

      router.push(`/jobs/${jobId}`)
    } catch (err) {
      setError(
        err instanceof Error
          ? `${dictionary.jobs.errorPrefix}: ${err.message}`
          : text.unexpectedSaveFailed
      )
      setLoading(false)
    }
  }

  if (pageLoading) {
    return (
      <DashboardShell activeItem="jobs">
        <main
          style={{
            maxWidth: '900px',
            fontFamily: 'Arial, Helvetica, sans-serif',
            color: '#111827',
          }}
        >
          <p>{text.loading}</p>
        </main>
      </DashboardShell>
    )
  }

  return (
    <DashboardShell activeItem="jobs">
      <main
        style={{
          maxWidth: '900px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111827',
        }}
      >
        <Link
          href={`/jobs/${jobId}`}
          style={{
            display: 'inline-block',
            marginBottom: '24px',
            color: '#2563eb',
            textDecoration: 'none',
            fontWeight: '600',
          }}
        >
          ← {text.backToDetail}
        </Link>

        <section
          style={{
            marginBottom: '24px',
            padding: '24px',
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
          }}
        >
          <h1
            style={{
              margin: '0 0 12px 0',
              fontSize: '36px',
              lineHeight: '1.2',
              color: '#111827',
            }}
          >
            {text.title}
          </h1>

          <div style={{ display: 'grid', gap: '8px', fontSize: '16px', color: '#4b5563' }}>
            <div>
              <strong style={{ color: '#111827' }}>{dictionary.jobs.titleLabel}:</strong> {jobTitle}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>{dictionary.jobs.customer}:</strong> {customerName}
            </div>
          </div>
        </section>

        <form
          onSubmit={handleSubmit}
          style={{
            marginBottom: '24px',
            padding: '24px',
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
          }}
        >
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '14px',
                fontWeight: 700,
                color: '#111827',
              }}
            >
              {dictionary.jobs.contactPerson}
            </label>
            <select
              value={customerContactId}
              onChange={(e) => setCustomerContactId(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              disabled={contacts.length === 0}
            >
              <option value="">
                {contacts.length === 0 ? text.noContacts : text.selectContact}
              </option>

              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name || dictionary.customers.unnamedContact}
                  {contact.role ? ` — ${contact.role}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '14px',
                fontWeight: 700,
                color: '#111827',
              }}
            >
              {text.roleOnJob}
            </label>
            <input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
              placeholder={text.rolePlaceholder}
            />
          </div>

          {error ? (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px',
                borderRadius: '8px',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                fontSize: '14px',
                border: '1px solid #fecaca',
              }}
            >
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={loading || contacts.length === 0}
              style={{
                backgroundColor: '#000000',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 18px',
                fontWeight: 700,
                fontSize: '14px',
                cursor: loading || contacts.length === 0 ? 'not-allowed' : 'pointer',
                opacity: loading || contacts.length === 0 ? 0.7 : 1,
              }}
            >
              {loading ? text.saving : text.saveContact}
            </button>

            <Link
              href={`/jobs/${jobId}`}
              style={{
                border: '1px solid #d1d5db',
                borderRadius: '12px',
                padding: '12px 18px',
                fontWeight: 600,
                fontSize: '14px',
                textDecoration: 'none',
                color: '#111827',
                background: '#fff',
              }}
            >
              {text.back}
            </Link>
          </div>
        </form>
      </main>
    </DashboardShell>
  )
}
