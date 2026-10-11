import {aiWorkspace,aiError} from '@/lib/diriqent/server'
import {providerConfigured} from '@/lib/diriqent/provider'
import type {AiKind} from '@/lib/diriqent/domain'
import AiFrame from '../Frame'
import OcrClient from './OcrClient'
import styles from '../diriqent.module.css'
export default async function OcrPage({searchParams}:{searchParams:Promise<{domain?:string}>}) {
  const params=await searchParams,domain=['smart_quotes','inventory','invoicing'].includes(params.domain??'')?params.domain!:'smart_quotes',kind=`${domain}.ocr` as AiKind
  let data
  try{data=await aiWorkspace(kind)}catch(error){return <AiFrame title="Čtení podkladů"><p className={styles.notice}>{aiError(error)}</p></AiFrame>}
  return <AiFrame title="Čtení podkladů"><p className={styles.muted}>Tato funkce používá oprávnění modulu {domain==='smart_quotes'?'Chytré nabídky':domain==='inventory'?'Sklad':'Fakturace'} a vlastní kreditní rozpočet. Licence konverzačního Diriqenta není potřeba.</p><OcrClient key={`${data.companyId}:${data.profileId}:${data.roleScope}:${kind}`} data={data} kind={kind} configured={providerConfigured()}/></AiFrame>
}
