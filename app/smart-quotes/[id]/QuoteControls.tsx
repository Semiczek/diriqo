'use client'
import Link from 'next/link'
import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { MIN_MARGIN_PERCENT, variantTotals } from '@/lib/smart-quotes/domain'
import type { QuoteRecord, Workspace } from '@/lib/smart-quotes/server'
import { runQuoteCommand, type QuoteCommand } from '../actions'
import styles from '../quotes.module.css'

export default function QuoteControls({ companyId, quote, acceptance, conversion, canConvert }: { companyId:string; quote:QuoteRecord; acceptance:Workspace['acceptance']; conversion:Workspace['conversion']; canConvert:boolean }) {
  const router=useRouter()
  const [pending,startTransition]=useTransition()
  const [error,setError]=useState('')
  const [link,setLink]=useState('')
  const [copied,setCopied]=useState(false)
  const [message,setMessage]=useState('')
  function run(command:QuoteCommand, payload:Record<string,unknown>={}) {
    setError(''); setMessage('')
    startTransition(async()=>{
      const result=await runQuoteCommand(companyId,command,{ id:quote.id,revision:quote.revision,...payload })
      if(!result.ok) { setError(result.error); return }
      if(result.token) { setLink(`${window.location.origin}/quote/${result.token}`); setCopied(false) }
      if(command==='approve') setMessage('Schválení této revize bylo uloženo.')
      if(result.jobId) router.push(`/jobs/${result.jobId}`)
      router.refresh()
    })
  }
  function convert(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values=new FormData(event.currentTarget)
    const start=new Date(String(values.get('start'))),end=new Date(String(values.get('end')))
    if(!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end<=start) { setError('Konec zakázky musí následovat po jejím začátku.'); return }
    run('convert',{ startAt:start.toISOString(),endAt:end.toISOString(),address:String(values.get('address')??'') })
  }
  const belowMargin=quote.draft.variants.some(v=>variantTotals(v).margin<MIN_MARGIN_PERCENT)
  return <div className={styles.stack}>
    {error && <div className={styles.error} role="alert">{error}</div>}{message && <div className={styles.notice} role="status">{message}</div>}
    {quote.status!=='accepted' && <div className={styles.actions}>
      {quote.published_revision!==quote.revision && <button disabled={pending || (belowMargin && quote.approved_revision!==quote.revision)} onClick={()=>run('publish')} className={styles.primary}>{pending?'Pracuji…':'Vydat a vytvořit odkaz'}</button>}
      <Link className={styles.secondary} href={`/smart-quotes/${quote.id}/edit`}>Upravit návrh</Link>
      {quote.current_version>0 && <button disabled={pending} onClick={()=>run('share')} className={styles.secondary}>Nový odkaz na vydanou verzi</button>}
    </div>}
    {link && <div className={`${styles.card} ${styles.stack}`}><h2>Odkaz je připravený</h2><p className={styles.muted}>Zkopírujte jej a předejte zákazníkovi. Odkaz umožňuje přečíst a přijmout tuto verzi; uchovejte jej jako soukromý. Žádný e-mail jsme neodeslali.</p><label className={styles.field}>Soukromý zákaznický odkaz<input readOnly value={link} onFocus={e=>e.target.select()} /></label><div className={styles.actions}><button className={styles.primary} onClick={async()=>{ try { await navigator.clipboard.writeText(link); setCopied(true) } catch { setError('Odkaz zkopírujte z označeného pole.') } }}>{copied?'Zkopírováno':'Zkopírovat odkaz'}</button><a href={link} target="_blank" rel="noopener noreferrer" className={styles.secondary}>Otevřít náhled zákazníka</a></div></div>}
    {belowMargin && quote.status!=='accepted' && quote.published_revision!==quote.revision && <section className={styles.card}><h2>Schválení marže</h2>{quote.approved_revision===quote.revision ? <p className={styles.notice}>Administrátor tuto revizi schválil. Důvod: {quote.approval_reason}</p> : <form className={styles.stack} onSubmit={event=>{ event.preventDefault(); run('approve',{ reason:String(new FormData(event.currentTarget).get('reason')) }) }}><p className={styles.muted}>Alespoň jedna varianta má marži pod {MIN_MARGIN_PERCENT} %. Schválení může udělit administrátor firmy; úprava návrhu jej zruší.</p><label className={styles.field}>Důvod schválení<textarea name="reason" required minLength={5} maxLength={1000} /></label><div><button disabled={pending} className={styles.secondary}>Schválit aktuální revizi</button></div></form>}</section>}
    {acceptance && <section className={styles.card}><h2>Převést přijatý rozsah na zakázku</h2>{conversion ? <Link className={styles.secondary} href={`/jobs/${conversion.job_id}`}>Otevřít vytvořenou zakázku</Link> : canConvert ? <form onSubmit={convert} className={styles.stack}><p className={styles.muted}>Převede se pouze přijatá varianta verze {acceptance.version}. Plánované náklady nezaloží žádný skutečný výdaj ani skladový pohyb.</p><div className={styles.grid}><label className={styles.field}>Začátek zakázky<input type="datetime-local" required name="start" /></label><label className={styles.field}>Konec zakázky<input type="datetime-local" required name="end" /></label></div><label className={styles.field}>Adresa realizace<input name="address" maxLength={1000} /></label><div><button disabled={pending} className={styles.primary}>{pending?'Vytvářím…':'Vytvořit zakázku'}</button></div></form> : <p className={styles.notice}>Zakázku může vytvořit administrátor firmy s aktivním Diriqo Core.</p>}</section>}
  </div>
}
