'use client'

import { createContext, startTransition, useActionState, useContext, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'

import type { InvoiceDraftActionState } from '@/app/invoices/actions'

type Props = {
  action: (state: InvoiceDraftActionState, formData: FormData) => Promise<InvoiceDraftActionState>
  companyId: string
  invoiceId: string
  revision: string
  itemIds: string[]
  label: string
  pendingLabel: string
  children?: ReactNode
  style?: CSSProperties
  danger?: boolean
}

type DraftCoordinator = { busy: boolean; begin: () => boolean; finish: () => void }
const DraftCoordinatorContext = createContext<DraftCoordinator | null>(null)

/** One immediate gate covers the revision-aware invoice actions, including queued clicks. */
export function InvoiceDraftActionsProvider({ children }: { children: ReactNode }) {
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const coordinator: DraftCoordinator = {
    busy,
    begin() {
      if (active.current) return false
      active.current = true
      setBusy(true)
      return true
    },
    finish() {
      active.current = false
      setBusy(false)
    },
  }
  return <DraftCoordinatorContext.Provider value={coordinator}>{children}</DraftCoordinatorContext.Provider>
}

/** Explicit dispatch preserves uncontrolled input values after a returned error. */
export default function InvoiceDraftForm({ action, companyId, invoiceId, revision, itemIds, label, pendingLabel, children, style, danger = false }: Props) {
  const coordinatorValue = useContext(DraftCoordinatorContext)
  if (!coordinatorValue) throw new Error('InvoiceDraftForm requires InvoiceDraftActionsProvider')
  const coordinator = coordinatorValue
  const [state, dispatch, pending] = useActionState(async (previous: InvoiceDraftActionState, data: FormData) => {
    try { return await action(previous, data) } finally { coordinator.finish() }
  }, { error: null, reloadRequired: false })

  const blocked = coordinator.busy || pending

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (blocked || state.reloadRequired) return
    const data = new FormData(event.currentTarget)
    if (!coordinator.begin()) return
    startTransition(() => dispatch(data))
  }

  return (
    <form method="post" onSubmit={submit} aria-busy={blocked} style={style}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="revision" value={revision} />
      {itemIds.map((id) => <input key={id} type="hidden" name="itemIds" value={id} />)}
      <fieldset disabled={blocked} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'grid', gap: children ? '18px' : 0 }}>
        {children}
        {state.error ? (
          <div role="alert" style={{ padding: '12px', marginBottom: '12px', border: '1px solid #fecaca', borderRadius: '8px', backgroundColor: '#fef2f2', color: '#991b1b' }}>
            <p style={{ margin: 0 }}>{state.error}</p>
            {state.reloadRequired ? (
              <>
                <p style={{ margin: '8px 0', fontSize: '13px' }}>Před načtením si zkopírujte rozepsané změny, které chcete zachovat.</p>
                <a href={`/invoices/${invoiceId}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', color: '#6d28d9', marginRight: '12px', marginBottom: '8px' }}>Otevřít aktuální fakturu vedle</a>
                <button type="button" onClick={() => window.location.reload()} style={{ color: '#6d28d9', background: 'white', border: '1px solid #c4b5fd', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer' }}>Načíst aktuální fakturu</button>
              </>
            ) : null}
          </div>
        ) : null}
        <button type="submit" disabled={blocked || state.reloadRequired} style={{ justifySelf: 'start', borderRadius: '8px', border: danger ? '1px solid #fecaca' : '1px solid #c4b5fd', backgroundColor: danger ? '#fef2f2' : '#6d28d9', color: danger ? '#991b1b' : '#ffffff', padding: '10px 14px', fontWeight: 800, cursor: blocked || state.reloadRequired ? 'default' : 'pointer', opacity: blocked || state.reloadRequired ? 0.6 : 1 }}>
          {pending ? pendingLabel : label}
        </button>
      </fieldset>
      <span role="status" aria-live="polite">{pending ? pendingLabel : ''}</span>
    </form>
  )
}
