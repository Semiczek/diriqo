import Link from 'next/link'
import {aiError,aiWorkspace} from '@/lib/diriqent/server'
import {providerConfigured} from '@/lib/diriqent/provider'
import AiFrame from './Frame'
import ChatClient from './ChatClient'
import styles from './diriqent.module.css'
export default async function DiriqentPage() {
  let data
  try{data=await aiWorkspace()}catch(error){return <AiFrame title="Diriqent"><p className={styles.notice}>{aiError(error)}</p><Link href="/moje-prace" className={styles.secondary}>Zpět na moje úkoly</Link></AiFrame>}
  return <AiFrame title="Diriqent"><ChatClient key={`${data.companyId}:${data.profileId}:${data.roleScope}`} data={data} configured={providerConfigured()}/></AiFrame>
}
