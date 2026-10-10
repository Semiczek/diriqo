import { NextResponse } from 'next/server'

import { requireAuthenticatedUser, requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getStripe } from '@/lib/stripe'
import { isModuleCheckoutEnabled } from '@/lib/platform/module-checkout'
import { loadModuleOfferCatalog } from '@/lib/platform/module-offer-catalog'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers })
  const company = await requireCompanyRole('company_admin', 'super_admin')
  if (!company.ok) return NextResponse.json({ error: company.error }, { status: company.status, headers })
  if (!isModuleCheckoutEnabled()) {
    return NextResponse.json({ companyId: company.value.companyId, enabled: false, offers: [] }, { headers })
  }
  try {
    const catalog = await loadModuleOfferCatalog({ admin: createSupabaseAdminClient(), stripe: getStripe() })
    return NextResponse.json({ companyId: company.value.companyId, ...catalog }, { headers })
  } catch {
    return NextResponse.json({ error: 'Nabídku modulů se nepodařilo ověřit. Zkuste to znovu.' }, { status: 503, headers })
  }
}
