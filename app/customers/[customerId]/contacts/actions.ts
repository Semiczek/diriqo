'use server'

import { revalidatePath } from 'next/cache'

import { requireCompanyRoleDalContext } from '@/lib/dal/auth'

type ContactMutationResult =
  | {
      ok: true
      contactId?: string
    }
  | {
      ok: false
      error: string
    }

function cleanString(value: unknown) {
  return String(value ?? '').trim()
}

function cleanOptionalString(value: unknown) {
  const cleaned = cleanString(value)
  return cleaned || null
}

function normalizeEmail(value: unknown) {
  const cleaned = cleanString(value).toLowerCase()
  return cleaned || null
}

async function assertCustomerInActiveCompany(input: {
  customerId: string
  companyId: string
  supabase: Awaited<ReturnType<typeof requireCompanyRoleDalContext>>['supabase']
}) {
  const response = await input.supabase
    .from('customers')
    .select('id')
    .eq('id', input.customerId)
    .eq('company_id', input.companyId)
    .maybeSingle()

  if (response.error || !response.data?.id) {
    throw new Error('Zakaznik nebyl nalezen v aktivni firme.')
  }
}

async function assertContactInCustomer(input: {
  contactId: string
  customerId: string
  companyId: string
  supabase: Awaited<ReturnType<typeof requireCompanyRoleDalContext>>['supabase']
}) {
  const response = await input.supabase
    .from('customer_contacts')
    .select('id')
    .eq('id', input.contactId)
    .eq('customer_id', input.customerId)
    .eq('company_id', input.companyId)
    .maybeSingle()

  if (response.error || !response.data?.id) {
    throw new Error('Kontakt nebyl nalezen u tohoto zakaznika.')
  }
}

function revalidateCustomer(customerId: string) {
  revalidatePath('/customers')
  revalidatePath(`/customers/${customerId}`)
}

export async function createCustomerContactAction(input: {
  customerId?: string | null
  fullName?: string | null
  role?: string | null
  phone?: string | null
  email?: string | null
  note?: string | null
  createPortalAccess?: boolean
}): Promise<ContactMutationResult> {
  try {
    const { supabase, companyId } = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const customerId = cleanString(input.customerId)
    const fullName = cleanString(input.fullName)
    const email = normalizeEmail(input.email)

if (!customerId) return { ok: false, error: 'Chybí zákazník.' }
    if (!fullName) return { ok: false, error: 'Zadejte jmeno kontaktu.' }
    if (input.createPortalAccess && !email) {
      return { ok: false, error: 'Pro zakaznicky portal je nutne vyplnit e-mail kontaktu.' }
    }

    await assertCustomerInActiveCompany({ supabase, companyId, customerId })

    const response = await supabase
      .from('customer_contacts')
      .insert({
        company_id: companyId,
        customer_id: customerId,
        name: fullName,
        full_name: fullName,
        role: cleanOptionalString(input.role),
        phone: cleanOptionalString(input.phone),
        email,
        note: cleanOptionalString(input.note),
      })
      .select('id')
      .single()

    if (response.error || !response.data?.id) {
    return { ok: false, error: response.error?.message ?? 'Kontakt se nepodařilo uložit.' }
    }

    revalidateCustomer(customerId)

    return { ok: true, contactId: response.data.id }
  } catch (error) {
    return {
      ok: false,
    error: error instanceof Error ? error.message : 'Kontakt se nepodařilo uložit.',
    }
  }
}

export async function updateCustomerContactAction(input: {
  customerId?: string | null
  contactId?: string | null
  fullName?: string | null
  role?: string | null
  phone?: string | null
  email?: string | null
  note?: string | null
}): Promise<ContactMutationResult> {
  try {
    const { supabase, companyId } = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const customerId = cleanString(input.customerId)
    const contactId = cleanString(input.contactId)
    const fullName = cleanString(input.fullName)

  if (!customerId || !contactId) return { ok: false, error: 'Chybí kontakt.' }
    if (!fullName) return { ok: false, error: 'Zadejte jmeno kontaktu.' }

    await assertCustomerInActiveCompany({ supabase, companyId, customerId })
    await assertContactInCustomer({ supabase, companyId, customerId, contactId })

    const response = await supabase
      .from('customer_contacts')
      .update({
        name: fullName,
        full_name: fullName,
        role: cleanOptionalString(input.role),
        phone: cleanOptionalString(input.phone),
        email: normalizeEmail(input.email),
        note: cleanOptionalString(input.note),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('customer_id', customerId)
      .eq('company_id', companyId)

    if (response.error) {
    return { ok: false, error: response.error.message || 'Kontakt se nepodařilo uložit.' }
    }

    revalidateCustomer(customerId)

    return { ok: true, contactId }
  } catch (error) {
    return {
      ok: false,
    error: error instanceof Error ? error.message : 'Kontakt se nepodařilo uložit.',
    }
  }
}

export async function deleteCustomerContactAction(input: {
  customerId?: string | null
  contactId?: string | null
}): Promise<ContactMutationResult> {
  try {
    const { supabase, companyId } = await requireCompanyRoleDalContext('company_admin', 'super_admin')
    const customerId = cleanString(input.customerId)
    const contactId = cleanString(input.contactId)

  if (!customerId || !contactId) return { ok: false, error: 'Chybí kontakt.' }

    await assertCustomerInActiveCompany({ supabase, companyId, customerId })
    await assertContactInCustomer({ supabase, companyId, customerId, contactId })

    const linkedJobsResponse = await supabase
      .from('job_customer_contacts')
      .delete()
      .eq('company_id', companyId)
      .eq('customer_contact_id', contactId)

    if (linkedJobsResponse.error) {
      return { ok: false, error: linkedJobsResponse.error.message }
    }

    const response = await supabase
      .from('customer_contacts')
      .delete()
      .eq('id', contactId)
      .eq('customer_id', customerId)
      .eq('company_id', companyId)

    if (response.error) {
    return { ok: false, error: response.error.message || 'Kontakt se nepodařilo smazat.' }
    }

    revalidateCustomer(customerId)
    revalidatePath('/jobs')

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
    error: error instanceof Error ? error.message : 'Kontakt se nepodařilo smazat.',
    }
  }
}
