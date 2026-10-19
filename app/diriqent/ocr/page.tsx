import Link from 'next/link'
import {uuidPattern} from '@/lib/inventory/domain'
import {aiWorkspace,aiError} from '@/lib/diriqent/server'
import {providerConfigured} from '@/lib/diriqent/provider'
import type {AiKind} from '@/lib/diriqent/domain'
import AiFrame from '../Frame'
import ContextBoundary from '../ContextBoundary'
import OcrClient from './OcrClient'
import styles from '../diriqent.module.css'
export default async function OcrPage({searchParams}:{searchParams:Promise<{domain?:string;warehouse?:string}>}) {
  const params=await searchParams,domain=['smart_quotes','inventory','invoicing'].includes(params.domain??'')?params.domain!:'smart_quotes',kind=`${domain}.ocr` as AiKind
  const warehouseId=domain==='inventory'&&uuidPattern.test(params.warehouse??'')?params.warehouse:undefined
  const inventoryHref='/inventory?tab=documents'+(warehouseId?'&warehouse='+encodeURIComponent(warehouseId):'')
  let data
  try{data=await aiWorkspace(kind)}catch(error){return <AiFrame title="Čtení podkladů"><p className={styles.notice}>{aiError(error)}</p></AiFrame>}
  const identity={companyId:data.companyId,profileId:data.profileId,role:data.roleScope??''}
  return <AiFrame title="Čtení podkladů">{domain==='inventory'&&<Link href={inventoryHref} className={styles.secondary}>← Zpět do skladu</Link>}<p className={styles.muted}>Tato funkce používá oprávnění modulu {domain==='smart_quotes'?'Chytré nabídky':domain==='inventory'?'Sklad':'Fakturace'} a vlastní kreditní rozpočet. Licence konverzačního Diriqenta není potřeba.</p><ContextBoundary key={`${data.companyId}:${data.profileId}:${data.roleScope}:${kind}`} identity={identity}><OcrClient data={data} kind={kind} configured={providerConfigured()} warehouseId={warehouseId}/></ContextBoundary></AiFrame>
}
