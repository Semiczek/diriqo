import 'server-only'
import { parseCoreQuoteDocumentRead, coreQuoteId, type CoreQuoteDocumentRead } from '@/lib/core-quote-lifecycle'
import { isLikelyPublicOfferToken } from '@/lib/public-offer-security'
import { createSupabasePublicClient } from '@/lib/supabase-public'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function getPublicCoreQuote(token: string): Promise<CoreQuoteDocumentRead | null> {
  if (!isLikelyPublicOfferToken(token)) return null
  const { data, error } = await createSupabasePublicClient().rpc('get_public_core_quote_version', { input_token: token })
  if (error || !data) return null
  const read = parseCoreQuoteDocumentRead(data)
  return read.kind === 'draft' ? null : read
}

/** Null is an explicit legacy selection, never an alias for the newest version. */
export function parsePortalQuoteSelector(query: { versionId?: unknown; legacy?: unknown }): string | null {
  const hasVersion = query.versionId !== undefined, hasLegacy = query.legacy !== undefined
  if (hasVersion === hasLegacy) throw new Error('Vyberte právě jednu vydanou verzi nebo starší nabídku.')
  if (hasLegacy) {
    if (query.legacy !== '1') throw new Error('Neplatný odkaz na starší nabídku.')
    return null
  }
  return coreQuoteId(query.versionId)
}

export async function getPortalCoreQuote(companyId: string, customerId: string, quoteId: string, versionId: string | null): Promise<CoreQuoteDocumentRead | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('get_portal_core_quote_version', {
    p_company_id: coreQuoteId(companyId), p_customer_id: coreQuoteId(customerId),
    p_quote_id: coreQuoteId(quoteId), p_version_id: versionId == null ? null : coreQuoteId(versionId),
  })
  if (error || !data) return null
  const read = parseCoreQuoteDocumentRead(data)
  if (read.document.quote_id !== quoteId || (versionId === null
    ? read.kind !== 'legacy' || read.document.version_id !== null || read.publishedAt !== null
    : read.kind !== 'issued' || read.document.version_id !== versionId)) return null
  return read
}

export async function listPortalCoreQuotes(companyId: string, customerId: string): Promise<CoreQuoteDocumentRead[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('list_portal_core_quote_versions', {
    p_company_id: coreQuoteId(companyId), p_customer_id: coreQuoteId(customerId),
  })
  if (error) throw new Error('Nabídky se nepodařilo načíst. Zkuste to znovu.')
  if (!Array.isArray(data)) throw new Error('Nepodařilo se ověřit seznam nabídek.')
  const reads = data.map(value => parseCoreQuoteDocumentRead(value))
  if (reads.some(read => read.kind === 'draft' || (read.kind === 'legacy' && read.publishedAt !== null))) throw new Error('Nevydané nabídky nejsou pro zákazníka dostupné.')
  return reads
}
