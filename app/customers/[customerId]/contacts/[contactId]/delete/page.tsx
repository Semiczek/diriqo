'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { deleteCustomerContactAction } from '../../actions'

export default function DeleteCustomerContactPage() {
  const router = useRouter()
  const params = useParams()
  const { dictionary } = useI18n()

  const customerId = params.customerId as string
  const contactId = params.contactId as string

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)

    const deleteResponse = await deleteCustomerContactAction({ customerId, contactId })

    if (!deleteResponse.ok) {
      setError(deleteResponse.error)
      setLoading(false)
      return
    }

    router.push(`/customers/${customerId}`)
    router.refresh()
  }

  return (
    <DashboardShell activeItem="customers">
      <main
        style={{
          maxWidth: '720px',
          fontFamily: 'Arial, Helvetica, sans-serif',
          color: '#111827',
        }}
      >
        <Link
          href={`/customers/${customerId}`}
          style={{
            display: 'inline-block',
            marginBottom: '24px',
            color: '#2563eb',
            textDecoration: 'none',
            fontWeight: '600',
          }}
        >
          {dictionary.customers.contactDelete.backToCustomer}
        </Link>

        <section
          style={{
            padding: '24px',
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
          }}
        >
          <h1
            style={{
              margin: '0 0 12px 0',
              fontSize: '32px',
              color: '#111827',
            }}
          >
            {dictionary.customers.contactDelete.title}
          </h1>

          <p style={{ marginBottom: '20px', color: '#4b5563', lineHeight: 1.6 }}>
            {dictionary.customers.contactDelete.description}
          </p>

          {error ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                marginBottom: '16px',
              }}
            >
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={handleDelete}
              disabled={loading}
              style={{
                backgroundColor: '#b91c1c',
                color: '#ffffff',
                border: 'none',
                padding: '12px 16px',
                borderRadius: '12px',
                fontWeight: '700',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? dictionary.customers.contactDelete.deleting : dictionary.customers.contactDelete.confirmDelete}
            </button>

            <Link
              href={`/customers/${customerId}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px 16px',
                borderRadius: '12px',
                textDecoration: 'none',
                border: '1px solid #d1d5db',
                color: '#111827',
                backgroundColor: '#ffffff',
                fontWeight: '600',
              }}
            >
              {dictionary.customers.contactDelete.cancel}
            </Link>
          </div>
        </section>
      </main>
    </DashboardShell>
  )
}
