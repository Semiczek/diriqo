'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import SupportClient from '@/app/diriqent/SupportClient'
import ContextBoundary from '@/app/diriqent/ContextBoundary'
import { diriqentScope, diriqentScopeLabel, type DiriqentIdentity } from '@/lib/diriqent/access'
import { supportSuggestions } from '@/lib/diriqent/support'
import styles from './floating-diriqent.module.css'

export default function DiriqentPanel({ onClose, onOpenGuide }: { onClose: () => void; onOpenGuide?: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [identity, setIdentity] = useState<DiriqentIdentity | null>(null)
  const [error, setError] = useState(false)
  function close() {
    dialogRef.current?.close()
    onClose()
  }

  useEffect(() => {
    const dialog = dialogRef.current
    // Nonmodal: keep the current page usable and respect existing legal/modal layers.
    dialog?.show()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    let stopped = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    async function load() {
      try {
        const response = await fetch('/api/diriqent/context', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('context-unavailable')
        const value = await response.json() as Partial<DiriqentIdentity> | null
        if (!value || typeof value.companyId !== 'string' || !value.companyId
          || typeof value.profileId !== 'string' || !value.profileId
          || typeof value.role !== 'string' || !diriqentScope(value.role)) throw new Error('invalid-context')
        if (!stopped) setIdentity({ companyId: value.companyId, profileId: value.profileId, role: value.role })
      } catch { if (!stopped) setError(true) }
      finally { clearTimeout(timeout) }
    }
    void load()
    return () => { stopped = true; clearTimeout(timeout); controller.abort() }
  }, [])

  return <dialog ref={dialogRef} id="floating-diriqent" aria-labelledby="floating-diriqent-title"
    className={styles.panel} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }}>
    <header className={styles.header}>
      <div><h2 id="floating-diriqent-title">Diriqent</h2><p>Váš pomocník v Diriqu</p></div>
      <button type="button" className={styles.close} aria-label="Zavřít Diriqenta" onClick={close}>×</button>
    </header>
    <div className={styles.body}>
      <div className={styles.freeLabel}>Podpora zdarma · 0 Kč</div>
      {!identity && !error && <p role="status">Ověřuji váš přístup…</p>}
      {error && <p role="alert">Podporu se nepodařilo načíst. Zavřete Diriqenta a zkuste ho znovu otevřít.</p>}
      {identity && <ContextBoundary key={`${identity.companyId}:${identity.profileId}:${identity.role}`} identity={identity}>
        <SupportClient identity={identity} suggestions={supportSuggestions(identity.role)} compact onNavigate={close} />
        <p className={styles.scope}>Rozsah přístupu: {diriqentScopeLabel(identity.role)}.</p>
      </ContextBoundary>}
      {onOpenGuide && <button type="button" className={styles.guide} onClick={() => { dialogRef.current?.close(); onOpenGuide() }}>Nápověda k této stránce a průvodce</button>}
    </div>
    <footer className={styles.footer}>
      <p><strong>Práce s daty je placená</strong><span>Spustí se až po vašem potvrzení limitu a podle vašich oprávnění.</span></p>
      <nav aria-label="Placené režimy Diriqenta">
        <Link href="/diriqent?mode=work" prefetch={false} onClick={close}>Běžná práce</Link>
        <Link href="/diriqent?mode=advanced" prefetch={false} onClick={close}>Analytika a plány →</Link>
      </nav>
      <Link className={styles.fullPage} href="/diriqent" prefetch={false} onClick={close}>Otevřít celého Diriqenta</Link>
    </footer>
  </dialog>
}
