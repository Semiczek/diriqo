import DashboardShell from '@/components/DashboardShell'
import BillingClient from '@/app/billing/BillingClient'
import { getActiveCompanyContext } from '@/lib/active-company'
import { addOns, mainPlans } from '@/lib/plans'

function toPlanView(plan: (typeof mainPlans | typeof addOns)[number]) {
  return {
    key: plan.key,
    name: plan.name,
    workerLimit: plan.workerLimit,
    priceMonthly: plan.priceMonthly,
    setupPrice: plan.setupPrice,
    currency: plan.currency,
    recommended: Boolean(plan.recommended),
    billingKind: plan.billingKind,
  }
}

export default async function BillingPage() {
  const activeCompany = await getActiveCompanyContext({ allowedRoles: ['super_admin', 'company_admin'] })

  return (
    <DashboardShell activeItem="billing">
      <main style={pageStyle}>
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>Pricing</p>
            <h1 style={titleStyle}>Plans</h1>
            <p style={subtitleStyle}>
              {activeCompany
                ? `Pricing options for ${activeCompany.companyName || 'your company'}.`
                : 'Pricing options for Diriqo app accounts.'}
            </p>
          </div>
        </header>

        {!activeCompany ? (
          <section style={noticeStyle}>
            Company pricing can be managed after company setup by a company administrator.
          </section>
        ) : null}

        <BillingClient
          mainPlans={mainPlans.map(toPlanView)}
          addOns={addOns.map(toPlanView)}
        />
      </main>
    </DashboardShell>
  )
}

const pageStyle = {
  display: 'grid',
  gap: 18,
  paddingBottom: 48,
} as const

const headerStyle = {
  padding: 22,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  borderRadius: 8,
  background: '#ffffff',
  boxShadow: '0 14px 34px rgba(15, 23, 42, 0.06)',
} as const

const eyebrowStyle = {
  margin: 0,
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
} as const

const titleStyle = {
  margin: '8px 0 0',
  fontSize: 34,
  lineHeight: 1.1,
} as const

const subtitleStyle = {
  margin: '8px 0 0',
  color: '#64748b',
  fontWeight: 650,
} as const

const noticeStyle = {
  border: '1px solid #bfdbfe',
  background: '#eff6ff',
  color: '#1e3a8a',
  borderRadius: 8,
  padding: 14,
  fontWeight: 750,
} as const
