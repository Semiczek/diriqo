import Link from 'next/link'

import DashboardShell from '@/components/DashboardShell'
import { getActiveCompanyContext } from '@/lib/active-company'
import ModuleCatalogClient from './ModuleCatalogClient'
import styles from './modules.module.css'

type SearchParams = Promise<{ checkout?: string | string[] }>

export default async function ModuleCatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const [company, query] = await Promise.all([
    getActiveCompanyContext({ allowedRoles: ['super_admin', 'company_admin'] }),
    searchParams,
  ])
  const checkoutReturn = query.checkout === 'returned' || query.checkout === 'cancelled' ? query.checkout : null

  return (
    <DashboardShell activeItem="billing">
      <main className={styles.page}>
        <header className={styles.header}>
          <Link href="/billing" className={styles.backLink}>← Předplatné</Link>
          <p className={styles.eyebrow}>Diriqo pro vaši firmu</p>
          <h1>Základ a moduly</h1>
          <p className={styles.subtitle}>
            {company
              ? `Základ i samostatné doplňky pro ${company.companyName || 'vaši firmu'}.`
              : 'Nabídku a nákupy spravuje administrátor aktivní firmy.'}
          </p>
        </header>
        {company ? (
          <ModuleCatalogClient key={company.companyId} companyId={company.companyId} checkoutReturn={checkoutReturn} />
        ) : (
          <section className={styles.notice} aria-label="Přístup ke správě modulů">
            Pro správu modulů vyberte firmu, ve které máte oprávnění administrátora.
          </section>
        )}
      </main>
    </DashboardShell>
  )
}
