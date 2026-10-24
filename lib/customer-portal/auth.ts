import 'server-only'

import { redirect } from 'next/navigation'

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

export async function getPortalUserContext(): Promise<PortalUserContext | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) return null

  // The RPC checks the current Auth identity, exactly one active portal link,
  // and the customer's company together; no service-role customer read needed.
  const { data, error } = await supabase.rpc('get_customer_portal_context')
  if (error || !data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.portalUserId !== 'string' || !data.portalUserId
    || typeof data.customerId !== 'string' || !data.customerId
    || typeof data.companyId !== 'string' || !data.companyId
    || typeof data.email !== 'string' || !data.email
    || (data.contactId !== null && typeof data.contactId !== 'string')
    || (data.fullName !== null && typeof data.fullName !== 'string')
    || (data.customerName !== null && typeof data.customerName !== 'string')) return null

  return {
    portalUserId: data.portalUserId,
    authUserId: user.id,
    customerId: data.customerId,
    contactId: data.contactId,
    email: data.email,
    fullName: data.fullName,
    customerName: data.customerName,
    companyId: data.companyId,
  }
}

export async function requirePortalUserContext(): Promise<PortalUserContext> {
  const context = await getPortalUserContext()
  if (!context) redirect('/portal/login')
  return context
}
