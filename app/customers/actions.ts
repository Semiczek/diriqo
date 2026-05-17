'use server'

import { revalidatePath } from 'next/cache'

import { requireHubDalContext } from '@/lib/dal/auth'

export type CreateCustomerInput = {
  name?: string | null
  email?: string | null
  phone?: string | null
  billingName?: string | null
  billingStreet?: string | null
  billingCity?: string | null
  billingPostalCode?: string | null
  billingCountry?: string | null
  companyNumber?: string | null
  vatNumber?: string | null
}

export type CreateCustomerResult =
  | {
      ok: true
      customerId: string
    }
  | {
      ok: false
      error: string
    }

export type UpdateCustomerInput = CreateCustomerInput & {
  customerId?: string | null
}

export type UpdateCustomerResult =
  | {
      ok: true
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

function normalizeCompanyNumber(value: unknown) {
  return cleanString(value).replace(/\D/g, '')
}

function normalizeCountry(value: string | null) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isCzechBillingCountry(value: string | null) {
  const normalizedCountry = normalizeCountry(value)

  return (
    normalizedCountry === 'cz' ||
    normalizedCountry === 'cr' ||
    normalizedCountry === 'cesko' ||
    normalizedCountry === 'ceska republika' ||
    normalizedCountry === 'czechia' ||
    normalizedCountry === 'czech republic'
  )
}

function isMissingCustomerBillingColumns(error: { message?: string | null } | null | undefined) {
  const message = error?.message ?? ''
  return (
    message.includes('billing_name') ||
    message.includes('billing_street') ||
    message.includes('billing_city') ||
    message.includes('billing_postal_code') ||
    message.includes('billing_country') ||
    message.includes('company_number') ||
    message.includes('vat_number') ||
    message.includes('ares_last_checked_at')
  )
}

export async function createCustomerAction(
  input: CreateCustomerInput
): Promise<CreateCustomerResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context

    const name = cleanString(input.name)
    if (!name) {
      return { ok: false, error: 'Zadejte název zákazníka.' }
    }

    const email = cleanOptionalString(input.email)
    const phone = cleanOptionalString(input.phone)
    const billingName = cleanOptionalString(input.billingName)
    const billingStreet = cleanOptionalString(input.billingStreet)
    const billingCity = cleanOptionalString(input.billingCity)
    const billingPostalCode = cleanOptionalString(input.billingPostalCode)
    const billingCountry = cleanOptionalString(input.billingCountry)
    const companyNumber = normalizeCompanyNumber(input.companyNumber)
    const vatNumber = cleanOptionalString(input.vatNumber)

    if (companyNumber && companyNumber.length !== 8) {
      return { ok: false, error: 'ICO musi mit 8 cislic.' }
    }

    let { data, error } = await supabase
      .from('customers')
      .insert({
        company_id: companyId,
        name,
        email,
        phone,
        billing_name: billingName,
        billing_street: billingStreet,
        billing_city: billingCity,
        billing_postal_code: billingPostalCode,
        billing_country: billingCountry,
        company_number: companyNumber || null,
        vat_number: vatNumber,
        ares_last_checked_at:
          companyNumber && isCzechBillingCountry(billingCountry) ? new Date().toISOString() : null,
      })
      .select('id')
      .single()

    if (error && isMissingCustomerBillingColumns(error)) {
      const fallbackResult = await supabase
        .from('customers')
        .insert({
          company_id: companyId,
          name,
          email,
          phone,
        })
        .select('id')
        .single()

      data = fallbackResult.data
      error = fallbackResult.error
    }

    if (error || !data?.id) {
      return { ok: false, error: error?.message ?? 'Zákazníka se nepodařilo vytvořit.' }
    }

    revalidatePath('/customers')
    revalidatePath(`/customers/${data.id}`)

    return {
      ok: true,
      customerId: data.id,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Zákazníka se nepodařilo vytvořit.',
    }
  }
}

export async function updateCustomerAction(input: UpdateCustomerInput): Promise<UpdateCustomerResult> {
  try {
    const context = await requireHubDalContext()
    const { supabase, companyId } = context

    const customerId = cleanString(input.customerId)
    const name = cleanString(input.name)

    if (!customerId) {
      return { ok: false, error: 'Chybí zákazník.' }
    }

    if (!name) {
      return { ok: false, error: 'Zadejte název zákazníka.' }
    }

    const existingResponse = await supabase
      .from('customers')
      .select('id')
      .eq('id', customerId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (existingResponse.error || !existingResponse.data?.id) {
      return { ok: false, error: 'Zákazník nebyl nalezen v aktivní firmě.' }
    }

    const email = cleanOptionalString(input.email)
    const phone = cleanOptionalString(input.phone)
    const billingName = cleanOptionalString(input.billingName)
    const billingStreet = cleanOptionalString(input.billingStreet)
    const billingCity = cleanOptionalString(input.billingCity)
    const billingPostalCode = cleanOptionalString(input.billingPostalCode)
    const billingCountry = cleanOptionalString(input.billingCountry)
    const companyNumber = normalizeCompanyNumber(input.companyNumber)
    const vatNumber = cleanOptionalString(input.vatNumber)

    if (companyNumber && companyNumber.length !== 8) {
      return { ok: false, error: 'ICO musi mit 8 cislic.' }
    }

    let { error } = await supabase
      .from('customers')
      .update({
        name,
        email,
        phone,
        billing_name: billingName,
        billing_street: billingStreet,
        billing_city: billingCity,
        billing_postal_code: billingPostalCode,
        billing_country: billingCountry,
        company_number: companyNumber || null,
        vat_number: vatNumber,
        ares_last_checked_at:
          companyNumber && isCzechBillingCountry(billingCountry) ? new Date().toISOString() : null,
      })
      .eq('id', customerId)
      .eq('company_id', companyId)

    if (error && isMissingCustomerBillingColumns(error)) {
      const fallbackResult = await supabase
        .from('customers')
        .update({
          name,
          email,
          phone,
        })
        .eq('id', customerId)
        .eq('company_id', companyId)

      error = fallbackResult.error
    }

    if (error) {
      return { ok: false, error: error.message || 'Zákazníka se nepodařilo uložit.' }
    }

    revalidatePath('/customers')
    revalidatePath(`/customers/${customerId}`)

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Zákazníka se nepodařilo uložit.',
    }
  }
}
