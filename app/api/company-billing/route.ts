import { NextRequest, NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'
import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type CompanyBillingRow = {
  id: string
  name: string | null
  billing_name: string | null
  company_number: string | null
  vat_number: string | null
  billing_street: string | null
  billing_city: string | null
  billing_postal_code: string | null
  billing_country: string | null
  bank_account_number: string | null
  bank_code: string | null
  iban: string | null
  swift_bic: string | null
  ares_last_checked_at?: string | null
}

const COMPANY_BILLING_SELECT_BASE =
  'id, name, billing_name, company_number, vat_number, billing_street, billing_city, billing_postal_code, billing_country, bank_account_number, bank_code, iban, swift_bic'

const COMPANY_BILLING_SELECT_WITH_ARES = `${COMPANY_BILLING_SELECT_BASE}, ares_last_checked_at`

function normalizeText(value: unknown, maxLength: number) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  return normalized.slice(0, maxLength)
}

function normalizeCompanyNumber(value: unknown) {
  const normalized = String(value ?? '').replace(/\D/g, '')
  return normalized || null
}

function getSupabaseErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return String(error ?? '')
  return String((error as { message?: unknown }).message ?? '')
}

function getSupabaseErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return ''
  return String((error as { code?: unknown }).code ?? '')
}

function isMissingAresLastCheckedAtError(error: unknown) {
  const message = getSupabaseErrorMessage(error)
  const code = getSupabaseErrorCode(error)

  return (
    message.includes('ares_last_checked_at') &&
    (
      message.includes('does not exist') ||
      message.includes('Could not find') ||
      code === '42703' ||
      code === 'PGRST204'
    )
  )
}

function mapCompanyBilling(row: CompanyBillingRow) {
  return {
    companyId: row.id,
    name: row.name,
    billingName: row.billing_name,
    companyNumber: row.company_number,
    vatNumber: row.vat_number,
    billingStreet: row.billing_street,
    billingCity: row.billing_city,
    billingPostalCode: row.billing_postal_code,
    billingCountry: row.billing_country,
    bankAccountNumber: row.bank_account_number,
    bankCode: row.bank_code,
    iban: row.iban,
    swiftBic: row.swift_bic,
    aresLastCheckedAt: row.ares_last_checked_at ?? null,
  }
}

export async function GET() {
  try {
    const activeCompany = await getActiveCompanyContext()

    if (!activeCompany) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = await createSupabaseServerClient()
    const companyBillingResponse = await supabase
      .from('companies')
      .select(COMPANY_BILLING_SELECT_WITH_ARES)
      .eq('id', activeCompany.companyId)
      .maybeSingle()

    let data = companyBillingResponse.data as CompanyBillingRow | null
    let error = companyBillingResponse.error

    if (isMissingAresLastCheckedAtError(error)) {
      const retry = await supabase
        .from('companies')
        .select(COMPANY_BILLING_SELECT_BASE)
        .eq('id', activeCompany.companyId)
        .maybeSingle()

      data = retry.data as CompanyBillingRow | null
      error = retry.error
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Firma nebyla nalezena.' }, { status: 404 })
    }

    return NextResponse.json(mapCompanyBilling(data as CompanyBillingRow))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Nepodařilo se načíst fakturační údaje.' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const activeCompanyResult = await requireCompanyRole('super_admin', 'company_admin')

    if (!activeCompanyResult.ok) {
      return NextResponse.json({ error: activeCompanyResult.error }, { status: activeCompanyResult.status })
    }

    const activeCompany = activeCompanyResult.value

    const body = (await request.json()) as {
      name?: string
      billingName?: string
      companyNumber?: string
      vatNumber?: string
      billingStreet?: string
      billingCity?: string
      billingPostalCode?: string
      billingCountry?: string
      bankAccountNumber?: string
      bankCode?: string
      iban?: string
      swiftBic?: string
      aresLoaded?: boolean
    }

    const name = normalizeText(body.name, 180)
    const companyNumber = normalizeCompanyNumber(body.companyNumber)

    if (!name) {
      return NextResponse.json({ error: 'Název firmy je povinný.' }, { status: 400 })
    }

    if (companyNumber && companyNumber.length !== 8) {
      return NextResponse.json({ error: 'IČO musí mít 8 číslic.' }, { status: 400 })
    }

    const updatePayload = {
      name,
      billing_name: normalizeText(body.billingName, 180),
      company_number: companyNumber,
      vat_number: normalizeText(body.vatNumber, 32),
      billing_street: normalizeText(body.billingStreet, 220),
      billing_city: normalizeText(body.billingCity, 120),
      billing_postal_code: normalizeText(body.billingPostalCode, 32),
      billing_country: normalizeText(body.billingCountry, 80),
      bank_account_number: normalizeText(body.bankAccountNumber, 80),
      bank_code: normalizeText(body.bankCode, 16),
      iban: normalizeText(body.iban, 64),
      swift_bic: normalizeText(body.swiftBic, 32),
      ...(body.aresLoaded && companyNumber
        ? { ares_last_checked_at: new Date().toISOString() }
        : {}),
    }

    const supabase = await createSupabaseServerClient()
    const companyBillingUpdateResponse = await supabase
      .from('companies')
      .update(updatePayload)
      .eq('id', activeCompany.companyId)
      .select(COMPANY_BILLING_SELECT_WITH_ARES)
      .maybeSingle()

    let data = companyBillingUpdateResponse.data as CompanyBillingRow | null
    let error = companyBillingUpdateResponse.error

    if (isMissingAresLastCheckedAtError(error)) {
      const fallbackPayload = { ...updatePayload }
      delete fallbackPayload.ares_last_checked_at
      const retry = await supabase
        .from('companies')
        .update(fallbackPayload)
        .eq('id', activeCompany.companyId)
        .select(COMPANY_BILLING_SELECT_BASE)
        .maybeSingle()

      data = retry.data as CompanyBillingRow | null
      error = retry.error
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Firma nebyla nalezena.' }, { status: 404 })
    }

    return NextResponse.json(mapCompanyBilling(data as CompanyBillingRow))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Nepodařilo se uložit fakturační údaje.' },
      { status: 500 }
    )
  }
}
