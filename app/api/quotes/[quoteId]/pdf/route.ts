import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

import { buildSupplierSnapshot, formatCurrency } from '@/lib/invoices'
import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    quoteId: string
  }>
}

type QuoteRow = {
  id: string
  company_id: string
  customer_id: string
  quote_number: string
  title: string
  quote_date: string | null
  valid_until: string | null
  contact_name: string | null
  contact_email: string | null
  intro_text: string | null
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
  subtotal_price: number | null
  discount_amount: number | null
  total_price: number | null
  customers?:
    | {
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
      }[]
    | {
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
    | null
}

type QuoteItemRow = {
  name: string
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  total_price: number | null
  note: string | null
}

type Snapshot = Record<string, unknown>

const emptyQuoteContent = {
  contact_name: null,
  contact_email: null,
  intro_text: null,
  customer_request_title: null,
  customer_request: null,
  our_solution_title: null,
  proposed_solution: null,
  timeline_title: null,
  work_description: null,
  work_schedule: null,
  pricing_title: null,
  pricing_text: null,
  payment_terms_title: null,
  payment_terms: null,
  discount_amount: null,
}

const cp1252ReverseMap = new Map<string, number>([
  ['Š', 0x8a],
  ['Œ', 0x8c],
  ['Ž', 0x8e],
  ['š', 0x9a],
  ['œ', 0x9c],
  ['ž', 0x9e],
  ['™', 0x99],
])

function repairMojibake(value: string) {
  if (!/[ÃÄÅ]/.test(value)) return value

  const bytes = Array.from(value, (char) => {
    const mapped = cp1252ReverseMap.get(char)
    if (mapped != null) return mapped

    const codePoint = char.codePointAt(0) ?? 32
    return codePoint <= 255 ? codePoint : 32
  })

  return new TextDecoder('utf-8').decode(Uint8Array.from(bytes))
}

function normalizePdfText(value: unknown) {
  return repairMojibake(String(value ?? ''))
    .normalize('NFC')
    .replace(/[^\x20-\uFFFF]/g, ' ')
}

/*
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
*/

function encodePdfText(value: unknown) {
  return Array.from(normalizePdfText(value))
    .map((char) => {
      const codePoint = char.codePointAt(0) ?? 32
      const cid = codePoint <= 0xffff ? codePoint : 32
      return cid.toString(16).padStart(4, '0')
    })
    .join('')
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

function toMoney(value: number | null | undefined) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function readUInt16(buffer: Buffer, offset: number) {
  return buffer.readUInt16BE(offset)
}

function readInt16(buffer: Buffer, offset: number) {
  return buffer.readInt16BE(offset)
}

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32BE(offset)
}

function getTableOffset(font: Buffer, tag: string) {
  const tableCount = readUInt16(font, 4)

  for (let index = 0; index < tableCount; index += 1) {
    const entryOffset = 12 + index * 16
    if (font.toString('ascii', entryOffset, entryOffset + 4) === tag) {
      return readUInt32(font, entryOffset + 8)
    }
  }

  return null
}

function parseFormat4Cmap(font: Buffer, offset: number) {
  const segCount = readUInt16(font, offset + 6) / 2
  const endCodesOffset = offset + 14
  const startCodesOffset = endCodesOffset + segCount * 2 + 2
  const idDeltasOffset = startCodesOffset + segCount * 2
  const idRangeOffsetsOffset = idDeltasOffset + segCount * 2
  const map = new Map<number, number>()

  for (let segment = 0; segment < segCount; segment += 1) {
    const endCode = readUInt16(font, endCodesOffset + segment * 2)
    const startCode = readUInt16(font, startCodesOffset + segment * 2)
    const idDelta = readInt16(font, idDeltasOffset + segment * 2)
    const idRangeOffset = readUInt16(font, idRangeOffsetsOffset + segment * 2)

    for (let code = startCode; code <= endCode && code !== 0xffff; code += 1) {
      let glyphId = 0

      if (idRangeOffset === 0) {
        glyphId = (code + idDelta) & 0xffff
      } else {
        const glyphOffset =
          idRangeOffsetsOffset + segment * 2 + idRangeOffset + (code - startCode) * 2
        if (glyphOffset + 1 < font.length) {
          const glyphIndex = readUInt16(font, glyphOffset)
          glyphId = glyphIndex === 0 ? 0 : (glyphIndex + idDelta) & 0xffff
        }
      }

      if (glyphId > 0) map.set(code, glyphId)
    }
  }

  return map
}

function parseFormat12Cmap(font: Buffer, offset: number) {
  const groupCount = readUInt32(font, offset + 12)
  const map = new Map<number, number>()

  for (let index = 0; index < groupCount; index += 1) {
    const groupOffset = offset + 16 + index * 12
    const startCharCode = readUInt32(font, groupOffset)
    const endCharCode = readUInt32(font, groupOffset + 4)
    const startGlyphId = readUInt32(font, groupOffset + 8)

    for (let code = startCharCode; code <= endCharCode && code <= 0xffff; code += 1) {
      map.set(code, startGlyphId + code - startCharCode)
    }
  }

  return map
}

function parseFontCmap(font: Buffer) {
  const cmapOffset = getTableOffset(font, 'cmap')
  if (cmapOffset == null) return new Map<number, number>()

  const subtableCount = readUInt16(font, cmapOffset + 2)
  let format12Offset: number | null = null
  let format4Offset: number | null = null

  for (let index = 0; index < subtableCount; index += 1) {
    const recordOffset = cmapOffset + 4 + index * 8
    const platformId = readUInt16(font, recordOffset)
    const encodingId = readUInt16(font, recordOffset + 2)
    const subtableOffset = cmapOffset + readUInt32(font, recordOffset + 4)
    const format = readUInt16(font, subtableOffset)

    if (format === 12 && platformId === 3 && encodingId === 10) {
      format12Offset = subtableOffset
    }

    if (format === 4 && platformId === 3 && (encodingId === 1 || encodingId === 0)) {
      format4Offset = subtableOffset
    }
  }

  if (format12Offset != null) return parseFormat12Cmap(font, format12Offset)
  if (format4Offset != null) return parseFormat4Cmap(font, format4Offset)

  return new Map<number, number>()
}

const geistFontPath = path.join(
  process.cwd(),
  'public',
  'fonts',
  'Geist-Regular.ttf'
)
const geistFont = fs.readFileSync(geistFontPath)
const geistCmap = parseFontCmap(geistFont)

function parseFontMetrics(font: Buffer) {
  const headOffset = getTableOffset(font, 'head')
  const hheaOffset = getTableOffset(font, 'hhea')
  const hmtxOffset = getTableOffset(font, 'hmtx')

  if (headOffset == null || hheaOffset == null || hmtxOffset == null) {
    return { unitsPerEm: 1000, widths: [520] }
  }

  const unitsPerEm = readUInt16(font, headOffset + 18) || 1000
  const numberOfHMetrics = readUInt16(font, hheaOffset + 34)
  const widths: number[] = []

  for (let index = 0; index < numberOfHMetrics; index += 1) {
    const advanceWidth = readUInt16(font, hmtxOffset + index * 4)
    widths.push(Math.round((advanceWidth / unitsPerEm) * 1000))
  }

  return { unitsPerEm, widths }
}

const geistMetrics = parseFontMetrics(geistFont)

function getGlyphWidth(glyphId: number) {
  if (glyphId < geistMetrics.widths.length) {
    return geistMetrics.widths[glyphId] ?? 520
  }

  return geistMetrics.widths.at(-1) ?? 520
}

function collectUsedCids(content: string) {
  const used = new Set<number>([0, 10, 13, 32])
  const matches = content.matchAll(/<([0-9a-fA-F]+)> Tj/g)

  for (const match of matches) {
    const hex = match[1] ?? ''
    for (let index = 0; index + 3 < hex.length; index += 4) {
      used.add(Number.parseInt(hex.slice(index, index + 4), 16))
    }
  }

  return used
}

function buildCidToGidMap(usedCids: Set<number>) {
  const maxCid = Math.max(255, ...usedCids)
  const map = Buffer.alloc((maxCid + 1) * 2)

  for (let cid = 0; cid <= maxCid; cid += 1) {
    const glyphId = geistCmap.get(cid) ?? 0
    map.writeUInt16BE(glyphId, cid * 2)
  }

  return map
}

function buildFontWidths(usedCids: Set<number>) {
  const cids = Array.from(usedCids)
    .filter((cid) => cid > 0 && cid <= 0xffff)
    .sort((a, b) => a - b)
  const groups: string[] = []
  let index = 0

  while (index < cids.length) {
    const startCid = cids[index]
    const widths: number[] = []
    let currentCid = startCid

    while (index < cids.length && cids[index] === currentCid) {
      const glyphId = geistCmap.get(currentCid) ?? 0
      widths.push(getGlyphWidth(glyphId))
      index += 1
      currentCid += 1
    }

    groups.push(`${startCid} [${widths.join(' ')}]`)
  }

  return `[${groups.join(' ')}]`
}

function buildToUnicodeMap(usedCids: Set<number>) {
  const cids = Array.from(usedCids)
    .filter((cid) => cid > 0 && cid <= 0xffff)
    .sort((a, b) => a - b)
  const chunks: string[] = []

  for (let index = 0; index < cids.length; index += 100) {
    const group = cids.slice(index, index + 100)
    chunks.push(`${group.length} beginbfchar`)
    for (const cid of group) {
      const hex = cid.toString(16).padStart(4, '0').toUpperCase()
      chunks.push(`<${hex}> <${hex}>`)
    }
    chunks.push('endbfchar')
  }

  return Buffer.from(
    [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def',
      '/CMapName /GeistUnicode def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      ...chunks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n'),
    'ascii'
  )
}

function pdfTextObject(id: number, text: string) {
  return Buffer.from(`${id} 0 obj ${text} endobj\n`, 'ascii')
}

function pdfStreamObject(id: number, dictionary: string, stream: Buffer) {
  return Buffer.concat([
    Buffer.from(`${id} 0 obj << ${dictionary} /Length ${stream.length} >> stream\n`, 'ascii'),
    stream,
    Buffer.from('\nendstream endobj\n', 'ascii'),
  ])
}

function buildPdfBuffer(pageContents: string[]) {
  const combinedContent = pageContents.join('\n')
  const usedCids = collectUsedCids(combinedContent)
  const cidToGidMap = buildCidToGidMap(usedCids)
  const toUnicodeMap = buildToUnicodeMap(usedCids)
  const fontWidths = buildFontWidths(usedCids)
  const pageObjectStart = 3
  const contentObjectStart = pageObjectStart + pageContents.length
  const fontObjectStart = contentObjectStart + pageContents.length
  const pageRefs = pageContents
    .map((_, index) => `${pageObjectStart + index} 0 R`)
    .join(' ')
  const objects = [
    pdfTextObject(1, '<< /Type /Catalog /Pages 2 0 R >>'),
    pdfTextObject(2, `<< /Type /Pages /Kids [${pageRefs}] /Count ${pageContents.length} >>`),
    ...pageContents.map((_, index) =>
      pdfTextObject(
        pageObjectStart + index,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectStart} 0 R /F2 ${fontObjectStart + 1} 0 R >> >> /Contents ${contentObjectStart + index} 0 R >>`
      )
    ),
    ...pageContents.map((content, index) =>
      pdfStreamObject(contentObjectStart + index, '', Buffer.from(content, 'ascii'))
    ),
    pdfTextObject(
      fontObjectStart,
      `<< /Type /Font /Subtype /Type0 /BaseFont /Geist-Regular /Encoding /Identity-H /DescendantFonts [${fontObjectStart + 2} 0 R] /ToUnicode ${fontObjectStart + 4} 0 R >>`
    ),
    pdfTextObject(
      fontObjectStart + 1,
      `<< /Type /Font /Subtype /Type0 /BaseFont /Geist-Regular /Encoding /Identity-H /DescendantFonts [${fontObjectStart + 2} 0 R] /ToUnicode ${fontObjectStart + 4} 0 R >>`
    ),
    pdfTextObject(
      fontObjectStart + 2,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Geist-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontObjectStart + 3} 0 R /CIDToGIDMap ${fontObjectStart + 5} 0 R /DW 520 /W ${fontWidths} >>`
    ),
    pdfTextObject(
      fontObjectStart + 3,
      `<< /Type /FontDescriptor /FontName /Geist-Regular /Flags 4 /FontBBox [-500 -300 1200 1000] /ItalicAngle 0 /Ascent 950 /Descent -250 /CapHeight 700 /StemV 80 /FontFile2 ${fontObjectStart + 6} 0 R >>`
    ),
    pdfStreamObject(fontObjectStart + 4, '', toUnicodeMap),
    pdfStreamObject(fontObjectStart + 5, '', cidToGidMap),
    pdfStreamObject(fontObjectStart + 6, `/Length1 ${geistFont.length}`, geistFont),
  ]

  let pdf = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')
  const offsets = [0]

  for (const object of objects) {
    offsets.push(pdf.length)
    pdf = Buffer.concat([pdf, object])
  }

  const xrefOffset = pdf.length
  const xrefLines = [`xref\n0 ${objects.length + 1}`, '0000000000 65535 f ']
  for (const offset of offsets.slice(1)) {
    xrefLines.push(`${String(offset).padStart(10, '0')} 00000 n `)
  }
  xrefLines.push(`trailer << /Size ${objects.length + 1} /Root 1 0 R >>`)
  xrefLines.push(`startxref\n${xrefOffset}\n%%EOF`)

  return Buffer.concat([pdf, Buffer.from(`${xrefLines.join('\n')}\n`, 'ascii')])
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
  lines.push(`${r} ${g} ${b} rg BT /${font} ${size} Tf ${x} ${y} Td <${encodePdfText(text)}> Tj ET`)
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
  maxRows = 3,
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
  for (const row of rows.slice(0, maxRows)) {
    addText(lines, x, y, size, row, options)
    y -= lineHeight
  }

  return y
}

function customerToSnapshot(quote: QuoteRow): Snapshot {
  const customer = Array.isArray(quote.customers) ? quote.customers[0] ?? null : quote.customers ?? null
  return {
    name: customer?.name ?? null,
    billingName: customer?.billing_name ?? customer?.name ?? null,
    companyNumber: customer?.company_number ?? null,
    vatNumber: customer?.vat_number ?? null,
    billingStreet: customer?.billing_street ?? null,
    billingCity: customer?.billing_city ?? null,
    billingPostalCode: customer?.billing_postal_code ?? null,
    email: quote.contact_email ?? customer?.email ?? null,
    phone: customer?.phone ?? null,
  }
}

function addInfoSection(lines: string[], title: string, text: string | null | undefined, y: number) {
  const trimmed = text?.trim()
  if (!trimmed || y < 175) return y

  addText(lines, 44, y, 11, title, { font: 'bold' })
  y -= 17
  return addWrappedText(lines, 44, y, 9, trimmed, 92, 12, 4, { color: [0.2, 0.25, 0.33] }) - 8
}

function addQuoteHeader(
  lines: string[],
  supplierName: string,
  quote: Pick<QuoteRow, 'quote_number' | 'title'>,
  total: number,
  subtitle = quote.title || quote.quote_number
) {
  addRect(lines, 0, 742, 595, 100, { fill: [0.05, 0.09, 0.16] })
  addText(lines, 44, 802, 10, supplierName, { color: [0.78, 0.84, 0.95], font: 'bold' })
  addText(lines, 44, 771, 27, 'Cenová nabídka', {
    color: [1, 1, 1],
    font: 'bold',
  })
  addText(lines, 44, 750, 12, subtitle, {
    color: [0.78, 0.84, 0.95],
  })
  addRightText(lines, 551, 802, 10, quote.quote_number, {
    color: [0.78, 0.84, 0.95],
  })
  addRightText(lines, 551, 771, 14, `Celkem ${formatCurrency(total)}`, {
    color: [1, 1, 1],
    font: 'bold',
  })
}

function addQuoteFooter(lines: string[], text: string | null | undefined, page: number) {
  if (text?.trim()) {
    addWrappedText(lines, 44, 54, 8, text, 104, 10, 2, { color: [0.39, 0.45, 0.55] })
  }

  addText(lines, 44, 22, 7, 'Cenová nabídka byla vystavena elektronicky v Diriqo.', {
    color: [0.55, 0.6, 0.68],
  })
  addRightText(lines, 551, 22, 7, `${page} / 2`, { color: [0.55, 0.6, 0.68] })
}

function buildPdf(quote: QuoteRow, items: QuoteItemRow[], supplier: Snapshot) {
  const firstPageLines: string[] = []
  const secondPageLines: string[] = []
  const customer = customerToSnapshot(quote)
  const supplierName = snapshotValue(supplier, 'billingName') || snapshotValue(supplier, 'name') || '-'
  const customerName = snapshotValue(customer, 'billingName') || snapshotValue(customer, 'name') || '-'
  const subtotal = toMoney(quote.subtotal_price)
  const discount = toMoney(quote.discount_amount)
  const total = toMoney(quote.total_price)

  addQuoteHeader(firstPageLines, supplierName, quote, total)

  addRect(firstPageLines, 44, 642, 507, 70, { fill: [0.97, 0.98, 0.99], stroke: [0.88, 0.9, 0.94] })
  addText(firstPageLines, 62, 688, 8, 'DATUM NABÍDKY', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addText(firstPageLines, 62, 668, 13, formatDate(quote.quote_date), { font: 'bold' })
  addText(firstPageLines, 238, 688, 8, 'PLATNOST DO', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addText(firstPageLines, 238, 668, 13, formatDate(quote.valid_until), { font: 'bold' })
  addText(firstPageLines, 414, 688, 8, 'KONTAKT', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addWrappedText(firstPageLines, 414, 668, 10, quote.contact_name || quote.contact_email || '-', 22, 11, 2, { font: 'bold' })

  addText(firstPageLines, 44, 604, 13, 'Dodavatel', { font: 'bold' })
  addText(firstPageLines, 315, 604, 13, 'Zákazník', { font: 'bold' })
  addLine(firstPageLines, 44, 594, 260, 594)
  addLine(firstPageLines, 315, 594, 551, 594)

  let supplierY = 574
  addText(firstPageLines, 44, supplierY, 10, supplierName, { font: 'bold' })
  supplierY -= 15
  addText(firstPageLines, 44, supplierY, 9, `ICO: ${snapshotValue(supplier, 'companyNumber') || '-'}`)
  supplierY -= 13
  addText(firstPageLines, 44, supplierY, 9, `DIC: ${snapshotValue(supplier, 'vatNumber') || '-'}`)
  supplierY -= 13
  addText(firstPageLines, 44, supplierY, 9, snapshotValue(supplier, 'billingStreet') || '-')
  supplierY -= 13
  addText(firstPageLines, 44, supplierY, 9, `${snapshotValue(supplier, 'billingPostalCode')} ${snapshotValue(supplier, 'billingCity')}`.trim() || '-')

  let customerY = 574
  addWrappedText(firstPageLines, 315, customerY, 10, customerName, 34, 13, 2, { font: 'bold' })
  customerY -= 28
  addText(firstPageLines, 315, customerY, 9, `ICO: ${snapshotValue(customer, 'companyNumber') || '-'}`)
  customerY -= 13
  addText(firstPageLines, 315, customerY, 9, `DIC: ${snapshotValue(customer, 'vatNumber') || '-'}`)
  customerY -= 13
  addText(firstPageLines, 315, customerY, 9, snapshotValue(customer, 'billingStreet') || '-')
  customerY -= 13
  addText(firstPageLines, 315, customerY, 9, `${snapshotValue(customer, 'billingPostalCode')} ${snapshotValue(customer, 'billingCity')}`.trim() || '-')
  customerY -= 13
  addText(firstPageLines, 315, customerY, 9, snapshotValue(customer, 'email') || '-')

  let y = 438
  y = addInfoSection(firstPageLines, quote.customer_request_title || 'Zadání zákazníka', quote.customer_request, y)
  y = addInfoSection(firstPageLines, quote.our_solution_title || 'Navržené řešení', quote.proposed_solution, y)
  y = addInfoSection(firstPageLines, 'Rozsah práce', quote.work_description, y)
  addInfoSection(firstPageLines, quote.timeline_title || 'Termín a organizace', quote.work_schedule, y)
  addQuoteFooter(firstPageLines, null, 1)

  addQuoteHeader(secondPageLines, supplierName, quote, total, 'Kalkulace a platební podmínky')
  let pricingY = 666
  addText(secondPageLines, 44, pricingY, 16, quote.pricing_title || 'Cenová kalkulace', { font: 'bold' })
  pricingY -= 30
  addRect(secondPageLines, 44, pricingY - 7, 507, 24, { fill: [0.05, 0.09, 0.16] })
  addText(secondPageLines, 58, pricingY, 8, 'POLOŽKA', { color: [1, 1, 1], font: 'bold' })
  addRightText(secondPageLines, 322, pricingY, 8, 'MNOŽSTVÍ', { color: [1, 1, 1], font: 'bold' })
  addRightText(secondPageLines, 420, pricingY, 8, 'CENA/KS', { color: [1, 1, 1], font: 'bold' })
  addRightText(secondPageLines, 538, pricingY, 8, 'CELKEM', { color: [1, 1, 1], font: 'bold' })
  pricingY -= 26

  for (const [index, item] of items.entries()) {
    if (pricingY < 330) break
    if (index % 2 === 0) {
      addRect(secondPageLines, 44, pricingY - 9, 507, 24, { fill: [0.98, 0.99, 1] })
    }
    addWrappedText(secondPageLines, 58, pricingY, 9, item.name || '-', 36, 10, 2)
    addRightText(secondPageLines, 322, pricingY, 9, `${item.quantity ?? 1} ${item.unit ?? 'ks'}`)
    addRightText(secondPageLines, 420, pricingY, 9, formatCurrency(item.unit_price))
    addRightText(secondPageLines, 538, pricingY, 9, formatCurrency(item.total_price), { font: 'bold' })
    pricingY -= 24
  }

  addLine(secondPageLines, 44, pricingY + 6, 551, pricingY + 6)
  addRect(secondPageLines, 326, 150, 225, 118, { fill: [0.97, 0.98, 0.99], stroke: [0.88, 0.9, 0.94] })
  addText(secondPageLines, 342, 236, 10, 'Mezisoucet')
  addRightText(secondPageLines, 535, 236, 10, formatCurrency(subtotal))
  addText(secondPageLines, 342, 214, 10, 'Sleva')
  addRightText(secondPageLines, 535, 214, 10, formatCurrency(discount))
  addLine(secondPageLines, 342, 195, 535, 195)
  addText(secondPageLines, 342, 176, 10, 'Cena celkem', { color: [0.39, 0.45, 0.55], font: 'bold' })
  addRightText(secondPageLines, 535, 158, 17, formatCurrency(total), { font: 'bold' })

  addRect(secondPageLines, 44, 150, 252, 118, { fill: [1, 1, 1], stroke: [0.88, 0.9, 0.94] })
  addText(secondPageLines, 60, 238, 11, quote.payment_terms_title || 'Platební podmínky', { font: 'bold' })
  addWrappedText(secondPageLines, 60, 219, 8, quote.payment_terms || quote.pricing_text || 'Dle dohody.', 38, 11, 7, {
    color: [0.39, 0.45, 0.55],
  })

  addQuoteFooter(secondPageLines, quote.intro_text, 2)

  return buildPdfBuffer([firstPageLines.join('\n'), secondPageLines.join('\n')])
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const activeCompany = await requireHubAccess()
  const { quoteId } = await context.params
  const supabase = await createSupabaseServerClient()

  const [quoteResponse, itemsResponse, companyResponse] = await Promise.all([
    supabase
      .from('quotes')
      .select(
        'id, company_id, customer_id, quote_number, title, quote_date, valid_until, subtotal_price, total_price, customers(name, email, phone, billing_name, billing_street, billing_city, billing_postal_code, billing_country, company_number, vat_number)'
      )
      .eq('id', quoteId)
      .eq('company_id', activeCompany.companyId)
      .maybeSingle(),
    supabase
      .from('quote_items')
      .select('name, description, quantity, unit, unit_price, total_price, note')
      .eq('quote_id', quoteId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('companies')
      .select(
        'id, name, billing_name, company_number, vat_number, billing_street, billing_city, billing_postal_code, billing_country, bank_account_number, bank_code, iban, swift_bic'
      )
      .eq('id', activeCompany.companyId)
      .maybeSingle(),
  ])

  if (quoteResponse.error) {
    return NextResponse.json({ error: quoteResponse.error.message }, { status: 400 })
  }

  if (itemsResponse.error) {
    return NextResponse.json({ error: itemsResponse.error.message }, { status: 400 })
  }

  if (companyResponse.error) {
    return NextResponse.json({ error: companyResponse.error.message }, { status: 400 })
  }

  if (!quoteResponse.data) {
    return NextResponse.json({ error: 'Cenová nabídka nebyla nalezena.' }, { status: 404 })
  }

  if (!companyResponse.data) {
    return NextResponse.json({ error: 'Nepodařilo se načíst údaje firmy.' }, { status: 404 })
  }

  const quote = {
    ...emptyQuoteContent,
    ...(quoteResponse.data as Omit<
      QuoteRow,
      | 'contact_name'
      | 'contact_email'
      | 'intro_text'
      | 'customer_request_title'
      | 'customer_request'
      | 'our_solution_title'
      | 'proposed_solution'
      | 'timeline_title'
      | 'work_description'
      | 'work_schedule'
      | 'pricing_title'
      | 'pricing_text'
      | 'payment_terms_title'
      | 'payment_terms'
      | 'discount_amount'
    >),
  } as QuoteRow
  const supplier = buildSupplierSnapshot(companyResponse.data) as unknown as Snapshot
  const pdf = buildPdf(quote, (itemsResponse.data ?? []) as QuoteItemRow[], supplier)
  const fileNumber = quote.quote_number?.replace(/[^\w-]/g, '') || 'nabidka'

  return new NextResponse(pdf, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="cenova-nabidka-${fileNumber}.pdf"`,
      'cache-control': 'no-store',
    },
  })
}
