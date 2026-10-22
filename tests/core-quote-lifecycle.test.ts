import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CORE_QUOTE_CONTENT_KEYS, CoreQuoteError, coreQuoteError, coreQuoteDraftToRpc, normalizeCoreQuoteDecimal,
  parseCoreQuoteCreate, parseCoreQuoteDraft, parseCoreQuoteSync, parseCoreQuoteOpenRevision, parseCoreQuotePublish,
  parseCoreQuoteDecision, parseCoreQuoteRevoke, parseCoreQuoteReceipt, parseCoreQuoteDocumentRead, parseCoreQuoteWorkspace,
  previewCoreQuote, quoteDraftToInput,
  type CoreQuoteDraftInput, type CoreQuoteItemInput, type CoreQuoteContent, type CoreQuoteDocumentRead,
} from '../lib/core-quote-lifecycle'
vi.mock('server-only', () => ({}))
import { createCoreQuoteFromCalculation, updateQuote, syncCoreQuoteDraft, openCoreQuoteRevision, publishCoreQuoteVersion,
  recordCoreQuoteDecision, revokeCoreQuotePublication, archiveCoreQuote, deleteCoreQuoteDraft, getCoreQuoteWorkspace, getCoreQuoteVersion, getCoreQuoteDraftDocument } from '../lib/dal/quotes'

const companyId = 'a1111111-1111-4111-8111-111111111111', profileId = 'b1111111-1111-4111-8111-111111111111'
const operationId = 'c1111111-1111-4111-8111-111111111111', quoteId = 'd1111111-1111-4111-8111-111111111111'
const calculationId = 'e1111111-1111-4111-8111-111111111111', versionId = 'f1111111-1111-4111-8111-111111111111'
const otherId = 'a2222222-2222-4222-8222-222222222222'
const scope = { companyId, profileId, operationId }, revision = { ...scope, quoteId, expectedRevision: '3' }
const create = { ...scope, calculationId, expectedCalculationRevision: '2' }
const content = Object.fromEntries(Object.keys(CORE_QUOTE_CONTENT_KEYS).map(key => [key, key + ' obsah'])) as CoreQuoteContent
const item = (change: Partial<CoreQuoteItemInput> = {}): CoreQuoteItemInput => ({ name: 'Práce', description: 'Popis', quantity: '1.00', unit: 'hod', unitPrice: '100.00', vatRate: '21.00', note: 'Poznámka zákazníka', ...change })
const draft = (change: Partial<CoreQuoteDraftInput> = {}): CoreQuoteDraftInput => ({
  ...revision, title: 'Nabídka', quoteDate: '2026-10-21', validUntil: '2026-11-21', currency: 'CZK', pricingMode: 'net',
  discountAmount: '0.00', customerNote: 'Pro zákazníka', internalNote: 'Interní canary', content, items: [item()], ...change,
})
const receipt = (change: Record<string, unknown> = {}) => ({ companyId, operationId, quoteId, revision: '4', replayed: false, ...change })
const publication = () => receipt({ versionId, versionNumber: 1, shareToken: 'a'.repeat(64), publishedAt: '2026-10-21T12:00:00.000Z' })
const document = (): CoreQuoteDocumentRead => ({
  kind: 'issued', publishedAt: '2026-10-21T12:00:00.000Z', legacyCapturedAt: null, status: 'published', acceptedAt: null, rejectedAt: null,
  document: {
    id: quoteId, quote_id: quoteId, version_id: versionId, version_number: 1, content_hash: 'a'.repeat(64),
    title: 'Nabídka', quote_number: 'CN-1', quote_date: '2026-10-21', valid_until: '2026-11-21', currency: 'CZK', pricing_mode: 'net',
    subtotal_price: '100.00', discount_amount: '0.00', total_price: '100.00', customer_note: 'Veřejné',
    customer_identity_state: 'legacy_unknown', customer: { name: null },
    supplier: { name: 'Dodavatel', company_number: null, vat_number: null, address: null, street: null, city: null, postal_code: null, country: null, email: null, phone: null, logo_url: null, bank_account: null, iban: null, bic: null },
    content: coreQuoteDraftToRpc(draft()).content,
    items: [{ id: otherId, sort_order: 0, name: 'Práce', description: 'Popis', quantity: '1.00', unit: 'hod', unit_price: '100.00', total_price: '100.00', vat_rate: '21.00', note: null }],
    locale: 'cs', schema_version: 1,
  },
})
const workspace = () => ({
  companyId, quoteId, customerId: null, sourceCalculationId: calculationId, sourceCalculationRevision: '2', currentCalculationRevision: '4',
  customerIdentityState: 'legacy_unknown', customerSnapshot: null, revision: '3', draftOpen: true, archivedAt: null, currentVersionId: versionId, acceptedVersionId: null,
  draft: coreQuoteDraftToRpc(draft()), responses: [], versions: [{ versionId, versionNumber: 1, sourceRevision: '2', contentHash: 'a'.repeat(64), publishedAt: '2026-10-21T12:00:00.000Z', status: 'published', acceptedAt: null, rejectedAt: null, shareToken: 'a'.repeat(64), decision: null }], legacy: null,
})
const auth = vi.fn(), rpc = vi.fn(), from = vi.fn()
const ctx = (change: Record<string, unknown> = {}) => ({ companyId, profileId, role: 'manager', supabase: { auth: { getUser: auth }, rpc, from }, ...change }) as unknown as Parameters<typeof updateQuote>[0]
beforeEach(() => {
  vi.resetAllMocks()
  auth.mockResolvedValue({ data: { user: { id: otherId } }, error: null })
  rpc.mockResolvedValue({ data: receipt(), error: null })
  from.mockImplementation(() => { throw new Error('Split table access forbidden') })
})

describe('core quote typed commands', () => {
  it('preserves every editor field and customer row in the complete SQL payload', () => {
    const parsed = parseCoreQuoteDraft(draft({ currency: 'EUR', internalNote: '  Interní  ', items: [item({ quantity: '01,50', unitPrice: '000.00' })] }))
    expect(parsed.currency).toBe('EUR')
    expect(parsed.items[0]).toMatchObject({ quantity: '1.50', unitPrice: '0.00' })
    const stored = coreQuoteDraftToRpc(parsed)
    expect(stored.internal_note).toBe('Interní')
    for (const [camel, snake] of Object.entries(CORE_QUOTE_CONTENT_KEYS)) expect(stored.content[snake as keyof typeof stored.content]).toBe(content[camel as keyof CoreQuoteContent])
    expect(stored.items[0]).toMatchObject({ unit_price: '0.00', vat_rate: '21.00', note: 'Poznámka zákazníka' })
    expect(stored).not.toHaveProperty('status')
    expect(stored).not.toHaveProperty('customer_snapshot')
    expect(stored.items[0]).not.toHaveProperty('total_price')
  })
  it('keeps exact decimal multiplication, row rounding and discount', () => {
    const preview = previewCoreQuote([item({ quantity: '0.50', unitPrice: '0.01' }), item({ quantity: '0.50', unitPrice: '0.01' })], '0.01')
    expect(preview).toMatchObject({ subtotalPrice: '0.02', discountAmount: '0.01', totalPrice: '0.01' })
    expect(preview.items.map(row => row.totalPrice)).toEqual(['0.01', '0.01'])
  })
  it.each(['', ' ', '1.001', '-1', '1e3', 'NaN', 'Infinity', '.1', null, undefined, 0])('does not guess a decimal value %j', value => {
    expect(() => normalizeCoreQuoteDecimal(value)).toThrow(CoreQuoteError)
  })
  it.each([
    { currency: 'czk' }, { currency: 'EURO' }, { currency: '' }, { pricingMode: 'gross' },
    { title: '' }, { title: 'x'.repeat(301) }, { customerNote: 'x'.repeat(10001) }, { internalNote: 'a\0b' },
    { items: [] }, { items: null }, { items: [item({ quantity: '0' })] }, { items: [item({ vatRate: '100.01' })] },
    { items: [item({ unit: 'x'.repeat(31) })] }, { items: [item({ name: 'x'.repeat(301) })] },
    { items: [{ ...item(), unitCost: '1' }] }, { items: [{ ...item(), totalPrice: '1' }] },
    { items: [{ ...item(), vatRate: null }] }, { discountAmount: '100.01' }, { discountAmount: undefined },
    { quoteDate: '2026-02-29' }, { quoteDate: null }, { validUntil: '2026-10-20' }, { validUntil: undefined },
    { shareToken: 'x' }, { acceptedAt: '2026-10-21T12:00:00Z' }, { status: 'accepted' }, { customerId: otherId },
    { content: { ...content, internal_cost: 'secret' } }, { profileId: undefined },
  ])('rejects invalid or caller-controlled draft values %j', change => {
    expect(() => parseCoreQuoteDraft({ ...draft(), ...change })).toThrow(CoreQuoteError)
  })
  it('applies Unicode character limits consistently and rejects a request above the safe action size', () => {
    expect(parseCoreQuoteDraft(draft({ title: '🧽'.repeat(300) })).title).toHaveLength(600)
    expect(() => parseCoreQuoteDraft(draft({ items: Array.from({ length: 100 }, () => item({ description: 'x'.repeat(4000), note: 'x'.repeat(4000), unitPrice: '0' })) }))).toThrow(/rozsáhlá/)
  })
  it('maps historical missing fields to blank controls without claiming zero or a new currency', () => {
    const input = quoteDraftToInput({ ...coreQuoteDraftToRpc(draft()), title: null, quote_date: null, currency: 'EUR', pricing_mode: null, discount_amount: null, items: [{ ...coreQuoteDraftToRpc(draft()).items[0], vat_rate: null }] }, revision)
    expect(input).toMatchObject({ title: '', quoteDate: '', currency: 'EUR', pricingMode: '', discountAmount: '' })
    expect(input.items[0].vatRate).toBe('')
    expect(() => parseCoreQuoteDraft(input)).toThrow(CoreQuoteError)
  })
  it('normalizes UUIDs while retaining revisions above safe integer precision', () => {
    expect(parseCoreQuoteCreate({ ...create, companyId: companyId.toUpperCase(), expectedCalculationRevision: '9007199254740993' })).toEqual({ ...create, expectedCalculationRevision: '9007199254740993' })
    expect(parseCoreQuoteSync({ ...revision, calculationId, expectedCalculationRevision: '2' })).toMatchObject({ expectedRevision: '3' })
    expect(parseCoreQuoteOpenRevision({ ...revision, versionId })).toMatchObject({ versionId })
    expect(parseCoreQuotePublish(revision)).toEqual(revision)
  })
  it('opens only an explicitly selected legacy baseline without substituting a current version', async () => {
    const input = { ...revision, versionId: null }
    expect(parseCoreQuoteOpenRevision(input)).toEqual(input)
    expect(() => parseCoreQuoteOpenRevision(revision)).toThrow(CoreQuoteError)
    expect(() => parseCoreQuoteOpenRevision({ ...revision, versionId: undefined })).toThrow(CoreQuoteError)
    await openCoreQuoteRevision(ctx(), input)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('open_core_quote_revision_atomic', {
      p_company_id: companyId, p_quote_id: quoteId, p_expected_revision: '3', p_operation_id: operationId, p_version_id: null,
    })
    expect(() => parseCoreQuoteDecision({ ...scope, quoteId, versionId: null, decision: 'accepted', evidence: 'Legacy is not issued', decidedAt: '2026-10-21T12:00:00Z' })).toThrow(CoreQuoteError)
  })
  it.each(['0', '01', 1, '9223372036854775808', undefined])('rejects invalid expected revision %j', expectedRevision => {
    expect(() => parseCoreQuotePublish({ ...revision, expectedRevision })).toThrow(CoreQuoteError)
  })
  it('requires evidence and a timezone for manually recorded decisions', () => {
    const input = { ...scope, quoteId, versionId, decision: 'accepted', evidence: ' E-mail zákazníka ', decidedAt: '2026-10-21T14:00:00+02:00' }
    expect(parseCoreQuoteDecision(input)).toMatchObject({ evidence: 'E-mail zákazníka', decidedAt: '2026-10-21T12:00:00.000Z' })
    for (const change of [{ evidence: '' }, { decidedAt: '2026-10-21' }, { decision: 'interested' }, { actorId: profileId }]) expect(() => parseCoreQuoteDecision({ ...input, ...change })).toThrow(CoreQuoteError)
  })
})

describe('quote receipts retain uncertain outcomes', () => {
  it('accepts an exact replay after later revisions without substituting the current revision', () => {
    expect(parseCoreQuoteReceipt(receipt({ replayed: true }), revision, 'update')).toMatchObject({ revision: '4', replayed: true })
    expect(() => parseCoreQuoteReceipt(receipt({ revision: '5', replayed: true }), revision, 'update')).toThrow(expect.objectContaining({ code: 'unknown', uncertain: true }))
  })
  it.each([null, { companyId: otherId }, { operationId: otherId }, { quoteId: otherId }, { revision: 4 }, { revision: '3' }, { replayed: 'true' }])('never accepts a mismatched or malformed receipt %j', change => {
    expect(() => parseCoreQuoteReceipt(change === null ? null : { ...receipt(), ...change }, revision, 'update')).toThrow(expect.objectContaining({ code: 'unknown', uncertain: true }))
  })
  it('requires the complete issued version and token, not an old identity-only receipt', () => {
    expect(parseCoreQuoteReceipt(publication(), revision, 'publish')).toMatchObject({ versionId, versionNumber: 1 })
    for (const change of [{ versionId: undefined }, { versionNumber: 0 }, { shareToken: 'a'.repeat(48) }, { publishedAt: null }]) expect(() => parseCoreQuoteReceipt({ ...publication(), ...change }, revision, 'publish')).toThrow(expect.objectContaining({ uncertain: true }))
    expect(() => parseCoreQuoteReceipt(receipt({ versionId: otherId }), { ...scope, quoteId, versionId, decision: 'accepted', evidence: 'Důkaz', decidedAt: '2026-10-21T12:00:00.000Z' }, 'decision')).toThrow(CoreQuoteError)
  })
  it('never includes an unknown provider/SQL message in a safe error', () => {
    const error = coreQuoteError({ message: 'secret database connection', details: 'private content' })
    expect(error).toMatchObject({ code: 'unknown', uncertain: true })
    expect(error.message).not.toContain('secret')
    expect(coreQuoteError({ message: 'CORE_QUOTE_REVISION_CONFLICT' })).toMatchObject({ code: 'conflict', uncertain: false })
    expect(coreQuoteError({ message: 'toString' })).toMatchObject({ code: 'unknown' })
  })
})

describe('one authenticated quote RPC per write', () => {
  it.each([
    ['create', createCoreQuoteFromCalculation, create, 'create_core_quote_from_calculation_atomic', { p_calculation_id: calculationId, p_expected_calculation_revision: '2' }, receipt({ revision: '1' })],
    ['update', updateQuote, draft(), 'update_core_quote_draft_atomic', { p_quote_id: quoteId, p_expected_revision: '3', p_input: coreQuoteDraftToRpc(draft()) }, receipt()],
    ['sync', syncCoreQuoteDraft, { ...revision, calculationId, expectedCalculationRevision: '2' }, 'sync_core_quote_draft_atomic', { p_quote_id: quoteId, p_expected_revision: '3', p_calculation_id: calculationId, p_expected_calculation_revision: '2' }, receipt()],
    ['open', openCoreQuoteRevision, { ...revision, versionId }, 'open_core_quote_revision_atomic', { p_quote_id: quoteId, p_version_id: versionId, p_expected_revision: '3' }, receipt()],
    ['publish', publishCoreQuoteVersion, revision, 'publish_core_quote_version_atomic', { p_quote_id: quoteId, p_expected_revision: '3' }, publication()],
    ['decision', recordCoreQuoteDecision, { ...scope, quoteId, versionId, decision: 'accepted', evidence: 'Důkaz', decidedAt: '2026-10-21T12:00:00.000Z' }, 'record_core_quote_decision_atomic', { p_quote_id: quoteId, p_version_id: versionId, p_input: { decision: 'accepted', evidence: 'Důkaz', decided_at: '2026-10-21T12:00:00.000Z' } }, receipt({ versionId, decisionId: otherId, decision: 'accepted', recordedAt: '2026-10-21T12:00:00.000Z' })],
    ['archive', archiveCoreQuote, revision, 'archive_core_quote_atomic', { p_quote_id: quoteId, p_expected_revision: '3' }, receipt()],
    ['delete', deleteCoreQuoteDraft, revision, 'delete_core_quote_draft_atomic', { p_quote_id: quoteId, p_expected_revision: '3' }, receipt()],
  ])('%s is a single scoped RPC, never a split table write', async (_name, fn, input, rpcName, args, result) => {
    rpc.mockResolvedValue({ data: result, error: null })
    const invoke = fn as (context: ReturnType<typeof ctx>, input: unknown) => Promise<unknown>
    await invoke(ctx(), input)
    expect(auth).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledExactlyOnceWith(rpcName, { p_company_id: companyId, p_operation_id: operationId, ...args as object })
    expect(auth.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0])
    expect(from).not.toHaveBeenCalled()
  })
  it.each([{ companyId: otherId }, { profileId: otherId }, { role: 'worker' }, { role: null }])('rejects stale scope or role before RPC %j', async change => {
    await expect(updateQuote(ctx(change), draft())).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rechecks real authentication and does not trust a supplied profile ID', async () => {
    auth.mockResolvedValue({ data: { user: null }, error: null })
    await expect(updateQuote(ctx(), draft())).rejects.toMatchObject({ code: 'forbidden' })
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['network', 'malformed', 'wrong-operation', 'server'])('keeps %s failures uncertain without fallback writes', async failure => {
    if (failure === 'network') rpc.mockRejectedValue(new Error('secret'))
    if (failure === 'malformed') rpc.mockResolvedValue({ data: null, error: null })
    if (failure === 'wrong-operation') rpc.mockResolvedValue({ data: receipt({ operationId: otherId }), error: null })
    if (failure === 'server') rpc.mockResolvedValue({ data: null, error: { message: 'secret provider detail' } })
    await expect(updateQuote(ctx(), draft())).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    expect(rpc).toHaveBeenCalledTimes(1); expect(from).not.toHaveBeenCalled()
  })
})

describe('immutable quote read projection', () => {
  it('preserves the issued document and unknown customer identity without any live lookup', () => {
    expect(parseCoreQuoteDocumentRead(document(), { quoteId, versionId })).toEqual(document())
    expect(parseCoreQuoteWorkspace(workspace(), { companyId, quoteId }).currentCalculationRevision).toBe('4')
  })
  it('keeps customer reactions pinned to the issued version and strips transport metadata', () => {
    const response = { responseId: otherId, versionId, actionType: 'revision_requested', customerName: 'Zákazník', customerEmail: null, customerPhone: null, note: 'Upravit termín', recordedAt: '2026-10-21T13:00:00.000Z', actorKind: 'public', actorId: null }
    const result = parseCoreQuoteWorkspace({ ...workspace(), responses: [{ ...response, shareToken: 'secret', visitorId: 'not-for-ui', userAgent: 'not-for-ui' }] }, { companyId, quoteId })
    expect(result.responses).toEqual([response])
    expect(result.versions[0].decision).toBeNull()
    expect(result.responses[0]).not.toHaveProperty('shareToken')
    const portal = { ...response, actorKind: 'portal', actorId: profileId }
    expect(parseCoreQuoteWorkspace({ ...workspace(), responses: [portal] }, { companyId, quoteId }).responses).toEqual([portal])
    for (const change of [{ versionId: otherId }, { actionType: 'accepted' }, { actorKind: 'employee' }, { actorId: profileId }, { recordedAt: 'yesterday' }]) {
      expect(() => parseCoreQuoteWorkspace({ ...workspace(), responses: [{ ...response, ...change }] }, { companyId, quoteId })).toThrow(expect.objectContaining({ code: 'unavailable', uncertain: false }))
    }
    expect(() => parseCoreQuoteWorkspace({ ...workspace(), responses: [{ ...portal, actorId: null }] }, { companyId, quoteId })).toThrow(CoreQuoteError)
    expect(() => parseCoreQuoteWorkspace({ ...workspace(), responses: undefined }, { companyId, quoteId })).toThrow(CoreQuoteError)
  })
  it('keeps null historical totals/VAT rather than inventing values', () => {
    const legacy = document(); legacy.kind = 'legacy'; legacy.publishedAt = null; legacy.legacyCapturedAt = '2026-10-21T12:00:00.000Z'
    legacy.document.version_id = null; legacy.document.version_number = null; legacy.document.pricing_mode = null
    legacy.document.items[0].vat_rate = null; legacy.document.items[0].total_price = null
    legacy.document.subtotal_price = null; legacy.document.total_price = null
    expect(parseCoreQuoteDocumentRead(legacy).document.items[0]).toMatchObject({ vat_rate: null, total_price: null })
    expect(parseCoreQuoteDocumentRead(legacy).document).toMatchObject({ subtotal_price: null, total_price: null })
  })
  it('allows a truthful draft with no issued version', () => {
    const draftRead = document(); draftRead.kind = 'draft'; draftRead.publishedAt = null
    draftRead.document.version_id = null; draftRead.document.version_number = null; draftRead.document.items[0].vat_rate = null
    expect(parseCoreQuoteDocumentRead(draftRead).kind).toBe('draft')
  })
  it.each(['internal_note', 'unit_cost', 'total_cost', 'margin', 'margin_amount'])('rejects private field %s in customer documents', key => {
    const data = document()
    expect(() => parseCoreQuoteDocumentRead({ ...data, document: { ...data.document, [key]: 'canary' } })).toThrow(expect.objectContaining({ code: 'unavailable', uncertain: false }))
    expect(() => parseCoreQuoteDocumentRead({ ...data, document: { ...data.document, items: [{ ...data.document.items[0], [key]: 'canary' }] } })).toThrow(CoreQuoteError)
  })
  it('checks parent/version scope and fails closed on incomplete data', () => {
    expect(() => parseCoreQuoteDocumentRead(document(), { quoteId: otherId })).toThrow(CoreQuoteError)
    expect(() => parseCoreQuoteDocumentRead(document(), { versionId: otherId })).toThrow(CoreQuoteError)
    expect(() => parseCoreQuoteDocumentRead({ ...document(), document: { ...document().document, items: null } })).toThrow(CoreQuoteError)
    expect(() => parseCoreQuoteWorkspace({ ...workspace(), companyId: otherId }, { companyId, quoteId })).toThrow(CoreQuoteError)
  })
  it('uses exact scoped read RPCs and validates their payloads', async () => {
    rpc.mockResolvedValueOnce({ data: workspace(), error: null }).mockResolvedValueOnce({ data: document(), error: null })
    await getCoreQuoteWorkspace(ctx(), quoteId)
    await getCoreQuoteVersion(ctx(), quoteId, versionId)
    expect(rpc.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['get_core_quote_workspace', { p_company_id: companyId, p_quote_id: quoteId }],
      ['get_core_quote_version', { p_company_id: companyId, p_quote_id: quoteId, p_version_id: versionId }],
    ])
    expect(from).not.toHaveBeenCalled()
  })
  it('pins draft preview to the requested revision and never silently substitutes an issued document', async () => {
    rpc.mockResolvedValue({ data: document(), error: null })
    await expect(getCoreQuoteDraftDocument(ctx(), quoteId, '3')).rejects.toMatchObject({ code: 'unknown' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_core_quote_draft_document', { p_company_id: companyId, p_quote_id: quoteId, p_expected_revision: '3' })
  })
})



describe('complete documents and decision history', () => {
  it('rejects omitted nullable fields instead of silently clearing existing content', () => {
    const missingHeader = { ...draft() } as Record<string, unknown>; delete missingHeader.internalNote
    const missingContent = { ...content } as Record<string, unknown>; delete missingContent.paymentTerms
    const missingItem = { ...item() } as Record<string, unknown>; delete missingItem.note
    for (const value of [missingHeader, { ...draft(), content: missingContent }, { ...draft(), items: [missingItem] }]) expect(() => parseCoreQuoteDraft(value)).toThrow(CoreQuoteError)
  })
  it.each(['missing-vat', 'missing-total', 'wrong-total', 'wrong-subtotal', 'live-identity'])('refuses an incomplete or inconsistent issued snapshot: %s', reason => {
    const value = document()
    if (reason === 'missing-vat') value.document.items[0].vat_rate = null
    if (reason === 'missing-total') value.document.items[0].total_price = null
    if (reason === 'wrong-total') value.document.total_price = '999.00'
    if (reason === 'wrong-subtotal') value.document.subtotal_price = '999.00'
    if (reason === 'live-identity') value.document.customer_identity_state = 'draft'
    expect(() => parseCoreQuoteDocumentRead(value)).toThrow(expect.objectContaining({ code: 'unavailable', uncertain: false }))
  })
  it('preserves historical ordering even when an old sort value is negative', () => {
    const legacy = document(); legacy.kind = 'legacy'; legacy.publishedAt = null; legacy.legacyCapturedAt = '2026-10-21T12:00:00.000Z'
    legacy.document.version_id = null; legacy.document.version_number = null; legacy.document.items[0].sort_order = -1
    expect(parseCoreQuoteDocumentRead(legacy).document.items[0].sort_order).toBe(-1)
  })
  it('returns recorded decision evidence and actor identity from the authorized workspace', () => {
    const value = workspace()
    const decision = { id: otherId, decision: 'accepted', evidence: 'Telefonický souhlas doložený zápisem', decidedAt: '2026-10-21T12:00:00.000Z', recordedAt: '2026-10-21T13:00:00.000Z', actorId: profileId, actorKind: 'profile' }
    const parsed = parseCoreQuoteWorkspace({ ...value, versions: [{ ...value.versions[0], decision }] }, { companyId, quoteId })
    expect(parsed.versions[0].decision).toEqual(decision)
  })
  it('validates the complete acceptance receipt before declaring success', () => {
    const input = { ...scope, quoteId, versionId, decision: 'accepted' as const, evidence: 'Důkaz', decidedAt: '2026-10-21T12:00:00.000Z' }
    for (const data of [receipt({ versionId }), receipt({ versionId, decisionId: otherId, decision: 'rejected', recordedAt: input.decidedAt })]) {
      expect(() => parseCoreQuoteReceipt(data, input, 'decision')).toThrow(expect.objectContaining({ uncertain: true }))
    }
  })
})


describe('exact publication revocation', () => {
  it.each([versionId, null])('requires an explicit selected version, including legacy %j', selectedVersion => {
    const command = { ...revision, versionId: selectedVersion }
    expect(parseCoreQuoteRevoke(command)).toEqual(command)
    expect(parseCoreQuoteReceipt(receipt({ versionId: selectedVersion, replayed: true }), command, 'revoke')).toEqual(receipt({ versionId: selectedVersion, replayed: true }))
  })
  it.each([{}, { versionId: undefined }, { versionId: '' }, { versionId: 'latest' }, { versionId, expectedRevision: undefined }, { versionId, shareToken: 'caller-controlled' }])('rejects missing, guessed or unrelated revoke input %j', change => {
    expect(() => parseCoreQuoteRevoke({ ...revision, ...change })).toThrow(CoreQuoteError)
  })
  it.each([versionId, null])('sends one authenticated scoped CAS RPC for version %j', async selectedVersion => {
    rpc.mockResolvedValue({ data: receipt({ versionId: selectedVersion }), error: null })
    expect(await revokeCoreQuotePublication(ctx(), { ...revision, versionId: selectedVersion })).toEqual(receipt({ versionId: selectedVersion }))
    expect(rpc).toHaveBeenCalledExactlyOnceWith('revoke_core_quote_publication_atomic', {
      p_company_id: companyId, p_quote_id: quoteId, p_version_id: selectedVersion, p_expected_revision: '3', p_operation_id: operationId,
    })
    expect(auth.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]); expect(from).not.toHaveBeenCalled()
  })
  it.each([{ companyId: otherId }, { profileId: otherId }, { role: 'worker' }])('rejects stale revoke authorization %j before RPC', async change => {
    await expect(revokeCoreQuotePublication(ctx(change), { ...revision, versionId })).rejects.toMatchObject({ code: 'forbidden', uncertain: false })
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([undefined, null, otherId])('retains an uncertain outcome for wrong modern revoke receipt version %j', selectedVersion => {
    expect(() => parseCoreQuoteReceipt(receipt({ versionId: selectedVersion }), { ...revision, versionId }, 'revoke')).toThrow(expect.objectContaining({ uncertain: true }))
  })
  it.each([{ versionId }, { versionId: undefined }, { versionId: null, revision: '3' }, { versionId: null, revision: '5' }])('never substitutes modern/default or wrong CAS receipt for legacy %j', change => {
    expect(() => parseCoreQuoteReceipt(receipt(change), { ...revision, versionId: null }, 'revoke')).toThrow(expect.objectContaining({ uncertain: true }))
  })
  it('keeps transport failure uncertain and never falls back to a table update', async () => {
    rpc.mockRejectedValue(new Error('private transport detail'))
    await expect(revokeCoreQuotePublication(ctx(), { ...revision, versionId })).rejects.toMatchObject({ code: 'unknown', uncertain: true })
    expect(rpc).toHaveBeenCalledTimes(1); expect(from).not.toHaveBeenCalled()
  })
  it('reads explicit legacy revocation separately from the preserved document', () => {
    const legacy = { capturedAt: '2026-10-21T10:00:00.000Z', revokedAt: '2026-10-21T12:00:00.000Z', document: { ...document().document, version_id: null, version_number: null } }
    expect(parseCoreQuoteWorkspace({ ...workspace(), legacy }, { companyId, quoteId }).legacy).toEqual(legacy)
    expect(() => parseCoreQuoteWorkspace({ ...workspace(), legacy: { ...legacy, revokedAt: undefined } }, { companyId, quoteId })).toThrow(CoreQuoteError)
  })
})
