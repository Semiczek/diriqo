'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createQuoteFromCalculationAction } from '@/app/business-actions'

type CalculationItemForQuote = {
  sortOrder: number
  name: string
  description: string | null
  quantity: number
  unit: string | null
  unitPrice: number
  vatRate: number
  totalPrice: number
  note: string | null
}

type CreateQuoteFromCalculationButtonProps = {
  calculationId: string
  customerId: string | null
  companyId: string
  title: string
  internalNote: string | null
  subtotalPrice: number
  totalPrice: number
  currency: string
  items: CalculationItemForQuote[]
}

export default function CreateQuoteFromCalculationButton({ calculationId, customerId }: CreateQuoteFromCalculationButtonProps) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  async function handleCreateQuote() {
    if (creating) return
    setCreating(true)

    try {
      const result = await createQuoteFromCalculationAction({ calculationId })
      if (!result.ok) throw new Error(result.error)

      router.push(
        customerId
          ? `/customers/${customerId}/quotes/${result.data.quoteId}`
          : `/cenove-nabidky/${result.data.quoteId}`,
      )
      router.refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nepodařilo se vytvořit cenovou nabídku.'
      alert(message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCreateQuote}
      disabled={creating}
      style={{
        display: 'inline-block',
        backgroundColor: '#000000',
        color: '#ffffff',
        border: 'none',
        textDecoration: 'none',
        fontWeight: '700',
        fontSize: '14px',
        padding: '10px 14px',
        borderRadius: '12px',
        whiteSpace: 'nowrap',
        cursor: creating ? 'not-allowed' : 'pointer',
        opacity: creating ? 0.7 : 1,
      }}
    >
      {creating ? 'Vytvářím nabídku...' : 'Vytvořit cenovou nabídku'}
    </button>
  )
}
