import 'server-only'

import type { SupabaseServerClient } from '@/lib/dal/auth'

type BillingRow = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  created_at: string | null
  billing_name: string | null
  billing_street: string | null
  billing_city: string | null
  billing_postal_code: string | null
  billing_country: string | null
  company_number: string | null
  vat_number: string | null
  ares_last_checked_at: string | null
}
const legacyLeadFields = [
  'lead_contact_name', 'lead_source', 'lead_locale', 'lead_service_slug', 'lead_message',
  'lead_page_url', 'lead_referrer', 'lead_user_agent', 'lead_submitted_at',
] as const
const webLeadFields = ['web_lead_source', 'web_lead_locale', 'web_lead_service_slug', 'web_lead_message'] as const
type LeadMetadata = Record<typeof legacyLeadFields[number], string | null>
export type CustomerBillingDetail = BillingRow & LeadMetadata

function emptyLead(): LeadMetadata {
  return Object.fromEntries(legacyLeadFields.map(field => [field, null])) as LeadMetadata
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
function missingOptionalColumns(error: { code?: string; message?: string } | null, fields: readonly string[]) {
  return error !== null && (error.code === '42703' || error.code === 'PGRST204') &&
    fields.some(field => error.message?.includes(field))
}

export async function loadCustomerBillingDetail(
  ctx: { supabase: Pick<SupabaseServerClient, 'from'>; companyId: string },
  customerId: string,
): Promise<{ customer: CustomerBillingDetail | null; error: string | null; leadMetadataUnavailable: boolean }> {
  const { data, error } = await ctx.supabase.from('customers')
    .select('id, name, email, phone, created_at, billing_name, billing_street, billing_city, billing_postal_code, billing_country, company_number, vat_number, ares_last_checked_at')
    .eq('id', customerId).eq('company_id', ctx.companyId).maybeSingle()
  if (error) return { customer: null, error: 'Fakturační údaje zákazníka se nepodařilo načíst. Zkuste stránku obnovit.', leadMetadataUnavailable: false }
  if (!data) return { customer: null, error: null, leadMetadataUnavailable: false }

  // Optional metadata must never turn a failed read into an empty billing address.
  const [web, legacy] = await Promise.all([
    ctx.supabase.from('customers').select(webLeadFields.join(', '))
      .eq('id', customerId).eq('company_id', ctx.companyId).maybeSingle(),
    ctx.supabase.from('customers').select(legacyLeadFields.join(', '))
      .eq('id', customerId).eq('company_id', ctx.companyId).maybeSingle(),
  ])
  const webRow = web.error ? null : web.data as Record<string, unknown> | null
  const legacyRow = legacy.error ? null : legacy.data as Record<string, unknown> | null
  const lead = emptyLead()
  // Prefer the current schema as one event; do not mix fields from two submissions.
  if (webRow && webLeadFields.some(field => text(webRow[field]) !== null)) {
    lead.lead_source = text(webRow.web_lead_source)
    lead.lead_locale = text(webRow.web_lead_locale)
    lead.lead_service_slug = text(webRow.web_lead_service_slug)
    lead.lead_message = text(webRow.web_lead_message)
  } else if (legacyRow) {
    for (const field of legacyLeadFields) lead[field] = text(legacyRow[field])
  }
  return {
    customer: { ...(data as BillingRow), ...lead }, error: null,
    leadMetadataUnavailable: Boolean(
      (web.error && !missingOptionalColumns(web.error, webLeadFields)) ||
      (legacy.error && !missingOptionalColumns(legacy.error, legacyLeadFields))
    ),
  }
}
