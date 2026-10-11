'use client'
import {useState,useTransition} from 'react'
import {useRouter} from 'next/navigation'
import type {OcrResult} from '@/lib/diriqent/domain'
import {createReviewedOcrQuote} from '../actions'
import styles from '../diriqent.module.css'
export default function ReviewedQuote({companyId,operationId,result}:{companyId:string;operationId:string;result:OcrResult}) {
  const router=useRouter(),[error,setError]=useState(''),[pending,startTransition]=useTransition()
  const [validUntil]=useState(()=>new Date(Date.now()+30*86400000).toISOString().slice(0,10))
  if(result.items.length===0)return null
  return <details className={styles.details}><summary>Zkontrolovat položky a připravit nabídku</summary><form className={styles.stack} onSubmit={event=>{
    event.preventDefault();setError('');const f=new FormData(event.currentTarget)
    const items=result.items.map((_,i)=>({id:`ocr-${i+1}`,name:String(f.get(`name-${i}`)),description:`Podklad OCR, položka ${i+1}; hodnoty ručně zkontrolovány.`,quantity:Number(f.get(`qty-${i}`)),unit:String(f.get(`unit-${i}`)),unitPrice:Number(f.get(`price-${i}`)),vatRate:Number(f.get(`vat-${i}`)),costPrice:Number(f.get(`cost-${i}`))}))
    const draft={title:String(f.get('title')),customerName:String(f.get('customer')),customerEmail:'',validUntil:String(f.get('until')),deliveryTerms:'',terms:'',variants:[{id:'reviewed',name:'Zkontrolovaná varianta',discountPercent:0,items}]}
    startTransition(async()=>{const saved=await createReviewedOcrQuote(companyId,operationId,draft,f.get('checked')==='on');if(!saved.ok)setError(saved.error);else router.push(`/smart-quotes/${saved.value}`)})
  }}><p className={styles.notice}>Ceny podkladu nemusí být vaše prodejní ceny. Každou položku zkontrolujte a doplňte prodejní cenu i interní náklad. Založí se pouze návrh nabídky.</p>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    <label className={styles.field}>Název nabídky<input name="title" required maxLength={200}/></label><div className={styles.grid}><label className={styles.field}>Zákazník<input name="customer" required maxLength={200}/></label><label className={styles.field}>Platnost do<input name="until" type="date" required defaultValue={validUntil}/></label></div>
    {result.items.map((item,i)=><div className={`${styles.card} ${styles.stack}`} key={i}><label className={styles.field}>Položka {i+1}<input name={`name-${i}`} required maxLength={200} defaultValue={item.name}/></label><div className={styles.grid}><label className={styles.field}>Množství<input name={`qty-${i}`} type="number" min={0.001} max={1000000} step="0.001" required defaultValue={item.quantity??''}/></label><label className={styles.field}>Jednotka<input name={`unit-${i}`} required maxLength={20} defaultValue={item.unit}/></label><label className={styles.field}>Prodejní cena / jedn. bez DPH<input name={`price-${i}`} type="number" required min={0} max={100000000} step="0.01" defaultValue={item.unitPrice??''}/></label><label className={styles.field}>DPH (%)<input name={`vat-${i}`} type="number" required min={0} max={100} step="0.01" defaultValue={item.vatRate??''}/></label><label className={styles.field}>Interní náklad / jedn.<input name={`cost-${i}`} type="number" required min={0} max={100000000} step="0.01"/></label></div></div>)}
    <label><input type="checkbox" name="checked" required/> Ověřil/a jsem položky, množství a ceny proti podkladu.</label><div><button className={styles.primary} disabled={pending}>{pending?'Ukládám…':'Uložit ověřený návrh nabídky'}</button></div>
  </form></details>
}
