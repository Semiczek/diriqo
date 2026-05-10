'use client'

import { useMemo, useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import { getIntlLocale } from '@/lib/i18n/config'
import {
  createJobCostItemAction,
  deleteJobCostItemAction,
  updateJobPriceAction,
} from '@/app/business-actions'

type Assignment = {
  id: string
  job_id: string
  profile_id: string
  labor_hours: number | string | null
  hourly_rate: number | string | null
  worker_type?: string | null
  external_amount?: number | string | null
  computed_internal_labor_cost?: number | string | null
  computed_external_labor_cost?: number | string | null
  note: string | null
  profiles?: {
    full_name: string | null
    hourly_rate?: number | null
    default_hourly_rate?: number | null
  } | null
}

type CostType = 'material' | 'transport' | 'accommodation' | 'other' | 'consumption'

type CostItem = {
  id: string
  job_id: string
  cost_type: CostType
  title: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  total_price: number | null
  note: string | null
}

type Props = {
  jobId: string
  companyId: string | null
  initialPrice: number | null
  initialAssignments: Assignment[]
  initialCostItems: CostItem[]
  actualLaborCost: number
  actualExternalLaborCost?: number
  onPriceSaved?: (price: number) => void
  onCostItemAdded?: (item: CostItem) => void
  onCostItemDeleted?: (id: string) => void
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CZK',
  }).format(value)
}

function formatHours(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(value)
}

function getSupabaseErrorDetail(error: unknown) {
  if (!error || typeof error !== 'object') return ''

  const supabaseError = error as {
    message?: unknown
    details?: unknown
    hint?: unknown
    code?: unknown
  }

  return [supabaseError.message, supabaseError.details, supabaseError.hint, supabaseError.code ? `Kód: ${supabaseError.code}` : null]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
}

function getAssignmentRate(assignment: Assignment) {
  return toNumber(assignment.hourly_rate ?? assignment.profiles?.hourly_rate ?? assignment.profiles?.default_hourly_rate)
}

function getCostTotal(item: CostItem) {
  return toNumber(item.total_price) || toNumber(item.quantity) * toNumber(item.unit_price)
}

const fieldLabelStyle: React.CSSProperties = {
  marginBottom: '6px',
  fontSize: '13px',
  color: '#64748b',
  fontWeight: 800,
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={fieldLabelStyle}>{label}</div>
      {children}
    </label>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'danger' }) {
  const color = tone === 'success' ? '#15803d' : tone === 'danger' ? '#b91c1c' : '#0f172a'

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '16px', padding: '12px', background: '#f8fafc' }}>
      <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 800, marginBottom: '6px' }}>{label}</div>
      <div style={{ color, fontSize: '20px', fontWeight: 950 }}>{value}</div>
    </div>
  )
}

export default function JobEconomicsEditor({
  jobId,
  initialPrice,
  initialAssignments,
  initialCostItems,
  actualLaborCost,
  actualExternalLaborCost = 0,
  onPriceSaved,
  onCostItemAdded,
  onCostItemDeleted,
}: Props) {
  const { dictionary, locale } = useI18n()
  const dateLocale = getIntlLocale(locale)
  const detailMessages = dictionary.jobs.detail
  const text =
    locale === 'en'
      ? {
          savingPrice: 'Saving price...',
          priceSaved: 'Job price was saved.',
          priceSaveFailed: 'Failed to save price.',
          costNameRequired: 'Enter the cost name.',
          costPriceRequired: 'Enter the cost price. Price must be higher than 0 CZK.',
          addingCost: 'Adding cost...',
          costAdded: 'Cost was added.',
          addCostFailed: 'Failed to add cost. Check permissions or the job_cost_items schema.',
          deletingCost: 'Deleting cost...',
          costDeleted: 'Cost was deleted.',
          deleteCostFailed: 'Failed to delete cost.',
          quickSummary: 'Quick summary',
          plannedDifference: 'Planned difference',
          priceDescription: 'Total customer price.',
          savePrice: 'Save price',
          addCostDescription:
            'Add material, transport, or another direct cost. Internal worker labor comes from the worker assignments above.',
          type: 'Type',
          name: 'Name',
          titlePlaceholder: 'E.g. chemicals, transport, machine rental',
          quantity: 'Quantity',
          unit: 'Unit',
          unitPrice: 'Price / unit',
          optional: 'Optional',
          addCostDisabledTitle: 'Enter cost name and price',
          costItemsTitle: 'Cost items',
          noCostItems: 'No additional costs have been added yet.',
          costFallback: 'Cost',
          laborFromAssignments: 'Labor from assignments',
          laborFromAssignmentsDescription:
            'These costs are not edited here. They are changed in Workers and work.',
          noAssignedWorkers: 'No workers are assigned to this job.',
          total: 'Total',
        }
      : locale === 'de'
        ? {
            savingPrice: 'Preis wird gespeichert...',
            priceSaved: 'Auftragspreis wurde gespeichert.',
            priceSaveFailed: 'Preis konnte nicht gespeichert werden.',
            costNameRequired: 'Bitte Kostenname eingeben.',
            costPriceRequired: 'Bitte Kostenpreis eingeben. Der Preis muss höher als 0 CZK sein.',
            addingCost: 'Kosten werden hinzugefügt...',
            costAdded: 'Kosten wurden hinzugefügt.',
            addCostFailed: 'Kosten konnten nicht hinzugefügt werden. Prüfe Berechtigungen oder das Schema job_cost_items.',
            deletingCost: 'Kosten werden gelöscht...',
            costDeleted: 'Kosten wurden gelöscht.',
            deleteCostFailed: 'Kosten konnten nicht gelöscht werden.',
            quickSummary: 'Kurzübersicht',
            plannedDifference: 'Geplante Differenz',
            priceDescription: 'Gesamtpreis für den Kunden.',
            savePrice: 'Preis speichern',
            addCostDescription:
              'Füge Material, Transport oder andere direkte Kosten hinzu. Interne Arbeit kommt aus den Mitarbeiterzuweisungen oben.',
            type: 'Typ',
            name: 'Name',
            titlePlaceholder: 'Z. B. Chemie, Transport, Maschinenmiete',
            quantity: 'Menge',
            unit: 'Einheit',
            unitPrice: 'Preis / Einheit',
            optional: 'Optional',
            addCostDisabledTitle: 'Kostenname und Preis ausfüllen',
            costItemsTitle: 'Kostenpositionen',
            noCostItems: 'Es wurden noch keine weiteren Kosten hinzugefügt.',
            costFallback: 'Kosten',
            laborFromAssignments: 'Arbeit aus Zuweisungen',
            laborFromAssignmentsDescription:
              'Diese Kosten werden hier nicht bearbeitet. Sie werden unter Mitarbeiter und Arbeit geändert.',
            noAssignedWorkers: 'Diesem Auftrag sind keine Mitarbeiter zugewiesen.',
            total: 'Gesamt',
          }
        : {
            savingPrice: 'Ukládám cenu...',
            priceSaved: 'Cena zakázky byla uložena.',
            priceSaveFailed: 'Nepodařilo se uložit cenu.',
            costNameRequired: 'Vyplň název nákladu.',
            costPriceRequired: 'Vyplň cenu nákladu. Cena musí být vyšší než 0 Kč.',
            addingCost: 'Přidávám náklad...',
            costAdded: 'Náklad byl přidán.',
            addCostFailed: 'Nepodařilo se přidat náklad. Zkontroluj oprávnění nebo schema job_cost_items.',
            deletingCost: 'Mažu náklad...',
            costDeleted: 'Náklad byl smazán.',
            deleteCostFailed: 'Nepodařilo se smazat náklad.',
            quickSummary: 'Rychlý souhrn',
            plannedDifference: 'Plánovaný rozdíl',
            priceDescription: 'Celková cena pro zákazníka.',
            savePrice: 'Uložit cenu',
            addCostDescription:
              'Přidej materiál, dopravu nebo jiný náklad. Práce interních pracovníků se bere z přiřazení pracovníků výše.',
            type: 'Typ',
            name: 'Název',
            titlePlaceholder: 'Např. chemie, doprava, zapůjčení stroje',
            quantity: 'Množství',
            unit: 'Jednotka',
            unitPrice: 'Cena / jednotka',
            optional: 'Volitelné',
            addCostDisabledTitle: 'Vyplň název a cenu nákladu',
            costItemsTitle: 'Položky nákladů',
            noCostItems: 'Zatím nejsou přidané žádné další náklady.',
            costFallback: 'Náklad',
            laborFromAssignments: 'Práce z přiřazení',
            laborFromAssignmentsDescription:
              'Tyto náklady se neupravují tady. Mění se v sekci Pracovníci a práce.',
            noAssignedWorkers: 'K zakázce nejsou přiřazení žádní pracovníci.',
            total: 'Celkem',
          }
  const costTypeLabels: Record<CostType, string> = {
    material: detailMessages.materialCost,
    transport: detailMessages.transportCost,
    accommodation: detailMessages.accommodationCost,
    other: detailMessages.otherCost,
    consumption: detailMessages.consumptionCost,
  }
  const [price, setPrice] = useState(String(initialPrice ?? 0))
  const [costItems, setCostItems] = useState<CostItem[]>(initialCostItems ?? [])
  const [savingPrice, setSavingPrice] = useState(false)
  const [addingCost, setAddingCost] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [costMessage, setCostMessage] = useState<string>('')
  const [newCost, setNewCost] = useState({
    cost_type: 'material' as CostType,
    title: '',
    quantity: '1',
    unit: 'ks',
    unit_price: '',
    note: '',
  })

  const plannedAssignmentCost = useMemo(() => {
    return initialAssignments.reduce(
      (sum, assignment) => sum + toNumber(assignment.labor_hours) * getAssignmentRate(assignment),
      0
    )
  }, [initialAssignments])

  const currentOtherCosts = useMemo(() => {
    return costItems.reduce((sum, item) => sum + getCostTotal(item), 0)
  }, [costItems])

  const currentPrice = toNumber(price)
  const plannedProfit = currentPrice - actualLaborCost - actualExternalLaborCost - currentOtherCosts
  const liveNewCostTotal = toNumber(newCost.quantity) * toNumber(newCost.unit_price)
  const canAddCost = newCost.title.trim().length > 0 && toNumber(newCost.unit_price) > 0 && !addingCost

  const panelStyle: React.CSSProperties = {
    border: '1px solid rgba(203, 213, 225, 0.9)',
    borderRadius: '20px',
    padding: '18px',
    marginBottom: '18px',
    background: '#ffffff',
    boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    minHeight: '46px',
    padding: '11px 13px',
    borderRadius: '12px',
    border: '1px solid #cbd5e1',
    fontSize: '15px',
    boxSizing: 'border-box',
    background: '#ffffff',
  }

  const buttonStyle: React.CSSProperties = {
    minHeight: '46px',
    padding: '11px 18px',
    borderRadius: '999px',
    border: 'none',
    background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 52%, #06b6d4 100%)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: '15px',
    boxShadow: '0 14px 28px rgba(37, 99, 235, 0.2)',
  }

  const secondaryButtonStyle: React.CSSProperties = {
    minHeight: '40px',
    padding: '9px 14px',
    borderRadius: '999px',
    border: '1px solid #cbd5e1',
    background: '#fff',
    color: '#111827',
    cursor: 'pointer',
    fontWeight: 800,
    fontSize: '14px',
  }

  async function savePrice() {
    try {
      setSavingPrice(true)
      setMessage(text.savingPrice)

      const result = await updateJobPriceAction({ jobId, price: toNumber(price) })

      if (!result.ok) throw new Error(result.error)

      setMessage(text.priceSaved)
      onPriceSaved?.(toNumber(price))
    } catch {
      setMessage(text.priceSaveFailed)
    } finally {
      setSavingPrice(false)
    }
  }

  async function addCost() {
    setCostMessage('')

    if (!newCost.title.trim()) {
      setCostMessage(text.costNameRequired)
      return
    }

    if (toNumber(newCost.unit_price) <= 0) {
      setCostMessage(text.costPriceRequired)
      return
    }

    try {
      setAddingCost(true)
      setCostMessage(text.addingCost)

      const quantity = Math.max(toNumber(newCost.quantity), 1)
      const unitPrice = toNumber(newCost.unit_price)
      const totalPrice = quantity * unitPrice

      const result = await createJobCostItemAction({
        jobId,
        costType: newCost.cost_type,
        title: newCost.title.trim(),
        quantity,
        unit: newCost.unit.trim() || 'ks',
        unitPrice,
        totalPrice,
        note: newCost.note.trim() || null,
      })

      if (!result.ok) throw new Error(result.error)

      const savedCostItem = result.data.item as CostItem
      setCostItems((prev) => [savedCostItem, ...prev])
      onCostItemAdded?.(savedCostItem)
      setNewCost({
        cost_type: 'material',
        title: '',
        quantity: '1',
        unit: 'ks',
        unit_price: '',
        note: '',
      })

      setMessage(text.costAdded)
      setCostMessage(text.costAdded)
    } catch (error) {
      const detail = getSupabaseErrorDetail(error)
      setCostMessage(`${text.addCostFailed}${detail ? ` ${detail}` : ''}`)
    } finally {
      setAddingCost(false)
    }
  }

  async function deleteCost(id: string) {
    try {
      setMessage(text.deletingCost)

      const result = await deleteJobCostItemAction({ id, jobId })
      if (!result.ok) throw new Error(result.error)

      setCostItems((prev) => prev.filter((item) => item.id !== id))
      onCostItemDeleted?.(id)
      setMessage(text.costDeleted)
    } catch {
      setMessage(text.deleteCostFailed)
    }
  }

  return (
    <div style={{ marginTop: '20px' }}>
      {message ? (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
            borderRadius: '14px',
            border: '1px solid #bfdbfe',
            background: '#eff6ff',
            color: '#1e3a8a',
            fontSize: '14px',
            fontWeight: 700,
          }}
        >
          {message}
        </div>
      ) : null}

      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 14px 0', fontSize: '20px' }}>{text.quickSummary}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
          <SummaryTile label={detailMessages.jobPrice} value={formatCurrency(toNumber(price), dateLocale)} />
          <SummaryTile label={detailMessages.internalLabor} value={formatCurrency(actualLaborCost, dateLocale)} />
          <SummaryTile label={detailMessages.externalLabor} value={formatCurrency(actualExternalLaborCost, dateLocale)} />
          <SummaryTile label={detailMessages.directCosts} value={formatCurrency(currentOtherCosts, dateLocale)} />
          <SummaryTile label={text.plannedDifference} value={formatCurrency(plannedProfit, dateLocale)} tone={plannedProfit >= 0 ? 'success' : 'danger'} />
        </div>
      </div>

      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '20px' }}>{detailMessages.jobPrice}</h3>
            <p style={{ margin: '6px 0 0 0', color: '#64748b', fontSize: '14px' }}>{text.priceDescription}</p>
          </div>
          <button type="button" onClick={savePrice} disabled={savingPrice} style={{ ...secondaryButtonStyle, opacity: savingPrice ? 0.7 : 1 }}>
            {savingPrice ? dictionary.jobs.saving : text.savePrice}
          </button>
        </div>

        <div style={{ maxWidth: '340px', marginTop: '14px' }}>
          <div style={fieldLabelStyle}>{detailMessages.jobPrice}</div>
          <input value={price} onChange={(event) => setPrice(event.target.value)} style={inputStyle} placeholder={detailMessages.jobPrice} />
        </div>
      </div>

      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>{detailMessages.addCost}</h3>
        <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '14px' }}>
          {text.addCostDescription}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <Field label={text.type}>
            <select
              value={newCost.cost_type}
              onChange={(event) => setNewCost((current) => ({ ...current, cost_type: event.target.value as CostType }))}
              style={inputStyle}
            >
              {Object.entries(costTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={text.name}>
            <input
              placeholder={text.titlePlaceholder}
              value={newCost.title}
              onChange={(event) => setNewCost((current) => ({ ...current, title: event.target.value }))}
              style={inputStyle}
            />
          </Field>

          <Field label={text.quantity}>
            <input
              inputMode="decimal"
              value={newCost.quantity}
              onChange={(event) => setNewCost((current) => ({ ...current, quantity: event.target.value }))}
              style={inputStyle}
            />
          </Field>

          <Field label={text.unit}>
            <input
              value={newCost.unit}
              onChange={(event) => setNewCost((current) => ({ ...current, unit: event.target.value }))}
              style={inputStyle}
            />
          </Field>

          <Field label={text.unitPrice}>
            <input
              inputMode="decimal"
              placeholder="0"
              value={newCost.unit_price}
              onChange={(event) => setNewCost((current) => ({ ...current, unit_price: event.target.value }))}
              style={inputStyle}
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) auto', gap: '12px', marginTop: '12px', alignItems: 'end' }}>
          <Field label={detailMessages.note}>
            <input
              placeholder={text.optional}
              value={newCost.note}
              onChange={(event) => setNewCost((current) => ({ ...current, note: event.target.value }))}
              style={inputStyle}
            />
          </Field>

          <button
            type="button"
            onClick={addCost}
            disabled={addingCost}
            title={canAddCost ? detailMessages.addCost : text.addCostDisabledTitle}
            style={{ ...buttonStyle, opacity: addingCost ? 0.7 : 1 }}
          >
            {addingCost ? text.addingCost : `${detailMessages.addCost} ${formatCurrency(liveNewCostTotal, dateLocale)}`}
          </button>
        </div>

        {costMessage ? (
          <div
            style={{
              marginTop: '12px',
              border: costMessage.includes('Nepodařilo') || costMessage.includes('Vyplň') ? '1px solid #fed7aa' : '1px solid #bbf7d0',
              background: costMessage.includes('Nepodařilo') || costMessage.includes('Vyplň') ? '#fff7ed' : '#f0fdf4',
              color: costMessage.includes('Nepodařilo') || costMessage.includes('Vyplň') ? '#9a3412' : '#166534',
              borderRadius: '14px',
              padding: '10px 12px',
              fontSize: '14px',
              fontWeight: 800,
            }}
          >
            {costMessage}
          </div>
        ) : null}
      </div>

      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '20px' }}>{text.costItemsTitle}</h3>

        {costItems.length === 0 ? (
          <div style={{ border: '1px dashed #cbd5e1', borderRadius: '16px', padding: '18px', color: '#64748b', background: '#f8fafc' }}>
            {text.noCostItems}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {costItems.map((item) => (
              <div
                key={item.id}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '16px',
                  padding: '14px',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '12px',
                  alignItems: 'center',
                  background: '#ffffff',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '16px', color: '#0f172a' }}>{item.title || text.costFallback}</strong>
                    <span style={{ borderRadius: '999px', background: '#f1f5f9', color: '#475569', padding: '4px 8px', fontSize: '12px', fontWeight: 800 }}>
                      {costTypeLabels[item.cost_type] ?? detailMessages.otherCost}
                    </span>
                  </div>
                  <div style={{ marginTop: '6px', color: '#64748b', fontSize: '14px' }}>
                    {formatHours(toNumber(item.quantity), dateLocale)} {item.unit || 'ks'} × {formatCurrency(toNumber(item.unit_price), dateLocale)}
                    {item.note ? ` · ${item.note}` : ''}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 900, fontSize: '18px', color: '#0f172a' }}>{formatCurrency(getCostTotal(item), dateLocale)}</div>
                  <button type="button" onClick={() => deleteCost(item.id)} style={{ ...secondaryButtonStyle, marginTop: '8px', color: '#b91c1c' }}>
                    {dictionary.common.delete}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={panelStyle}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '20px' }}>{text.laborFromAssignments}</h3>
        <p style={{ margin: '0 0 14px 0', color: '#64748b', fontSize: '14px' }}>
          {text.laborFromAssignmentsDescription}
        </p>

        {initialAssignments.length === 0 ? (
          <div style={{ color: '#64748b' }}>{text.noAssignedWorkers}</div>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {initialAssignments.map((assignment) => {
              const hours = toNumber(assignment.labor_hours)
              const rate = getAssignmentRate(assignment)
              const cost = toNumber(assignment.computed_internal_labor_cost) || hours * rate

              return (
                <div
                  key={assignment.id}
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '14px',
                    padding: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{assignment.profiles?.full_name || detailMessages.unknownWorker}</div>
                    {assignment.note ? <div style={{ color: '#64748b', fontSize: '13px', marginTop: '4px' }}>{assignment.note}</div> : null}
                  </div>
                  <div style={{ fontWeight: 900, color: '#0f172a' }}>
                    {formatHours(hours, dateLocale)} h × {formatCurrency(rate, dateLocale)} = {formatCurrency(cost, dateLocale)}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ marginTop: '14px', fontWeight: 900, color: '#0f172a' }}>{text.total}: {formatCurrency(plannedAssignmentCost, dateLocale)}</div>
      </div>
    </div>
  )
}
