'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import FloatingDiriqent from '@/components/diriqent/FloatingDiriqent'
import { notifyOfficeContextChanged } from '@/lib/office/client-context'
import type { publicMobileContext } from './data'
import styles from './mobile.module.css'
import { signOutMobileAction } from './actions'

type Props = { app: 'my' | 'manager'; context?: ReturnType<typeof publicMobileContext>; children: ReactNode }

export default function MobileShell({ app, context, children }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function switchCompany(companyId: string) {
    setSwitching(true); setError(null)
    try {
      const response = await fetch('/api/active-company', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId }) })
      if (!response.ok) throw new Error('Firmu se nepodařilo změnit.')
      notifyOfficeContextChanged()
      router.refresh()
    } catch { setError('Firmu se nepodařilo změnit. Zkuste to znovu.') }
    finally { setSwitching(false) }
  }
  return <div className={styles.app} data-app={app}>
    <header className={styles.header}>
      <Link className={styles.brand} href={`/mobile/${app}`}><Image className={styles.logo} src="/diriqo-logo-icon.png" width={42} height={42} alt="" /><span>{app === 'my' ? 'My Diriqo' : 'Diriqo Manager'}<small>{app === 'my' ? 'Váš pracovní den' : 'Vaše firma v přehledu'}</small></span></Link>
      <form action={signOutMobileAction}><button className={styles.logout} type="submit">Odhlásit</button></form>
    </header>
    <main className={styles.main}>
      {context && <section className={styles.identity}>
        <div><span className={styles.eyebrow}>Přihlášený účet</span><strong>{context.profileName || 'Člen týmu'}</strong></div>
        <label><span className={styles.eyebrow}>Aktivní firma</span><select aria-label="Aktivní firma" value={context.companyId} disabled={switching} onChange={event => void switchCompany(event.target.value)}>
          {context.companyMemberships.map(company => <option key={company.companyId} value={company.companyId}>{company.companyName || 'Firma'}</option>)}
        </select></label>
      </section>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {children}
      <p className={styles.onlineNote}>Změny se ukládají při připojení k internetu. Před zavřením vždy vyčkejte na potvrzení.</p>
    </main>
    {context && <FloatingDiriqent key={`${pathname}:${context.companyId}:${context.role}`} />}
  </div>
}
