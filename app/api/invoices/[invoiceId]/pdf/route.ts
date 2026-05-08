import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

import { buildQrPaymentPayload, formatCurrency } from '@/lib/invoices'
import { getActiveCompanyContext } from '@/lib/active-company'
import { getPortalUserContext } from '@/lib/customer-portal/auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    invoiceId: string
  }>
}

type Snapshot = Record<string, unknown>

type InvoiceRow = {
  id: string
  company_id: string
  customer_id: string
  status: string | null
  invoice_number: string | null
  variable_symbol: string | null
  issue_date: string | null
  taxable_supply_date: string | null
  due_date: string | null
  payment_method: string | null
  is_vat_payer: boolean | null
  vat_note: string | null
  subtotal_without_vat: number | null
  vat_total: number | null
  total_with_vat: number | null
  customer_snapshot: Snapshot
  supplier_snapshot: Snapshot
  note: string | null
}

type InvoiceItemRow = {
  item_name: string
  quantity: number | null
  unit: string | null
  total_without_vat: number | null
  vat_rate: number | null
  vat_amount: number | null
  total_with_vat: number | null
}

function normalizePdfText(value: unknown) {
  return String(value ?? '').replace(/[^\x20-\xff\u0100-\u017f]/g, ' ')
}

const cp1250Map: Record<string, number> = {
  Š: 0x8a,
  Ť: 0x8d,
  Ž: 0x8e,
  š: 0x9a,
  ť: 0x9d,
  ž: 0x9e,
  Č: 0xc8,
  Ď: 0xcf,
  Ě: 0xcc,
  Ň: 0xd2,
  Ř: 0xd8,
  Ů: 0xd9,
  č: 0xe8,
  ď: 0xef,
  ě: 0xec,
  ň: 0xf2,
  ř: 0xf8,
  ů: 0xf9,
}

function encodePdfText(value: unknown) {
  const chars = Array.from(normalizePdfText(value))
  let output = ''

  for (const char of chars) {
    const mapped = cp1250Map[char]
    const code = mapped ?? char.charCodeAt(0)
    output += code <= 255 ? String.fromCharCode(code) : ' '
  }

  return output
}

function escapePdfText(value: unknown) {
  return encodePdfText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function snapshotValue(snapshot: Snapshot, key: string) {
  const value = snapshot[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

function formatPaymentMethod(value: string | null | undefined) {
  if (value === 'bank_transfer') return 'Převodem'
  if (value === 'cash') return 'Hotově'
  if (value === 'card') return 'Kartou'
  return value?.trim() || 'Převodem'
}

function addText(
  lines: string[],
  x: number,
  y: number,
  size: number,
  text: string,
  options?: {
    font?: 'regular' | 'bold'
    color?: [number, number, number]
  }
) {
  const [r, g, b] = options?.color ?? [0.05, 0.09, 0.16]
  const font = options?.font === 'bold' ? 'F2' : 'F1'
  lines.push(`${r} ${g} ${b} rg BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`)
}

function estimatedTextWidth(text: string, size: number) {
  return normalizePdfText(text).length * size * 0.52
}

function addRightText(
  lines: string[],
  xRight: number,
  y: number,
  size: number,
  text: string,
  options?: Parameters<typeof addText>[5]
) {
  addText(lines, xRight - estimatedTextWidth(text, size), y, size, text, options)
}

function addRect(
  lines: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  options?: {
    fill?: [number, number, number]
    stroke?: [number, number, number]
  }
) {
  if (options?.fill) {
    const [r, g, b] = options.fill
    lines.push(`${r} ${g} ${b} rg ${x} ${y} ${width} ${height} re f`)
  }

  if (options?.stroke) {
    const [r, g, b] = options.stroke
    lines.push(`${r} ${g} ${b} RG ${x} ${y} ${width} ${height} re S`)
  }
}

function addLine(lines: string[], x1: number, y1: number, x2: number, y2: number, color: [number, number, number] = [0.86, 0.88, 0.91]) {
  const [r, g, b] = color
  lines.push(`${r} ${g} ${b} RG ${x1} ${y1} m ${x2} ${y2} l S`)
}

function addWrappedText(
  lines: string[],
  x: number,
  y: number,
  size: number,
  text: string,
  maxChars: number,
  lineHeight = 13,
  options?: Parameters<typeof addText>[5]
) {
  const words = normalizePdfText(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const rows: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      rows.push(current)
      current = word
    } else {
      current = next
    }
  }

  if (current) rows.push(current)
  for (const row of rows.slice(0, 3)) {
    addText(lines, x, y, size, row, options)
    y -= lineHeight
  }

  return y
}

function addQrCode(lines: string[], payload: string, x: number, y: number, size: number) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' })
  const moduleCount = qr.modules.size
  const moduleSize = size / moduleCount

  lines.push('q 0 0 0 rg')
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qr.modules.get(row, col)) {
        const drawX = x + col * moduleSize
        const drawY = y + (moduleCount - row - 1) * moduleSize
        lines.push(`${drawX.toFixed(2)} ${drawY.toFixed(2)} ${moduleSize.toFixed(2)} ${moduleSize.toFixed(2)} re f`)
      }
    }
  }
  lines.push('Q')
}

function buildPdf(invoice: InvoiceRow, items: InvoiceItemRow[]) {
  const contentLines: string[] = []
  const supplier = invoice.supplier_snapshot ?? {}
  const customer = invoice.customer_snapshot ?? {}
  const supplierName = snapshotValue(supplier, 'billingName') || snapshotValue(supplier, 'name') || '-'
  const customerName = snapshotValue(customer, 'billingName') || snapshotValue(customer, 'name') || '-'
  const bankAccount = `${snapshotValue(supplier, 'bankAccountNumber')}/${snapshotValue(supplier, 'bankCode')}`.replace('/-', '')
  const qrPaymentPayload = buildQrPaymentPayload({
    iban: snapshotValue(supplier, 'iban'),
    bankAccountNumber: snapshotValue(supplier, 'bankAccountNumber'),
    bankCode: snapshotValue(supplier, 'bankCode'),
    amount: invoice.total_with_vat,
    variableSymbol: invoice.variable_symbol,
    invoiceNumber: invoice.invoice_number,
  })

  addRect(contentLines, 0, 742, 595, 100, { fill: [0.05, 0.09, 0.16] })
  addText(contentLines, 44, 802, 10, supplierName, { color: [0.78, 0.84, 0.95], font: 'bold' })
  addText(contentLines, 44, 771, 30, `Faktura ${invoice.invoice_number ?? 'koncept'}`, {
    color: [1, 1, 1],
    font: 'bold',
  })
  addRightText(contentLines, 551, 802, 10, `Variabilni symbol: ${invoice.variable_symbol ?? '-'}`, {
    color: [0.78, 0.84, 0.95],
  })
  addRightText(contentLines, 551, 771, 14, `Celkem ${formatCurrency(invoice.total_with_vat)}`, {
    color: [1, 1, 1],
    font: 'bold',
  })

  addRect(contentLines, 44, 642, 507, 70, { fill: [0.97, 0.98, 0.99], stroke: [0.88, 0.9, 0.94] })
  addText(contentLines, 62, 688, 8, 'VYSTAVENÍ', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addText(contentLines, 62, 668, 13, formatDate(invoice.issue_date), { font: 'bold' })
  addText(contentLines, 198, 688, 8, 'DUZP', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addText(contentLines, 198, 668, 13, formatDate(invoice.taxable_supply_date), { font: 'bold' })
  addText(contentLines, 320, 688, 8, 'SPLATNOST', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addText(contentLines, 320, 668, 13, formatDate(invoice.due_date), { font: 'bold' })
  addText(contentLines, 444, 688, 8, 'PLATBA', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addText(contentLines, 444, 668, 12, formatPaymentMethod(invoice.payment_method), { font: 'bold' })

  addText(contentLines, 44, 604, 13, 'Dodavatel', { font: 'bold' })
  addText(contentLines, 315, 604, 13, 'Odběratel', { font: 'bold' })
  addLine(contentLines, 44, 594, 260, 594)
  addLine(contentLines, 315, 594, 551, 594)

  let supplierY = 574
  addText(contentLines, 44, supplierY, 10, supplierName, { font: 'bold' })
  supplierY -= 15
  addText(contentLines, 44, supplierY, 9, `ICO: ${snapshotValue(supplier, 'companyNumber') || '-'}`)
  supplierY -= 13
  addText(contentLines, 44, supplierY, 9, `DIC: ${snapshotValue(supplier, 'vatNumber') || '-'}`)
  supplierY -= 13
  addText(contentLines, 44, supplierY, 9, snapshotValue(supplier, 'billingStreet') || '-')
  supplierY -= 13
  addText(contentLines, 44, supplierY, 9, `${snapshotValue(supplier, 'billingPostalCode')} ${snapshotValue(supplier, 'billingCity')}`.trim() || '-')
  supplierY -= 18
  addText(contentLines, 44, supplierY, 9, `Účet: ${bankAccount || '-'}`, { font: 'bold' })

  let customerY = 574
  addWrappedText(contentLines, 315, customerY, 10, customerName, 34, 13, { font: 'bold' })
  customerY -= 28
  addText(contentLines, 315, customerY, 9, `ICO: ${snapshotValue(customer, 'companyNumber') || '-'}`)
  customerY -= 13
  addText(contentLines, 315, customerY, 9, `DIC: ${snapshotValue(customer, 'vatNumber') || '-'}`)
  customerY -= 13
  addText(contentLines, 315, customerY, 9, snapshotValue(customer, 'billingStreet') || '-')
  customerY -= 13
  addText(contentLines, 315, customerY, 9, `${snapshotValue(customer, 'billingPostalCode')} ${snapshotValue(customer, 'billingCity')}`.trim() || '-')

  let y = 438
  if (invoice.vat_note) {
    addRect(contentLines, 44, y - 16, 507, 30, { fill: [1, 0.98, 0.9], stroke: [0.99, 0.86, 0.45] })
    addText(contentLines, 60, y - 2, 9, invoice.vat_note, { color: [0.5, 0.32, 0.02], font: 'bold' })
    y -= 52
  }

  addText(contentLines, 44, y, 13, 'Položky faktury', { font: 'bold' })
  y -= 26
  addRect(contentLines, 44, y - 7, 507, 24, { fill: [0.05, 0.09, 0.16] })
  addText(contentLines, 58, y, 8, 'NÁZEV', { color: [1, 1, 1], font: 'bold' })
  addRightText(contentLines, 322, y, 8, 'MNOŽSTVÍ', { color: [1, 1, 1], font: 'bold' })
  addRightText(contentLines, 410, y, 8, 'BEZ DPH', { color: [1, 1, 1], font: 'bold' })
  addRightText(contentLines, 462, y, 8, 'DPH', { color: [1, 1, 1], font: 'bold' })
  addRightText(contentLines, 538, y, 8, 'CELKEM', { color: [1, 1, 1], font: 'bold' })
  y -= 26

  for (const [index, item] of items.entries()) {
    if (y < 142) break
    if (index % 2 === 0) {
      addRect(contentLines, 44, y - 9, 507, 24, { fill: [0.98, 0.99, 1] })
    }
    addWrappedText(contentLines, 58, y, 9, item.item_name || '-', 34, 10)
    addRightText(contentLines, 322, y, 9, `${item.quantity ?? 1} ${item.unit ?? 'ks'}`)
    addRightText(contentLines, 410, y, 9, formatCurrency(item.total_without_vat))
    addRightText(contentLines, 462, y, 9, `${item.vat_rate ?? 0} %`)
    addRightText(contentLines, 538, y, 9, formatCurrency(item.total_with_vat), { font: 'bold' })
    y -= 24
  }

  addLine(contentLines, 44, y + 6, 551, y + 6)
  addRect(contentLines, 326, 86, 225, 98, { fill: [0.97, 0.98, 0.99], stroke: [0.88, 0.9, 0.94] })
  addText(contentLines, 342, 156, 10, 'Základ')
  addRightText(contentLines, 535, 156, 10, formatCurrency(invoice.subtotal_without_vat))
  addText(contentLines, 342, 136, 10, 'DPH')
  addRightText(contentLines, 535, 136, 10, formatCurrency(invoice.vat_total))
  addLine(contentLines, 342, 123, 535, 123)
  addText(contentLines, 342, 107, 10, 'Celkem k úhradě', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addRightText(contentLines, 535, 91, 17, formatCurrency(invoice.total_with_vat), { font: 'bold' })

  if (qrPaymentPayload) {
    addRect(contentLines, 44, 64, 252, 114, { fill: [1, 1, 1], stroke: [0.88, 0.9, 0.94] })
    addText(contentLines, 60, 154, 12, 'QR platba', { font: 'bold' })
    addText(contentLines, 60, 137, 8, 'Naskenujte v bankovní aplikaci.', { color: [0.39, 0.45, 0.55] })
    addQrCode(contentLines, qrPaymentPayload, 202, 78, 82)
  } else {
    addRect(contentLines, 44, 92, 252, 86, { fill: [1, 1, 1], stroke: [0.88, 0.9, 0.94] })
    addText(contentLines, 60, 150, 11, 'Platební údaje', { font: 'bold' })
    addText(contentLines, 60, 130, 9, `Účet: ${bankAccount || '-'}`)
    addText(contentLines, 60, 113, 9, `VS: ${invoice.variable_symbol ?? '-'}`)
  }

  if (invoice.note) {
    addText(contentLines, 44, 40, 8, `Poznámka: ${invoice.note.replace(/\s+/g, ' ').slice(0, 110)}`, {
      color: [0.39, 0.45, 0.55],
    })
  }

  addText(contentLines, 44, 22, 7, 'Doklad byl vystaven elektronicky v Diriqo.', { color: [0.55, 0.6, 0.68] })

  const content = contentLines.join('\n')
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding 7 0 R >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(content, 'binary')} >> stream\n${content}\nendstream endobj`,
    '6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding 7 0 R >> endobj',
    '7 0 obj << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [138 /Scaron 141 /Tcaron 142 /Zcaron 154 /scaron 157 /tcaron 158 /zcaron 200 /Ccaron 204 /Ecaron 207 /Dcaron 210 /Ncaron 216 /Rcaron 217 /Uring 232 /ccaron 236 /ecaron 239 /dcaron 242 /ncaron 248 /rcaron 249 /uring] >> endobj',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'binary'))
    pdf += `${object}\n`
  }

  const xrefOffset = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return Buffer.from(pdf, 'binary')
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const [activeCompany, portalUser] = await Promise.all([
    getActiveCompanyContext(),
    getPortalUserContext(),
  ])

  if (!activeCompany && !portalUser) {
    return NextResponse.json({ error: 'Přístup zamítnut.' }, { status: 401 })
  }

  const { invoiceId } = await context.params
  const supabase = createSupabaseAdminClient()

  const [invoiceResponse, itemsResponse] = await Promise.all([
    supabase
      .from('invoices')
      .select(
        'id, company_id, customer_id, status, invoice_number, variable_symbol, issue_date, taxable_supply_date, due_date, payment_method, is_vat_payer, vat_note, subtotal_without_vat, vat_total, total_with_vat, customer_snapshot, supplier_snapshot, note'
      )
      .eq('id', invoiceId)
      .maybeSingle(),
    supabase
      .from('invoice_items')
      .select('item_name, quantity, unit, total_without_vat, vat_rate, vat_amount, total_with_vat')
      .eq('invoice_id', invoiceId)
      .eq('company_id', activeCompany?.companyId ?? portalUser?.companyId ?? '00000000-0000-0000-0000-000000000000')
      .order('sort_order', { ascending: true }),
  ])

  if (invoiceResponse.error) {
    return NextResponse.json({ error: invoiceResponse.error.message }, { status: 400 })
  }

  if (itemsResponse.error) {
    return NextResponse.json({ error: itemsResponse.error.message }, { status: 400 })
  }

  if (!invoiceResponse.data) {
    return NextResponse.json({ error: 'Faktura nebyla nalezena.' }, { status: 404 })
  }

  const invoice = invoiceResponse.data as InvoiceRow
  const hasHubAccess = activeCompany?.companyId === invoice.company_id
  const hasPortalAccess =
    portalUser?.customerId === invoice.customer_id &&
    portalUser.companyId === invoice.company_id &&
    ['issued', 'sent', 'paid', 'overdue'].includes(invoice.status ?? '') &&
    Boolean(invoice.invoice_number)

  if (!hasHubAccess && !hasPortalAccess) {
    return NextResponse.json({ error: 'Přístup zamítnut.' }, { status: 403 })
  }

  const pdf = buildPdf(invoice, (itemsResponse.data ?? []) as InvoiceItemRow[])
  const fileNumber = invoice.invoice_number?.replace(/[^\w-]/g, '') || 'koncept'

  return new NextResponse(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="faktura-${fileNumber}.pdf"`,
      'cache-control': 'no-store',
    },
  })
}
