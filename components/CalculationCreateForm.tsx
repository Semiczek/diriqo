'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react'
import { createCalculationAction, updateCalculationAction } from '@/app/business-actions'
import { useI18n } from '@/components/I18nProvider'
import { parseCoreCalculationSave, previewCoreCalculationItems, type CoreCalculationSaveReceipt } from '@/lib/core-calculation-save'
import {
  CALCULATION_STORAGE_ERROR, calculationPayloadItems, calculationReceiptMatches, calculationSaveStorageKey,
  emptyCalculationItem, formatCalculationMoney, readPendingCalculationSave,
  type CalculationDraftItem, type CalculationSaveScope, type PendingCalculationSave,
} from './calculation-save-state'

export type CalculationFormItemInput = {
  itemType: string | null; name: string; description: string | null; quantity: number | string | null
  unit: string | null; unitCost: number | string | null; unitPrice: number | string | null
  vatRate: number | string | null; note: string | null
}
export type CalculationFormInitialValues = {
  title: string; description: string; status: 'draft' | 'ready'; calculationDate: string
  internalNote: string; currency: string | null; items: CalculationFormItemInput[]
}
type Props = {
  customerId?: string | null; companyId: string; profileId: string; customerName: string; cancelHref: string
  detailHrefBase?: string; initialTitle?: string; initialDescription?: string; initialInternalNote?: string
  edit?: { calculationId: string; expectedRevision: string; detailHref: string; initialValues: CalculationFormInitialValues }
}
type FormValues = Omit<CalculationFormInitialValues, 'items'> & { items: CalculationDraftItem[] }
const inputStyle: CSSProperties = { padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', minWidth: 0, width: '100%', boxSizing: 'border-box' }
const sectionStyle: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: '16px', backgroundColor: '#ffffff', padding: '20px', display: 'grid', gap: '16px' }
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }
const buttonStyle: CSSProperties = { padding: '10px 14px', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#ffffff', fontWeight: 700, cursor: 'pointer' }
const warningStyle: CSSProperties = { padding: '14px 16px', borderRadius: '12px', border: '1px solid #fcd34d', backgroundColor: '#fffbeb', color: '#92400e' }
const subscribeHydration = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false
const itemTypes = ['customer', 'labor', 'material', 'rental', 'transport', 'accommodation'] as const
const decimalText = (value: number | string | null) => value == null ? '' : String(value)
function initialForm(props: Props): FormValues {
  if (props.edit) return { ...props.edit.initialValues, items: props.edit.initialValues.items.map((item, index) => ({
    id: 'existing-' + index, persisted: true, itemType: item.itemType ?? '', name: item.name,
    description: item.description ?? '', quantity: decimalText(item.quantity), unit: item.unit ?? '',
    unitCost: decimalText(item.unitCost), unitPrice: decimalText(item.unitPrice), vatRate: decimalText(item.vatRate), note: item.note ?? '',
  })) }
  return { title: props.initialTitle ?? '', description: props.initialDescription ?? '', status: 'draft',
    calculationDate: new Date().toISOString().slice(0, 10), internalNote: props.initialInternalNote ?? '', currency: 'CZK',
    items: [emptyCalculationItem('customer', 'new-customer'), emptyCalculationItem('material', 'new-cost')] }
}
function restoredForm(pending: PendingCalculationSave): FormValues {
  return { ...pending.payload, description: pending.payload.description ?? '', internalNote: pending.payload.internalNote ?? '',
    items: pending.payload.items.map((item, index) => ({ ...item, id: 'pending-' + index, persisted: true,
      description: item.description ?? '', unit: item.unit ?? '', note: item.note ?? '' })) }
}

export default function CalculationCreateForm(props: Props) {
  const router = useRouter()
  const { dictionary } = useI18n()
  const labels = dictionary.customers.calculationForm
  const [scope] = useState<CalculationSaveScope>(() => ({ companyId: props.companyId, profileId: props.profileId,
    customerId: props.customerId ?? null, ...(props.edit ? { calculationId: props.edit.calculationId } : {}) }))
  const key = calculationSaveStorageKey(scope)
  const currentKey = calculationSaveStorageKey({ companyId: props.companyId, profileId: props.profileId,
    customerId: props.customerId ?? null, ...(props.edit ? { calculationId: props.edit.calculationId } : {}) })
  const currentCustomer = props.customerId ?? null
  const scopeIdentity = key + '|' + scope.customerId
  const currentIdentity = currentKey + '|' + currentCustomer
  const currentScope = useRef(currentIdentity)
  useLayoutEffect(() => { currentScope.current = currentIdentity }, [currentIdentity])
  const initialized = useSyncExternalStore(subscribeHydration, clientSnapshot, serverSnapshot)
  const [restoration] = useState(() => {
    if (typeof window === 'undefined') return { pending: null, error: null }
    try { return { pending: readPendingCalculationSave(window.sessionStorage.getItem(key), scope), error: null } }
    catch (reason) { return { pending: null, error: reason instanceof Error ? reason.message : CALCULATION_STORAGE_ERROR } }
  })
  const alive = useRef(false)
  const inFlight = useRef(false)
  const blocked = useRef(Boolean(restoration.error))
  const confirmedRef = useRef<CoreCalculationSaveReceipt | null>(restoration.pending?.receipt ?? null)
  const pendingRef = useRef<PendingCalculationSave | null>(restoration.pending)
  const [values, setValues] = useState(() => restoration.pending ? restoredForm(restoration.pending) : initialForm(props))
  // A refresh may replace props while retaining the user's unsaved values. Keep their original revision together.
  const [initialRevision] = useState(() => props.edit?.expectedRevision)
  const [pending, setPending] = useState<PendingCalculationSave | null>(restoration.pending)
  const [storageError, setStorageError] = useState<string | null>(restoration.error)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmed, setConfirmed] = useState<CoreCalculationSaveReceipt | null>(restoration.pending?.receipt ?? null)
  const [detailAvailable, setDetailAvailable] = useState(false)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const scopeChanged = currentIdentity !== scopeIdentity
  const locked = !initialized || saving || Boolean(pending) || Boolean(storageError) || Boolean(confirmed) || scopeChanged
  const update = <K extends keyof FormValues>(field: K, value: FormValues[K]) => setValues(old => ({ ...old, [field]: value }))
  const updateItem = (id: string, field: keyof CalculationDraftItem, value: string) => setValues(old => ({ ...old,
    items: old.items.map(item => item.id === id ? { ...item, [field]: value } : item) }))
  const typeLabels: Record<string, string> = { customer: labels.customerItem, labor: labels.typeLabor, material: labels.typeMaterial,
    rental: labels.typeRental, transport: labels.typeTransport, accommodation: labels.typeAccommodation }
  const typeLabel = (type: string) => typeLabels[type] ?? 'Neznámý původní typ — vyberte'
  let preview: ReturnType<typeof previewCoreCalculationItems> | null = null
  try { if (values.currency === 'CZK') preview = previewCoreCalculationItems(calculationPayloadItems(values.items)) } catch { /* Incomplete fields never display fabricated zero totals. */ }
  const detailHref = (receipt: CoreCalculationSaveReceipt) => props.edit?.detailHref ?? (props.detailHrefBase
    ? props.detailHrefBase + '/' + receipt.calculationId
    : scope.customerId ? '/customers/' + scope.customerId + '/calculations/' + receipt.calculationId : '/kalkulace/' + receipt.calculationId)
  const stillHere = () => alive.current && currentScope.current === scopeIdentity

  async function openConfirmed(receipt: CoreCalculationSaveReceipt) {
    try {
      const response = await fetch('/api/active-company', { cache: 'no-store', credentials: 'same-origin' })
      const active: unknown = response.ok ? await response.json() : null
      if (!stillHere()) return
      if (!active || typeof active !== 'object' || !('companyId' in active) || !('profileId' in active)
        || active.companyId !== scope.companyId || active.profileId !== scope.profileId) {
        setError('Kalkulace je uložená v původní firmě. Pro otevření se vraťte do této firmy a ověřte přihlášení.'); return
      }
      setError(null); setDetailAvailable(true)
      try { window.sessionStorage.removeItem(key) } catch { /* Persisted receipt is safe to restore. */ }
      router.push(detailHref(receipt)); router.refresh()
    } catch {
      if (stillHere()) setError('Kalkulace je uložená. Aktivní firmu nyní nelze ověřit; po obnovení připojení ji můžete bezpečně otevřít.')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || blocked.current || confirmedRef.current || !initialized || storageError || confirmed || scopeChanged || !stillHere()) return
    inFlight.current = true
    setSaving(true); setError(null)
    const retry = Boolean(pendingRef.current)
    try {
      let request = pendingRef.current
      if (!request) {
        const payload = parseCoreCalculationSave({ ...values, ...scope, operationId: crypto.randomUUID(),
          ...(props.edit ? { expectedRevision: initialRevision } : {}), items: calculationPayloadItems(values.items) }, props.edit ? 'update' : 'create')
        request = { version: 1, scope, payload }
        try { window.sessionStorage.setItem(key, JSON.stringify(request)) } catch {
          blocked.current = true; setStorageError(CALCULATION_STORAGE_ERROR); return
        }
        pendingRef.current = request; setPending(request)
      }
      const result = scope.calculationId
        ? await updateCalculationAction(scope.calculationId, request.payload)
        : await createCalculationAction(request.payload)
      if (!stillHere()) return
      if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') throw new Error('Uložení se nepodařilo potvrdit. Ověřte stejný požadavek.')
      if (!result.ok) {
        if (!retry && result.uncertain === false && ['validation', 'forbidden', 'conflict', 'unavailable'].includes(result.code) && typeof result.error === 'string') {
          try {
            window.sessionStorage.removeItem(key)
            pendingRef.current = null; setPending(null)
          } catch { blocked.current = true; setStorageError(CALCULATION_STORAGE_ERROR) }
        }
        setError(typeof result.error === 'string' ? result.error : 'Výsledek uložení není potvrzený. Ověřte stejný požadavek.')
        return
      }
      if (!calculationReceiptMatches(result.data, request.payload)) throw new Error('Odpověď nepotvrdila původní požadavek. Ověřte stejný požadavek.')
      confirmedRef.current = result.data; setConfirmed(result.data)
      // Keep a durable confirmed receipt until the current company/profile is verified and navigation can proceed.
      try { window.sessionStorage.setItem(key, JSON.stringify({ ...request, receipt: result.data })) } catch { /* Original pending payload remains replayable. */ }
      pendingRef.current = null; setPending(null)
      await openConfirmed(result.data)
    } catch (reason) {
      if (stillHere()) setError(reason instanceof Error ? reason.message : labels.saveFailed)
    } finally {
      inFlight.current = false
      if (stillHere()) setSaving(false)
    }
  }

  function renderItems(customerSection: boolean) {
    const items = values.items.filter(item => (item.itemType === 'customer') === customerSection)
    return <section data-tour={customerSection ? 'calculation-customer-items' : 'calculation-cost-items'} style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '22px' }}>{customerSection ? labels.customerItems : labels.internalCostItems}</h2>
        <button type="button" data-tour={customerSection ? 'calculation-add-customer-item' : 'calculation-add-cost-item'} style={buttonStyle}
          onClick={() => update('items', [...values.items, emptyCalculationItem(customerSection ? 'customer' : 'material', crypto.randomUUID())])}>
          {customerSection ? labels.addCustomerItem : labels.addCostItem}</button>
      </div>
      {items.map(item => {
        const index = values.items.indexOf(item)
        const unknown = !itemTypes.some(type => type === item.itemType)
        const opposite = customerSection ? item.unitCost : item.unitPrice
        const showBoth = unknown || !/^(?:0+(?:[.,]0{1,2})?)$/.test(opposite)
        let line: ReturnType<typeof previewCoreCalculationItems>['items'][number] | undefined
        try { if (values.currency === 'CZK') line = previewCoreCalculationItems(calculationPayloadItems([{ ...item, persisted: true }])).items[0] } catch { /* Missing historical data stays unknown. */ }
        const field = (name: 'name' | 'description' | 'quantity' | 'unit' | 'unitCost' | 'unitPrice' | 'vatRate' | 'note', label: string) => <label style={{ display: 'grid', gap: '6px', minWidth: 0 }}>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>{label}</span>
          <input id={'calculation-item-' + index + '-' + name} value={item[name]} aria-label={label}
            inputMode={['quantity', 'unitCost', 'unitPrice', 'vatRate'].includes(name) ? 'decimal' : undefined}
            placeholder={name === 'vatRate' && item.persisted && !item.vatRate ? 'Původní DPH není známá' : label}
            onChange={event => updateItem(item.id, name, event.target.value)} style={inputStyle} />
        </label>
        return <div key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: '14px', padding: '16px', display: 'grid', gap: '14px', backgroundColor: '#f9fafb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <strong>{customerSection ? labels.customerItem : labels.internalCost} · {typeLabel(item.itemType)}</strong>
            <button type="button" style={{ ...buttonStyle, color: '#991b1b', borderColor: '#fecaca', backgroundColor: '#fef2f2' }}
              onClick={() => update('items', values.items.filter(other => other.id !== item.id))}>{labels.remove}</button>
          </div>
          {(unknown || (item.persisted && !item.vatRate)) && <p role="note" style={{ ...warningStyle, margin: 0 }}>Původní typ nebo DPH této položky nejsou uložené. Před uložením je výslovně doplňte.</p>}
          {showBoth && <p style={{ margin: 0, color: '#92400e' }}>Zkontrolujte původní cenu i náklad. Zákaznická položka má náklad 0, interní položka cenu 0; hodnoty neměníme automaticky.</p>}
          <div style={gridStyle}>
            {!customerSection && <label style={{ display: 'grid', gap: '6px' }}><span style={{ fontSize: '13px', fontWeight: 700 }}>{labels.costType}</span>
              <select id={'calculation-item-' + index + '-itemType'} aria-label={labels.costType} value={item.itemType} onChange={event => updateItem(item.id, 'itemType', event.target.value)} style={inputStyle}>
                {unknown && <option value={item.itemType}>Neznámý původní typ — vyberte</option>}
                {itemTypes.map(type => <option key={type} value={type}>{typeLabel(type)}</option>)}
              </select></label>}
            {field('name', labels.itemName)}{field('description', labels.itemDescription)}
          </div>
          <div style={gridStyle}>
            {field('quantity', labels.quantity)}{field('unit', labels.unit)}
            {(customerSection || showBoth) && field('unitPrice', labels.unitPrice)}
            {(!customerSection || showBoth) && field('unitCost', labels.unitCost)}
            {field('vatRate', labels.vatRate)}
            <label style={{ display: 'grid', gap: '6px' }}><span style={{ fontSize: '13px', fontWeight: 700 }}>{customerSection ? labels.totalPrice : labels.totalCost}</span>
              <input readOnly aria-label={customerSection ? labels.totalPrice : labels.totalCost} value={formatCalculationMoney(customerSection ? line?.totalPrice : line?.totalCost)} style={{ ...inputStyle, backgroundColor: '#f3f4f6' }} /></label>
          </div>
          {field('note', labels.note)}
        </div>
      })}
    </section>
  }

  if (!initialized) return <p role="status">Načítám bezpečné uložení kalkulace…</p>

  return <form data-tour="calculation-create-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: '20px' }}>
    {(error || storageError || scopeChanged) && <div role="alert" style={{ ...warningStyle, borderColor: '#fecaca', color: '#b91c1c', backgroundColor: '#fef2f2' }}>{storageError || (scopeChanged ? 'Aktivní firma nebo přihlášení se změnily. Obnovte stránku; původní požadavek zůstává oddělený.' : error)}</div>}
    {pending && !confirmed && <p role="status" style={warningStyle}>Výsledek předchozího uložení ještě není potvrzený. Ověření znovu odešle stejný obsah a nevytvoří druhou kalkulaci.</p>}
    {confirmed && <p role="status" style={{ ...warningStyle, backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>Kalkulace je uložená. {detailAvailable && <Link href={detailHref(confirmed)}>Otevřít kalkulaci</Link>}</p>}
    <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: '20px' }}>
      <section data-tour="calculation-basic" style={sectionStyle}>
        <div style={gridStyle}>
          <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{labels.calculationTitle}</span><input id="calculation-title" data-tour="calculation-title" value={values.title} onChange={event => update('title', event.target.value)} style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{labels.date}</span><input id="calculation-date" data-tour="calculation-date" type="date" value={values.calculationDate} onChange={event => update('calculationDate', event.target.value)} style={inputStyle} /></label>
          <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{labels.status}</span><select id="calculation-status" data-tour="calculation-status" value={values.status} onChange={event => update('status', event.target.value as 'draft' | 'ready')} style={inputStyle}><option value="draft">{labels.draft}</option><option value="ready">{labels.ready}</option></select></label>
        </div>
        <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{labels.description}</span><textarea id="calculation-description" value={values.description} onChange={event => update('description', event.target.value)} rows={3} style={inputStyle} /></label>
        <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{labels.internalNote}</span><textarea id="calculation-internal-note" value={values.internalNote} onChange={event => update('internalNote', event.target.value)} rows={3} style={inputStyle} /></label>
        {values.currency !== 'CZK' && <p role="alert" style={warningStyle}>Původní měna {values.currency || 'není známá'}. Tento formulář podporuje pouze CZK; měnu při ukládání nepřevádí.</p>}
      </section>
      {renderItems(true)}{renderItems(false)}
    </fieldset>
    <section data-tour="calculation-summary" style={{ ...sectionStyle, ...gridStyle }}>
      {[[labels.customerTotal, preview?.subtotalPrice], [labels.customerVat, preview?.vatAmount], [labels.totalCosts, preview?.subtotalCost],
        [labels.costVat, preview?.costVatAmount], [labels.expectedProfit, preview?.marginAmount], [labels.laborCosts, preview?.laborCost], [labels.otherCosts, preview?.otherCost]].map(([label, amount]) =>
        <div key={label} style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}><div style={{ color: '#6b7280', marginBottom: '6px' }}>{label}</div><strong>{formatCalculationMoney(amount)}</strong></div>)}
      {!preview && <p style={{ gridColumn: '1 / -1', margin: 0, color: '#6b7280' }}>Součty se zobrazí po doplnění platných položek. Prázdné částky nejsou nula.</p>}
    </section>
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      {confirmed && !detailAvailable && <button type="button" onClick={() => void openConfirmed(confirmed)} disabled={scopeChanged} style={buttonStyle}>Ověřit firmu a otevřít uloženou kalkulaci</button>}
      <button type="submit" data-tour="calculation-save" disabled={!initialized || saving || Boolean(storageError) || Boolean(confirmed) || scopeChanged} style={{ ...buttonStyle, backgroundColor: '#000000', color: '#ffffff', opacity: saving ? 0.7 : 1 }}>
        {saving ? (props.edit ? labels.savingEdit : labels.savingNew) : pending ? 'Ověřit stejný požadavek' : props.edit ? labels.saveChanges : labels.saveCalculation}</button>
      <Link href={props.cancelHref} style={{ ...buttonStyle, color: '#111827', textDecoration: 'none' }}>{labels.cancel}</Link>
    </div>
  </form>
}
