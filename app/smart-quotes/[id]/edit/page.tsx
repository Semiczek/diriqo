import { quoteError, readWorkspace } from '@/lib/smart-quotes/server'
import { QuoteFrame, QuoteUnavailable, ReadOnlyNotice } from '../../Frame'
import QuoteEditor from '../../QuoteEditor'
export default async function EditSmartQuotePage({ params }: { params:Promise<{ id:string }> }) {
  const { id }=await params
  let data
  try { data=await readWorkspace(id) } catch(error) { return <QuoteUnavailable message={quoteError(error)} /> }
  const q=data.quote!
  return <QuoteFrame title="Upravit návrh">{data.canWrite && q.status!=='accepted' ? <QuoteEditor key={`${data.companyId}:${q.id}:${q.revision}`} companyId={data.companyId} id={q.id} revision={q.revision} initial={q.draft} initialCustomerId={q.customer_id} customers={data.customers} templates={data.templates} library={data.library} /> : <ReadOnlyNotice />}</QuoteFrame>
}
