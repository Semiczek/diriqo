import 'server-only'

import { redirect } from 'next/navigation'

import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type PortalUserContext = {
  portalUserId: string
  authUserId: string
  customerId: string
  contactId: string | null
  email: string
  fullName: string | null
  customerName: string | null
  companyId: string | null
}

type PortalUserRow = {
  id: string
  customer_id: string
  contact_id: string | null
  email: string
  full_name: string | null
}

type CustomerRow = {
  id: string
  name: string | null
  company_id: string | null
}

export async function getPortalUserContext(): Promise<PortalUserContext | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return null
  }

  const { data: portalUser, error: portalUserError } = await supabase
    .from('customer_portal_users')
    .select('id, customer_id, contact_id, email, full_name')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (portalUserError || !portalUser) {
    return null
  }

  const admin = createSupabaseAdminClient()
  const { data: customer } = await admin
    .from('customers')
    .select('id, name, company_id')
    .eq('id', portalUser.customer_id)
    .maybeSingle()

  const portalRow = portalUser as PortalUserRow
  const customerRow = (customer as CustomerRow | null) ?? null

  return {
    portalUserId: portalRow.id,
    authUserId: user.id,
    customerId: portalRow.customer_id,
    contactId: portalRow.contact_id,
    email: portalRow.email,
    fullName: portalRow.full_name,
    customerName: customerRow?.name ?? null,
    companyId: customerRow?.company_id ?? null,
  }
}

export async function requirePortalUserContext(): Promise<PortalUserContext> {
  const context = await getPortalUserContext()

  if (!context) {
    redirect('/portal/login')
  }

  return context
}
