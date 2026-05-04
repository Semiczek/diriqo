'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { supabase } from '@/lib/supabase'

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

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    setSaving(true)
    setError(null)

    const { error } = await supabase
      .from('customer_contacts')
      .update({
        full_name: fullName.trim() || null,
        role: role.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        note: note.trim() || null,
      })
      .eq('id', contactId)
      .eq('customer_id', customerId)

    if (error) {
      setError(dictionary.customers.contactEdit.saveFailed)
      setSaving(false)
      return
    }

    router.push(`/customers/${customerId}`)
    router.refresh()
  }

  return (
    <DashboardShell activeItem="customers">
      <div
        style={{
          maxWidth: 720,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 32,
              fontWeight: 700,
              color: '#111827',
            }}
          >
            {dictionary.customers.contactEdit.title}
          </h1>

          <p
            style={{
              margin: 0,
              fontSize: 16,
              color: '#6b7280',
            }}
          >
            {dictionary.customers.contactEdit.subtitle}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link
            href={`/customers/${customerId}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 14px',
              borderRadius: 10,
              textDecoration: 'none',
              border: '1px solid #d1d5db',
              color: '#111827',
              background: '#ffffff',
              fontWeight: 600,
            }}
          >
            {dictionary.customers.contactEdit.backToCustomer}
          </Link>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            background: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: 16,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
        >
          {loading ? (
            <div style={{ color: '#6b7280' }}>{dictionary.customers.contactEdit.loading}</div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="full_name"
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: '#111827',
                  }}
                >
                  {dictionary.customers.contactEdit.fullName}
                </label>
                <input
                  id="full_name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={dictionary.customers.contactEdit.fullNamePlaceholder}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="role"
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: '#111827',
                  }}
                >
                  {dictionary.customers.contactEdit.roleLabel}
                </label>
                <input
                  id="role"
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder={dictionary.customers.contactEdit.rolePlaceholder}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="phone"
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: '#111827',
                  }}
                >
                  {dictionary.customers.contactEdit.phoneLabel}
                </label>
                <input
                  id="phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={dictionary.customers.contactEdit.phonePlaceholder}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: '#111827',
                  }}
                >
                  {dictionary.customers.contactEdit.emailLabel}
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={dictionary.customers.contactEdit.emailPlaceholder}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="note"
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 600,
                    marginBottom: 6,
                    color: '#111827',
                  }}
                >
                  {dictionary.customers.contactEdit.noteLabel}
                </label>
                <textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={dictionary.customers.contactEdit.notePlaceholder}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </div>

              {error ? (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    fontSize: 14,
                  }}
                >
                  {error}
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 10,
                    border: 'none',
                    background: '#111827',
                    color: '#ffffff',
                    fontWeight: 700,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving
                    ? dictionary.customers.contactEdit.saving
                    : dictionary.customers.contactEdit.saveChanges}
                </button>

                <Link
                  href={`/customers/${customerId}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '12px 16px',
                    borderRadius: 10,
                    textDecoration: 'none',
                    border: '1px solid #d1d5db',
                    color: '#111827',
                    background: '#ffffff',
                    fontWeight: 600,
                  }}
                >
                  {dictionary.customers.contactEdit.cancel}
                </Link>
              </div>
            </>
          )}
        </form>
      </div>
    </DashboardShell>
  )
}
