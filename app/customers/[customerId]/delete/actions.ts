'use server'

import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export type DeleteCustomerResult =
  | {
      ok: true
    }
  | {
      ok: false
      error: string
    }

function normalizeId(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

export async function deleteCustomerAction(customerId: string): Promise<DeleteCustomerResult> {
  const activeCompany = await requireHubAccess()
  const cleanCustomerId = normalizeId(customerId)

  if (!cleanCustomerId) {
    return { ok: false, error: 'Chybí zákazník.' }
  }

  const supabase = await createSupabaseServerClient()
  const customerResponse = await supabase
    .from('customers')
    .select('id')
    .eq('id', cleanCustomerId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (customerResponse.error) {
    return { ok: false, error: customerResponse.error.message }
  }

  if (!customerResponse.data?.id) {
    return { ok: false, error: 'Zákazník nebyl nalezen.' }
  }

  const contactsResponse = await supabase
    .from('customer_contacts')
    .select('id')
    .eq('customer_id', cleanCustomerId)
    .eq('company_id', activeCompany.companyId)

  if (contactsResponse.error) {
    return { ok: false, error: contactsResponse.error.message }
  }

  const contactIds = (contactsResponse.data ?? []).map((contact) => contact.id).filter(Boolean)

  if (contactIds.length > 0) {
    const jobContactResponse = await supabase
      .from('job_customer_contacts')
      .delete()
      .eq('company_id', activeCompany.companyId)
      .in('customer_contact_id', contactIds)

    if (jobContactResponse.error) {
      return { ok: false, error: jobContactResponse.error.message }
    }
  }

  const deleteContactsResponse = await supabase
    .from('customer_contacts')
    .delete()
    .eq('customer_id', cleanCustomerId)
    .eq('company_id', activeCompany.companyId)

  if (deleteContactsResponse.error) {
    return { ok: false, error: deleteContactsResponse.error.message }
  }

  const jobsResponse = await supabase
    .from('jobs')
    .update({ customer_id: null, contact_id: null })
    .eq('customer_id', cleanCustomerId)
    .eq('company_id', activeCompany.companyId)

  if (jobsResponse.error) {
    return { ok: false, error: jobsResponse.error.message }
  }

  const deleteCustomerResponse = await supabase
    .from('customers')
    .delete()
    .eq('id', cleanCustomerId)
    .eq('company_id', activeCompany.companyId)

  if (deleteCustomerResponse.error) {
    return { ok: false, error: deleteCustomerResponse.error.message }
  }

  return { ok: true }
}
