'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { deleteCustomerAction } from './actions'

export default function DeleteCustomerPage() {
  const params = useParams()
  const router = useRouter()
  const { dictionary } = useI18n()
  const customerId = params.customerId as string

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)

    try {
      const result = await deleteCustomerAction(customerId)

      if (!result.ok) {
        setError(result.error)
        setLoading(false)
        return
      }

      router.push('/customers')
    } catch (err) {
      setError(err instanceof Error ? err.message : dictionary.customers.customerDelete.unexpectedError)
      setLoading(false)
    }
  }

  return (
    <DashboardShell activeItem="customers">
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 800, marginBottom: '16px' }}>
          {dictionary.customers.customerDelete.title}
        </h1>

        <div style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: '16px', padding: '20px' }}>
          <p style={{ marginBottom: '16px', color: '#991b1b' }}>
            {dictionary.customers.customerDelete.description}
          </p>

          {error ? (
            <div style={{ marginBottom: '16px', padding: '10px', borderRadius: '10px', background: '#fef2f2', color: '#b91c1c' }}>
              {error}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={handleDelete}
              disabled={loading}
              style={{ padding: '12px 16px', borderRadius: '12px', border: 'none', background: loading ? '#9ca3af' : '#dc2626', color: '#fff', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}
            >
              {loading ? dictionary.customers.customerDelete.deleting : dictionary.customers.customerDelete.confirmDelete}
            </button>

            <Link
              href={`/customers/${customerId}`}
              style={{ padding: '12px 16px', borderRadius: '12px', border: '1px solid #d1d5db', textDecoration: 'none', color: '#111827', fontWeight: 600 }}
            >
              {dictionary.customers.customerDelete.cancel}
            </Link>
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
