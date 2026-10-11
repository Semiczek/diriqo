'use client'
import { useState,useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { money,type PublicVariant } from '@/lib/smart-quotes/domain'
import { respondToQuote } from './actions'
import styles from '../../smart-quotes/quotes.module.css'

export default function AcceptanceForm({token,version,variants}:{token:string;version:number;variants:PublicVariant[]}) {
  const router=useRouter()
  const [pending,startTransition]=useTransition()
  const [error,setError]=useState('')
  const [complete,setComplete]=useState(false)
  if(complete) return <div className={styles.notice} role="status">Vaše odpověď byla uložena. Děkujeme.</div>
  return <form className={`${styles.card} ${styles.stack} ${styles.noPrint}`} onSubmit={event=>{
    event.preventDefault(); setError('')
    const form=new FormData(event.currentTarget,(event.nativeEvent as SubmitEvent).submitter)
    startTransition(async()=>{ const result=await respondToQuote(token,version,form); if(!result.ok) setError(result.error); else {setComplete(true);router.refresh()} })
  }}><h2>Vaše rozhodnutí · verze {version}</h2>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    <fieldset disabled={pending} className={styles.stack} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <legend>Vyberte jednu variantu nabídky</legend>
      {variants.map(v=><label key={v.id} className={styles.choice}><input type="radio" name="variant" value={v.id} required defaultChecked={variants.length===1}/><span><strong>{v.name}</strong><br/>{money(v.total)} včetně DPH</span></label>)}
      <div className={styles.grid}><label className={styles.field}>Vaše jméno<input name="name" autoComplete="name" required minLength={2} maxLength={200}/></label><label className={styles.field}>Váš e-mail<input name="email" type="email" autoComplete="email" required maxLength={254}/></label></div>
      <label className={styles.check}><input type="checkbox" name="consent" required/><span>Přečetl/a jsem si verzi {version}, její ceny a podmínky. Mám oprávnění za zákazníka potvrdit níže zvolenou odpověď.</span></label>
      <p className={styles.muted}>Uložíme vybranou variantu, vaše jméno, e-mail a čas odpovědi. Přístup potvrzuje soukromý odkaz; vaše totožnost není samostatně ověřována.</p>
      <div className={styles.actions}><button name="decision" value="accept" className={styles.primary} disabled={pending}>{pending?'Ukládám…':'Přijmout vybranou variantu'}</button><button name="decision" value="reject" className={styles.secondary} disabled={pending}>Odmítnout nabídku</button></div>
    </fieldset>
  </form>
}
