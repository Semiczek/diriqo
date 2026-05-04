import { NextRequest, NextResponse } from 'next/server'

import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    invoiceId: string
  }>
}

type Snapshot = Record<string, unknown>

type InvoiceCsvRow = {
  id: string
  invoice_number: string | null
  variable_symbol: string | null
  status: string | null
  currency: string | null
  issue_date: string | null
  taxable_supply_date: string | null
  due_date: string | null
  payment_method: string | null
  subtotal_without_vat: number | null
  vat_total: number | null
  total_with_vat: number | null
  customer_snapshot: Snapshot
  supplier_snapshot: Snapshot
  note: string | null
}

type InvoiceItemCsvRow = {
  source_job_id: string | null
  item_name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price_without_vat: number | null
  vat_rate: number | null
  vat_amount: number | null
  total_without_vat: number | null
  total_with_vat: number | null
}

function snapshotValue(snapshot: Snapshot, key: string) {
  const value = snapshot[key]
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''
}

function csvValue(value: unknown) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ').trim()
  return `"${text.replace(/"/g, '""')}"`
}

function moneyValue(value: number | null | undefined) {
  return value == null ? '' : String(value).replace('.', ',')
}

function buildCsv(invoice: InvoiceCsvRow, items: InvoiceItemCsvRow[]) {
  const customer = invoice.customer_snapshot ?? {}
  const supplier = invoice.supplier_snapshot ?? {}
  const headers = [
    'typ_radku',
    'cislo_faktury',
    'variabilni_symbol',
    'stav',
    'mena',
    'datum_vystaveni',
    'duzp',
    'splatnost',
    'zpusob_platby',
    'odberatel',
    'odberatel_ico',
    'odberatel_dic',
    'dodavatel',
    'dodavatel_ico',
    'dodavatel_dic',
    'source_job_id',
    'polozka',
    'popis',
    'mnozstvi',
    'jednotka',
    'jednotkova_cena_bez_dph',
    'sazba_dph',
    'dph',
    'polozka_celkem_bez_dph',
    'polozka_celkem_s_dph',
    'faktura_celkem_bez_dph',
    'faktura_dph',
    'faktura_celkem_s_dph',
    'poznamka',
  ]

  const rows = (items.length > 0 ? items : [null]).map((item) => [
    item ? 'polozka' : 'faktura',
    invoice.invoice_number ?? '',
    invoice.variable_symbol ?? '',
    invoice.status ?? '',
    invoice.currency ?? 'CZK',
    invoice.issue_date ?? '',
    invoice.taxable_supply_date ?? '',
    invoice.due_date ?? '',
    invoice.payment_method ?? '',
    snapshotValue(customer, 'billingName') || snapshotValue(customer, 'name'),
    snapshotValue(customer, 'companyNumber'),
    snapshotValue(customer, 'vatNumber'),
    snapshotValue(supplier, 'billingName') || snapshotValue(supplier, 'name'),
    snapshotValue(supplier, 'companyNumber'),
    snapshotValue(supplier, 'vatNumber'),
    item?.source_job_id ?? '',
    item?.item_name ?? '',
    item?.description ?? '',
    item?.quantity ?? '',
    item?.unit ?? '',
    moneyValue(item?.unit_price_without_vat),
    moneyValue(item?.vat_rate),
    moneyValue(item?.vat_amount),
    moneyValue(item?.total_without_vat),
    moneyValue(item?.total_with_vat),
    moneyValue(invoice.subtotal_without_vat),
    moneyValue(invoice.vat_total),
    moneyValue(invoice.total_with_vat),
    invoice.note ?? '',
  ])

  return [
    'sep=;',
    headers.map(csvValue).join(';'),
    ...rows.map((row) => row.map(csvValue).join(';')),
  ].join('\r\n')
}

function buildFileName(invoiceNumber: string | null) {
  const safeNumber = (invoiceNumber || 'faktura')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  return `${safeNumber || 'faktura'}.csv`
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const activeCompany = await requireHubAccess()
  const { invoiceId } = await context.params
  const supabase = await createSupabaseServerClient()

  const [invoiceResponse, itemsResponse] = await Promise.all([
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, variable_symbol, status, currency, issue_date, taxable_supply_date, due_date, payment_method, subtotal_without_vat, vat_total, total_with_vat, customer_snapshot, supplier_snapshot, note'
      )
      .eq('id', invoiceId)
      .eq('company_id', activeCompany.companyId)
      .maybeSingle(),
    supabase
      .from('invoice_items')
      .select(
        'source_job_id, item_name, description, quantity, unit, unit_price_without_vat, vat_rate, vat_amount, total_without_vat, total_with_vat'
      )
      .eq('invoice_id', invoiceId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (invoiceResponse.error) {
    return NextResponse.json({ error: invoiceResponse.error.message }, { status: 400 })
  }

  if (!invoiceResponse.data) {
    return NextResponse.json({ error: 'Faktura nebyla nalezena.' }, { status: 404 })
  }

  if (itemsResponse.error) {
    return NextResponse.json({ error: itemsResponse.error.message }, { status: 400 })
  }

  const invoice = invoiceResponse.data as InvoiceCsvRow
  const items = (itemsResponse.data ?? []) as InvoiceItemCsvRow[]
  const csv = `\uFEFF${buildCsv(invoice, items)}`

  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${buildFileName(invoice.invoice_number)}"`,
      'cache-control': 'no-store',
    },
  })
}
