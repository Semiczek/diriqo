'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

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

type CostItem = {
  id: string
  job_id: string
  cost_type: 'material' | 'transport' | 'accommodation' | 'other' | 'consumption'
  title: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  total_price: number | null
  note: string | null
}

type Props = {
  jobId: string
  initialPrice: number | null
  initialAssignments: Assignment[]
  initialCostItems: CostItem[]
  actualLaborCost: number
  actualExternalLaborCost?: number
  actualOtherCosts: number
  actualProfit: number
}

function toNumber(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
  }).format(value)
}

function formatHours(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 2,
  }).format(value)
}

function getAssignmentRate(assignment: Assignment) {
  return toNumber(assignment.hourly_rate ?? assignment.profiles?.hourly_rate ?? assignment.profiles?.default_hourly_rate)
}

export default function JobEconomicsEditor({
  jobId,
  initialPrice,
  initialAssignments,
  initialCostItems,
  actualLaborCost,
  actualExternalLaborCost = 0,
  actualOtherCosts,
  actualProfit,
}: Props) {
  const router = useRouter()

  const [price, setPrice] = useState(String(initialPrice ?? 0))
  const [costItems, setCostItems] = useState<CostItem[]>(initialCostItems ?? [])
  const [savingPrice, setSavingPrice] = useState(false)
  const [addingCost, setAddingCost] = useState(false)
  const [message, setMessage] = useState<string>('')
  const [newCost, setNewCost] = useState({
    cost_type: 'material' as CostItem['cost_type'],
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

  const sectionStyle: React.CSSProperties = {
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '20px',
    background: '#fff',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    boxSizing: 'border-box',
  }

  const buttonStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #111',
    background: '#111',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
  }

  const secondaryButtonStyle: React.CSSProperties = {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#111827',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
  }

  const gridTwoStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px',
  }

  async function savePrice() {
    try {
      setSavingPrice(true)
      setMessage('Ukládám cenu...')

      await supabase
        .from('jobs')
        .update({ price: toNumber(price) })
        .eq('id', jobId)

      setMessage('Cena zakázky byla uložena.')
      router.refresh()
    } catch {
      setMessage('Nepodařilo se uložit cenu.')
    } finally {
      setSavingPrice(false)
    }
  }

  async function addCost() {
    if (!newCost.title.trim()) {
      setMessage('Vyplň název nákladu.')
      return
    }

    try {
      setAddingCost(true)
      setMessage('Přidávám náklad...')

      const quantity = toNumber(newCost.quantity)
      const unit_price = toNumber(newCost.unit_price)

      const { data, error } = await supabase
        .from('job_cost_items')
        .insert([
          {
            job_id: jobId,
            ...newCost,
            quantity,
            unit_price,
            total_price: quantity * unit_price,
          },
        ])
        .select()
        .single()

      if (error) throw error

      setCostItems((prev) => [data, ...prev])

      setNewCost({
        cost_type: 'material',
        title: '',
        quantity: '1',
        unit: 'ks',
        unit_price: '',
        note: '',
      })

      setMessage('Náklad byl přidán.')
      router.refresh()
    } catch {
      setMessage('Nepodařilo se přidat náklad.')
    } finally {
      setAddingCost(false)
    }
  }

  async function deleteCost(id: string) {
    try {
      setMessage('Mažu náklad...')

      await supabase.from('job_cost_items').delete().eq('id', id)
      setCostItems((prev) => prev.filter((c) => c.id !== id))

      setMessage('Náklad byl smazán.')
      router.refresh()
    } catch {
      setMessage('Nepodařilo se smazat náklad.')
    }
  }

  return (
    <div style={{ marginTop: '20px' }}>
      {message ? (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 14px',
            borderRadius: '10px',
            border: '1px solid #e5e7eb',
            background: '#f9fafb',
            color: '#111827',
            fontSize: '14px',
          }}
        >
          {message}
        </div>
      ) : null}

      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 10px 0' }}>Souhrn zakázky</h3>
        <div style={{ color: '#374151', lineHeight: '1.8' }}>
          <div>Cena: {formatCurrency(toNumber(price))}</div>
          <div>Interní práce: {formatCurrency(actualLaborCost)}</div>
          <div>Externí práce: {formatCurrency(actualExternalLaborCost)}</div>
          <div>Ostatní náklady: {formatCurrency(actualOtherCosts)}</div>
          <div style={{ fontWeight: '700' }}>Zisk: {formatCurrency(actualProfit)}</div>
        </div>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 12px 0' }}>Cena zakázky</h3>

        <div style={{ maxWidth: '320px' }}>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={inputStyle}
            placeholder="Cena zakázky"
          />
        </div>

        <button
          onClick={savePrice}
          disabled={savingPrice}
          style={{
            ...buttonStyle,
            marginTop: '10px',
            opacity: savingPrice ? 0.7 : 1,
          }}
        >
          {savingPrice ? 'Ukládám...' : 'Uložit cenu'}
        </button>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 12px 0' }}>Práce</h3>
        <div style={{ color: '#6b7280', fontSize: '13px', marginBottom: '12px' }}>
          Náklady na práci se počítají pouze z pracovníků přiřazených v sekci Pracovníci a práce.
          Ruční přidávání pracovníků tady je záměrně odstraněné.
        </div>

        {initialAssignments.length === 0 ? (
          <div style={{ color: '#6b7280' }}>Žádní pracovníci na zakázce.</div>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {initialAssignments.map((assignment) => {
              const hours = toNumber(assignment.labor_hours)
              const rate = getAssignmentRate(assignment)
              const cost = hours * rate

              return (
                <div
                  key={assignment.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    padding: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: '#111827' }}>
                      {assignment.profiles?.full_name || 'Neznámý pracovník'}
                    </div>
                    {assignment.note ? (
                      <div style={{ color: '#6b7280', fontSize: '13px', marginTop: '4px' }}>
                        {assignment.note}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ fontWeight: 800, color: '#111827' }}>
                    {formatHours(hours)} h × {formatCurrency(rate)} = {formatCurrency(cost)}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ marginTop: '14px', fontWeight: 900, color: '#111827' }}>
          Celkem: {formatCurrency(plannedAssignmentCost)}
        </div>
      </div>

      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 12px 0' }}>Ostatní náklady</h3>

        <div style={gridTwoStyle}>
          <div>
            <div style={{ marginBottom: '6px', fontSize: '14px', color: '#6b7280' }}>Typ</div>
            <select
              value={newCost.cost_type}
              onChange={(e) =>
                setNewCost((p) => ({ ...p, cost_type: e.target.value as CostItem['cost_type'] }))
              }
              style={inputStyle}
            >
              <option value="material">Materiál</option>
              <option value="transport">Doprava</option>
              <option value="accommodation">Ubytování</option>
              <option value="consumption">Spotřeba</option>
              <option value="other">Ostatní</option>
            </select>
          </div>

          <div>
            <div style={{ marginBottom: '6px', fontSize: '14px', color: '#6b7280' }}>Název</div>
            <input
              placeholder="Název"
              value={newCost.title}
              onChange={(e) => setNewCost((p) => ({ ...p, title: e.target.value }))}
              style={inputStyle}
            />
          </div>

          <div>
            <div style={{ marginBottom: '6px', fontSize: '14px', color: '#6b7280' }}>Množství</div>
            <input
              placeholder="Množství"
              value={newCost.quantity}
              onChange={(e) => setNewCost((p) => ({ ...p, quantity: e.target.value }))}
              style={inputStyle}
            />
          </div>

          <div>
            <div style={{ marginBottom: '6px', fontSize: '14px', color: '#6b7280' }}>Jednotka</div>
            <input
              placeholder="Jednotka"
              value={newCost.unit}
              onChange={(e) => setNewCost((p) => ({ ...p, unit: e.target.value }))}
              style={inputStyle}
            />
          </div>

          <div>
            <div style={{ marginBottom: '6px', fontSize: '14px', color: '#6b7280' }}>Cena za jednotku</div>
            <input
              placeholder="Cena"
              value={newCost.unit_price}
              onChange={(e) => setNewCost((p) => ({ ...p, unit_price: e.target.value }))}
              style={inputStyle}
            />
          </div>

          <div>
            <div style={{ marginBottom: '6px', fontSize: '14px', color: '#6b7280' }}>Poznámka</div>
            <input
              placeholder="Poznámka"
              value={newCost.note}
              onChange={(e) => setNewCost((p) => ({ ...p, note: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

        <button
          onClick={addCost}
          disabled={addingCost}
          style={{
            ...buttonStyle,
            marginTop: '12px',
            opacity: addingCost ? 0.7 : 1,
          }}
        >
          {addingCost ? 'Přidávám...' : 'Přidat náklad'}
        </button>

        <div style={{ marginTop: '16px' }}>
          {costItems.map((c) => (
            <div
              key={c.id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '10px',
                padding: '12px',
                marginBottom: '10px',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '6px' }}>{c.title}</div>
              <div style={{ color: '#374151', marginBottom: '6px' }}>
                {c.cost_type} {'\u2014'} {formatCurrency(c.total_price ?? 0)}
              </div>
              {c.note ? (
                <div style={{ color: '#6b7280', marginBottom: '8px' }}>{c.note}</div>
              ) : null}
              <button onClick={() => deleteCost(c.id)} style={secondaryButtonStyle}>
                Smazat
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
