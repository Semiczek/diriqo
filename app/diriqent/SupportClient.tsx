'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import type { DiriqentIdentity } from '@/lib/diriqent/access'
import type { SupportAnswer } from '@/lib/diriqent/support'
import { askDiriqentSupport } from './support-actions'
import styles from './diriqent.module.css'

export default function SupportClient({ identity, suggestions }: { identity: DiriqentIdentity; suggestions: string[] }) {
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState<SupportAnswer | null>(null)
  const [question, setQuestion] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const submitting = useRef(false)
  function submit(value: string) {
    if (submitting.current || !value.trim()) return
    submitting.current = true
    setError('')
    startTransition(async () => {
      try {
        const result = await askDiriqentSupport(identity, value)
        if (!result.ok) { setError(result.error); return }
        setAnswer(result.value)
        setQuestion(value)
        setPrompt('')
      } catch { setError('Podpora není dostupná. Vaše rozepsaná otázka zůstala zachovaná.') }
      finally { submitting.current = false }
    })
  }
  return <div className={styles.stack}>
    <section className={styles.card}>
      <span className={styles.badge}>Bez čerpání AI kreditu</span>
      <h2>Jak vám můžu pomoci s Diriqem?</h2>
      <p className={styles.muted}>Návody a orientace v aplikaci jsou dostupné i bez AI kreditu. Podpora používá ověřené návody; nečte firemní záznamy a nespouští placenou analýzu.</p>
      <div className={styles.actions}>{suggestions.map(text => <button key={text} disabled={pending} className={styles.secondary} onClick={() => { setPrompt(text); submit(text) }}>{text}</button>)}</div>
    </section>
    {answer && <article className={styles.message} aria-live="polite">
      <p className={styles.question}>{question}</p>
      <h2>{answer.title}</h2>
      <p className={styles.answer}>{answer.answer}</p>
      <div className={styles.actions}>{answer.links.map(link => <Link key={link.href} href={link.href} className={styles.secondary}>{link.label}</Link>)}</div>
      {answer.kind === 'needs_data' && <p className={styles.muted}>Práce s firemními daty se spouští samostatně s vaším limitem spotřeby. Otevření dalšího režimu nic neúčtuje.</p>}
      {answer.kind === 'needs_data' && <div className={styles.actions}><Link href="/diriqent?mode=work" className={styles.secondary}>Běžná práce a návrhy</Link><Link href="/diriqent?mode=advanced" className={styles.secondary}>Analytika a plány s cenovým limitem</Link></div>}
      <small className={styles.muted}>Spotřeba AI kreditu: 0 Kč</small>
    </article>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <form className={`${styles.card} ${styles.stack}`} onSubmit={event => { event.preventDefault(); submit(prompt) }}>
      <label className={styles.field}>Otázka k ovládání aplikace<textarea value={prompt} disabled={pending} required maxLength={2000} onChange={event => setPrompt(event.target.value)} placeholder="Například: Jak vytvořím nový dokument?" /></label>
      <div className={styles.actions}><button className={styles.primary} disabled={pending || !prompt.trim()}>{pending ? 'Hledám návod…' : 'Získat pomoc zdarma'}</button></div>
    </form>
  </div>
}
