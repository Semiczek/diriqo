'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { LegalDocumentType } from '@/lib/legal-documents'

type PendingDocument = {
  type: LegalDocumentType
  title: string
  version: string
}

type Props = {
  pending: PendingDocument[]
  storageAvailable: boolean
}

export default function LegalAcceptanceActions({ pending, storageAvailable }: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function acceptCurrentDocuments() {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/legal/accept', {
        method: 'POST',
      })

      if (!response.ok) {
        setError('Souhlas se nepodařilo uložit. Zkuste to prosím znovu.')
        return
      }

      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  if (!storageAvailable) {
    return (
      <div className="legal-status legal-status-warning">
        Databázové tabulky pro audit souhlasů zatím nejsou dostupné. Po aplikování migrací se zde zobrazí stav souhlasů.
      </div>
    )
  }

  if (pending.length === 0) {
    return (
      <div className="legal-status legal-status-ok">
        Aktuální povinné právní dokumenty jsou potvrzené.
      </div>
    )
  }

  return (
    <div className="legal-consent-panel">
      <div>
        <h2>Vyžaduje se potvrzení</h2>
        <p>
          Pro pokračování v aplikaci potvrďte aktuální verze dokumentů:{' '}
          {pending.map((document) => `${document.title} ${document.version}`).join(', ')}.
        </p>
      </div>
      {error ? <div className="legal-status legal-status-error">{error}</div> : null}
      <button type="button" onClick={acceptCurrentDocuments} disabled={submitting}>
        {submitting ? 'Ukládám souhlas...' : 'Souhlasím s aktuálními dokumenty'}
      </button>
    </div>
  )
}
