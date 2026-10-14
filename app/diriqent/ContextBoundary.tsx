'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { DiriqentIdentity } from '@/lib/diriqent/access'
import { watchDiriqentIdentity, type DiriqentContextState } from '@/lib/diriqent/context-watch'
import styles from './diriqent.module.css'

export default function ContextBoundary({ identity, children }: { identity: DiriqentIdentity; children: ReactNode }) {
  const [state, setState] = useState<DiriqentContextState>('checking')
  const { companyId, profileId, role } = identity
  useEffect(() => watchDiriqentIdentity({ companyId, profileId, role }, setState), [companyId, profileId, role])

  if (state === 'blocked') return <div className={styles.notice} role="alert">
    Firma nebo oprávnění se změnily, případně je nyní nelze ověřit. Obsah rozhovoru je skrytý.
    <div className={styles.actions}><button className={styles.secondary} onClick={() => window.location.reload()}>Znovu ověřit přístup</button></div>
  </div>
  // Keep a same-role draft mounted during a brief check; revoke by unmounting above.
  return <>{state === 'checking' && <p className={styles.notice} role="status">Ověřuji aktuální přístup…</p>}<div hidden={state !== 'ready'}>{children}</div></>
}
