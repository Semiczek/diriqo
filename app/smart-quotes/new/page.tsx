import { quoteError, readWorkspace } from '@/lib/smart-quotes/server'
import { QuoteFrame, QuoteUnavailable, ReadOnlyNotice } from '../Frame'
import QuoteEditor from '../QuoteEditor'
export default async function NewSmartQuotePage() {
  let data
  try { data=await readWorkspace() } catch(error) { return <QuoteUnavailable message={quoteError(error)} /> }
  return <QuoteFrame title="Nová nabídka">{data.canWrite ? <QuoteEditor key={data.companyId} companyId={data.companyId} customers={data.customers} templates={data.templates} library={data.library} /> : <ReadOnlyNotice />}</QuoteFrame>
}
