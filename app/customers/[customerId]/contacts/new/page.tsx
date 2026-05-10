'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'

import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { createCustomerContactAction } from '../actions'

export default function NewCustomerContactPage() {
  const router = useRouter()
  const params = useParams()
  const { dictionary } = useI18n()
  const customerId = params.customerId as string

  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [createPortalAccess, setCreatePortalAccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    if (createPortalAccess && !email.trim()) {
      setError('Pro zákaznický portál je nutné vyplnit e-mail kontaktu.')
      setLoading(false)
      return
    }

    const createResponse = await createCustomerContactAction({
      customerId,
      fullName,
      role,
      phone,
      email,
      note,
      createPortalAccess,
    })
    const insertResponse = createResponse.ok ? { error: null } : { error: { message: createResponse.error } }

    if (!createResponse.ok || !createResponse.contactId) {
      setError(insertResponse.error?.message || 'Nepodařilo se uložit kontakt.')
      setLoading(false)
      return
    }

    if (createPortalAccess) {
      const inviteResponse = await fetch('/api/customer-portal-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId,
          contactId: createResponse.contactId,
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
        }),
      })

      const invitePayload = (await inviteResponse.json()) as { error?: string; message?: string }

      if (!inviteResponse.ok) {
        setSuccessMessage('Kontakt byl uložen, ale portálový přístup se nepodařilo vytvořit.')
        setError(invitePayload.error || 'Nepodařilo se odeslat e-mail pro nastavení hesla.')
        setLoading(false)
        return
      }
    }

    router.push(`/customers/${customerId}`)
    router.refresh()
  }

  const sectionStyle: React.CSSProperties = {
    marginBottom: '24px',
    padding: '24px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '16px',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '6px',
    fontSize: '14px',
    fontWeight: 700,
    color: '#111827',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
  }

  return (
    <DashboardShell activeItem="customers">
      <main style={{ maxWidth: '900px', fontFamily: 'Arial', color: '#111827' }}>
        <Link
          href={`/customers/${customerId}`}
          style={{ marginBottom: '24px', display: 'inline-block', color: '#2563eb' }}
        >
          {dictionary.customers.contactNew.backToCustomer}
        </Link>

        <section style={sectionStyle}>
          <h1 style={{ fontSize: '36px', marginBottom: '12px' }}>
            {dictionary.customers.contactNew.title}
          </h1>
          <p style={{ color: '#4b5563' }}>{dictionary.customers.contactNew.subtitle}</p>
        </section>

        <form onSubmit={handleSubmit} style={sectionStyle}>
          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>{dictionary.customers.contactNew.fullName}</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              style={inputStyle}
              required
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>{dictionary.customers.contactNew.roleLabel}</label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>{dictionary.customers.contactNew.phoneLabel}</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>{dictionary.customers.contactNew.emailLabel}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>{dictionary.customers.contactNew.noteLabel}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div
            style={{
              marginBottom: '20px',
              borderRadius: '14px',
              border: '1px solid #dbeafe',
              backgroundColor: '#eff6ff',
              padding: '16px',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={createPortalAccess}
                onChange={(e) => setCreatePortalAccess(e.target.checked)}
                style={{ marginTop: '3px' }}
              />
              <span>
                <strong>Vytvořit přístup do zákaznického portálu</strong>
                <br />
                <span style={{ color: '#4b5563' }}>
                  Po uložení kontaktu odešleme e-mail, přes který si zákazník nastaví vlastní
                  heslo.
                </span>
              </span>
            </label>
          </div>

          {successMessage ? (
            <div style={{ color: '#166534', marginBottom: '12px' }}>{successMessage}</div>
          ) : null}
          {error ? <div style={{ color: 'red', marginBottom: '12px' }}>{error}</div> : null}

          <button
            type="submit"
            disabled={loading}
            style={{
              backgroundColor: '#000',
              color: '#fff',
              padding: '12px 18px',
              borderRadius: '12px',
              fontWeight: 700,
            }}
          >
            {loading
              ? createPortalAccess
                ? 'Ukládám a odesílám přístup...'
                : dictionary.customers.contactNew.saving
              : dictionary.customers.contactNew.saveContact}
          </button>
        </form>
      </main>
    </DashboardShell>
  )
}
