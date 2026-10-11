import { quoteError, readWorkspace } from '@/lib/smart-quotes/server'
import { QuoteFrame, QuoteUnavailable, ReadOnlyNotice } from '../Frame'
import AssetsEditor from '../AssetsEditor'
export default async function LibraryPage() {
  let data
  try { data=await readWorkspace() } catch(error) { return <QuoteUnavailable message={quoteError(error)} /> }
  return <QuoteFrame title="Knihovna položek">{!data.canWrite && <ReadOnlyNotice />}<AssetsEditor key={data.companyId} data={data} mode="library" /></QuoteFrame>
}
