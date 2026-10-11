import 'server-only'
import { requireCompanyRoleDalContext } from '@/lib/dal/auth'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import type { PublicSnapshot, QuoteDraft, QuoteItem } from './domain'

export type Template = { id: string; name: string; draft: QuoteDraft; archived: boolean; revision: number }
export type LibraryItem = { id: string; item: QuoteItem; archived: boolean; revision: number }
export type QuoteRecord = { id: string; company_id: string; customer_id: string | null; draft: QuoteDraft; revision: number; current_version: number; published_revision: number | null; status: string; approved_revision: number | null; approval_reason: string | null }
export type Version = { version: number; snapshot: PublicSnapshot; published_at: string; content_hash: string }
export type Workspace = {
  companyId: string; canWrite: boolean; canConvert: boolean
  templates: Template[]; library: LibraryItem[]
  customers: { id: string; name: string }[]
  quotes: { id: string; title: string; customer: string; status: string; current_version: number; updated_at: string }[]
  quote?: QuoteRecord; versions?: Version[]
  acceptance?: { version: number; variant_id: string; name: string; email: string; accepted_at: string; mechanism: string } | null
  rejections?: { version:number; name:string; email:string; rejected_at:string }[]
  conversion?: { job_id: string } | null
}
export type PublicQuote = { version: number; snapshot: PublicSnapshot; publishedAt: string; current: boolean; expired: boolean; active: boolean; status: string; acceptance: { variantId: string; name: string; acceptedAt: string } | null }

export async function quoteContext(expectedCompanyId?: string) {
  const ctx = await requireCompanyRoleDalContext('super_admin', 'company_admin', 'manager')
  if (expectedCompanyId !== undefined && ctx.companyId !== expectedCompanyId) throw new Error('Aktivní firma se změnila. Obnovte stránku před uložením.')
  return ctx
}
export async function readWorkspace(quoteId?: string, purpose: 'read' | 'export' = 'read'): Promise<Workspace> {
  const ctx = await quoteContext()
  if (purpose === 'export') {
    const { data: access, error: accessError } = await ctx.supabase.rpc('get_module_workspace_access', { company: ctx.companyId, product: 'smart_quotes' })
    if (accessError || access?.can_export !== true) throw new Error('Pro export potřebujete oprávnění k exportu historie nabídek.')
  }
  const { data, error } = await ctx.supabase.rpc('smart_quotes_read', { target_company_id: ctx.companyId, target_quote_id: quoteId ?? null })
  if (error) throw new Error(error.message)
  return { ...data, canConvert:data.canConvert && ['super_admin','company_admin'].includes(ctx.role??'') } as Workspace
}
export async function readPublicQuote(token: string): Promise<PublicQuote | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('smart_quote_public_read', { access_token: token })
  if (error) throw new Error('Nabídku nyní nelze načíst. Zkuste to znovu nebo kontaktujte dodavatele.')
  return data as PublicQuote | null
}
export function quoteError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Operaci se nepodařilo dokončit.'
  if (message.includes('MODULE_REQUIRED')) return 'Chytré nabídky vyžadují aktivní modul a Diriqo Core. Historie zůstává dostupná po dobu oprávnění k historii.'
  if (message.includes('MODULE_FORBIDDEN') || message.includes('Insufficient') || message.includes('Authentication')) return 'Pro tuto agendu potřebujete přihlášení a oprávnění správce nebo manažera firmy.'
  if (/schema cache|does not exist|permission denied|invalid input syntax|violates|column |relation |syntax error/i.test(message)) return 'Operaci nelze dokončit. Obnovte stránku a zkontrolujte zadané údaje.'
  return message.slice(0, 500)
}
