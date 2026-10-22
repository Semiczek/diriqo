import { describe, expect, it } from 'vitest'
import { buildCoreQuotePdf } from '../lib/core-quote-pdf'
import { coreQuotePresentation } from '../lib/core-quote-presentation'
import { quoteDocumentFixture } from './fixtures/core-quote-document'
function pdfLines(pdf: Buffer) {
  return Array.from(pdf.toString('latin1').matchAll(/<([0-9a-f]+)> Tj/g), match => {
    const values = match[1].match(/.{4}/g) || []
    return values.map(value => String.fromCharCode(parseInt(value, 16))).join('')
  })
}
describe('complete version-bound quote documents', () => {
  it('writes all 73 rows, including a free row, and totals without a 12-row limit', () => {
    const read = quoteDocumentFixture(73)
    const pdf = buildCoreQuotePdf(read.document, read)
    const lines = pdfLines(pdf), text = lines.join('\n')
    for (let n = 2; n <= 73; n += 1) expect(text).toContain(`Položka ${n} - čištění povrchů`)
    expect(text).toContain('Bezplatná položka')
    expect(text).toContain('0,00')
    expect(text).toContain('Celkem bez DPH')
    expect(text).toContain('příliš žluťoučký kůň.')
    expect(pdf.toString('latin1').match(/\/Type \/Page /g)!.length).toBeGreaterThan(2)
  })
  it('paginates long text and an unbroken identifier without dropping their ends', () => {
    const read = quoteDocumentFixture(2)
    read.document.content.payment_terms = ('Dlouhé platební podmínky.\n').repeat(500) + 'KONEC PODMÍNEK'
    read.document.items[1].description = 'X'.repeat(1500) + 'KONECIDENTIFIKÁTORU'
    const lines = pdfLines(buildCoreQuotePdf(read.document, read))
    expect(lines.join('\n')).toContain('KONEC PODMÍNEK')
    expect(lines.join('')).toContain('KONECIDENTIFIKÁTORU')
    expect(lines.filter(line => line === 'Dlouhé platební podmínky.')).toHaveLength(500)
  })
  it('uses frozen supplier/customer, currency, discount and never internal fields from extra input', () => {
    const read = quoteDocumentFixture()
    Object.assign(read.document, { internal_note: 'PRIVATE_INTERNAL_SENTINEL', total_cost: 987654.32, margin: 876543.21 })
    Object.assign(read.document.items[0], { unit_cost: 987654.32 })
    const text = pdfLines(buildCoreQuotePdf(read.document, read)).join('\n')
    expect(text).toContain('Původní zákazník s.r.o.')
    expect(text).toContain('Syntetická firma s.r.o.')
    expect(text).toContain('EUR')
    expect(text).toContain('Sleva')
    expect(text).not.toMatch(/PRIVATE_INTERNAL|987654|876543\.21/)
    const props = JSON.stringify(coreQuotePresentation(read, 'a'.repeat(64), 'public', '/pdf'))
    expect(props).not.toMatch(/PRIVATE_INTERNAL|unit_cost|total_cost|margin/)
  })
  it('preserves unknown legacy currency and identity instead of inventing CZK or a version', () => {
    const read = quoteDocumentFixture()
    read.kind = 'legacy'; read.publishedAt = null; read.legacyCapturedAt = '2026-10-21T00:00:00Z'
    Object.assign(read.document, { version_id: null, version_number: null, currency: null, pricing_mode: null, customer_identity_state: 'legacy_unknown', customer: { name: null } })
    const text = pdfLines(buildCoreQuotePdf(read.document, read)).join('\n')
    expect(text).toContain('měna nedoložena')
    expect(text).toContain('původní verze a okamžik vydání nejsou doloženy')
    expect(text).not.toContain('CZK')
    expect(coreQuotePresentation(read, 'a'.repeat(64), 'public', '/pdf').canRespond).toBe(false)
  })
})
