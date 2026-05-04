'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import DashboardShell from '@/components/DashboardShell'

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
          setError(`Nepodařilo se načíst zakázku: ${jobError.message}`)
          setPageLoading(false)
          return
        }

        if (!job) {
          setError('Zakázka nebyla nalezena.')
          setPageLoading(false)
          return
        }

        setJobTitle(job.title || 'Bez názvu zakázky')

        if (!job.customer_id) {
          setError('Tato zakázka nemá přiřazeného zákazníka.')
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
          setError(`Nepodařilo se načíst zákazníka: ${customerResponse.error.message}`)
          setPageLoading(false)
          return
        }

        if (contactsResponse.error) {
          setError(`Nepodařilo se načíst kontakty: ${contactsResponse.error.message}`)
          setPageLoading(false)
          return
        }

        setCustomerName(customerResponse.data?.name || 'Bez názvu zákazníka')
        setContacts((contactsResponse.data as CustomerContact[]) ?? [])
        setPageLoading(false)
      } catch (err) {
        if (!mounted) return

        setError(
          err instanceof Error
            ? `Neočekávaná chyba: ${err.message}`
            : 'Neočekávaná chyba při načítání stránky.'
        )
        setPageLoading(false)
      }
    }

    loadData()

    return () => {
      mounted = false
    }
  }, [jobId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (!customerContactId) {
      setError('Vyber kontaktní osobu.')
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
        setError(`Nepodařilo se ověřit duplicitu: ${existingResponse.error.message}`)
        setLoading(false)
        return
      }

      if (existingResponse.data) {
        setError('Tento kontakt už je u zakázky přiřazen.')
        setLoading(false)
        return
      }

      const insertResponse = await supabase.from('job_customer_contacts').insert({
        job_id: jobId,
        customer_contact_id: customerContactId,
        role_label: roleLabel || null,
      })

      if (insertResponse.error) {
        setError(insertResponse.error.message || 'Nepodařilo se uložit kontakt.')
        setLoading(false)
        return
      }

      router.push(`/jobs/${jobId}`)
    } catch (err) {
      setError(
        err instanceof Error
          ? `Neočekávaná chyba: ${err.message}`
          : 'Neočekávaná chyba při ukládání.'
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
          <p>Načítám…</p>
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
          ← Zpět na detail zakázky
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
            Přiřadit kontakt k zakázce
          </h1>

          <div style={{ display: 'grid', gap: '8px', fontSize: '16px', color: '#4b5563' }}>
            <div>
              <strong style={{ color: '#111827' }}>Zakázka:</strong> {jobTitle}
            </div>
            <div>
              <strong style={{ color: '#111827' }}>Zákazník:</strong> {customerName}
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
              Kontaktní osoba
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
                {contacts.length === 0 ? '-- Žádné kontakty --' : '-- Vyber kontakt --'}
              </option>

              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.full_name || 'Bez jména'}
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
              Role na zakázce
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
              placeholder="Např. stavbyvedoucí"
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
              {loading ? 'Ukládám...' : 'Uložit kontakt'}
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
              Zpět
            </Link>
          </div>
        </form>
      </main>
    </DashboardShell>
  )
}