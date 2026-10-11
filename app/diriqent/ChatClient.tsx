'use client'
import Link from 'next/link'
import {useEffect,useState,useTransition} from 'react'
import {useRouter} from 'next/navigation'
import {formatCredits,type ChatResult} from '@/lib/diriqent/domain'
import type {AiWorkspace,Operation} from '@/lib/diriqent/server'
import {checkAiOperation,startChat} from './actions'
import JobProposal from './JobProposal'
import styles from './diriqent.module.css'

export default function ChatClient({data,configured}:{data:AiWorkspace;configured:boolean}) {
  const router=useRouter()
  const [selected,setSelected]=useState<string|null>(data.conversations[0]?.id??null)
  const [live,setLive]=useState<Record<string,Operation>>({})
  const [prompt,setPrompt]=useState(''),[kind,setKind]=useState<'chat'|'proposal'>('chat'),[limit,setLimit]=useState(500)
  const [requestId,setRequestId]=useState<string|null>(null),[error,setError]=useState(''),[pending,startTransition]=useTransition()
  const operations=[...new Map([...data.operations,...Object.values(live)].map(op=>[op.id,op])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at))
  const running=operations.find(op=>op.state==='running')?.id
  useEffect(()=>{
    if(!running)return
    let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined,attempts=0
    async function tick(){const result=await checkAiOperation(data.companyId,running!);if(cancelled)return;if(result.ok){setLive(prev=>({...prev,[result.value.id]:result.value}));if(['completed','failed'].includes(result.value.state))router.refresh()}if(++attempts<40&&(!result.ok||result.value.state==='running'))timer=setTimeout(tick,4000)}
    timer=setTimeout(tick,3000)
    return()=>{cancelled=true;if(timer)clearTimeout(timer)}
  },[data.companyId,running,router])
  const conversations=[...data.conversations]
  for(const op of operations)if(op.conversation_id&&!conversations.some(c=>c.id===op.conversation_id))conversations.unshift({id:op.conversation_id,title:op.prompt.slice(0,80)})
  return <div className={styles.stack}>
    <div className={`${styles.card} ${styles.row}`}><div><strong>Dostupný kredit: {formatCredits(data.availableUnits)}</strong><p className={styles.muted}>Testovací ceník v1 · účtuje se skutečné využití do schváleného limitu.</p></div><Link href="/diriqent/export" download prefetch={false} className={styles.secondary}>Export historie</Link></div>
    {!configured&&<p className={styles.notice}>AI služba čeká na nastavení serverového klíče. Historie je dostupná.</p>}
    {!data.canRun&&<p className={styles.notice}>Nové dotazy jsou vypnuté. Historii můžete dál číst a exportovat po dobu jejího oprávnění.</p>}
    <div className={styles.row}><label className={styles.field}>Rozhovor<select disabled={pending} value={selected??''} onChange={e=>setSelected(e.target.value||null)}><option value="">Nový rozhovor</option>{conversations.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label><button disabled={pending} className={styles.secondary} onClick={()=>{setSelected(null);setPrompt('');setRequestId(null)}}>Nový rozhovor</button></div>
    {operations.filter(op=>op.conversation_id===selected).map(op=>{const result=op.result as ChatResult|null;return <article key={op.id} className={styles.message}><p className={styles.question}>{op.prompt}</p>
      {result?<><p className={styles.answer}>{result.answer}</p>{result.jobProposal&&data.canCreateJobs&&<JobProposal companyId={data.companyId} operationId={op.id} draft={result.jobProposal} customers={op.context_snapshot?.customers??[]} initial={data.proposals.find(p=>p.operation_id===op.id)}/>}</>:<p className={styles.muted}>{op.state==='failed'?'Požadavek nedal použitelný výsledek. Kredit nebyl odečten.':op.state==='unknown'?'Výsledek poskytovatele není známý. Rezervaci držíme k ověření; požadavek znovu nespouštíme.':'Diriqent připravuje odpověď…'}</p>}
      <div className={styles.row}><small className={styles.muted}>{op.state==='completed'?`Spotřeba ${formatCredits(op.charged_units)}`:op.state==='failed'?'Rezerva uvolněna':`Rezervace ${formatCredits(op.reserved_units)}`} · {new Date(op.created_at).toLocaleString('cs-CZ')}</small>{['running','unknown','reserved'].includes(op.state)&&<button className={styles.secondary} disabled={pending} onClick={()=>startTransition(async()=>{const value=await checkAiOperation(data.companyId,op.id);if(value.ok){setLive(prev=>({...prev,[op.id]:value.value}));router.refresh()}else setError(value.error)})}>Ověřit výsledek</button>}</div>
      {op.context_snapshot&&<details className={styles.details}><summary>Použité podklady</summary><p className={styles.muted}>{op.context_snapshot.scope}</p><div className={styles.actions}>{op.context_snapshot.jobs?.map(j=><Link key={j.id} href={`/jobs/${j.id}`}>{j.title}</Link>)}</div></details>}
    </article>})}
    {error&&<div role="alert" className={styles.error}>{error}</div>}
    {data.canRun&&configured&&<form className={`${styles.card} ${styles.stack}`} onSubmit={event=>{event.preventDefault();setError('');const id=requestId??crypto.randomUUID();setRequestId(id);startTransition(async()=>{const result=await startChat({companyId:data.companyId,requestId:id,kind,prompt,conversationId:selected,maxUnits:limit});if(!result.ok){setError(result.error);return}setLive(prev=>({...prev,[result.value.id]:result.value}));setSelected(result.value.conversation_id);setPrompt('');setRequestId(null);router.refresh()})}}>
      <div className={styles.grid}><label className={styles.field}>Co potřebujete<select disabled={pending} value={kind} onChange={e=>{setKind(e.target.value as 'chat'|'proposal');setRequestId(null)}}><option value="chat">Poradit s firmou a zakázkami</option>{data.canCreateJobs&&<option value="proposal">Připravit novou zakázku</option>}</select></label><label className={styles.field}>Nejvyšší spotřeba tohoto dotazu<select disabled={pending} value={limit} onChange={e=>{setLimit(Number(e.target.value));setRequestId(null)}}><option value={100}>1 Kč</option><option value={500}>5 Kč</option><option value={1500}>15 Kč</option></select></label></div>
      <label className={styles.field}>Vaše zadání<textarea disabled={pending} required maxLength={4000} value={prompt} onChange={e=>{setPrompt(e.target.value);setRequestId(null)}} placeholder="Například: Co mám dnes na přidělených zakázkách?"/></label>
      <div className={styles.actions}><button disabled={pending||!prompt.trim()} className={styles.primary}>{pending?'Připravuji…':'Odeslat dotaz'}</button><span className={styles.muted}>Nejvýše {formatCredits(limit)}. Nevyužitá rezerva se uvolní.</span></div>
      <p className={styles.muted}>AI pracuje s omezeným výběrem dostupných dat a může se mýlit. Zakázku může samostatně potvrdit a založit administrátor firmy.</p>
    </form>}
  </div>
}
