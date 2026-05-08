'use client'

import { useState } from 'react'
import { useI18n } from '@/components/I18nProvider'
import JobEconomicsEditor from './JobEconomicsEditor'
import {
  cardTitleStyle,
  metaItemStyle,
  metaLabelStyle,
  metaValueStyle,
  secondaryButtonStyle,
  sectionCardStyle,
} from '@/components/SaasPageLayout'

type Assignment = {
  id: string
  job_id: string
  profile_id: string
  labor_hours: number | null
  hourly_rate: number | null
  worker_type?: 'employee' | 'contractor' | string | null
  assignment_billing_type?: string | null
  external_amount?: number | null
  note: string | null
  computed_labor_hours?: number | null
  computed_hourly_rate?: number | null
  computed_labor_cost?: number | null
  computed_internal_labor_cost?: number | null
  computed_external_labor_cost?: number | null
  profiles?: {
    full_name: string | null
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

type JobEconomicsSectionProps = {
  jobId: string
  companyId: string | null
  price: number | null
  assignments: Assignment[]
  costItems: CostItem[]
  accountingRevenue?: number
  laborCost: number
  externalLaborCost?: number
  otherCosts: number
  profit: number
  onPriceSaved?: (price: number) => void
  onCostItemAdded?: (item: CostItem) => void
  onCostItemDeleted?: (id: string) => void
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(value)
}

export default function JobEconomicsSection({
  jobId,
  companyId,
  price,
  assignments,
  costItems,
  accountingRevenue,
  laborCost,
  externalLaborCost = 0,
  otherCosts,
  profit,
  onPriceSaved,
  onCostItemAdded,
  onCostItemDeleted,
}: JobEconomicsSectionProps) {
  const { dictionary } = useI18n()
  const [isEditing, setIsEditing] = useState(false)

  const revenue = toNumber(accountingRevenue)
  const quotedPrice = toNumber(price)

  const sectionStyle: React.CSSProperties = {
    ...sectionCardStyle,
  }

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  }

  const titleStyle: React.CSSProperties = {
    ...cardTitleStyle,
    margin: 0,
    fontSize: '24px',
  }

  const descriptionStyle: React.CSSProperties = {
    margin: '8px 0 0 0',
    fontSize: '14px',
    color: '#6b7280',
  }

  const buttonStyle: React.CSSProperties = {
    ...secondaryButtonStyle,
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    cursor: 'pointer',
  }

  const cardsWrapStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px',
  }

  const cardStyle: React.CSSProperties = {
    ...metaItemStyle,
  }

  const labelStyle: React.CSSProperties = {
    ...metaLabelStyle,
  }

  const valueStyle: React.CSSProperties = {
    ...metaValueStyle,
    fontSize: '28px',
    lineHeight: '1.2',
  }

  const profitStyle: React.CSSProperties = {
    ...valueStyle,
    color: profit >= 0 ? '#15803d' : '#b91c1c',
  }

  return (
    <section style={sectionStyle}>
      <div style={headerStyle}>
        <div>
          <h2 style={titleStyle}>Náklady</h2>
          <p style={descriptionStyle}>{dictionary.jobs.detail.costItemsByType}</p>
        </div>

        <button type="button" onClick={() => setIsEditing((prev) => !prev)} style={buttonStyle}>
          {isEditing ? 'Zavřít úpravy' : costItems.length === 0 ? 'Přidat náklad' : 'Upravit náklady'}
        </button>
      </div>

      {!isEditing ? (
        <div style={cardsWrapStyle}>
          <div style={cardStyle}>
            <div style={labelStyle}>Fakturováno</div>
            <div style={valueStyle}>{formatCurrency(revenue)}</div>
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>Cena zakázky</div>
            <div style={valueStyle}>{formatCurrency(quotedPrice)}</div>
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>Interní práce</div>
            <div style={valueStyle}>{formatCurrency(laborCost)}</div>
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>Externí práce</div>
            <div style={valueStyle}>{formatCurrency(externalLaborCost)}</div>
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>Přímé náklady</div>
            <div style={valueStyle}>{formatCurrency(otherCosts)}</div>
          </div>

          <div style={cardStyle}>
            <div style={labelStyle}>{dictionary.jobs.profit}</div>
            <div style={profitStyle}>{formatCurrency(profit)}</div>
          </div>
        </div>
      ) : (
        <JobEconomicsEditor
          jobId={jobId}
          companyId={companyId}
          initialPrice={price}
          initialAssignments={assignments}
          initialCostItems={costItems}
          actualLaborCost={laborCost}
          actualExternalLaborCost={externalLaborCost}
          onPriceSaved={onPriceSaved}
          onCostItemAdded={onCostItemAdded}
          onCostItemDeleted={onCostItemDeleted}
        />
      )}
    </section>
  )
}
