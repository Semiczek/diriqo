'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { supabase } from '@/lib/supabase'

export default function DeleteJobCustomerContactPage() {
  const params = useParams()
  const router = useRouter()

  const jobId = params.jobId as string
  const jobCustomerContactId = params.jobCustomerContactId as string

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)

    const { error } = await supabase
      .from('job_customer_contacts')
      .delete()
      .eq('id', jobCustomerContactId)
      .eq('job_id', jobId)

    if (error) {
      setError(error.message || 'Nepodařilo se odebrat kontakt.')
      setLoading(false)
      return
    }

    router.push(`/jobs/${jobId}`)
  }

  return (
    <DashboardShell activeItem="jobs">
      <main
        style={{
          maxWidth: '720px',
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
            Odebrat kontakt ze zakázky
          </h1>

          <p style={{ marginBottom: '20px', color: '#4b5563', lineHeight: 1.6 }}>
            Opravdu chceš odebrat tento kontakt z této zakázky? Tato akce odstraní jen vazbu na
            zakázku, ne samotný kontakt zákazníka.
          </p>

          {error && (
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
          )}

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
              {loading ? 'Odebírám...' : 'Ano, odebrat'}
            </button>

            <Link
              href={`/jobs/${jobId}`}
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
              Zrušit
            </Link>
          </div>
        </section>
      </main>
    </DashboardShell>
  )
}