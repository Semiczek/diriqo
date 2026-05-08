'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { updateCalculationAction } from '@/app/business-actions'
import { useI18n } from '@/components/I18nProvider'

type CostItemType = 'labor' | 'material' | 'rental' | 'transport' | 'accommodation'

type CalculationItemInput = {
  itemType: string | null
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unitCost: number | null
  unitPrice: number | null
  vatRate: number | null
  note: string | null
}

type CalculationEditFormProps = {
  calculationId: string
  customerId?: string | null
  cancelHref: string
  detailHref: string
  initialValues: {
    title: string
    description: string
    status: 'draft' | 'ready'
    calculationDate: string
    internalNote: string
    customerItems: CalculationItemInput[]
    costItems: CalculationItemInput[]
  }
}

type CustomerDraftItem = {
  id: string
  name: string
  description: string
  quantity: string
  unit: string
  unitPrice: string
  vatRate: string
  note: string
}

type CostDraftItem = {
  id: string
  itemType: CostItemType
  name: string
  description: string
  quantity: string
  unit: string
  unitCost: string
  vatRate: string
  note: string
}

function parseNumber(value: string) {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function isValidCostDraftItem(item: CostDraftItem) {
  const quantity = parseNumber(item.quantity)
  const unitCost = parseNumber(item.unitCost)
  const hasDescriptor = Boolean(item.name.trim() || item.description.trim() || item.unit.trim())

  return quantity > 0 && unitCost > 0 && hasDescriptor
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function textNumber(value: number | null | undefined, fallback = '') {
  if (value == null || Number.isNaN(Number(value))) return fallback
  return String(value).replace('.', ',')
}

function createCustomerDraftItem(item?: CalculationItemInput): CustomerDraftItem {
  return {
    id: crypto.randomUUID(),
    name: item?.name ?? '',
    description: item?.description ?? '',
    quantity: textNumber(item?.quantity, '1'),
    unit: item?.unit ?? '',
    unitPrice: textNumber(item?.unitPrice),
    vatRate: textNumber(item?.vatRate, '21'),
    note: item?.note ?? '',
  }
}

function createCostDraftItem(item?: CalculationItemInput): CostDraftItem {
  return {
    id: crypto.randomUUID(),
    itemType: (item?.itemType as CostItemType) ?? 'material',
    name: item?.name ?? '',
    description: item?.description ?? '',
    quantity: textNumber(item?.quantity, '1'),
    unit: item?.unit ?? '',
    unitCost: textNumber(item?.unitCost),
    vatRate: textNumber(item?.vatRate, '21'),
    note: item?.note ?? '',
  }
}

export default function CalculationEditForm({
  calculationId,
  customerId = null,
  cancelHref,
  detailHref,
  initialValues,
}: CalculationEditFormProps) {
  const router = useRouter()
  const { dictionary } = useI18n()
  const [title, setTitle] = useState(initialValues.title)
  const [description, setDescription] = useState(initialValues.description)
  const [status, setStatus] = useState<'draft' | 'ready'>(initialValues.status)
  const [calculationDate, setCalculationDate] = useState(initialValues.calculationDate)
  const [internalNote, setInternalNote] = useState(initialValues.internalNote)
  const [customerItems, setCustomerItems] = useState<CustomerDraftItem[]>(
    initialValues.customerItems.length
      ? initialValues.customerItems.map((item) => createCustomerDraftItem(item))
      : [createCustomerDraftItem()]
  )
  const [costItems, setCostItems] = useState<CostDraftItem[]>(
    initialValues.costItems.length
      ? initialValues.costItems.map((item) => createCostDraftItem(item))
      : [createCostDraftItem()]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const customerTotal = useMemo(
    () => customerItems.reduce((sum, item) => sum + parseNumber(item.quantity) * parseNumber(item.unitPrice), 0),
    [customerItems]
  )
  const customerVatTotal = useMemo(
    () => customerItems.reduce((sum, item) => sum + parseNumber(item.quantity) * parseNumber(item.unitPrice) * (parseNumber(item.vatRate) / 100), 0),
    [customerItems]
  )
  const totalCost = useMemo(
    () => costItems.reduce((sum, item) => sum + parseNumber(item.quantity) * parseNumber(item.unitCost), 0),
    [costItems]
  )
  const costVatTotal = useMemo(
    () => costItems.reduce((sum, item) => sum + parseNumber(item.quantity) * parseNumber(item.unitCost) * (parseNumber(item.vatRate) / 100), 0),
    [costItems]
  )
  const laborCost = useMemo(
    () => costItems.reduce((sum, item) => (item.itemType === 'labor' ? sum + parseNumber(item.quantity) * parseNumber(item.unitCost) : sum), 0),
    [costItems]
  )
  const otherCost = totalCost - laborCost
  const expectedProfit = customerTotal - totalCost

  const typeLabel = (itemType: CostItemType) => {
    if (itemType === 'labor') return dictionary.customers.calculationForm.typeLabor
    if (itemType === 'material') return dictionary.customers.calculationForm.typeMaterial
    if (itemType === 'rental') return dictionary.customers.calculationForm.typeRental
    if (itemType === 'transport') return dictionary.customers.calculationForm.typeTransport
    return dictionary.customers.calculationForm.typeAccommodation
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const validCustomerItems = customerItems.filter((item) => item.name.trim())
      const validCostItems = costItems.filter(isValidCostDraftItem)

      if (!title.trim()) throw new Error(dictionary.customers.calculationForm.titleRequired)
      if (validCustomerItems.length === 0) {
        throw new Error(dictionary.customers.calculationForm.customerItemsRequired)
      }
      if (validCostItems.length === 0) {
        throw new Error(dictionary.customers.calculationForm.costItemsRequired)
      }

      const subtotalCost = validCostItems.reduce((sum, item) => sum + parseNumber(item.quantity) * parseNumber(item.unitCost), 0)
      const subtotalPrice = validCustomerItems.reduce((sum, item) => sum + parseNumber(item.quantity) * parseNumber(item.unitPrice), 0)

      const customerPayload = validCustomerItems.map((item, index) => {
        const quantity = parseNumber(item.quantity)
        const unitPrice = parseNumber(item.unitPrice)

        return {
          sortOrder: index,
          itemType: 'customer',
          name: item.name.trim(),
          description: item.description.trim() || null,
          quantity,
          unit: item.unit.trim() || null,
          unitCost: 0,
          unitPrice,
          vatRate: parseNumber(item.vatRate),
          totalCost: 0,
          totalPrice: quantity * unitPrice,
          note: item.note.trim() || null,
        }
      })

      const costPayload = validCostItems.map((item, index) => {
        const quantity = parseNumber(item.quantity)
        const unitCost = parseNumber(item.unitCost)

        return {
          sortOrder: validCustomerItems.length + index,
          itemType: item.itemType,
          name: item.name.trim() || typeLabel(item.itemType),
          description: item.description.trim() || null,
          quantity,
          unit: item.unit.trim() || null,
          unitCost,
          unitPrice: 0,
          vatRate: parseNumber(item.vatRate),
          totalCost: quantity * unitCost,
          totalPrice: 0,
          note: item.note.trim() || null,
        }
      })

      const result = await updateCalculationAction(calculationId, {
        customerId,
        title: title.trim(),
        description: description.trim() || null,
        status,
        calculationDate,
        internalNote: internalNote.trim() || null,
        subtotalCost,
        subtotalPrice,
        marginAmount: subtotalPrice - subtotalCost,
        totalPrice: subtotalPrice,
        currency: 'CZK',
        items: [...customerPayload, ...costPayload],
      })

      if (!result.ok) throw new Error(result.error)

      router.push(detailHref)
      router.refresh()
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : dictionary.customers.calculationForm.saveFailed
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '20px' }}>
      {error ? (
        <div style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#b91c1c', fontWeight: 600 }}>
          {error}
        </div>
      ) : null}

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', backgroundColor: '#ffffff', padding: '20px', display: 'grid', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px' }}>
          <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{dictionary.customers.calculationForm.calculationTitle}</span><input value={title} onChange={(event) => setTitle(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} /></label>
          <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{dictionary.customers.calculationForm.date}</span><input type="date" value={calculationDate} onChange={(event) => setCalculationDate(event.target.value)} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} /></label>
          <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{dictionary.customers.calculationForm.status}</span><select value={status} onChange={(event) => setStatus(event.target.value as 'draft' | 'ready')} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }}><option value="draft">{dictionary.customers.calculationForm.draft}</option><option value="ready">{dictionary.customers.calculationForm.ready}</option></select></label>
        </div>
        <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{dictionary.customers.calculationForm.description}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} /></label>
        <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontWeight: 700 }}>{dictionary.customers.calculationForm.internalNote}</span><textarea value={internalNote} onChange={(event) => setInternalNote(event.target.value)} rows={3} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', resize: 'vertical' }} /></label>
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', backgroundColor: '#ffffff', padding: '20px', display: 'grid', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '22px' }}>{dictionary.customers.calculationForm.customerItems}</h2>
          <button type="button" onClick={() => setCustomerItems((current) => [...current, createCustomerDraftItem()])} style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>{dictionary.customers.calculationForm.addCustomerItem}</button>
        </div>
        {customerItems.map((item, index) => (
          <div key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: '14px', padding: '16px', display: 'grid', gap: '14px', backgroundColor: '#f9fafb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <strong>{dictionary.customers.calculationForm.customerItem} {index + 1}</strong>
              {customerItems.length > 1 ? <button type="button" onClick={() => setCustomerItems((current) => current.filter((currentItem) => currentItem.id !== item.id))} style={{ padding: '8px 12px', borderRadius: '10px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', fontWeight: 700, cursor: 'pointer' }}>{dictionary.customers.calculationForm.remove}</button> : null}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr', gap: '12px' }}>
              <input placeholder={dictionary.customers.calculationForm.itemName} value={item.name} onChange={(event) => setCustomerItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, name: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.itemDescription} value={item.description} onChange={(event) => setCustomerItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, description: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '12px' }}>
              <input placeholder={dictionary.customers.calculationForm.quantity} value={item.quantity} onChange={(event) => setCustomerItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, quantity: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.unit} value={item.unit} onChange={(event) => setCustomerItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, unit: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.unitPrice} value={item.unitPrice} onChange={(event) => setCustomerItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, unitPrice: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.vatRate} value={item.vatRate} onChange={(event) => setCustomerItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, vatRate: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.totalPrice} value={String(parseNumber(item.quantity) * parseNumber(item.unitPrice)).replace('.', ',')} readOnly style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#f3f4f6', color: '#111827' }} />
            </div>
            <input placeholder={dictionary.customers.calculationForm.note} value={item.note} onChange={(event) => setCustomerItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, note: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </div>
        ))}
      </section>

      <section style={{ border: '1px solid #e5e7eb', borderRadius: '16px', backgroundColor: '#ffffff', padding: '20px', display: 'grid', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: '22px' }}>{dictionary.customers.calculationForm.internalCostItems}</h2>
          <button type="button" onClick={() => setCostItems((current) => [...current, createCostDraftItem()])} style={{ padding: '10px 14px', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#ffffff', fontWeight: 700, cursor: 'pointer' }}>{dictionary.customers.calculationForm.addCostItem}</button>
        </div>
        {costItems.map((item, index) => (
          <div key={item.id} style={{ border: '1px solid #e5e7eb', borderRadius: '14px', padding: '16px', display: 'grid', gap: '14px', backgroundColor: '#f9fafb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <strong>{dictionary.customers.calculationForm.internalCost} {index + 1} · {typeLabel(item.itemType)}</strong>
              {costItems.length > 1 ? <button type="button" onClick={() => setCostItems((current) => current.filter((currentItem) => currentItem.id !== item.id))} style={{ padding: '8px 12px', borderRadius: '10px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', fontWeight: 700, cursor: 'pointer' }}>{dictionary.customers.calculationForm.remove}</button> : null}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.9fr 1.9fr', gap: '12px' }}>
              <label style={{ display: 'grid', gap: '8px' }}><span style={{ fontSize: '13px', fontWeight: 700, color: '#4b5563' }}>{dictionary.customers.calculationForm.costType}</span><select value={item.itemType} onChange={(event) => setCostItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, itemType: event.target.value as CostItemType } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }}><option value="labor">{dictionary.customers.calculationForm.typeLabor}</option><option value="material">{dictionary.customers.calculationForm.typeMaterial}</option><option value="rental">{dictionary.customers.calculationForm.typeRental}</option><option value="transport">{dictionary.customers.calculationForm.typeTransport}</option><option value="accommodation">{dictionary.customers.calculationForm.typeAccommodation}</option></select></label>
              <input placeholder={dictionary.customers.calculationForm.itemName} value={item.name} onChange={(event) => setCostItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, name: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.itemDescription} value={item.description} onChange={(event) => setCostItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, description: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '12px' }}>
              <input placeholder={dictionary.customers.calculationForm.quantity} value={item.quantity} onChange={(event) => setCostItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, quantity: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.unit} value={item.unit} onChange={(event) => setCostItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, unit: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.unitCost} value={item.unitCost} onChange={(event) => setCostItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, unitCost: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.vatRate} value={item.vatRate} onChange={(event) => setCostItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, vatRate: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
              <input placeholder={dictionary.customers.calculationForm.totalCost} value={String(parseNumber(item.quantity) * parseNumber(item.unitCost)).replace('.', ',')} readOnly style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#f3f4f6', color: '#111827' }} />
            </div>
            <input placeholder={dictionary.customers.calculationForm.note} value={item.note} onChange={(event) => setCostItems((current) => current.map((currentItem) => currentItem.id === item.id ? { ...currentItem, note: event.target.value } : currentItem))} style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid #d1d5db' }} />
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '12px' }}>
          <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}><div style={{ color: '#6b7280', marginBottom: '6px' }}>{dictionary.customers.calculationForm.customerTotal}</div><strong>{formatCurrency(customerTotal)}</strong></div>
          <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}><div style={{ color: '#6b7280', marginBottom: '6px' }}>{dictionary.customers.calculationForm.customerVat}</div><strong>{formatCurrency(customerVatTotal)}</strong></div>
          <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}><div style={{ color: '#6b7280', marginBottom: '6px' }}>{dictionary.customers.calculationForm.totalCosts}</div><strong>{formatCurrency(totalCost)}</strong></div>
          <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}><div style={{ color: '#6b7280', marginBottom: '6px' }}>{dictionary.customers.calculationForm.costVat}</div><strong>{formatCurrency(costVatTotal)}</strong></div>
          <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}><div style={{ color: '#6b7280', marginBottom: '6px' }}>{dictionary.customers.calculationForm.expectedProfit}</div><strong>{formatCurrency(expectedProfit)}</strong></div>
          <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}><div style={{ color: '#6b7280', marginBottom: '6px' }}>{dictionary.customers.calculationForm.laborCosts}</div><strong>{formatCurrency(laborCost)}</strong></div>
          <div style={{ padding: '14px', borderRadius: '12px', backgroundColor: '#f9fafb' }}><div style={{ color: '#6b7280', marginBottom: '6px' }}>{dictionary.customers.calculationForm.otherCosts}</div><strong>{formatCurrency(otherCost)}</strong></div>
        </div>
      </section>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button type="submit" disabled={saving} style={{ padding: '12px 16px', borderRadius: '12px', border: 'none', backgroundColor: '#000000', color: '#ffffff', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? dictionary.customers.calculationForm.savingEdit : dictionary.customers.calculationForm.saveChanges}
        </button>
        <Link href={cancelHref} style={{ padding: '12px 16px', borderRadius: '12px', border: '1px solid #d1d5db', backgroundColor: '#ffffff', color: '#111827', fontWeight: 700, textDecoration: 'none' }}>
          {dictionary.customers.calculationForm.cancel}
        </Link>
      </div>
    </form>
  )
}


