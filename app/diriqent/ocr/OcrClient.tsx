'use client'
import Link from 'next/link'
import {useEffect,useState,useTransition} from 'react'
import {useRouter} from 'next/navigation'
import {formatCredits,type AiKind,type OcrResult} from '@/lib/diriqent/domain'
import type {AiWorkspace,Operation} from '@/lib/diriqent/server'
import {checkAiOperation} from '../actions'
import ReviewedReceipt from '@/app/inventory/ReviewedReceipt'
import ReviewedQuote from './ReviewedQuote'
import styles from '../diriqent.module.css'

export default function OcrClient({data,kind,configured,warehouseId}:{data:AiWorkspace;kind:AiKind;configured:boolean;warehouseId?:string}) {
  const router=useRouter(),[live,setLive]=useState<Record<string,Operation>>({}),[error,setError]=useState(''),[pending,startTransition]=useTransition(),[requestId,setRequestId]=useState<string|null>(null)
  const operations=[...new Map([...data.operations,...Object.values(live)].map(op=>[op.id,op])).values()].sort((a,b)=>b.created_at.localeCompare(a.created_at))
  const running=operations.find(op=>op.state==='running')?.id
  useEffect(()=>{if(!running)return;let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,count=0
    async function tick(){const result=await checkAiOperation(data.companyId,running!);if(cancelled)return;if(result.ok){setLive(p=>({...p,[result.value.id]:result.value}));if(['completed','failed'].includes(result.value.state))router.refresh()}if(++count<40&&(!result.ok||result.value.state==='running'))timer=setTimeout(tick,4000)}
    timer=setTimeout(tick,3000);return()=>{cancelled=true;if(timer)clearTimeout(timer)}
  },[data.companyId,running,router])
  return <div className={styles.stack}><div className={`${styles.card} ${styles.row}`}><strong>Dostupný kredit: {formatCredits(data.availableUnits)}</strong><Link download prefetch={false} href={`/diriqent/export?kind=${kind}`} className={styles.secondary}>Export výsledků</Link></div>
    {!data.canRun&&<p className={styles.notice}>OCR je v režimu historie. Uložené výsledky a originály zůstávají dostupné po dobu oprávnění k historii.</p>}
    {!configured&&<p className={styles.notice}>AI služba čeká na serverový klíč.</p>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
    {data.canRun&&configured&&<form className={`${styles.card} ${styles.stack}`} onSubmit={event=>{event.preventDefault();setError('');const form=new FormData(event.currentTarget),id=requestId??crypto.randomUUID();setRequestId(id);form.set('requestId',id);form.set('companyId',data.companyId);form.set('kind',kind);startTransition(async()=>{try{const response=await fetch('/diriqent/ocr/run',{method:'POST',body:form}),result=await response.json();if(!response.ok||!result.ok){setError(result.error??'Podklad se nepodařilo zpracovat.');return}setLive(p=>({...p,[result.value.id]:result.value}));setRequestId(null);router.refresh()}catch{setError('Výsledek spojení není známý. Obnovte historii a ověřte stav, než vytvoříte nový požadavek.')}})}}>
      <h2>Přečíst nový podklad</h2><label className={styles.field}>Jedna stránka podkladu<input type="file" name="file" required disabled={pending} accept="image/png,image/jpeg,image/webp" onChange={()=>setRequestId(null)}/></label><p className={styles.muted}>PNG, JPEG nebo WebP do 3 MB a 4 megapixelů. Uložte PDF stránku jako obrázek. Originál uchováme soukromě u výsledku.</p>
      <label className={styles.field}>Co z podkladu potřebujete<textarea name="prompt" required maxLength={4000} disabled={pending} defaultValue="Přečti položky, množství, jednotky, ceny a DPH. Nejasné údaje označ; nic si nedomýšlej." onChange={()=>setRequestId(null)}/></label>
      <label className={styles.field}>Maximální spotřeba<select name="maxUnits" defaultValue="1500" disabled={pending} onChange={()=>setRequestId(null)}><option value="500">5 Kč</option><option value="1500">15 Kč</option><option value="5000">50 Kč</option></select></label><div><button disabled={pending} className={styles.primary}>{pending?'Nahrávám…':'Přečíst podklad'}</button></div><p className={styles.muted}>Výsledek je návrh k vaší kontrole. Nezakládá účetní doklad, příjemku ani skladový pohyb.</p>
    </form>}
    {operations.length===0&&<p className={styles.muted}>Zatím nemáte žádný zpracovaný podklad v této firmě a doméně.</p>}
    {operations.map(op=>{const result=op.result as OcrResult|null;return <section key={op.id} className={`${styles.card} ${styles.stack}`}><div className={styles.row}><h2>{op.source_name??'Podklad'}</h2><span className={styles.badge}>{op.state==='completed'?'Ke kontrole':op.state==='failed'?'Neúspěšné':op.state==='unknown'?'Ověřit výsledek':'Zpracovává se'}</span></div>
      <p className={styles.muted}>{new Date(op.created_at).toLocaleString('cs-CZ')} · {op.state==='completed'?`Spotřeba ${formatCredits(op.charged_units)}`:op.state==='failed'?'Rezerva uvolněna':`Rezervace ${formatCredits(op.reserved_units)}`}</p>
      {result?<><p className={styles.notice}>Zkontrolujte všechny rozpoznané údaje proti originálu. Neověřené množství a ceny nejsou hotový obchodní doklad.</p><p>{result.documentType} · {result.supplierName} · {result.documentNumber}</p>{result.warnings.length>0&&<ul className={styles.muted}>{result.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Položka</th><th>Množství</th><th>Cena / jedn.</th><th>DPH</th><th>Jistota / zdroj</th></tr></thead><tbody>{result.items.map((item,i)=><tr key={i}><td>{item.name}</td><td>{item.quantity??'Neznámé'} {item.unit}</td><td>{item.unitPrice??'Neznámá'}</td><td>{item.vatRate===null?'Neznámá':`${item.vatRate} %`}</td><td>{item.confidence==='high'?'Vyšší':item.confidence==='medium'?'Střední':'Nízká'} · {item.source}</td></tr>)}</tbody></table></div>
        <div className={styles.actions}>{op.source_path&&<Link className={styles.secondary} href={`/diriqent/files/${op.id}`} target="_blank" prefetch={false}>Otevřít originál</Link>}<Link className={styles.secondary} href={`/diriqent/export?kind=${kind}&operation=${op.id}`} download prefetch={false}>Uložit výsledek JSON</Link></div>
        <details className={styles.details}><summary>Rozpoznaný text</summary><p className={styles.answer}>{result.extractedText}</p></details>{kind==='inventory.ocr'&&data.canRun&&<ReviewedReceipt companyId={data.companyId} operationId={op.id} result={result} warehouseId={warehouseId}/>} {kind==='smart_quotes.ocr'&&data.canRun&&<ReviewedQuote companyId={data.companyId} operationId={op.id} result={result}/>}</>:<><p className={styles.muted}>{op.state==='failed'?'Použitelný výsledek nevznikl; zákaznický kredit se neodečetl.':op.state==='unknown'?'Přijetí výsledku není jisté. Rezervaci držíme k dohledání a neodesíláme další placené volání.':'Podklad se zpracovává. Výsledek můžete později otevřít v této historii.'}</p>{['reserved','running','unknown'].includes(op.state)&&<div><button className={styles.secondary} disabled={pending} onClick={()=>startTransition(async()=>{const result=await checkAiOperation(data.companyId,op.id);if(result.ok){setLive(p=>({...p,[op.id]:result.value}));router.refresh()}else setError(result.error)})}>Ověřit výsledek</button></div>}</>}
    </section>})}
  </div>
}
