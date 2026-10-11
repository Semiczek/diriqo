'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { MIN_MARGIN_PERCENT, money, validateDraft, variantTotals, type QuoteDraft, type QuoteItem, type QuoteVariant } from '@/lib/smart-quotes/domain'
import type { LibraryItem, Template } from '@/lib/smart-quotes/server'
import { runQuoteCommand } from './actions'
import styles from './quotes.module.css'

const blankItem = (id: string): QuoteItem => ({ id, name:'', description:'', quantity:1, unit:'ks', unitPrice:0, vatRate:21, costPrice:0 })
export function blankDraft(): QuoteDraft {
  return { title:'', customerName:'', customerEmail:'', validUntil:new Date(Date.now()+30*86400000).toISOString().slice(0,10), deliveryTerms:'', terms:'',
    variants:[{ id:'variant-1', name:'Základní varianta', discountPercent:0, items:[blankItem('item-1')] }] }
}

function ItemFields({ item, change }: { item: QuoteItem; change: (item: QuoteItem) => void }) {
  const numeric = (key: 'quantity' | 'unitPrice' | 'vatRate' | 'costPrice', label: string, min: number, max: number, step: string) =>
    <label className={styles.field}>{label}<input type="number" required min={min} max={max} step={step} value={item[key]} onChange={e => change({ ...item, [key]:Number(e.target.value) })} /></label>
  return <><div className={styles.grid}><label className={styles.field}>Název položky<input required maxLength={200} value={item.name} onChange={e => change({ ...item, name:e.target.value })} /></label>
    <label className={styles.field}>Jednotka<input required maxLength={20} value={item.unit} onChange={e => change({ ...item, unit:e.target.value })} /></label></div>
    <div className={styles.itemFields}>{numeric('quantity','Množství',0.001,1000000,'0.001')}{numeric('unitPrice','Cena za jednotku bez DPH',0,100000000,'0.01')}{numeric('vatRate','DPH (%)',0,100,'0.01')}{numeric('costPrice','Interní náklad / jednotku',0,100000000,'0.01')}</div>
    <label className={styles.field}>Popis pro zákazníka<textarea maxLength={2000} rows={2} value={item.description} onChange={e => change({ ...item, description:e.target.value })} /></label></>
}

type Props = {
  companyId: string; initial?: QuoteDraft; id?: string; revision?: number; initialCustomerId?: string | null
  customers?: { id:string; name:string }[]; templates?: Template[]; library?: LibraryItem[]
  mode?: 'quote' | 'template' | 'library'; initialName?: string; onSaved?: () => void
}
export default function QuoteEditor({ companyId, initial, id, revision, initialCustomerId, customers=[], templates=[], library=[], mode='quote', initialName='', onSaved }: Props) {
  const router = useRouter()
  const [draft,setDraft] = useState<QuoteDraft>(() => initial ?? blankDraft())
  const [customerId,setCustomerId] = useState(initialCustomerId ?? '')
  const [name,setName] = useState(initialName)
  const [error,setError] = useState('')
  const [pending,startTransition] = useTransition()
  const replaceVariant = (variant: QuoteVariant) => setDraft(d => ({ ...d, variants:d.variants.map(v => v.id===variant.id ? variant : v) }))
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    startTransition(async () => {
      try {
        const next = mode==='quote' ? draft : { ...draft, title:mode==='template' ? name : draft.variants[0].items[0].name, customerName:'Šablona', customerEmail:'' }
        const checked = validateDraft(next)
        const result = await runQuoteCommand(companyId,mode==='template' ? 'template_save' : mode==='library' ? 'library_save' : 'save',{ id, revision, name, customerId, draft:checked })
        if (!result.ok) { setError(result.error); return }
        if (onSaved) onSaved()
        if (mode==='quote' && result.id) router.push(`/smart-quotes/${result.id}`)
        router.refresh()
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nabídku se nepodařilo uložit.') }
    })
  }
  return <form onSubmit={save} className={styles.stack}>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    <fieldset disabled={pending} className={styles.stack} style={{ border:0, padding:0, margin:0, minWidth:0 }}>
      {mode!=='library' && <section className={styles.card}><div className={styles.stack}>
        {mode==='quote' && templates.filter(t=>!t.archived).length>0 && <label className={styles.field}>Začít ze šablony<select defaultValue="" onChange={e=> { const template=templates.find(t=>t.id===e.target.value); if(template) setDraft({ ...template.draft, title:template.name, customerName:draft.customerName, customerEmail:draft.customerEmail, validUntil:blankDraft().validUntil }) }}><option value="" disabled>Vyberte šablonu před vyplněním</option>{templates.filter(t=>!t.archived).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        {mode==='template' ? <label className={styles.field}>Název šablony<input required maxLength={160} value={name} onChange={e=>setName(e.target.value)} /></label> : <>
          <label className={styles.field}>Název nabídky<input required maxLength={200} value={draft.title} onChange={e=>setDraft({ ...draft,title:e.target.value })} /></label>
          <div className={styles.grid}><label className={styles.field}>Zákazník z adresáře<select value={customerId} onChange={e=> { setCustomerId(e.target.value); const c=customers.find(c=>c.id===e.target.value); if(c) setDraft({ ...draft,customerName:c.name }) }}><option value="">Zadat ručně</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className={styles.field}>Název zákazníka<input required maxLength={200} value={draft.customerName} onChange={e=>setDraft({ ...draft,customerName:e.target.value })} /></label>
            <label className={styles.field}>E-mail zákazníka<input type="email" maxLength={254} value={draft.customerEmail} onChange={e=>setDraft({ ...draft,customerEmail:e.target.value })} /></label>
            <label className={styles.field}>Platnost do<input type="date" required value={draft.validUntil} onChange={e=>setDraft({ ...draft,validUntil:e.target.value })} /></label></div></>}
        <label className={styles.field}>Termín a místo realizace<textarea maxLength={4000} value={draft.deliveryTerms} onChange={e=>setDraft({ ...draft,deliveryTerms:e.target.value })} /></label>
        <label className={styles.field}>Podmínky nabídky<textarea maxLength={10000} value={draft.terms} onChange={e=>setDraft({ ...draft,terms:e.target.value })} /></label>
      </div></section>}
      {draft.variants.map((variant,variantIndex)=> {
        const totals=variantTotals(variant)
        return <section key={variant.id} className={`${styles.card} ${styles.stack}`}>
          {mode!=='library' && <><div className={styles.row}><h2>Varianta {variantIndex+1}</h2>{draft.variants.length>1 && <button type="button" className={styles.secondary} onClick={()=>setDraft({ ...draft,variants:draft.variants.filter(v=>v.id!==variant.id) })}>Odstranit variantu</button>}</div>
            <div className={styles.grid}><label className={styles.field}>Název varianty<input required maxLength={160} value={variant.name} onChange={e=>replaceVariant({ ...variant,name:e.target.value })} /></label><label className={styles.field}>Sleva na tuto variantu (%)<input type="number" required min={0} max={100} step="0.01" value={variant.discountPercent} onChange={e=>replaceVariant({ ...variant,discountPercent:Number(e.target.value) })} /></label></div></>}
          {variant.items.map((item,index)=><div className={styles.item} key={item.id}><div className={styles.row}><h3>{mode==='library' ? 'Položka knihovny' : `Položka ${index+1}`}</h3>{variant.items.length>1 && <button type="button" className={styles.secondary} onClick={()=>replaceVariant({ ...variant,items:variant.items.filter(i=>i.id!==item.id) })}>Odebrat</button>}</div>
            <ItemFields item={item} change={next=>replaceVariant({ ...variant,items:variant.items.map(i=>i.id===item.id?next:i) })} /></div>)}
          {mode!=='library' && <><div className={styles.actions}><button type="button" className={styles.secondary} disabled={variant.items.length>=200} onClick={()=>replaceVariant({ ...variant,items:[...variant.items,blankItem(crypto.randomUUID())] })}>Přidat položku</button>
            {library.some(l=>!l.archived) && <label className={styles.field}>Přidat z knihovny<select value="" disabled={variant.items.length>=200} onChange={e=> { const entry=library.find(l=>l.id===e.target.value); if(entry) replaceVariant({ ...variant,items:[...variant.items,{ ...entry.item,id:crypto.randomUUID() }] }) }}><option value="">Vyberte položku</option>{library.filter(l=>!l.archived).map(l=><option key={l.id} value={l.id}>{l.item.name}</option>)}</select></label>}</div>
            <div className={styles.totals}><span className={styles.muted}>Bez DPH<strong>{money(totals.net)}</strong></span><span className={styles.muted}>Cena s DPH<strong>{money(totals.total)}</strong></span><span className={styles.muted}>Interní marže<strong>{totals.margin.toLocaleString('cs-CZ')} %</strong></span></div>
            {totals.margin<MIN_MARGIN_PERCENT && <p className={styles.muted}>Marži pod {MIN_MARGIN_PERCENT} % musí před vydáním schválit administrátor firmy.</p>}</>}
        </section>
      })}
      <div className={styles.actions}><button className={styles.primary} type="submit">{pending?'Ukládám…':mode==='quote'?'Uložit návrh':mode==='template'?'Uložit šablonu':'Uložit položku'}</button>{mode!=='library' && <button type="button" className={styles.secondary} disabled={draft.variants.length>=10} onClick={()=>setDraft({ ...draft,variants:[...draft.variants,{ id:crypto.randomUUID(),name:`Varianta ${draft.variants.length+1}`,discountPercent:0,items:[blankItem(crypto.randomUUID())] }] })}>Přidat variantu</button>}</div>
    </fieldset>
    <p className={styles.muted}>Interní náklady a marže se zákazníkovi nezobrazí. Nabídka funguje ručně bez AI. Uložením se zákazníkovi neposílá e-mail.</p>
  </form>
}
