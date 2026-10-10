import type { PlanKey } from '@/lib/plans'

type PricingPlanView = {
  key: PlanKey
  name: string
  workerLimit: number | null
  priceMonthly: number
  priceYearly: number
  currency: 'EUR'
  recommended: boolean
}

type BillingClientProps = {
  mainPlans: PricingPlanView[]
}

function formatMonthlyPrice(plan: PricingPlanView) {
  return `${plan.priceMonthly.toLocaleString('cs-CZ')} ${plan.currency} / měsíc`
}

function formatYearlyPrice(plan: PricingPlanView) {
  return `${plan.priceYearly.toLocaleString('cs-CZ')} ${plan.currency} / rok`
}

function formatWorkerLimit(value: number | null) {
  return value === null ? 'Individuální limit pracovníků' : `${value} aktivních pracovníků`
}

export default function BillingClient({ mainPlans }: BillingClientProps) {
  return (
    <section style={sectionStyle}>
      <div style={toolbarStyle}>
        <h2 style={sectionTitleStyle}>Dosavadní firemní tarify</h2>
      </div>
      <p style={descriptionStyle}>
        Přehled dosavadních tarifů v EUR. Jejich ceny a limity se vztahují k původnímu předplatnému.
        Stav a nabídku samostatných modulů najdete v přehledu Základ a moduly.
      </p>

      <div style={plansGridStyle}>
        {mainPlans.map((plan) => (
          <article key={plan.key} style={planCardStyle}>
            <div style={planHeaderStyle}>
              <h3 style={planTitleStyle}>{plan.name}</h3>
            </div>
            <div>
              <div style={priceStyle}>{formatMonthlyPrice(plan)}</div>
              <div style={mutedStyle}>{formatYearlyPrice(plan)} · 2 měsíce zdarma</div>
              <div style={mutedStyle}>{formatWorkerLimit(plan.workerLimit)}</div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

const sectionStyle = {
  display: 'grid',
  gap: 14,
} as const

const toolbarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
} as const

const sectionTitleStyle = {
  margin: 0,
  fontSize: 22,
} as const

const descriptionStyle = {
  margin: 0,
  color: '#64748b',
  lineHeight: 1.6,
} as const

const plansGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: 12,
} as const

const planCardStyle = {
  display: 'grid',
  gap: 16,
  alignContent: 'start',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#ffffff',
  padding: 18,
  minHeight: 150,
} as const

const planHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
} as const

const planTitleStyle = {
  margin: 0,
  fontSize: 20,
} as const

const priceStyle = {
  marginTop: 10,
  fontSize: 26,
  fontWeight: 900,
} as const

const mutedStyle = {
  marginTop: 6,
  color: '#64748b',
  fontSize: 14,
  fontWeight: 700,
} as const
