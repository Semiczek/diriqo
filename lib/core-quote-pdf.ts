import fs from 'node:fs'
import path from 'node:path'
import type { CoreQuoteDocument } from './core-quote-lifecycle'

function normalizePdfText(value: unknown) {
  return String(value ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
}

function encodePdfText(value: string) {
  return Array.from(normalizePdfText(value)).map(char => {
    const code = char.codePointAt(0) ?? 32
    return (code <= 0xffff ? code : 0xfffd).toString(16).padStart(4, '0')
  }).join('')
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


const PAGE_LEFT = 44
const PAGE_RIGHT = 551
const PAGE_BOTTOM = 62
const INK: [number, number, number] = [0.09, 0.12, 0.20]
const MUTED: [number, number, number] = [0.37, 0.41, 0.49]
const ACCENT: [number, number, number] = [0.37, 0.24, 0.77]

function textWidth(text: string, size: number) {
  return Array.from(normalizePdfText(text)).reduce((width, char) =>
    width + getGlyphWidth(geistCmap.get(char.codePointAt(0) ?? 32) ?? 0) * size / 1000, 0)
}

function wrapText(text: string, width: number, size: number): string[] {
  const lines: string[] = []
  for (const paragraph of normalizePdfText(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue }
    let line = ''
    for (const word of paragraph.trim().split(/\s+/u)) {
      if (line && textWidth(`${line} ${word}`, size) <= width) { line += ` ${word}`; continue }
      if (line) { lines.push(line); line = '' }
      // A long URL or unbroken identifier is split by measured glyph width too.
      for (const char of Array.from(word)) {
        if (line && textWidth(line + char, size) > width) { lines.push(line); line = '' }
        line += char
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

function putText(commands: string[], x: number, y: number, size: number, text: string, color = INK) {
  commands.push(`${color.join(' ')} rg BT /F1 ${size} Tf ${x} ${y} Td <${encodePdfText(text)}> Tj ET`)
}
function putRight(commands: string[], right: number, y: number, size: number, text: string, maxWidth: number) {
  const actual = Math.min(size, size * maxWidth / Math.max(textWidth(text, size), 1))
  putText(commands, right - textWidth(text, actual), y, actual, text)
}
function rule(commands: string[], y: number, color = [0.89, 0.90, 0.94]) {
  commands.push(`${color.join(' ')} RG 0.6 w ${PAGE_LEFT} ${y} m ${PAGE_RIGHT} ${y} l S`)
}
function dateLabel(value: string | null | undefined) {
  if (!value) return 'Neuvedeno'
  // Date-only business values must not shift with the host time zone.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value
}
function money(value: string | number | null | undefined, currency: string | null) {
  if (value == null) return 'Neuvedeno'
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${value} (měna nedoložena)`
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))
}

export type CoreQuotePdfOptions = { kind: 'draft' | 'issued' | 'legacy'; publishedAt?: string | null }

/** One frozen customer projection in, all pages out. No live joins or internal fields. */
export function buildCoreQuotePdf(document: CoreQuoteDocument, options: CoreQuotePdfOptions): Buffer {
  const pages: string[][] = []
  let commands: string[] = []
  let y = 755
  const currency = document.currency && /^[A-Z]{3}$/.test(document.currency) ? document.currency : null
  function newPage() {
    commands = []
    pages.push(commands)
    putText(commands, PAGE_LEFT, 805, 11, 'CENOVÁ NABÍDKA', ACCENT)
    putRight(commands, PAGE_RIGHT, 805, 9, document.quote_number || document.id, 280)
    rule(commands, 790)
    y = 766
  }
  function ensure(height: number) { if (y - height < PAGE_BOTTOM) newPage() }
  function paragraph(text: string | null | undefined, size = 10, color = INK, width = PAGE_RIGHT - PAGE_LEFT) {
    if (!text) return
    const height = size * 1.5
    for (const line of wrapText(text, width, size)) {
      ensure(height)
      putText(commands, PAGE_LEFT, y, size, line, color)
      y -= height
    }
    y -= 6
  }
  function section(title: string, text: string | null | undefined) {
    if (!text?.trim()) return
    ensure(48)
    paragraph(title, 12, ACCENT)
    paragraph(text)
    y -= 6
  }
  newPage()
  paragraph(document.title, 22)
  paragraph(options.kind === 'draft' ? 'KONCEPT - dosud nevydáno' : options.kind === 'legacy'
    ? 'Starší nabídka - původní verze a okamžik vydání nejsou doloženy'
    : `Verze ${document.version_number} | Vydáno ${dateLabel(options.publishedAt)}`, 9, MUTED)
  paragraph(`Datum nabídky: ${dateLabel(document.quote_date)}   |   Platnost do: ${dateLabel(document.valid_until)}`, 9, MUTED)
  const supplier = document.supplier
  section('Dodavatel', [supplier.name, supplier.address || [supplier.street, [supplier.postal_code, supplier.city].filter(Boolean).join(' '), supplier.country].filter(Boolean).join(', '), supplier.company_number && `IČO: ${supplier.company_number}`, supplier.vat_number && `DIČ: ${supplier.vat_number}`, supplier.email, supplier.phone].filter(Boolean).join('\n') || 'Údaje dodavatele nejsou doloženy.')
  const customer = document.customer
  section('Zákazník', document.customer_identity_state === 'legacy_unknown'
    ? 'Identita zákazníka v původní nabídce není doložena.'
    : [customer?.billing_name || customer?.name, customer?.billing_street, [customer?.billing_postal_code, customer?.billing_city].filter(Boolean).join(' '), customer?.billing_country, customer?.company_number && `IČO: ${customer.company_number}`, customer?.vat_number && `DIČ: ${customer.vat_number}`, customer?.email, customer?.phone].filter(Boolean).join('\n') || 'Zákazník neuveden')
  const c = document.content
  paragraph([c.contact_name, c.contact_email].filter(Boolean).join(' | '), 9, MUTED)
  section('Úvod', c.intro_text)
  section(c.customer_request_title || 'Zadání zákazníka', c.customer_request)
  section(c.our_solution_title || 'Navržené řešení', c.proposed_solution)
  section('Rozsah prací', c.work_description)
  section(c.timeline_title || 'Termín a organizace', c.work_schedule)
  section('Přínosy řešení', c.benefits_text)
  section(c.pricing_title || 'Cena a rozsah nabídky', c.pricing_text)
  ensure(80)
  paragraph('Položky nabídky', 13, ACCENT)
  paragraph(document.pricing_mode === 'net' ? `Ceny bez DPH | Měna: ${currency || 'nedoložena'}` : `Historický cenový režim není doložen | Měna: ${currency || 'nedoložena'}`, 9, MUTED)
  function tableHeader() {
    ensure(30)
    putText(commands, PAGE_LEFT, y, 9, 'Položka', MUTED)
    putRight(commands, 345, y, 9, 'Množství', 64)
    putRight(commands, 445, y, 9, 'Cena / jednotka', 92)
    putRight(commands, PAGE_RIGHT, y, 9, 'Celkem', 100)
    y -= 12
    rule(commands, y)
    y -= 18
  }
  tableHeader()
  for (let index = 0; index < document.items.length; index += 1) {
    const item = document.items[index]
    const text = [`${index + 1}. ${item.name || 'Položka'}`, item.description, item.note, item.vat_rate == null ? 'DPH: sazba není doložena' : `DPH: ${item.vat_rate} %`].filter(Boolean).join('\n')
    const rowLines = wrapText(text, 226, 9)
    if (y - Math.min(rowLines.length * 13 + 14, 70) < PAGE_BOTTOM) { newPage(); tableHeader() }
    putRight(commands, 345, y, 9, `${item.quantity} ${item.unit || ''}`, 64)
    putRight(commands, 445, y, 9, money(item.unit_price, currency), 92)
    putRight(commands, PAGE_RIGHT, y, 9, money(item.total_price, currency), 100)
    for (let lineIndex = 0; lineIndex < rowLines.length; lineIndex += 1) {
      if (y - 13 < PAGE_BOTTOM) {
        newPage(); tableHeader()
        putText(commands, 355, y, 8, `Položka ${index + 1} - pokračování`, MUTED)
      }
      putText(commands, PAGE_LEFT, y, 9, rowLines[lineIndex])
      y -= 13
    }
    y -= 4
    rule(commands, y)
    y -= 15
  }
  ensure(105)
  const totals = [['Mezisoučet', document.subtotal_price], ['Sleva', document.discount_amount], [document.pricing_mode === 'net' ? 'Celkem bez DPH' : 'Celkem (historická částka)', document.total_price]] as const
  for (const [label, value] of totals) {
    putText(commands, PAGE_LEFT, y, 11, label)
    putRight(commands, PAGE_RIGHT, y, 12, money(value, currency), 230)
    y -= 25
  }
  y -= 8
  section(c.payment_terms_title || 'Platební podmínky', c.payment_terms)
  section('Poznámka pro zákazníka', document.customer_note)
  const bank = [supplier.bank_account, supplier.iban && `IBAN: ${supplier.iban}`, supplier.bic && `BIC: ${supplier.bic}`].filter(Boolean).join(' | ')
  if (bank) paragraph(bank, 9, MUTED)
  // The identity of the frozen version is included without inventing one for legacy rows.
  if (document.version_id) paragraph(`Verze dokumentu: ${document.version_id}`, 8, MUTED)
  for (let index = 0; index < pages.length; index += 1) {
    rule(pages[index], 43)
    putText(pages[index], PAGE_LEFT, 28, 8, options.kind === 'draft' ? 'Koncept - není vydanou nabídkou' : 'Cenová nabídka', MUTED)
    putRight(pages[index], PAGE_RIGHT, 28, 8, `${index + 1} / ${pages.length}`, 80)
  }
  return buildPdfBuffer(pages.map(page => page.join('\n')))
}
