'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Workspace } from '@/lib/smart-quotes/server'
import { money } from '@/lib/smart-quotes/domain'
import QuoteEditor, { blankDraft } from './QuoteEditor'
import { runQuoteCommand } from './actions'
import styles from './quotes.module.css'

export default function AssetsEditor({ data, mode }: { data:Workspace; mode:'template'|'library' }) {
  const router=useRouter()
  const [editing,setEditing]=useState<string|null>(null)
  const [error,setError]=useState('')
  const [pending,startTransition]=useTransition()
  const template=data.templates.find(t=>t.id===editing)
  const item=data.library.find(i=>i.id===editing)
  const entries=mode==='template' ? data.templates.map(t=>({ id:t.id,name:t.name,archived:t.archived,detail:`${t.draft.variants.length} variant` })) : data.library.map(i=>({ id:i.id,name:i.item.name,archived:i.archived,detail:`${money(i.item.unitPrice)} / ${i.item.unit} bez DPH` }))
  const draft=item ? { ...blankDraft(),variants:[{ id:'variant-1',name:'Základní',discountPercent:0,items:[item.item] }] } : template?.draft
  return <div className={styles.stack}>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {data.canWrite && <div className={styles.actions}><button className={styles.primary} onClick={()=>setEditing('new')}>{mode==='template'?'Nová šablona':'Nová položka'}</button></div>}
    {editing && data.canWrite && <section className={styles.stack}><div className={styles.row}><h2>{editing==='new'?'Nový záznam':'Upravit záznam'}</h2><button className={styles.secondary} onClick={()=>setEditing(null)}>Zavřít editor</button></div><QuoteEditor key={`${mode}:${editing}`} mode={mode} companyId={data.companyId} id={editing==='new'?undefined:editing} revision={template?.revision??item?.revision} initial={draft} initialName={template?.name} library={data.library} onSaved={()=>setEditing(null)} /></section>}
    <section className={styles.card}>{entries.filter(e=>!e.archived).length===0 ? <p className={styles.muted}>Zatím tu nic není. Uložte vlastní {mode==='template'?'šablonu, kterou potom použijete pro nové nabídky.':'položky pro rychlé sestavení dalších nabídek.'}</p> : entries.filter(e=>!e.archived).map(entry=><div className={styles.listRow} key={entry.id}><div><strong>{entry.name}</strong><small>{entry.detail}</small></div>{data.canWrite && <div className={styles.actions}><button className={styles.secondary} onClick={()=>setEditing(entry.id)}>Upravit</button><button disabled={pending} className={styles.secondary} onClick={()=>startTransition(async()=>{ const result=await runQuoteCommand(data.companyId,mode==='template'?'template_archive':'library_archive',{ id:entry.id }); if(!result.ok) setError(result.error); else { setEditing(null); router.refresh() } })}>Archivovat</button></div>}</div>)}</section>
    {entries.some(e=>e.archived) && <details className={`${styles.card} ${styles.details}`}><summary>Archiv ({entries.filter(e=>e.archived).length})</summary>{entries.filter(e=>e.archived).map(e=><div key={e.id} className={styles.listRow}><strong>{e.name}</strong><span className={styles.muted}>{e.detail}</span></div>)}</details>}
  </div>
}
