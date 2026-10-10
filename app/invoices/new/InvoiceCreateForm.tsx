'use client'

import { createContext, startTransition, useActionState, useContext, useState, type FormEvent, type ReactNode } from 'react'

import { alertSurface, panelSurface } from '@/components/ui/styles'
import { createInvoiceDraftAction } from '../actions'

type PreviewJob = { id: string; price: number }
type Props = {
  children: ReactNode
  companyId: string
  requestId: string
  availableJobs: PreviewJob[]
  isVatPayer: boolean
  defaultVatRate: number
}

const VatRateContext = createContext<number | null>(null)
const currencyFormatter = new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' })

function previewItem(price: number, vatRate: number) {
  const subtotal = Math.round(price * 100)
  const vat = Math.round(subtotal * vatRate / 100)
  return { subtotal, vat, total: subtotal + vat }
}

/** Display only. The database loads job prices again when creating the draft. */
export function InvoiceCreateItemTotal({ price }: { price: number }) {
  const vatRate = useContext(VatRateContext)
  return vatRate === null ? '—' : currencyFormatter.format(previewItem(price, vatRate).total / 100)
}

export default function InvoiceCreateForm({ children, companyId, requestId, availableJobs, isVatPayer, defaultVatRate }: Props) {
  const [state, formAction, pending] = useActionState(createInvoiceDraftAction, { error: null })
  // Preserve the attempt identifier through action errors and retries.
  const [stableRequestId] = useState(requestId)
  const [selection, setSelection] = useState(() => ({
    jobIds: availableJobs.map((job) => job.id),
    vatRate: (isVatPayer ? defaultVatRate : 0) as number | null,
  }))
  const selectedIds = new Set(selection.jobIds)
  const selectedJobs = availableJobs.filter((job) => selectedIds.has(job.id))
  const totals = selectedJobs.reduce((sum, job) => {
    const item = previewItem(job.price, selection.vatRate ?? 0)
    return { subtotal: sum.subtotal + item.subtotal, vat: sum.vat + item.vat, total: sum.total + item.total }
  }, { subtotal: 0, vat: 0, total: 0 })
  const cannotSubmit = pending || selectedJobs.length === 0 || selection.vatRate === null

  function updatePreview(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget)
    const value = String(data.get('vatRate') ?? '').trim()
    const rate = Number(value.replace(',', '.'))
    setSelection({
      jobIds: data.getAll('jobIds').filter((id): id is string => typeof id === 'string'),
      vatRate: !isVatPayer ? 0 : value && Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : null,
    })
  }

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (cannotSubmit) return
    // Capture enabled fields before pending disables them. Dispatching explicitly also
    // keeps React's native form-action reset from discarding values after a returned error.
    const data = new FormData(event.currentTarget)
    startTransition(() => formAction(data))
  }

  return (
    <form
      method="post"
      onSubmit={submitDraft}
      onChange={updatePreview}
      aria-busy={pending}
      className="invoice-create-form"
      style={{ display: 'grid', gap: '16px' }}
    >
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="requestId" value={stableRequestId} />
      {state.error ? (
        <div role="alert" style={{ ...alertSurface, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b' }}>
          {state.error}
        </div>
      ) : null}
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: '16px' }}>
        <VatRateContext.Provider value={selection.vatRate}>
          {children}
        </VatRateContext.Provider>
        <section style={{ ...panelSurface, padding: '16px', display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'grid', gap: '4px' }} aria-live="polite" aria-atomic="true">
            <strong>Součet vybraných zakázek v náhledu ({selectedJobs.length})</strong>
            <span style={{ color: '#6b7280' }}>
              {selection.vatRate === null ? 'Vyplňte platnou sazbu DPH od 0 do 100 %.' : (
                <>Bez DPH {currencyFormatter.format(totals.subtotal / 100)} | DPH {selection.vatRate}% {currencyFormatter.format(totals.vat / 100)} | Celkem {currencyFormatter.format(totals.total / 100)}</>
              )}
            </span>
            <span style={{ color: '#6b7280', fontSize: '13px' }}>Ceny se při vytvoření znovu ověří.</span>
          </div>
          <button
            type="submit"
            disabled={cannotSubmit}
            style={{ borderRadius: '14px', border: 'none', backgroundColor: cannotSubmit ? '#9ca3af' : '#111827', color: '#ffffff', minHeight: '50px', padding: '12px 18px', fontWeight: 900, cursor: cannotSubmit ? 'default' : 'pointer' }}
          >
            {pending ? 'Vytvářím fakturu…' : 'Vytvořit fakturu'}
          </button>
        </section>
      </fieldset>
      <div role="status" aria-live="polite">{pending ? 'Ukládám návrh faktury. Vyčkejte prosím.' : ''}</div>
    </form>
  )
}
