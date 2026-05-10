import type { PlanKey } from '@/lib/plans'

type PricingPlanView = {
  key: PlanKey
  name: string
  workerLimit: number | null
  priceMonthly: number | null
  setupPrice: number | null
  currency: 'EUR'
  recommended: boolean
  billingKind: 'subscription' | 'add_on'
}

type BillingClientProps = {
  mainPlans: PricingPlanView[]
  addOns: PricingPlanView[]
}

function formatMonthlyPrice(plan: PricingPlanView) {
  if (plan.priceMonthly === null) return 'Custom pricing'
  return `${plan.priceMonthly.toLocaleString('cs-CZ')} ${plan.currency} / month`
}

function formatSetupPrice(plan: PricingPlanView) {
  if (plan.setupPrice === null) return null
  return `+${plan.setupPrice.toLocaleString('cs-CZ')} ${plan.currency} setup`
}

function formatWorkerLimit(value: number | null) {
  return value === null ? 'Custom worker limit' : `${value} active workers`
}

export default function BillingClient({ mainPlans, addOns }: BillingClientProps) {
  return (
    <section style={sectionStyle}>
      <div style={toolbarStyle}>
        <h2 style={sectionTitleStyle}>Subscription plans</h2>
      </div>

      <div style={plansGridStyle}>
        {mainPlans.map((plan) => (
          <article key={plan.key} style={plan.recommended ? recommendedPlanCardStyle : planCardStyle}>
            <div style={planHeaderStyle}>
              <h3 style={planTitleStyle}>{plan.name}</h3>
              {plan.recommended ? <span style={badgeStyle}>Recommended</span> : null}
            </div>
            <div>
              <div style={priceStyle}>{formatMonthlyPrice(plan)}</div>
              <div style={mutedStyle}>{formatWorkerLimit(plan.workerLimit)}</div>
            </div>
          </article>
        ))}
      </div>

      {addOns.length > 0 ? (
        <div style={addOnSectionStyle}>
          <h2 style={sectionTitleStyle}>Add-ons</h2>
          <div style={plansGridStyle}>
            {addOns.map((plan) => (
              <article key={plan.key} style={addOnCardStyle}>
                <h3 style={planTitleStyle}>{plan.name}</h3>
                <div style={priceStyle}>{formatSetupPrice(plan)}</div>
                <div style={mutedStyle}>Optional website setup add-on</div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
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

const recommendedPlanCardStyle = {
  ...planCardStyle,
  border: '1px solid #93c5fd',
  boxShadow: '0 12px 28px rgba(37, 99, 235, 0.12)',
} as const

const addOnCardStyle = {
  ...planCardStyle,
  minHeight: 126,
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

const badgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 26,
  borderRadius: 8,
  background: '#eff6ff',
  color: '#1d4ed8',
  border: '1px solid #bfdbfe',
  padding: '4px 8px',
  fontSize: 12,
  fontWeight: 850,
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

const addOnSectionStyle = {
  display: 'grid',
  gap: 12,
  marginTop: 8,
} as const
