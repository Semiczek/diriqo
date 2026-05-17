import 'server-only'

export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'cancelled'

export type PohodaExportStatus = 'not_exported' | 'exported' | 'failed'

export type InvoiceCustomerSnapshot = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  billingName: string | null
  billingStreet: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
  companyNumber: string | null
  vatNumber: string | null
}

export type InvoiceSupplierSnapshot = {
  id: string
  name: string | null
  billingName: string | null
  companyNumber: string | null
  vatNumber: string | null
  billingStreet: string | null
  billingCity: string | null
  billingPostalCode: string | null
  billingCountry: string | null
  bankAccountNumber: string | null
  bankCode: string | null
  iban: string | null
  swiftBic: string | null
  logoUrl: string | null
  isVatPayer: boolean
  vatNote: string | null
}

export type InvoiceTotals = {
  subtotalWithoutVat: number
  vatTotal: number
  totalWithVat: number
}

export type InvoiceItemCalculation = InvoiceTotals & {
  unitPriceWithoutVat: number
  vatRate: number
}

type CustomerSnapshotRow = {
  id: string
  name: string | null
  email?: string | null
  phone?: string | null
  billing_name?: string | null
  billing_street?: string | null
  billing_city?: string | null
  billing_postal_code?: string | null
  billing_country?: string | null
  company_number?: string | null
  vat_number?: string | null
}

type SupplierSnapshotRow = {
  id: string
  name: string | null
  billing_name?: string | null
  company_number?: string | null
  vat_number?: string | null
  billing_street?: string | null
  billing_city?: string | null
  billing_postal_code?: string | null
  billing_country?: string | null
  bank_account_number?: string | null
  bank_code?: string | null
  iban?: string | null
  swift_bic?: string | null
  logo_url?: string | null
}

export const DEFAULT_INVOICE_VAT_RATE = 21
export const DEFAULT_INVOICE_DUE_DAYS = 14
export const NON_VAT_PAYER_NOTE = 'Dodavatel není plátcem DPH.'

export function toMoney(value: unknown) {
  const numberValue = Number(value ?? 0)
  if (!Number.isFinite(numberValue)) return 0
  return Math.round(numberValue * 100) / 100
}

export function calculateInvoiceItem(
  priceWithoutVat: unknown,
  vatRate = DEFAULT_INVOICE_VAT_RATE
): InvoiceItemCalculation {
  const unitPriceWithoutVat = toMoney(priceWithoutVat)
  const parsedVatRate = Number(vatRate)
  const safeVatRate = Number.isFinite(parsedVatRate)
    ? Math.max(0, Math.min(100, parsedVatRate))
    : DEFAULT_INVOICE_VAT_RATE
  const vatAmount = toMoney(unitPriceWithoutVat * (safeVatRate / 100))
  const totalWithVat = toMoney(unitPriceWithoutVat + vatAmount)

  return {
    unitPriceWithoutVat,
    vatRate: safeVatRate,
    subtotalWithoutVat: unitPriceWithoutVat,
    vatTotal: vatAmount,
    totalWithVat,
  }
}

export function sumInvoiceTotals(items: InvoiceTotals[]): InvoiceTotals {
  return items.reduce<InvoiceTotals>(
    (total, item) => ({
      subtotalWithoutVat: toMoney(total.subtotalWithoutVat + item.subtotalWithoutVat),
      vatTotal: toMoney(total.vatTotal + item.vatTotal),
      totalWithVat: toMoney(total.totalWithVat + item.totalWithVat),
    }),
    {
      subtotalWithoutVat: 0,
      vatTotal: 0,
      totalWithVat: 0,
    }
  )
}

export function buildCustomerSnapshot(row: CustomerSnapshotRow): InvoiceCustomerSnapshot {
  return {
    id: row.id,
    name: row.name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    billingName: row.billing_name ?? row.name ?? null,
    billingStreet: row.billing_street ?? null,
    billingCity: row.billing_city ?? null,
    billingPostalCode: row.billing_postal_code ?? null,
    billingCountry: row.billing_country ?? null,
    companyNumber: row.company_number ?? null,
    vatNumber: row.vat_number ?? null,
  }
}

export function buildSupplierSnapshot(row: SupplierSnapshotRow): InvoiceSupplierSnapshot {
  const isVatPayer = Boolean(row.vat_number?.trim())

  return {
    id: row.id,
    name: row.name ?? null,
    billingName: row.billing_name ?? row.name ?? null,
    companyNumber: row.company_number ?? null,
    vatNumber: row.vat_number ?? null,
    billingStreet: row.billing_street ?? null,
    billingCity: row.billing_city ?? null,
    billingPostalCode: row.billing_postal_code ?? null,
    billingCountry: row.billing_country ?? null,
    bankAccountNumber: row.bank_account_number ?? null,
    bankCode: row.bank_code ?? null,
    iban: row.iban ?? null,
    swiftBic: row.swift_bic ?? null,
    logoUrl: row.logo_url ?? null,
    isVatPayer,
    vatNote: isVatPayer ? null : NON_VAT_PAYER_NOTE,
  }
}

export function addDaysToDate(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

export function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildVariableSymbol(invoiceNumber: string) {
  return invoiceNumber.replace(/\D/g, '').slice(0, 10) || null
}

export function normalizeIban(value: string | null | undefined) {
  return String(value ?? '').replace(/\s/g, '').toUpperCase()
}

function mod97(value: string) {
  let remainder = 0
  for (const char of value) {
    remainder = (remainder * 10 + Number(char)) % 97
  }
  return remainder
}

export function buildCzechIban(
  bankAccountNumber: string | null | undefined,
  bankCode: string | null | undefined
) {
  const accountInput = String(bankAccountNumber ?? '').replace(/\s/g, '')
  const code = String(bankCode ?? '').replace(/\D/g, '')

  if (!accountInput || code.length !== 4) {
    return null
  }

  const [prefixInput, accountNumberInput] = accountInput.includes('-')
    ? accountInput.split('-', 2)
    : ['', accountInput]
  const prefix = prefixInput.replace(/\D/g, '')
  const accountNumber = accountNumberInput.replace(/\D/g, '')

  if (prefix.length > 6 || accountNumber.length > 10 || !accountNumber) {
    return null
  }

  const bban = `${code}${prefix.padStart(6, '0')}${accountNumber.padStart(10, '0')}`
  const checkDigits = String(98 - mod97(`${bban}123500`)).padStart(2, '0')

  return `CZ${checkDigits}${bban}`
}

export function buildQrPaymentPayload({
  iban,
  bankAccountNumber,
  bankCode,
  amount,
  variableSymbol,
  invoiceNumber,
}: {
  iban: string | null | undefined
  bankAccountNumber?: string | null | undefined
  bankCode?: string | null | undefined
  amount: number | null | undefined
  variableSymbol: string | null | undefined
  invoiceNumber: string | null | undefined
}) {
  const normalizedIban = normalizeIban(iban) || buildCzechIban(bankAccountNumber, bankCode)
  const safeAmount = toMoney(amount)

  if (!normalizedIban || safeAmount <= 0) {
    return null
  }

  const parts = [
    'SPD',
    '1.0',
    `ACC:${normalizedIban}`,
    `AM:${safeAmount.toFixed(2)}`,
    'CC:CZK',
  ]

  const safeVariableSymbol = String(variableSymbol ?? '').replace(/\D/g, '').slice(0, 10)
  if (safeVariableSymbol) {
    parts.push(`X-VS:${safeVariableSymbol}`)
  }

  const safeMessage = String(invoiceNumber ?? 'Faktura')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, 60)
  if (safeMessage) {
    parts.push(`MSG:${safeMessage}`)
  }

  return parts.join('*')
}

export function formatInvoiceStatus(status: string | null | undefined) {
  if (status === 'draft') return 'Koncept'
  if (status === 'issued') return 'Vystavená'
  if (status === 'sent') return 'Odeslaná'
  if (status === 'paid') return 'Zaplacená'
  if (status === 'overdue') return 'Po splatnosti'
  if (status === 'cancelled') return 'Zrušená'
  return 'Neznámý stav'
}

export function formatPohodaExportStatus(status: string | null | undefined) {
  if (status === 'exported') return 'Exportováno'
  if (status === 'failed') return 'Chyba exportu'
  return 'Neexportováno'
}

export function formatCurrency(value: number | null | undefined) {
  if (value == null) return '-'
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(Number(value))
}
