'use client'
import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { formatCredits } from '@/lib/diriqent/domain'
import { diriqentScopeLabel } from '@/lib/diriqent/access'
import { canUseWorkDataset, workDatasetLabel, workModeLabel, type WorkDataset, type WorkMode, type WorkQuote } from '@/lib/diriqent/work'
import type { Operation } from '@/lib/diriqent/server'
import type { SupportAnswer } from '@/lib/diriqent/support'
import { prepareWork, runWork } from './work-actions'
import styles from './diriqent.module.css'

const defaultPrompts: Record<WorkMode, string> = {
  analytics: 'Analyzuj stav dostupných zakázek a mou vlastní docházku za vybrané období.',
  plan: 'Připrav návrh priorit a kroků pro dostupné zakázky za vybrané období.',
}

function currentDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const part = (name: string) => parts.find(value => value.type === name)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export default function WorkComposer({ companyId, role, onOperation }: { companyId: string; role: string; onOperation: (operation: Operation) => void }) {
  const [mode, setMode] = useState<WorkMode>('analytics')
  const [dataset, setDataset] = useState<WorkDataset>('operations')
  const [to, setTo] = useState(currentDate)
  const [from, setFrom] = useState(() => `${currentDate().slice(0, 8)}01`)
  const [prompt, setPrompt] = useState(defaultPrompts.analytics)
  const [limit, setLimit] = useState(500)
  const [quote, setQuote] = useState<WorkQuote | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [support, setSupport] = useState<SupportAnswer | null>(null)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const busy = useRef(false)
  const requestId = useRef<string | null>(null)
  function prepare() {
    if (busy.current) return
    busy.current = true; setError(''); setSupport(null)
    startTransition(async () => {
      try {
        const result = await prepareWork({ companyId, mode, spec: { dataset, from, to }, prompt, maxUnits: limit })
        if (!result.ok) { setError(result.error); return }
        if (result.support) { setSupport(result.support); return }
        if (result.quote) { setQuote(result.quote); setConfirmed(false); requestId.current = crypto.randomUUID() }
      } catch { setError('Potvrzení limitu se nepodařilo načíst. Zadání zůstalo zachované.') }
      finally { busy.current = false }
    })
  }
  function run() {
    if (busy.current || !quote || !confirmed || !requestId.current) return
    busy.current = true; setError('')
    const approval = { companyId, quoteId: quote.id, requestId: requestId.current, acceptedMaxUnits: quote.maxUnits, acceptedRateVersion: quote.rateVersion, confirmed: true }
    startTransition(async () => {
      try {
        const result = await runWork(approval)
        if (!result.ok) { setError(result.error); setUncertain(previous => previous || result.mayHaveStarted); return }
        onOperation(result.value)
        setQuote(null); setConfirmed(false); setUncertain(false); requestId.current = null
      } catch { setUncertain(true); setError('Odpověď se nepodařilo ověřit. Opakované potvrzení použije tentýž požadavek, nevytvářejte nové zadání.') }
      finally { busy.current = false }
    })
  }
  return <section className={`${styles.card} ${styles.stack}`}>
    <h2>{quote ? 'Potvrzení před spuštěním' : 'Nová analýza nebo plán'}</h2>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {support && <div className={styles.notice} aria-live="polite"><strong>Podpora · 0 Kč</strong><p>{support.answer}</p><Link href="/diriqent">Otevřít podporu bez kreditu</Link></div>}
    {quote ? <>
      <dl>
        <dt>Práce a data</dt><dd>{workModeLabel(quote.mode)} · {workDatasetLabel(quote.spec.dataset)}</dd>
        <dt>Období</dt><dd>{quote.spec.from} až {quote.spec.to} včetně, Europe/Prague</dd>
        <dt>Rozsah oprávnění</dt><dd>{diriqentScopeLabel(role)}</dd>
        <dt>Sazba</dt><dd>Testovací sazba {quote.multiplier}× běžný dotaz při stejné spotřebě tokenů. Účtuje se skutečné využití.</dd>
        <dt>Nejvyšší spotřeba</dt><dd><strong>{formatCredits(quote.maxUnits)}</strong> za celé toto zpracování. Nevyužitá rezerva se uvolní.</dd>
        <dt>Platnost potvrzení</dt><dd>Do {new Date(quote.expiresAt).toLocaleTimeString('cs-CZ')}</dd>
      </dl>
      <p className={styles.question}>{quote.prompt}</p>
      <p className={styles.muted}>{pending || uncertain ? 'Požadavek již mohl rezervovat kredit a spustit AI. Opakované potvrzení ověří totéž spuštění; zachováváme původní zadání i identifikátor.' : 'Zatím nebyl rezervován kredit ani spuštěna AI.'} Zpracování načte nejvýše 200 dostupných zakázek a 500 vlastních směn; případné omezení výběru uvede ve výsledku. Plán je návrh k posouzení a nic sám nezapisuje.</p>
      <label><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} /> Souhlasím se zadáním, sazbou a spotřebou nejvýše {formatCredits(quote.maxUnits)}.</label>
      <div className={styles.actions}>
        <button type="button" disabled={pending || !confirmed} className={styles.primary} onClick={run}>{pending ? 'Ověřuji spuštění…' : uncertain ? 'Ověřit stejné spuštění' : `Spustit nejvýše za ${formatCredits(quote.maxUnits)}`}</button>
        <button type="button" disabled={pending || uncertain} className={styles.secondary} onClick={() => { setQuote(null); setConfirmed(false); requestId.current = null }}>Upravit zadání</button>
      </div>
    </> : <form className={styles.stack} onSubmit={event => { event.preventDefault(); prepare() }}>
      <div className={styles.grid}>
        <label className={styles.field}>Druh práce<select disabled={pending} value={mode} onChange={event => { const next = event.target.value as WorkMode; setMode(next); setPrompt(value => Object.values(defaultPrompts).includes(value) ? defaultPrompts[next] : value) }}><option value="analytics">Analýza dat · sazba 2×</option><option value="plan">Plán složitějšího úkolu · sazba 3×</option></select></label>
        <label className={styles.field}>Povolené podklady<select disabled={pending} value={dataset} onChange={event => setDataset(event.target.value as WorkDataset)}><option value="operations">Zakázky a vlastní docházka</option>{canUseWorkDataset(role, 'finance') && <option value="finance">Hodnota zakázek podle měny</option>}</select></label>
        <label className={styles.field}>Od<input type="date" disabled={pending} required value={from} max={to} onChange={event => setFrom(event.target.value)} /></label>
        <label className={styles.field}>Do včetně<input type="date" disabled={pending} required value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
      </div>
      <p className={styles.muted}>Nejvýše 90 dní. Hodnota zakázek nepředstavuje zisk ani peníze na účtu. Docházka obsahuje pouze vaše vlastní směny.</p>
      <label className={styles.field}>Zadání<textarea required disabled={pending} value={prompt} maxLength={4000} onChange={event => setPrompt(event.target.value)} /></label>
      <label className={styles.field}>Maximální spotřeba za zpracování<select disabled={pending} value={limit} onChange={event => setLimit(Number(event.target.value))}><option value={100}>1 Kč</option><option value={500}>5 Kč</option><option value={1500}>15 Kč</option><option value={5000}>50 Kč</option></select></label>
      <div className={styles.actions}><button className={styles.primary} disabled={pending || !prompt.trim()}>{pending ? 'Připravuji potvrzení…' : 'Zkontrolovat zadání a limit'}</button><span className={styles.muted}>Tento krok nic neúčtuje.</span></div>
    </form>}
  </section>
}
