'use client'
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { OcrResult } from '@/lib/diriqent/domain'
import { decimalToMinor, inventoryHref, quantityValue } from '@/lib/inventory/domain'
import { createReviewedInventoryReceipt } from './actions'
import SearchSelect from './SearchSelect'
import s from './inventory.module.css'

export default function ReviewedReceipt({companyId,operationId,result,warehouseId}:{companyId:string;operationId:string;result:OcrResult;warehouseId?:string}) {
 const router=useRouter();const [pending,start]=useTransition();const [error,setError]=useState('');const busy=useRef(false)
 if(!result.items.length)return null
 return <div className={s.page}><details className={s.receiptReview}><summary>Zkontrolovat a připravit příjemku</summary><form onSubmit={event=>{
  event.preventDefault();if(busy.current)return;setError('');const f=new FormData(event.currentTarget)
  try {
   const lines=result.items.flatMap((_,i)=>f.get('include-'+i)==='on'?[{item_id:String(f.get('item-'+i)??''),quantity:quantityValue(String(f.get('quantity-'+i)??'')),unit_cost_minor:decimalToMinor(String(f.get('cost-'+i)??''))}]:[])
   if(!lines.length)throw new Error('Vyberte alespoň jednu položku příjemky.')
   busy.current=true
   start(async()=>{try{const saved=await createReviewedInventoryReceipt(companyId,operationId,{warehouse_id:String(f.get('warehouse_id')??''),reason:String(f.get('reason')??''),lines},f.get('checked')==='on');if(!saved.ok)setError(saved.message);else if(saved.id)router.push(inventoryHref('documents',String(f.get('warehouse_id')??''),{document:saved.id}))}catch{setError('Výsledek spojení není známý. Ověřte Doklady skladu před dalším pokusem.')}finally{busy.current=false}})
  }catch(error){setError(error instanceof Error?error.message:'Zkontrolujte příjemku.')}
 }}>
 <p className={s.muted}>Spárujte řádky se skladovými položkami. Ověřte množství ve skladové jednotce a nákupní cenu bez DPH v Kč. Nejasné ceny doplňte ručně. Vznikne pouze koncept; zásobu změní až vaše potvrzení v Dokladech.</p>
 {result.currency&&result.currency!=='CZK'?<p className={s.error}>Podklad je v měně {result.currency}. Ceny převeďte do Kč podle vlastního ověřeného přepočtu.</p>:null}
 {error?<p className={`${s.notice} ${s.error}`} role="alert">{error}</p>:null}
 <div className={s.formGrid}><SearchSelect companyId={companyId} kind="warehouses" name="warehouse_id" label="Přijmout do skladu" initialOption={warehouseId?{id:warehouseId,name:'Sklad vybraný v pracovní ploše'}:undefined}/><label className={s.field}>Číslo dokladu / poznámka<input name="reason" maxLength={800} defaultValue={[result.documentNumber,result.supplierName].filter(Boolean).join(' · ')}/></label></div>
 {result.items.map((item,i)=><div key={i} className={s.receiptLine}><h3><label><input type="checkbox" name={'include-'+i} defaultChecked style={{width:'auto',minHeight:0}}/> {item.name}</label></h3><small>Podklad: {item.quantity??'neznámé množství'} {item.unit} · {item.unitPrice??'neznámá cena'} {result.currency} / jedn.</small><div className={s.formGrid}><SearchSelect companyId={companyId} kind="items" name={'item-'+i} label="Skladová položka" required={false}/><label className={s.field}>Množství ve skladové jednotce<input name={'quantity-'+i} inputMode="decimal" defaultValue={item.quantity??''}/></label><label className={s.field}>Nákupní cena bez DPH / jednotka (Kč)<input name={'cost-'+i} inputMode="decimal" placeholder="Zkontrolujte proti originálu"/></label></div></div>)}
 <label className={s.field} style={{marginTop:18,display:'block'}}><input type="checkbox" required name="checked" style={{width:'auto',minHeight:0}}/> Ověřil/a jsem položky, skladové jednotky, množství a ceny bez DPH proti originálu.</label>
 <div className={s.actions}><button className={s.button} disabled={pending}>{pending?'Připravuji…':'Uložit koncept příjemky'}</button></div>
 </form></details></div>
}