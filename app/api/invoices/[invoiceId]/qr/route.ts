import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

import { buildQrPaymentPayload } from '@/lib/invoices'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    invoiceId: string
  }>
}

type Snapshot = Record<string, unknown>

type InvoiceRow = {
  id: string
  invoice_number: string | null
  variable_symbol: string | null
  total_with_vat: number | null
  supplier_snapshot: Snapshot
}

function snapshotString(snapshot: Snapshot, key: string) {
  const value = snapshot[key]
  return typeof value === 'string' && value.trim() ? value : null
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const activeCompany = await requireHubAccess()
  const { invoiceId } = await context.params
  const supabase = await createSupabaseServerClient()

  const invoiceResponse = await supabase
    .from('invoices')
    .select('id, invoice_number, variable_symbol, total_with_vat, supplier_snapshot')
    .eq('id', invoiceId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (invoiceResponse.error) {
    return NextResponse.json({ error: invoiceResponse.error.message }, { status: 400 })
  }

  if (!invoiceResponse.data) {
    return NextResponse.json({ error: 'Faktura nebyla nalezena.' }, { status: 404 })
  }

  const invoice = invoiceResponse.data as InvoiceRow
  const supplier = invoice.supplier_snapshot ?? {}
  const payload = buildQrPaymentPayload({
    iban: snapshotString(supplier, 'iban'),
    bankAccountNumber: snapshotString(supplier, 'bankAccountNumber'),
    bankCode: snapshotString(supplier, 'bankCode'),
    amount: invoice.total_with_vat,
    variableSymbol: invoice.variable_symbol,
    invoiceNumber: invoice.invoice_number,
  })

  if (!payload) {
    return NextResponse.json({ error: 'Pro QR platbu je nutný IBAN nebo české číslo účtu s kódem banky a částka faktury.' }, { status: 400 })
  }

  const svg = await QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 260,
  })

  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-disposition': `inline; filename="qr-faktura-${invoice.invoice_number?.replace(/[^\w-]/g, '') || invoice.id}.svg"`,
      'cache-control': 'no-store',
    },
  })
}
