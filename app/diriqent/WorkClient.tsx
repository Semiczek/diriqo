'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AiWorkspace, Operation } from '@/lib/diriqent/server'
import { formatCredits } from '@/lib/diriqent/domain'
import { workModeLabel } from '@/lib/diriqent/work'
import { checkAiOperation } from './actions'
import WorkComposer from './WorkComposer'
import WorkResultView from './WorkResultView'
import styles from './diriqent.module.css'

export default function WorkClient({ data, configured }: { data: AiWorkspace; configured: boolean }) {
  const router = useRouter()
  const [live, setLive] = useState<Record<string, Operation>>({})
  const [error, setError] = useState('')
  const [checking, setChecking] = useState<string | null>(null)
  const operations = useMemo(() => [...new Map([...data.operations, ...Object.values(live)].map(op => [op.id, op])).values()]
    .filter(op => op.work_mode === 'analytics' || op.work_mode === 'plan').sort((a, b) => b.created_at.localeCompare(a.created_at)), [data.operations, live])
  const receive = useCallback((operation: Operation) => { setLive(previous => ({ ...previous, [operation.id]: operation })); router.refresh() }, [router])
  const running = operations.find(op => op.state === 'running')?.id
  useEffect(() => {
    if (!running) return
    let disposed = false, attempts = 0
    let timer: ReturnType<typeof setTimeout>
    async function check() {
      try {
        const result = await checkAiOperation(data.companyId, running!)
        if (disposed) return
        if (result.ok) {
          setLive(previous => ({ ...previous, [result.value.id]: result.value }))
          if (result.value.state !== 'running') { router.refresh(); return }
        }
      } catch { /* A manual check remains available; never replay the provider POST. */ }
      if (!disposed && ++attempts < 30) timer = setTimeout(check, 5000)
    }
    timer = setTimeout(check, 4000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [data.companyId, running, router])
  async function check(id: string) {
    if (checking) return
    setChecking(id); setError('')
    try { const result = await checkAiOperation(data.companyId, id); if (result.ok) receive(result.value); else setError(result.error) }
    catch { setError('Výsledek se nyní nepodařilo ověřit. Zpracování se znovu nespouští.') }
    finally { setChecking(null) }
  }
  return <div className={styles.stack}>
    <section className={styles.card}><span className={styles.badge}>Placená práce s výslovným potvrzením</span><h2>Analytika a plány práce</h2><p>Vyhodnocení dostupných zakázek, vlastní docházky a návrhy dalších kroků. Rozsah podkladů určuje vaše role. <Link href="/diriqent">Podpora a návody jsou zdarma.</Link></p><p className={styles.muted}>Dostupný kredit: {formatCredits(data.availableUnits)}. Analytika používá testovací sazbu 2×, plánování 3× běžného dotazu při stejné spotřebě tokenů. Výsledná částka nepřekročí potvrzený limit.</p></section>
    {data.canRun && configured ? <WorkComposer companyId={data.companyId} role={data.roleScope ?? ''} onOperation={receive} /> : <p className={styles.notice}>Nové zpracování vyžaduje aktivní modul a nakonfigurovanou AI službu. Oprávněná historie zůstává dostupná.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <h2>Historie analýz a plánů</h2>
    {operations.length === 0 && <p className={styles.muted}>V aktuálním rozsahu oprávnění zatím není žádná analýza ani plán.</p>}
    {operations.map(op => <article className={styles.message} key={op.id}>
      <span className={styles.badge}>{workModeLabel(op.work_mode as 'analytics' | 'plan')}</span>
      <p className={styles.question}>{op.prompt}</p>
      {op.result ? <WorkResultView operation={op} /> : <p className={styles.muted}>{op.state === 'failed' ? 'Zpracování nedalo použitelný výsledek. Kredit nebyl odečten.' : op.state === 'unknown' ? 'Výsledek zatím není známý. Ověřte původní požadavek; nová AI práce se nespouští.' : 'Zpracování se připravuje…'}</p>}
      <div className={styles.actions}><small>{op.state === 'completed' ? `Spotřeba ${formatCredits(op.charged_units)}` : op.state === 'failed' ? 'Rezervace uvolněna' : `Rezervace ${formatCredits(op.reserved_units)}`} · Limit {formatCredits(op.reserved_units)} · {new Date(op.created_at).toLocaleString('cs-CZ')}</small>
        <Link href={`/diriqent/export?operation=${op.id}`} download prefetch={false} className={styles.secondary}>Export výsledku</Link>
        {['running', 'unknown', 'reserved'].includes(op.state) && <button type="button" disabled={checking !== null} className={styles.secondary} onClick={() => void check(op.id)}>Ověřit výsledek</button>}
      </div>
    </article>)}
  </div>
}
