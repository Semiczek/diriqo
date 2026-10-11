'use client'
import Link from 'next/link'
import {useState,useTransition} from 'react'
import type {JobDraft} from '@/lib/diriqent/domain'
import {formatCredits} from '@/lib/diriqent/domain'
import type {Proposal} from '@/lib/diriqent/server'
import {confirmAiJob,prepareAiJob} from './actions'
import styles from './diriqent.module.css'
const localTime=(iso:string|null)=>{if(!iso)return '';const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
export default function JobProposal({companyId,operationId,draft,customers,initial}:{companyId:string;operationId:string;draft:JobDraft;customers:{id:string;name:string}[];initial?:Proposal}) {
  const [proposal,setProposal]=useState(initial),[error,setError]=useState(''),[pending,startTransition]=useTransition()
  return <section className={`${styles.card} ${styles.stack}`}><h3>Návrh zakázky</h3>{error&&<div className={styles.error} role="alert">{error}</div>}
    {proposal?.job_id?<Link className={styles.secondary} href={`/jobs/${proposal.job_id}`}>Otevřít vytvořenou zakázku</Link>:proposal?<>
      <p className={styles.notice}>Zkontrolujte tento přesný rozsah. Až potvrzením níže vznikne zakázka.</p><strong>{proposal.payload.title}</strong><p className={styles.answer}>{proposal.payload.description}</p><p>Zákazník: {proposal.payload.customerName||'Bez přiřazeného zákazníka'}<br/>{proposal.payload.address||'Bez adresy'}<br/>{new Date(proposal.payload.startAt!).toLocaleString('cs-CZ')} – {new Date(proposal.payload.endAt!).toLocaleString('cs-CZ')}<br/>Cena: {formatCredits(Math.round(proposal.payload.price!*100))}</p>
      <div className={styles.actions}><button disabled={pending} className={styles.primary} onClick={()=>startTransition(async()=>{const result=await confirmAiJob(companyId,operationId,proposal.payload_hash);if(!result.ok)setError(result.error);else setProposal({...proposal,job_id:result.value})})}>{pending?'Vytvářím…':'Potvrdit a založit zakázku'}</button><button className={styles.secondary} disabled={pending} onClick={()=>setProposal(undefined)}>Změnit údaje</button></div>
    </>:<form className={styles.stack} onSubmit={event=>{event.preventDefault();const f=new FormData(event.currentTarget);setError('');startTransition(async()=>{try{const result=await prepareAiJob(companyId,operationId,{title:String(f.get('title')),description:String(f.get('description')),address:String(f.get('address')),customerId:String(f.get('customerId')??'')||null,startAt:new Date(String(f.get('start'))).toISOString(),endAt:new Date(String(f.get('end'))).toISOString(),price:Number(f.get('price'))});if(!result.ok)setError(result.error);else setProposal(result.value)}catch{setError('Zkontrolujte časové údaje.')}})}}>
      <p className={styles.muted}>AI návrh zkontrolujte a doplňte. V této fázi se obchodní data nemění.</p>
      <label className={styles.field}>Zákazník<select name="customerId" defaultValue={draft.customerId??''}><option value="">Bez zákazníka</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
      <label className={styles.field}>Název<input name="title" required maxLength={200} defaultValue={draft.title}/></label><label className={styles.field}>Rozsah<textarea name="description" maxLength={8000} defaultValue={draft.description}/></label><label className={styles.field}>Adresa<input name="address" maxLength={1000} defaultValue={draft.address}/></label>
      <div className={styles.grid}><label className={styles.field}>Začátek<input name="start" type="datetime-local" required defaultValue={localTime(draft.startAt)}/></label><label className={styles.field}>Konec<input name="end" type="datetime-local" required defaultValue={localTime(draft.endAt)}/></label></div><label className={styles.field}>Sjednaná cena (Kč)<input name="price" type="number" min={0} max={999999999} step="0.01" required defaultValue={draft.price??''}/></label><div><button disabled={pending} className={styles.secondary}>Připravit ke schválení</button></div>
    </form>}
  </section>
}
