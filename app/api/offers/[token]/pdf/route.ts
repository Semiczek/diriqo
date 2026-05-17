import { NextRequest, NextResponse } from 'next/server'

import { formatCurrency } from '@/lib/invoices'
import { isLikelyPublicOfferToken } from '@/lib/public-offer-security'
import { resolveQuoteStatus } from '@/lib/quote-status'
import { createSupabasePublicClient } from '@/lib/supabase-public'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

type PublicQuoteRow = {
  id: string
  title: string
  status: string | null
  valid_until: string | null
  intro_text: string | null
  contact_name: string | null
  contact_email: string | null
  customer_request_title: string | null
  customer_request: string | null
  our_solution_title: string | null
  proposed_solution: string | null
  timeline_title: string | null
  work_description: string | null
  work_schedule: string | null
  pricing_title: string | null
  pricing_text: string | null
  payment_terms_title: string | null
  payment_terms: string | null
  total_price: number | null
  customer_name: string | null
  created_at: string | null
  updated_at: string | null
  creator_name: string | null
}

type PublicQuoteItemRow = {
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  total_price: number | null
  note: string | null
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
  let output = ''
  for (const char of Array.from(normalizePdfText(value))) {
    const code = cp1250Map[char] ?? char.charCodeAt(0)
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

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('cs-CZ')
}

function addText(
  lines: string[],
  x: number,
  y: number,
  size: number,
  text: string,
  options?: { font?: 'regular' | 'bold'; color?: [number, number, number] }
) {
  const [r, g, b] = options?.color ?? [0.05, 0.09, 0.16]
  const font = options?.font === 'bold' ? 'F2' : 'F1'
  lines.push(`${r} ${g} ${b} rg BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`)
}

function estimatedTextWidth(text: string, size: number) {
  return normalizePdfText(text).length * size * 0.52
}

function addRightText(lines: string[], xRight: number, y: number, size: number, text: string, options?: Parameters<typeof addText>[5]) {
  addText(lines, xRight - estimatedTextWidth(text, size), y, size, text, options)
}

function addRect(lines: string[], x: number, y: number, width: number, height: number, options?: { fill?: [number, number, number]; stroke?: [number, number, number] }) {
  if (options?.fill) {
    const [r, g, b] = options.fill
    lines.push(`${r} ${g} ${b} rg ${x} ${y} ${width} ${height} re f`)
  }
  if (options?.stroke) {
    const [r, g, b] = options.stroke
    lines.push(`${r} ${g} ${b} RG ${x} ${y} ${width} ${height} re S`)
  }
}

function addLine(lines: string[], x1: number, y1: number, x2: number, y2: number) {
  lines.push(`0.86 0.88 0.91 RG ${x1} ${y1} m ${x2} ${y2} l S`)
}

function addWrappedText(lines: string[], x: number, y: number, size: number, text: string, maxChars: number, lineHeight = 13, maxRows = 3, options?: Parameters<typeof addText>[5]) {
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
  for (const row of rows.slice(0, maxRows)) {
    addText(lines, x, y, size, row, options)
    y -= lineHeight
  }
  return y
}

function addInfoSection(lines: string[], title: string, text: string | null | undefined, y: number) {
  const trimmed = text?.trim()
  if (!trimmed || y < 190) return y
  addText(lines, 44, y, 11, title, { font: 'bold' })
  y -= 17
  return addWrappedText(lines, 44, y, 9, trimmed, 92, 12, 4, { color: [0.2, 0.25, 0.33] }) - 8
}

function buildPdf(quote: PublicQuoteRow, items: PublicQuoteItemRow[]) {
  const lines: string[] = []
  const total = Number.isFinite(Number(quote.total_price)) ? Number(quote.total_price) : 0

  addRect(lines, 0, 742, 595, 100, { fill: [0.05, 0.09, 0.16] })
  addText(lines, 44, 802, 10, 'Diriqo', { color: [0.78, 0.84, 0.95], font: 'bold' })
  addText(lines, 44, 771, 27, 'Cenová nabídka', { color: [1, 1, 1], font: 'bold' })
  addWrappedText(lines, 44, 750, 12, quote.title || 'Online nabídka', 58, 13, 2, { color: [0.78, 0.84, 0.95] })
  addRightText(lines, 551, 771, 14, `Celkem ${formatCurrency(total)}`, { color: [1, 1, 1], font: 'bold' })

  addRect(lines, 44, 642, 507, 70, { fill: [0.97, 0.98, 0.99], stroke: [0.88, 0.9, 0.94] })
  addText(lines, 62, 688, 8, 'ZÁKAZNÍK', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addWrappedText(lines, 62, 668, 12, quote.customer_name || '-', 26, 12, 2, { font: 'bold' })
  addText(lines, 238, 688, 8, 'PLATNOST DO', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addText(lines, 238, 668, 13, formatDate(quote.valid_until), { font: 'bold' })
  addText(lines, 414, 688, 8, 'KONTAKT', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addWrappedText(lines, 414, 668, 10, quote.contact_name || quote.contact_email || 'Diriqo', 23, 11, 2, { font: 'bold' })

  let y = 604
  y = addInfoSection(lines, 'Úvod', quote.intro_text, y)
  y = addInfoSection(lines, quote.customer_request_title || 'Zadání zákazníka', quote.customer_request, y)
  y = addInfoSection(lines, quote.our_solution_title || 'Navržené řešení', quote.proposed_solution, y)
  y = addInfoSection(lines, 'Rozsah práce', quote.work_description, y)
  y = addInfoSection(lines, quote.timeline_title || 'Termín a organizace', quote.work_schedule, y)

  addText(lines, 44, y, 13, quote.pricing_title || 'Cenová kalkulace', { font: 'bold' })
  y -= 26
  addRect(lines, 44, y - 7, 507, 24, { fill: [0.05, 0.09, 0.16] })
  addText(lines, 58, y, 8, 'POLOŽKA', { color: [1, 1, 1], font: 'bold' })
  addRightText(lines, 322, y, 8, 'MNOŽSTVÍ', { color: [1, 1, 1], font: 'bold' })
  addRightText(lines, 420, y, 8, 'CENA/KS', { color: [1, 1, 1], font: 'bold' })
  addRightText(lines, 538, y, 8, 'CELKEM', { color: [1, 1, 1], font: 'bold' })
  y -= 26

  for (const [index, item] of items.entries()) {
    if (y < 142) break
    if (index % 2 === 0) addRect(lines, 44, y - 9, 507, 24, { fill: [0.98, 0.99, 1] })
    addWrappedText(lines, 58, y, 9, item.name || '-', 36, 10, 2)
    addRightText(lines, 322, y, 9, `${item.quantity ?? 1} ${item.unit ?? 'ks'}`)
    addRightText(lines, 420, y, 9, formatCurrency(item.unit_price))
    addRightText(lines, 538, y, 9, formatCurrency(item.total_price), { font: 'bold' })
    y -= 24
  }
  addLine(lines, 44, y + 6, 551, y + 6)

  addRect(lines, 326, 86, 225, 98, { fill: [0.97, 0.98, 0.99], stroke: [0.88, 0.9, 0.94] })
  addText(lines, 342, 128, 10, 'Cena celkem', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addRightText(lines, 535, 104, 17, formatCurrency(total), { font: 'bold' })

  addRect(lines, 44, 86, 252, 98, { fill: [1, 1, 1], stroke: [0.88, 0.9, 0.94] })
  addText(lines, 60, 160, 11, quote.payment_terms_title || 'Platební podmínky', { font: 'bold' })
  addWrappedText(lines, 60, 141, 8, quote.payment_terms || quote.pricing_text || 'Dle dohody.', 38, 11, 5, { color: [0.39, 0.45, 0.55] })

  addText(lines, 44, 22, 7, 'Cenová nabídka byla vystavena elektronicky v Diriqo.', { color: [0.55, 0.6, 0.68] })

  const content = lines.join('\n')
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
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'binary')
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params
  if (!isLikelyPublicOfferToken(token)) {
    return NextResponse.json({ error: 'Neplatny token nabidky.' }, { status: 400 })
  }

  const supabase = createSupabasePublicClient()
  const [{ data: quote, error: quoteError }, { data: items, error: itemsError }] = await Promise.all([
    supabase.rpc('get_public_offer_by_token', { input_token: token }).maybeSingle(),
    supabase.rpc('get_public_offer_items_by_token', { input_token: token }),
  ])

  if (quoteError || !quote) {
    return NextResponse.json({ error: 'Cenová nabídka nebyla nalezena.' }, { status: 404 })
  }
  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 400 })
  }

  const normalizedQuote = quote as PublicQuoteRow
  const status = resolveQuoteStatus(normalizedQuote.status, normalizedQuote.valid_until)
  if (status === 'expired' || status === 'draft') {
    return NextResponse.json({ error: 'Cenová nabídka není veřejně dostupná.' }, { status: 410 })
  }

  const pdf = buildPdf(normalizedQuote, (items ?? []) as PublicQuoteItemRow[])
  const fileName = normalizePdfText(normalizedQuote.title || 'cenova-nabidka')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'cenova-nabidka'

  return new NextResponse(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${fileName}.pdf"`,
      'cache-control': 'no-store',
    },
  })
}
