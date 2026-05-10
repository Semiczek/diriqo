'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import DashboardShell from '@/components/DashboardShell'
import { useI18n } from '@/components/I18nProvider'
import { deleteJobCustomerContactAction } from '../../actions'

export default function DeleteJobCustomerContactPage() {
  const { dictionary, locale } = useI18n()
  const text =
    locale === 'en'
      ? {
          removeFailed: 'Failed to remove contact.',
          backToDetail: 'Back to job detail',
          title: 'Remove contact from job',
          description:
            'Do you really want to remove this contact from this job? This only removes the job link, not the customer contact itself.',
          removing: 'Removing...',
          confirm: 'Yes, remove',
        }
      : locale === 'de'
        ? {
            removeFailed: 'Kontakt konnte nicht entfernt werden.',
            backToDetail: 'Zurück zum Auftragsdetail',
            title: 'Kontakt vom Auftrag entfernen',
            description:
              'Diesen Kontakt wirklich von diesem Auftrag entfernen? Es wird nur die Verknüpfung zum Auftrag entfernt, nicht der Kundenkontakt selbst.',
            removing: 'Wird entfernt...',
            confirm: 'Ja, entfernen',
          }
        : {
            removeFailed: 'Nepodařilo se odebrat kontakt.',
            backToDetail: 'Zpět na detail zakázky',
            title: 'Odebrat kontakt ze zakázky',
            description:
              'Opravdu chceš odebrat tento kontakt z této zakázky? Tato akce odstraní jen vazbu na zakázku, ne samotný kontakt zákazníka.',
            removing: 'Odebírám...',
            confirm: 'Ano, odebrat',
          }
  const params = useParams()
  const router = useRouter()

  const jobId = params.jobId as string
  const jobCustomerContactId = params.jobCustomerContactId as string

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)

    const deleteResponse = await deleteJobCustomerContactAction({ jobId, jobCustomerContactId })
    const error = deleteResponse.ok ? null : { message: deleteResponse.error }

    if (error) {
      setError(error.message || text.removeFailed)
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
          ← {text.backToDetail}
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
            {text.title}
          </h1>

          <p style={{ marginBottom: '20px', color: '#4b5563', lineHeight: 1.6 }}>
            {text.description}
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
              {loading ? text.removing : text.confirm}
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
              {dictionary.common.cancel}
            </Link>
          </div>
        </section>
      </main>
    </DashboardShell>
  )
}
