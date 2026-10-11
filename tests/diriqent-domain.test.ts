import { describe, expect, it } from 'vitest'
import {
  aiCapability, aiProduct, detectDocumentType, imageDimensions, isAiKind,
  parseChatResult, parseOcrResult, usageCharge, validateJobDraft,
  type AiUsage, type JobDraft,
} from '../lib/diriqent/domain'

const draft = (): JobDraft => ({
  title: 'Montáž dveří', description: 'Zkontrolovat rozměry.', address: 'Praha',
  customerId: null, startAt: null, endAt: null, price: null,
})
const document = () => ({
  documentType: 'Nabídka', supplierName: 'Testovací dodavatel', documentNumber: 'TEST-1',
  date: null, currency: 'CZK', total: null, warnings: ['Nečitelná cena'], extractedText: 'Dveře 2 ks',
  items: [{ name: 'Dveře', quantity: 2, unit: 'ks', unitPrice: null, vatRate: null, total: null, confidence: 'low', source: 'První řádek' }],
})

describe('Diriqent credit accounting', () => {
  it('separates provider USD micro-units from credit cents and discounts cached input', () => {
    expect(usageCharge({ inputTokens: 1000, cachedTokens: 200, outputTokens: 100 }, 100)).toEqual({
      providerMicrousd: 2840, creditUnits: 22, unbilledUnits: 0,
    })
    expect(usageCharge({ inputTokens: 1_000_000, cachedTokens: 200_000, outputTokens: 1_000_000 }, 200_000)).toEqual({
      providerMicrousd: 13_640_000, creditUnits: 102_300, unbilledUnits: 0,
    })
  })
  it('never bills more than the human-approved reservation and preserves the overrun', () => {
    expect(usageCharge({ inputTokens: 1000, cachedTokens: 200, outputTokens: 100 }, 20)).toEqual({
      providerMicrousd: 2840, creditUnits: 20, unbilledUnits: 2,
    })
    expect(usageCharge({ inputTokens: 1000, cachedTokens: 200, outputTokens: 100 }, 0)).toMatchObject({ creditUnits: 0, unbilledUnits: 22 })
  })
  it('rounds a fractional provider micro-unit up and does not charge zero usage', () => {
    expect(usageCharge({ inputTokens: 1, cachedTokens: 1, outputTokens: 0 }, 10)).toEqual({ providerMicrousd: 1, creditUnits: 1, unbilledUnits: 0 })
    expect(usageCharge({ inputTokens: 0, cachedTokens: 0, outputTokens: 0 }, 10)).toEqual({ providerMicrousd: 0, creditUnits: 0, unbilledUnits: 0 })
  })
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid token counts and reservation %s', invalid => {
    const valid: AiUsage = { inputTokens: 10, cachedTokens: 0, outputTokens: 10 }
    for (const key of ['inputTokens', 'cachedTokens', 'outputTokens'] as const) {
      expect(() => usageCharge({ ...valid, [key]: invalid }, 100)).toThrow()
    }
    expect(() => usageCharge(valid, invalid)).toThrow()
  })
  it('rejects cached tokens larger than all input tokens', () => {
    expect(() => usageCharge({ inputTokens: 10, cachedTokens: 11, outputTokens: 0 }, 100)).toThrow(/cache/)
  })
})

describe('Diriqent module boundaries', () => {
  it.each(['chat', 'proposal'] as const)('%s requires the assistant capability', kind => {
    expect(aiProduct(kind)).toBe('ai_assistant')
    expect(aiCapability(kind)).toBe('ai_assistant.conversation.run')
  })
  it.each(['smart_quotes.ocr', 'inventory.ocr', 'invoicing.ocr'] as const)('%s uses its own product entitlement', kind => {
    expect(aiProduct(kind)).toBe(kind.split('.')[0])
    expect(aiCapability(kind)).toBe(`${kind}.request`)
    expect(aiCapability(kind)).not.toContain('ai_assistant')
  })
  it.each([null, undefined, 1, {}, 'admin', 'chat.run', 'inventory', 'inventory.ocr.request'])('rejects an unknown operation kind %s', value => {
    expect(isAiKind(value)).toBe(false)
  })
})

describe('Diriqent structured result boundaries', () => {
  it('keeps unknown proposal facts null until a person supplies the required fields', () => {
    expect(validateJobDraft(draft())).toEqual(draft())
    expect(() => validateJobDraft(draft(), true)).toThrow(/cenu, začátek/)
    const complete = { ...draft(), startAt: '2026-10-20T09:00:00+02:00', endAt: '2026-10-20T10:00:00+02:00', price: 0 }
    expect(validateJobDraft(complete, true)).toMatchObject({ startAt: '2026-10-20T07:00:00.000Z', endAt: '2026-10-20T08:00:00.000Z', price: 0 })
    expect(() => validateJobDraft({ ...complete, endAt: complete.startAt }, true)).toThrow()
  })
  it('strips actions, tenant IDs and computed facts at both chat and proposal boundaries', () => {
    const result = parseChatResult(JSON.stringify({
      answer: 'Návrh vyžaduje kontrolu.', execute: 'delete', companyId: 'foreign',
      jobProposal: { ...draft(), companyId: 'foreign', status: 'completed', execute: 'createJob' },
    }))
    expect(result).toEqual({ answer: 'Návrh vyžaduje kontrolu.', jobProposal: draft() })
  })
  it.each(['null', '{}', '{"answer":""}', '{"answer":123}', '{"answer":"x","jobProposal":{}}', 'invalid JSON'])('rejects an unusable chat response %s', text => {
    expect(() => parseChatResult(text)).toThrow()
  })
  it('rejects invalid identity, dates and non-numeric prices rather than coercing them', () => {
    for (const patch of [{ customerId: 'foreign' }, { startAt: 'tomorrow' }, { price: '20' }, { price: -1 }, { title: ' ' }]) {
      expect(() => validateJobDraft({ ...draft(), ...patch })).toThrow()
    }
  })
  it('retains OCR uncertainty and allowlists document and line fields', () => {
    const input = document()
    expect(parseOcrResult(JSON.stringify({ ...input, execute: 'createInvoice', companyId: 'foreign', items: input.items.map(item => ({ ...item, execute: 'reserveStock', costPrice: 100 })) }))).toEqual(input)
  })
  it('downgrades an unknown OCR confidence and bounds warning count', () => {
    const input = document()
    expect(parseOcrResult(JSON.stringify({ ...input, warnings: Array.from({ length: 31 }, () => 'Zkontrolovat'), items: [{ ...input.items[0], confidence: 'certain' }] }))).toMatchObject({ warnings: Array.from({ length: 30 }, () => 'Zkontrolovat'), items: [{ confidence: 'low' }] })
  })
  it('rejects missing or implausible OCR quantities, VAT, prices and oversized extraction', () => {
    for (const patch of [{ quantity: undefined }, { quantity: '2' }, { quantity: -1 }, { quantity: 1_000_001 }, { vatRate: 101 }, { unitPrice: -1 }]) {
      const input = document()
      expect(() => parseOcrResult(JSON.stringify({ ...input, items: [{ ...input.items[0], ...patch }] }))).toThrow()
    }
    const input = document()
    expect(() => parseOcrResult(JSON.stringify({ ...input, items: Array.from({ length: 101 }, () => input.items[0]) }))).toThrow()
    expect(() => parseOcrResult(JSON.stringify({ ...input, extractedText: 'x'.repeat(24001) }))).toThrow()
  })
})

describe('Diriqent uploaded document identification', () => {
  it('identifies magic bytes instead of a user-provided filename or MIME', () => {
    expect(detectDocumentType(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf')
    expect(detectDocumentType(Uint8Array.from([255, 216, 255]))).toBe('image/jpeg')
    expect(detectDocumentType(new TextEncoder().encode('RIFF1234WEBP'))).toBe('image/webp')
    expect(detectDocumentType(new TextEncoder().encode('<svg onload="alert(1)">'))).toBeNull()
    expect(detectDocumentType(Uint8Array.from([137, 80, 78]))).toBeNull()
  })
  it('reads PNG dimensions correctly from a byte-offset view, including an oversized image', () => {
    const backing = new Uint8Array(32), bytes = backing.subarray(8), view = new DataView(backing.buffer, 8)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    view.setUint32(16, 6000); view.setUint32(20, 4000)
    expect(detectDocumentType(bytes)).toBe('image/png')
    expect(imageDimensions(bytes, 'image/png')).toEqual({ width: 6000, height: 4000 })
    expect(imageDimensions(bytes.subarray(0, 23), 'image/png')).toBeNull()
  })
  it('reads JPEG dimensions after a metadata segment and rejects truncated lengths', () => {
    const bytes = new Uint8Array(27)
    bytes.set([255, 216, 255, 224, 0, 4, 0, 0, 255, 194, 0, 17, 8, 3, 0, 4, 0])
    expect(imageDimensions(bytes, 'image/jpeg')).toEqual({ width: 1024, height: 768 })
    expect(imageDimensions(bytes.subarray(0, 19), 'image/jpeg')).toBeNull()
    bytes[10] = 255
    expect(imageDimensions(bytes, 'image/jpeg')).toBeNull()
  })
  it.each(['VP8X', 'VP8 ', 'VP8L'])('reads dimensions for WebP %s', kind => {
    const bytes = new Uint8Array(30), view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode(`RIFF1234WEBP${kind}`))
    if (kind === 'VP8X') { bytes[24] = 255; bytes[25] = 3; bytes[27] = 255; bytes[28] = 2 }
    if (kind === 'VP8 ') { view.setUint16(26, 1024, true); view.setUint16(28, 768, true) }
    if (kind === 'VP8L') { bytes[20] = 47; bytes[21] = 255; bytes[22] = 195; bytes[23] = 191 }
    expect(imageDimensions(bytes, 'image/webp')).toEqual({ width: 1024, height: 768 })
  })
  it('rejects unsupported or empty dimensional data', () => {
    expect(imageDimensions(new Uint8Array(), 'image/jpeg')).toBeNull()
    expect(imageDimensions(new Uint8Array(30), 'image/webp')).toBeNull()
    expect(imageDimensions(new Uint8Array(30), 'application/pdf')).toBeNull()
  })
})
