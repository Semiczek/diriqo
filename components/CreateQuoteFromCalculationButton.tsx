'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

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
  customerId: string
  companyId: string
  title: string
  internalNote: string | null
  subtotalPrice: number
  totalPrice: number
  currency: string
  items: CalculationItemForQuote[]
}

function buildShareToken() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function buildQuoteNumber() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const randomSuffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `CN-${year}${month}${day}-${hours}${minutes}-${randomSuffix}`
}

async function resolveProfileIdForUser(authUserId: string) {
  const profileByAuth = await supabase.from('profiles').select('id').eq('auth_user_id', authUserId).maybeSingle()
  if (profileByAuth.error) throw new Error(profileByAuth.error.message)
  if (profileByAuth.data?.id) return profileByAuth.data.id
  const profileByUser = await supabase.from('profiles').select('id').eq('user_id', authUserId).maybeSingle()
  if (profileByUser.error) throw new Error(profileByUser.error.message)
  return profileByUser.data?.id ?? null
}

export default function CreateQuoteFromCalculationButton({ calculationId, customerId, companyId, title, internalNote, subtotalPrice, totalPrice, currency, items }: CreateQuoteFromCalculationButtonProps) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  async function handleCreateQuote() {
    if (creating) return
    setCreating(true)

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw new Error(sessionError.message)

      const authUserId = session?.user?.id ?? null
      let createdBy: string | null = null
      if (authUserId) createdBy = await resolveProfileIdForUser(authUserId)

      const customerItems = items.filter((item) => item.name.trim() && item.totalPrice > 0)
      if (customerItems.length === 0) throw new Error('Kalkulace nemá žádné zákaznické položky pro vytvoření cenové nabídky.')

      const quotePayload = {
        company_id: companyId,
        customer_id: customerId,
        source_calculation_id: calculationId,
        quote_number: buildQuoteNumber(),
        share_token: buildShareToken(),
        title,
        status: 'draft',
        quote_date: new Date().toISOString().slice(0, 10),
        contact_name: null,
        contact_email: null,
        intro_text: null,
        customer_request_title: 'Požadavek zákazníka',
        customer_note: null,
        internal_note: internalNote,
        customer_request: null,
        our_solution_title: 'Naše řešení',
        proposed_solution: null,
        timeline_title: 'Časový harmonogram',
        work_description: null,
        work_schedule: null,
        pricing_title: 'Cenová kalkulace',
        pricing_text: null,
        payment_terms_title: 'Platební podmínky',
        payment_terms: 'Faktura 14 dni po predani.',
        subtotal_price: subtotalPrice,
        discount_amount: 0,
        total_price: totalPrice,
        currency,
        created_by: createdBy,
      }

      const { data: quoteRow, error: quoteError } = await supabase.from('quotes').insert(quotePayload).select('id').single()
      if (quoteError || !quoteRow?.id) throw new Error(quoteError?.message ?? 'Nepodařilo se vytvořit nabídku.')

      const quoteItemsPayload = customerItems.map((item) => ({
        quote_id: quoteRow.id,
        sort_order: item.sortOrder,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unitPrice,
        vat_rate: item.vatRate,
        total_price: item.totalPrice,
        note: item.note,
      }))

      const { error: quoteItemsError } = await supabase.from('quote_items').insert(quoteItemsPayload)
      if (quoteItemsError) throw new Error(quoteItemsError.message)

      router.push(`/customers/${customerId}/quotes/${quoteRow.id}`)
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
