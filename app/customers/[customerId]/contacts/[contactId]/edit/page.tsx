'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'
import { updateCustomerContactAction } from '../../actions'

type CustomerContact = {
  id: string
  customer_id: string
  full_name: string | null
  role: string | null
  phone: string | null
  email: string | null
  note: string | null
}

export default function EditCustomerContactPage() {
  const router = useRouter()
  const params = useParams()
  const { dictionary } = useI18n()

  const customerId = params.customerId as string
  const contactId = params.contactId as string

  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [sendPortalInvite, setSendPortalInvite] = useState(false)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [portalSending, setPortalSending] = useState(false)

  useEffect(() => {
    async function loadContact() {
      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from('customer_contacts')
        .select('id, customer_id, full_name, role, phone, email, note')
        .eq('id', contactId)
        .eq('customer_id', customerId)
        .single()

      if (error || !data) {
        setError(dictionary.customers.contactEdit.loadFailed)
        setLoading(false)
        return
      }

      const contact = data as CustomerContact

      setFullName(contact.full_name ?? '')
      setRole(contact.role ?? '')
      setPhone(contact.phone ?? '')
      setEmail(contact.email ?? '')
      setNote(contact.note ?? '')
      setLoading(false)
    }

    if (customerId && contactId) {
      void loadContact()
    }
  }, [contactId, customerId, dictionary.customers.contactEdit.loadFailed])

  async function sendPortalAccessInvite() {
    if (!email.trim()) {
      setError('Pro zákaznický portál je nutné vyplnit e-mail kontaktu.')
      return false
    }

    const response = await fetch('/api/customer-portal-users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerId,
        contactId,
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
      }),
    })

    const payload = (await response.json()) as { error?: string; message?: string }

    if (!response.ok) {
      setError(payload.error || 'Nepodařilo se vytvořit nebo odeslat portálový přístup.')
      return false
    }

    setSuccessMessage(
      payload.message || 'E-mail pro nastavení nebo změnu hesla byl úspěšně odeslán.'
    )
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccessMessage(null)

    const updateResponse = await updateCustomerContactAction({
      customerId,
      contactId,
      fullName,
      role,
      phone,
      email,
      note,
    })

    if (!updateResponse.ok) {
      setError(updateResponse.error)
      setSaving(false)
      return
    }

    if (sendPortalInvite) {
      const inviteOk = await sendPortalAccessInvite()
      if (!inviteOk) {
        setSaving(false)
        return
      }
    }

    router.push(`/customers/${customerId}`)
    router.refresh()
  }

  async function handleManualInvite() {
    setPortalSending(true)
    setError(null)
    setSuccessMessage(null)
    await sendPortalAccessInvite()
    setPortalSending(false)
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
          {dictionary.customers.contactEdit.backToCustomer}
        </Link>

        <section style={sectionStyle}>
          <h1 style={{ fontSize: '36px', marginBottom: '12px' }}>
            {dictionary.customers.contactEdit.title}
          </h1>
          <p style={{ color: '#4b5563' }}>{dictionary.customers.contactEdit.subtitle}</p>
        </section>

        <form onSubmit={handleSubmit} style={sectionStyle}>
          {loading ? (
            <div style={{ color: '#6b7280' }}>{dictionary.customers.contactEdit.loading}</div>
          ) : (
            <>
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
                <input value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle} />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>{dictionary.customers.contactNew.phoneLabel}</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
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
                <input value={note} onChange={(e) => setNote(e.target.value)} style={inputStyle} />
              </div>

              <div
                style={{
                  marginBottom: '16px',
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
                    checked={sendPortalInvite}
                    onChange={(e) => setSendPortalInvite(e.target.checked)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>
                    <strong>Po uložení odeslat přístup do zákaznického portálu</strong>
                    <br />
                    <span style={{ color: '#4b5563' }}>
                      Zákazník dostane e-mail, přes který si nastaví nové heslo nebo si ho změní.
                    </span>
                  </span>
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <button
                  type="button"
                  onClick={() => void handleManualInvite()}
                  disabled={portalSending || saving}
                  style={{
                    backgroundColor: '#ffffff',
                    color: '#111827',
                    padding: '12px 18px',
                    borderRadius: '12px',
                    border: '1px solid #d1d5db',
                    fontWeight: 700,
                    cursor: portalSending || saving ? 'default' : 'pointer',
                  }}
                >
                  {portalSending
                    ? 'Odesílám e-mail...'
                    : 'Odeslat / znovu odeslat přístup do portálu'}
                </button>
              </div>

              {successMessage ? (
                <div style={{ color: '#166534', marginBottom: '12px' }}>{successMessage}</div>
              ) : null}
              {error ? <div style={{ color: 'red', marginBottom: '12px' }}>{error}</div> : null}

              <button
                type="submit"
                disabled={saving}
                style={{
                  backgroundColor: '#000',
                  color: '#fff',
                  padding: '12px 18px',
                  borderRadius: '12px',
                  fontWeight: 700,
                }}
              >
                {saving
                  ? sendPortalInvite
                    ? 'Ukládám a odesílám přístup...'
                    : dictionary.customers.contactEdit.saving
                  : dictionary.customers.contactEdit.saveChanges}
              </button>
            </>
          )}
        </form>
      </main>
    </DashboardShell>
  )
}
