'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import type { LegalDocumentType } from '@/lib/legal-documents'

type PendingLegalDocument = {
  type: LegalDocumentType
  title: string
  version: string
  publishedAt: string
}

type LegalStatusPayload = {
  storageAvailable?: boolean
  requiresAcceptance?: boolean
  pending?: PendingLegalDocument[]
}

export default function LegalConsentGate() {
  const pathname = usePathname()
  const router = useRouter()
  const [pending, setPending] = useState<PendingLegalDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLegalPage = pathname === '/settings/legal' || pathname === '/legal'

  useEffect(() => {
    let cancelled = false

    async function loadLegalStatus() {
      try {
        const response = await fetch('/api/legal/status', { cache: 'no-store' })
        if (!response.ok) return

        const payload = (await response.json()) as LegalStatusPayload
        if (cancelled || payload.storageAvailable === false) return

        setPending(payload.pending ?? [])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadLegalStatus()

    return () => {
      cancelled = true
    }
  }, [])

  async function acceptDocuments() {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/legal/accept', { method: 'POST' })

      if (!response.ok) {
        setError('Souhlas se nepodařilo uložit. Otevřete prosím legal centrum a zkuste to znovu.')
        return
      }

      setPending([])
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || isLegalPage || pending.length === 0) {
    return null
  }

  const primaryDocument = pending[0]

  return (
    <div className="legal-gate" role="dialog" aria-modal="true" aria-labelledby="legal-gate-title">
      <div className="legal-gate-panel">
        <p className="legal-gate-eyebrow">Legal update</p>
        <h2 id="legal-gate-title">Aktualizovali jsme podmínky používání</h2>
        <p>
          Před dalším používáním aplikace je potřeba potvrdit aktuální verzi dokumentů. Díky tomu zůstává evidence
          souhlasů auditovatelná pro vaši firmu i provozovatele.
        </p>

        <div className="legal-gate-list">
          {pending.map((document) => (
            <div key={`${document.type}-${document.version}`}>
              <strong>{document.title}</strong>
              <span>Verze {document.version}</span>
            </div>
          ))}
        </div>

        {error ? <div className="legal-gate-error">{error}</div> : null}

        <div className="legal-gate-actions">
          <Link href={`/settings/legal?doc=${primaryDocument.type}`}>Přečíst změny</Link>
          <button type="button" onClick={acceptDocuments} disabled={submitting}>
            {submitting ? 'Ukládám...' : 'Souhlasím'}
          </button>
        </div>
      </div>

      <style>{`
        .legal-gate {
          position: fixed;
          inset: 0;
          z-index: 5000;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(2, 6, 23, 0.62);
          backdrop-filter: blur(12px);
        }

        .legal-gate-panel {
          width: min(100%, 560px);
          border-radius: 8px;
          border: 1px solid rgba(226, 232, 240, 0.82);
          background: #ffffff;
          box-shadow: 0 34px 90px rgba(2, 6, 23, 0.28);
          padding: 24px;
          color: #0f172a;
        }

        .legal-gate-eyebrow {
          margin: 0 0 8px;
          color: #2563eb;
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .legal-gate h2 {
          margin: 0;
          font-size: 26px;
          line-height: 1.15;
        }

        .legal-gate p {
          color: #475569;
          line-height: 1.65;
          font-weight: 650;
        }

        .legal-gate-list {
          display: grid;
          gap: 8px;
          margin: 18px 0;
        }

        .legal-gate-list div {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 12px;
          background: #f8fafc;
          font-size: 14px;
        }

        .legal-gate-list span {
          color: #64748b;
          font-weight: 800;
        }

        .legal-gate-error {
          margin-bottom: 12px;
          border: 1px solid #fecaca;
          border-radius: 8px;
          background: #fef2f2;
          color: #991b1b;
          padding: 10px 12px;
          font-size: 14px;
          font-weight: 750;
        }

        .legal-gate-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }

        .legal-gate-actions a,
        .legal-gate-actions button {
          min-height: 42px;
          border-radius: 8px;
          padding: 0 15px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 850;
        }

        .legal-gate-actions a {
          border: 1px solid #cbd5e1;
          color: #334155;
          text-decoration: none;
          background: #ffffff;
        }

        .legal-gate-actions button {
          border: 0;
          color: #ffffff;
          background: #0f172a;
          cursor: pointer;
        }

        .legal-gate-actions button:disabled {
          opacity: 0.68;
          cursor: wait;
        }
      `}</style>
    </div>
  )
}
