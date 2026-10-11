import { readWorkspace, quoteError } from '@/lib/smart-quotes/server'
import { QuoteUnavailable } from '../../Frame'
import DocumentView from '../../DocumentView'
import PrintButton from '../../PrintButton'
import styles from '../../quotes.module.css'
export default async function PrintQuotePage({ params,searchParams }:{ params:Promise<{id:string}>;searchParams:Promise<{version?:string}> }) {
  const [{ id },search]=await Promise.all([params,searchParams])
  let data
  try { data=await readWorkspace(id, 'export') } catch(error) { return <QuoteUnavailable message={quoteError(error)} /> }
  const version=data.versions?.find(v=>v.version===Number(search.version??data.quote!.current_version))
  if(!version) return <p>Vydaná verze není dostupná.</p>
  return <div className={styles.printDocument}><PrintButton /><DocumentView snapshot={version.snapshot} version={version.version} /></div>
}
