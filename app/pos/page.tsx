import Link from 'next/link'
import { getActiveCompanyContext } from '@/lib/active-company'
import PosClient from './PosClient'
import styles from './pos.module.css'

export default async function PosPage() {
  const company = await getActiveCompanyContext({ allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'] })
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{company?.companyName ?? 'Diriqo'}</p><h1>DiriPOS</h1><p>Webová pokladna · CZK · online provoz</p></div><Link href={['super_admin','company_admin'].includes(company?.role??'')?'/':'/moje-prace'}>Zpět do Diriqa</Link></header>
    {company ? <PosClient key={company.companyId} companyId={company.companyId} /> : <section className={styles.panel}><p>Pro práci s pokladnou se přihlaste a vyberte firmu, do které máte přístup.</p><Link href="/sign-in">Přihlásit se</Link></section>}
  </main>
}
