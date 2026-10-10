import Link from 'next/link'

import DashboardShell from '@/components/DashboardShell'
import BillingClient from '@/app/billing/BillingClient'
import { getActiveCompanyContext } from '@/lib/active-company'
import { mainPlans } from '@/lib/plans'
import styles from './billing.module.css'

function toPlanView(plan: (typeof mainPlans)[number]) {
  return {
    key: plan.key,
    name: plan.name,
    workerLimit: plan.workerLimit,
    priceMonthly: plan.priceMonthly,
    priceYearly: plan.priceYearly,
    currency: plan.currency,
    recommended: Boolean(plan.recommended),
  }
}

export default async function BillingPage() {
  const activeCompany = await getActiveCompanyContext({ allowedRoles: ['super_admin', 'company_admin'] })

  return (
    <DashboardShell activeItem="billing">
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>{activeCompany?.companyName || 'Diriqo pro vaši firmu'}</p>
          <h1>Předplatné</h1>
          <p>Licence, moduly a přehled dosavadních tarifů.</p>
        </header>

        {activeCompany ? (
          <section className={styles.moduleCard}>
            <div>
              <span className={styles.icon} aria-hidden="true">▦</span>
              <h2>Základ a moduly</h2>
              <p>Podívejte se, co máte aktivní a které další funkce připravujeme.</p>
            </div>
            <Link href="/billing/modules" className={styles.primaryButton}>Otevřít moje moduly<span aria-hidden="true">→</span></Link>
          </section>
        ) : (
          <section className={styles.notice}>Předplatné může spravovat administrátor po založení a výběru firmy.</section>
        )}

        <BillingClient mainPlans={mainPlans.map(toPlanView)} />
      </main>
    </DashboardShell>
  )
}
