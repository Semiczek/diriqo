'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCalculationAction } from '@/app/kalkulace/actions'

type CalculationDangerZoneProps = {
  calculationId: string
  backHref: string
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

export default function CalculationDangerZone({
  calculationId,
  backHref,
}: CalculationDangerZoneProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function handleDeleteCalculation() {
    const confirmed = window.confirm(
      'Opravdu smazat tuto kalkulaci? Tato akce smaže i všechny její položky.'
    )

    if (!confirmed) return

    try {
      setIsDeleting(true)
      setErrorMessage(null)

      const result = await deleteCalculationAction(calculationId)

      if (!result.ok) {
        throw new Error(result.error)
      }

      router.push(backHref)
      router.refresh()
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, 'Nepodařilo se smazat kalkulaci.'))
      setIsDeleting(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: '1px solid #fecaca',
        borderRadius: 12,
        background: '#fff5f5',
      }}
    >
      <h3
        style={{
          margin: '0 0 12px 0',
          fontSize: 18,
          fontWeight: 700,
          color: '#991b1b',
        }}
      >
        Nebezpečná zóna
      </h3>

      <p
        style={{
          margin: '0 0 16px 0',
          fontSize: 14,
          color: '#7f1d1d',
          lineHeight: 1.5,
        }}
      >
        Smazání kalkulace odstraní i všechny navázané položky kalkulace. Tuto akci nejde vrátit zpět.
      </p>

      <button
        type="button"
        onClick={handleDeleteCalculation}
        disabled={isDeleting}
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid #dc2626',
          background: '#dc2626',
          color: '#ffffff',
          cursor: isDeleting ? 'not-allowed' : 'pointer',
          fontWeight: 700,
        }}
      >
        {isDeleting ? 'Mažu kalkulaci...' : 'Smazat kalkulaci'}
      </button>

      {errorMessage && (
        <p
          style={{
            marginTop: 12,
            marginBottom: 0,
            fontSize: 14,
            color: '#b91c1c',
            fontWeight: 600,
          }}
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}
