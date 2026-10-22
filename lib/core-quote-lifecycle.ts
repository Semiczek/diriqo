export const CORE_QUOTE_MAX_REQUEST_BYTES = 512 * 1024
export const CORE_QUOTE_LIMITS = { title: 300, sectionTitle: 300, contactName: 200, contactEmail: 320, text: 10_000, itemName: 300, itemDescription: 4_000, note: 4_000, unit: 30, items: 500 } as const
export type CoreQuoteCode = 'validation' | 'forbidden' | 'conflict' | 'unavailable' | 'unknown'
export class CoreQuoteError extends Error {
  constructor(message: string, readonly code: CoreQuoteCode, readonly uncertain = code === 'unknown') { super(message); this.name = 'CoreQuoteError' }
}
export const CORE_QUOTE_CONTENT_KEYS = {
  contactName: 'contact_name', contactEmail: 'contact_email', introText: 'intro_text',
  customerRequestTitle: 'customer_request_title', customerRequest: 'customer_request',
  ourSolutionTitle: 'our_solution_title', proposedSolution: 'proposed_solution', benefitsText: 'benefits_text',
  timelineTitle: 'timeline_title', workDescription: 'work_description', workSchedule: 'work_schedule',
  pricingTitle: 'pricing_title', pricingText: 'pricing_text', paymentTermsTitle: 'payment_terms_title', paymentTerms: 'payment_terms',
} as const
export type CoreQuoteContent = { [K in keyof typeof CORE_QUOTE_CONTENT_KEYS]: string | null }
export type CoreQuoteStoredContent = { [K in typeof CORE_QUOTE_CONTENT_KEYS[keyof typeof CORE_QUOTE_CONTENT_KEYS]]: string | null }
export type CoreQuoteItemInput = { name: string; description: string | null; quantity: string; unit: string | null; unitPrice: string; vatRate: string; note: string | null }
export type CoreQuoteScope = { companyId: string; profileId: string; operationId: string }
export type CoreQuoteRevisionInput = CoreQuoteScope & { quoteId: string; expectedRevision: string }
export type CoreQuoteCreateInput = CoreQuoteScope & { calculationId: string; expectedCalculationRevision: string }
export type CoreQuoteSyncInput = CoreQuoteRevisionInput & { calculationId: string; expectedCalculationRevision: string }
export type CoreQuoteOpenRevisionInput = CoreQuoteRevisionInput & { versionId: string | null }
export type CoreQuoteRevokeInput = CoreQuoteRevisionInput & { versionId: string | null }
export type CoreQuotePublishInput = CoreQuoteRevisionInput
export type CoreQuoteArchiveInput = CoreQuoteRevisionInput
export type CoreQuoteDeleteInput = CoreQuoteRevisionInput
export type CoreQuoteDecisionInput = CoreQuoteScope & { quoteId: string; versionId: string; decision: 'accepted' | 'rejected'; evidence: string; decidedAt: string }
export type CoreQuoteDraftInput = CoreQuoteRevisionInput & {
  title: string; quoteDate: string; validUntil: string | null; currency: string; pricingMode: 'net'; discountAmount: string
  customerNote: string | null; internalNote: string | null; content: CoreQuoteContent; items: CoreQuoteItemInput[]
}
export type CoreQuoteCommandKind = 'create' | 'sync' | 'update' | 'openRevision' | 'publish' | 'decision' | 'revoke' | 'archive' | 'delete'
export type CoreQuoteCommandInput = CoreQuoteCreateInput | CoreQuoteSyncInput | CoreQuoteOpenRevisionInput | CoreQuoteRevokeInput | CoreQuoteDraftInput | CoreQuoteDecisionInput | CoreQuoteRevisionInput
export type CoreQuoteReceipt = { companyId: string; operationId: string; quoteId: string; revision: string; replayed: boolean; versionId?: string | null; versionNumber?: number; shareToken?: string; publishedAt?: string; decisionId?: string; decision?: 'accepted' | 'rejected'; recordedAt?: string }
export type CoreQuotePublicationReceipt = CoreQuoteReceipt & { versionId: string; versionNumber: number; shareToken: string; publishedAt: string }
export type CoreQuoteResult<T = CoreQuoteReceipt> = { ok: true; data: T } | { ok: false; error: string; code: CoreQuoteCode; uncertain: boolean }
export type CoreQuoteStoredItem = { name: string; description: string | null; quantity: string; unit: string | null; unit_price: string; vat_rate: string | null; note: string | null }
export type CoreQuoteDraftDocument = {
  title: string | null; quote_date: string | null; valid_until: string | null; currency: string | null; pricing_mode: 'net' | null; discount_amount: string | null
  customer_note: string | null; internal_note: string | null; content: CoreQuoteStoredContent; items: CoreQuoteStoredItem[]
}
export type CoreQuoteCustomer = { name: string | null; billing_name?: string | null; company_number?: string | null; vat_number?: string | null; billing_street?: string | null; billing_city?: string | null; billing_postal_code?: string | null; billing_country?: string | null; email?: string | null; phone?: string | null }
export type CoreQuoteSupplier = { name: string | null; company_number: string | null; vat_number: string | null; address: string | null; street: string | null; city: string | null; postal_code: string | null; country: string | null; email: string | null; phone: string | null; logo_url: string | null; bank_account: string | null; iban: string | null; bic: string | null }
export type CoreQuoteDocument = {
  id: string; quote_id: string; version_id: string | null; version_number: number | null; content_hash: string
  title: string | null; quote_number: string | null; quote_date: string | null; valid_until: string | null
  currency: string | null; pricing_mode: 'net' | null; subtotal_price: string | null; discount_amount: string | null; total_price: string | null
  customer_note: string | null; customer_identity_state: 'draft' | 'captured' | 'legacy_unknown'; customer: CoreQuoteCustomer
  supplier: CoreQuoteSupplier; content: CoreQuoteStoredContent
  items: Array<{ id: string; sort_order: number; name: string | null; description: string | null; quantity: string; unit: string | null; unit_price: string; total_price: string | null; vat_rate: string | null; note: string | null }>
  locale: 'cs'; schema_version: 1
}
export type CoreQuoteDocumentRead = { kind: 'draft' | 'issued' | 'legacy'; publishedAt: string | null; legacyCapturedAt: string | null; status: string; acceptedAt: string | null; rejectedAt: string | null; document: CoreQuoteDocument }
export type CoreQuoteDecisionRecord = { id: string; decision: 'accepted' | 'rejected'; evidence: string; decidedAt: string; recordedAt: string; actorId: string; actorKind: string }
export type CoreQuoteResponseRecord = {
  responseId: string; versionId: string; actionType: 'interested' | 'contact_requested' | 'revision_requested' | 'not_interested'
  customerName: string | null; customerEmail: string | null; customerPhone: string | null; note: string | null
  recordedAt: string; actorKind: 'public' | 'portal'; actorId: string | null
}
export type CoreQuoteVersionSummary = { versionId: string; versionNumber: number; sourceRevision: string; contentHash: string; publishedAt: string; status: string; acceptedAt: string | null; rejectedAt: string | null; shareToken: string | null; decision: CoreQuoteDecisionRecord | null }
export type CoreQuoteWorkspace = {
  companyId: string; quoteId: string; customerId: string | null; sourceCalculationId: string | null; sourceCalculationRevision: string | null; currentCalculationRevision: string | null
  customerIdentityState: 'draft' | 'captured' | 'legacy_unknown'; customerSnapshot: Record<string, unknown> | null
  revision: string; draftOpen: boolean; archivedAt: string | null; currentVersionId: string | null; acceptedVersionId: string | null
  draft: CoreQuoteDraftDocument; versions: CoreQuoteVersionSummary[]; responses: CoreQuoteResponseRecord[]; legacy: { capturedAt: string; revokedAt: string | null; document: CoreQuoteDocument } | null
}
const errorMessages: Record<string, [CoreQuoteCode, string]> = {
  CORE_QUOTE_VERSION_REQUIRED: ['conflict', 'Tato operace vyžaduje konkrétní vydanou verzi nabídky. Obnovte její detail.'],
  CORE_QUOTE_INVALID_INPUT: ['validation', 'Zkontrolujte údaje nabídky a všechny její položky.'],
  CORE_QUOTE_INPUT_INVALID: ['validation', 'Zkontrolujte údaje nabídky a všechny její položky.'],
  CORE_QUOTE_FORBIDDEN: ['forbidden', 'K této operaci nemáte oprávnění v aktivní firmě. Ověřte přihlášení a vybranou firmu.'],
  CORE_QUOTE_MODULE_REQUIRED: ['forbidden', 'Pro nové operace je potřeba aktivní základ Diriqo a nabídky.'],
  CORE_QUOTE_NOT_FOUND: ['forbidden', 'Nabídka není v aktivní firmě dostupná.'],
  CORE_QUOTE_SCOPE_INVALID: ['forbidden', 'Nabídka nebo její zdroj není v aktivní firmě dostupný.'],
  CORE_QUOTE_CALCULATION_NOT_FOUND: ['forbidden', 'Zdrojová kalkulace není v aktivní firmě dostupná.'],
  CORE_QUOTE_CUSTOMER_NOT_FOUND: ['forbidden', 'Zákazník není v aktivní firmě dostupný.'],
  CORE_QUOTE_REVISION_CONFLICT: ['conflict', 'Nabídku mezitím někdo změnil. Načtěte aktuální verzi a porovnejte ji se svými změnami.'],
  CORE_QUOTE_SOURCE_REVISION_CONFLICT: ['conflict', 'Zdrojová kalkulace se změnila. Zkontrolujte její aktuální verzi před převzetím položek.'],
  CORE_QUOTE_OPERATION_CONFLICT: ['conflict', 'Toto potvrzení už bylo použité pro jiné údaje. Zachovejte původní požadavek a ověřte výsledek.'],
  CORE_QUOTE_REQUEST_CONFLICT: ['conflict', 'Toto potvrzení už bylo použité pro jiné údaje. Zachovejte původní požadavek a ověřte výsledek.'],
  CORE_QUOTE_DRAFT_CLOSED: ['conflict', 'Tato verze už byla vydaná. Pro změny otevřete nový koncept.'],
  CORE_QUOTE_VERSION_CONFLICT: ['conflict', 'Vybraná verze už není aktuální. Obnovte detail nabídky.'],
  CORE_QUOTE_STATUS_INVALID: ['conflict', 'Stav nabídky se změnil. Obnovte její detail.'],
  CORE_QUOTE_ARCHIVED: ['conflict', 'Nabídka je archivovaná a nové operace nejsou dostupné.'],
  CORE_QUOTE_LEGACY_AMBIGUOUS: ['unavailable', 'Starší nabídky nelze jednoznačně přiřadit. Nejprve ověřte jejich historii.'],
  CORE_QUOTE_RESULT_MISSING: ['unavailable', 'Operace je evidovaná, ale její výsledek už není dostupný. Nová nabídka se automaticky nevytvoří.'],
  CORE_QUOTE_NUMERIC_OVERFLOW: ['validation', 'Množství nebo částka překračuje nejvyšší podporovanou hodnotu.'],
  CORE_QUOTE_CURRENCY_UNSUPPORTED: ['validation', 'Tuto měnu nelze touto operací změnit ani převést.'],
  QUOTE_CUSTOMER_FORBIDDEN: ['forbidden', 'K vydání nabídky nemáte oprávnění v aktivní firmě.'],
  QUOTE_CUSTOMER_MODULE_REQUIRED: ['forbidden', 'Pro vydání nabídky je potřeba aktivní základ Diriqo a nabídky.'],
  QUOTE_CUSTOMER_SCOPE_INVALID: ['forbidden', 'Zákazník není v aktivní firmě dostupný.'],
  QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE: ['conflict', 'Identita vydané nabídky je chráněná. Obnovte její detail.'],
}
export function coreQuoteError(error: unknown): CoreQuoteError {
  if (error instanceof CoreQuoteError) return error
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const known = Object.prototype.hasOwnProperty.call(errorMessages, message) ? errorMessages[message] : undefined
  return known ? new CoreQuoteError(known[1], known[0]) : new CoreQuoteError('Výsledek operace se nepodařilo potvrdit. Opakujte stejný požadavek; původní údaje a potvrzení musí zůstat zachované.', 'unknown')
}
function invalid(message = 'Zkontrolujte údaje nabídky a všechny její položky.'): never { throw new CoreQuoteError(message, 'validation') }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function coreQuoteId(value: unknown): string { if (typeof value !== 'string' || !uuid.test(value)) return invalid('Identifikátor formuláře není platný. Obnovte stránku.'); return value.toLowerCase() }
export function coreQuoteRevision(value: unknown): string { if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > BigInt('9223372036854775807')) return invalid('Verze nabídky není platná. Obnovte její detail.'); return value }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Record<string, unknown> }
function keys(value: Record<string, unknown>, allowed: readonly string[]) { if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !Object.prototype.hasOwnProperty.call(value, key))) invalid('Formulář obsahuje nepodporované údaje. Obnovte stránku nabídky.') }
function text(value: unknown, max: number = CORE_QUOTE_LIMITS.text, required = false): string | null {
  if (value != null && typeof value !== 'string') return invalid()
  const clean = typeof value === 'string' ? value.trim() || null : null
  if ((required && !clean) || (clean !== null && ([...clean].length > max || clean.includes('\0')))) return invalid()
  return clean
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return invalid('Vyberte platné datum nabídky.')
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid('Vyberte platné datum nabídky.')
  return value
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return invalid('Zadejte platné datum a čas včetně časového pásma.')
  date(value.slice(0, 10))
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return invalid()
  return parsed.toISOString()
}
const MAX_AMOUNT = BigInt('999999999999')
const cents = (value: string) => BigInt(value.replace('.', ''))
const decimal = (value: bigint) => (value / BigInt(100)).toString() + '.' + (value % BigInt(100)).toString().padStart(2, '0')
function bounded(value: bigint) { if (value > MAX_AMOUNT) throw coreQuoteError({ message: 'CORE_QUOTE_NUMERIC_OVERFLOW' }); return value }
export function normalizeCoreQuoteDecimal(value: unknown): string {
  if (typeof value !== 'string') return invalid('Částky a množství zadejte s nejvýše dvěma desetinnými místy.')
  const cleaned = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return invalid('Částky a množství zadejte s nejvýše dvěma desetinnými místy.')
  const [whole, fraction = ''] = cleaned.split('.'), normalized = whole.replace(/^0+/, '') || '0'
  if (normalized.length > 10) throw coreQuoteError({ message: 'CORE_QUOTE_NUMERIC_OVERFLOW' })
  return decimal(bounded(BigInt(normalized) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))))
}
function parseItem(value: unknown): CoreQuoteItemInput {
  const row = record(value); keys(row, ['name', 'description', 'quantity', 'unit', 'unitPrice', 'vatRate', 'note'])
  const quantity = normalizeCoreQuoteDecimal(row.quantity), unitPrice = normalizeCoreQuoteDecimal(row.unitPrice), vatRate = normalizeCoreQuoteDecimal(row.vatRate)
  if (cents(quantity) <= BigInt(0) || cents(vatRate) > BigInt(10_000)) return invalid('Množství musí být větší než nula a sazba DPH mezi 0 a 100 procenty.')
  return { name: text(row.name, CORE_QUOTE_LIMITS.itemName, true)!, description: text(row.description, CORE_QUOTE_LIMITS.itemDescription), quantity, unit: text(row.unit, CORE_QUOTE_LIMITS.unit), unitPrice, vatRate, note: text(row.note, CORE_QUOTE_LIMITS.note) }
}
export function previewCoreQuoteItems(value: unknown, discountValue: unknown = '0') {
  if (!Array.isArray(value) || value.length > CORE_QUOTE_LIMITS.items) return invalid('Nabídka může obsahovat nejvýše 500 položek.')
  const items = value.map(parseItem).map(item => ({ ...item, totalPrice: decimal(bounded((cents(item.quantity) * cents(item.unitPrice) + BigInt(50)) / BigInt(100))) }))
  const subtotal = bounded(items.reduce((sum, item) => sum + cents(item.totalPrice), BigInt(0)))
  const discountAmount = normalizeCoreQuoteDecimal(discountValue), discount = cents(discountAmount)
  if (discount > subtotal) return invalid('Sleva nesmí přesáhnout mezisoučet nabídky.')
  return { items, subtotalPrice: decimal(subtotal), discountAmount, totalPrice: decimal(subtotal - discount) }
}
const scopeKeys = ['companyId', 'profileId', 'operationId'] as const
const revisionKeys = [...scopeKeys, 'quoteId', 'expectedRevision'] as const
function scope(input: Record<string, unknown>): CoreQuoteScope { return { companyId: coreQuoteId(input.companyId), profileId: coreQuoteId(input.profileId), operationId: coreQuoteId(input.operationId) } }
function revisionScope(input: Record<string, unknown>): CoreQuoteRevisionInput { return { ...scope(input), quoteId: coreQuoteId(input.quoteId), expectedRevision: coreQuoteRevision(input.expectedRevision) } }
export function parseCoreQuoteCreate(value: unknown): CoreQuoteCreateInput {
  const input = record(value); keys(input, [...scopeKeys, 'calculationId', 'expectedCalculationRevision'])
  return { ...scope(input), calculationId: coreQuoteId(input.calculationId), expectedCalculationRevision: coreQuoteRevision(input.expectedCalculationRevision) }
}
export function parseCoreQuoteSync(value: unknown): CoreQuoteSyncInput {
  const input = record(value); keys(input, [...revisionKeys, 'calculationId', 'expectedCalculationRevision'])
  return { ...revisionScope(input), calculationId: coreQuoteId(input.calculationId), expectedCalculationRevision: coreQuoteRevision(input.expectedCalculationRevision) }
}
export function parseCoreQuoteOpenRevision(value: unknown): CoreQuoteOpenRevisionInput {
  const input = record(value); keys(input, [...revisionKeys, 'versionId']); return { ...revisionScope(input), versionId: input.versionId === null ? null : coreQuoteId(input.versionId) }
}
export const parseCoreQuoteRevoke = parseCoreQuoteOpenRevision
export function parseCoreQuotePublish(value: unknown): CoreQuotePublishInput { const input = record(value); keys(input, revisionKeys); return revisionScope(input) }
export const parseCoreQuoteArchive = parseCoreQuotePublish
export const parseCoreQuoteDelete = parseCoreQuotePublish
export function parseCoreQuoteDecision(value: unknown): CoreQuoteDecisionInput {
  const input = record(value); keys(input, [...scopeKeys, 'quoteId', 'versionId', 'decision', 'evidence', 'decidedAt'])
  if (input.decision !== 'accepted' && input.decision !== 'rejected') return invalid()
  return { ...scope(input), quoteId: coreQuoteId(input.quoteId), versionId: coreQuoteId(input.versionId), decision: input.decision, evidence: text(input.evidence, CORE_QUOTE_LIMITS.text, true)!, decidedAt: instant(input.decidedAt) }
}
function parseContent(value: unknown): CoreQuoteContent {
  const input = record(value); keys(input, Object.keys(CORE_QUOTE_CONTENT_KEYS))
  return Object.fromEntries(Object.keys(CORE_QUOTE_CONTENT_KEYS).map(key => [key, text(input[key], key === 'contactName' ? CORE_QUOTE_LIMITS.contactName : key === 'contactEmail' ? CORE_QUOTE_LIMITS.contactEmail : key.endsWith('Title') ? CORE_QUOTE_LIMITS.sectionTitle : CORE_QUOTE_LIMITS.text)])) as CoreQuoteContent
}
export function parseCoreQuoteDraft(value: unknown): CoreQuoteDraftInput {
  const input = record(value); keys(input, [...revisionKeys, 'title', 'quoteDate', 'validUntil', 'currency', 'pricingMode', 'discountAmount', 'customerNote', 'internalNote', 'content', 'items'])
  if (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency) || input.pricingMode !== 'net') return invalid('Zkontrolujte měnu a cenový režim nabídky.')
  if (!Array.isArray(input.items) || input.items.length < 1) return invalid('Nabídka musí obsahovat alespoň jednu položku.')
  const preview = previewCoreQuoteItems(input.items, normalizeCoreQuoteDecimal(input.discountAmount))
  const quoteDate = date(input.quoteDate), validUntil = input.validUntil === null ? null : date(input.validUntil)
  if (validUntil !== null && validUntil < quoteDate) return invalid('Platnost nabídky nesmí skončit před datem vystavení.')
  const result: CoreQuoteDraftInput = {
    ...revisionScope(input), title: text(input.title, CORE_QUOTE_LIMITS.title, true)!, quoteDate, validUntil,
    currency: input.currency, pricingMode: 'net', discountAmount: preview.discountAmount,
    customerNote: text(input.customerNote), internalNote: text(input.internalNote), content: parseContent(input.content),
    items: input.items.map(parseItem),
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > CORE_QUOTE_MAX_REQUEST_BYTES) return invalid('Nabídka je příliš rozsáhlá pro jedno uložení. Zkraťte poznámky nebo počet položek.')
  return result
}
export function coreQuoteDraftToRpc(input: CoreQuoteDraftInput): CoreQuoteDraftDocument {
  return {
    title: input.title, quote_date: input.quoteDate, valid_until: input.validUntil, currency: input.currency, pricing_mode: input.pricingMode,
    discount_amount: input.discountAmount, customer_note: input.customerNote, internal_note: input.internalNote,
    content: Object.fromEntries(Object.entries(CORE_QUOTE_CONTENT_KEYS).map(([camel, snake]) => [snake, input.content[camel as keyof CoreQuoteContent]])) as CoreQuoteStoredContent,
    items: input.items.map(item => ({ name: item.name, description: item.description, quantity: item.quantity, unit: item.unit, unit_price: item.unitPrice, vat_rate: item.vatRate, note: item.note })),
  }
}
export type CoreQuoteDraftFormValues = Omit<CoreQuoteDraftInput, 'pricingMode'> & { pricingMode: string }
/** Preserve missing historical facts as blank inputs; validation happens only at submission. */
export function quoteDraftToInput(draft: CoreQuoteDraftDocument, input: CoreQuoteRevisionInput): CoreQuoteDraftFormValues {
  return {
    ...input, title: draft.title ?? '', quoteDate: draft.quote_date ?? '', validUntil: draft.valid_until, currency: draft.currency ?? '', pricingMode: draft.pricing_mode ?? '',
    discountAmount: draft.discount_amount ?? '', customerNote: draft.customer_note, internalNote: draft.internal_note,
    content: Object.fromEntries(Object.entries(CORE_QUOTE_CONTENT_KEYS).map(([camel, snake]) => [camel, draft.content[snake]])) as CoreQuoteContent,
    items: draft.items.map(item => ({ name: item.name, description: item.description, quantity: item.quantity, unit: item.unit, unitPrice: item.unit_price, vatRate: item.vat_rate ?? '', note: item.note })),
  }
}
export function parseCoreQuoteReceipt(value: unknown, input: CoreQuoteCommandInput, kind?: CoreQuoteCommandKind): CoreQuoteReceipt {
  try {
    const data = record(value)
    if (data.companyId !== input.companyId || data.operationId !== input.operationId || typeof data.replayed !== 'boolean'
      || ('quoteId' in input && data.quoteId !== input.quoteId)) throw coreQuoteError(null)
    const result: CoreQuoteReceipt = { companyId: coreQuoteId(data.companyId), operationId: coreQuoteId(data.operationId), quoteId: coreQuoteId(data.quoteId), revision: coreQuoteRevision(data.revision), replayed: data.replayed }
    if (kind === 'create' && result.revision !== '1') throw coreQuoteError(null)
    if (kind && ['update', 'sync', 'openRevision', 'publish', 'revoke', 'archive', 'delete'].includes(kind)
      && (!('expectedRevision' in input) || BigInt(result.revision) !== BigInt(input.expectedRevision) + BigInt(1))) throw coreQuoteError(null)
    if (kind === 'revoke') {
      if (!('versionId' in input) || data.versionId !== input.versionId) throw coreQuoteError(null)
      result.versionId = data.versionId === null ? null : coreQuoteId(data.versionId)
    } else if (data.versionId !== undefined) result.versionId = coreQuoteId(data.versionId)
    if ('versionId' in input && result.versionId !== input.versionId && kind === 'decision') throw coreQuoteError(null)
    if (kind === 'publish') {
      if (!result.versionId || typeof data.versionNumber !== 'number' || !Number.isSafeInteger(data.versionNumber) || data.versionNumber < 1
        || typeof data.shareToken !== 'string' || !/^[0-9a-f]{64}$/.test(data.shareToken)) throw coreQuoteError(null)
      result.versionNumber = data.versionNumber; result.shareToken = data.shareToken; result.publishedAt = instant(data.publishedAt)
    }
    if (kind === 'decision') {
      if (!('decision' in input) || data.decision !== input.decision) throw coreQuoteError(null)
      result.decisionId = coreQuoteId(data.decisionId); result.decision = input.decision; result.recordedAt = instant(data.recordedAt)
    }
    return result
  } catch { throw coreQuoteError(null) }
}


export const previewCoreQuote = previewCoreQuoteItems

function readString(value: unknown): string { if (typeof value !== 'string' || value.includes('\0')) throw coreQuoteError(null); return value }
function readNullableString(value: unknown): string | null { return value === null ? null : readString(value) }
function readAmount(value: unknown): string {
  const result = readString(value)
  if (result.length > 40 || !/^-?\d+(?:\.\d+)?$/.test(result)) throw coreQuoteError(null)
  return result
}
function readInteger(value: unknown, minimum = 0): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw coreQuoteError(null); return value }
function readNullableId(value: unknown): string | null { return value === null ? null : coreQuoteId(value) }
function readInstant(value: unknown): string | null { return value === null ? null : instant(value) }
function readContent(value: unknown): CoreQuoteStoredContent {
  const data = record(value)
  return Object.fromEntries(Object.values(CORE_QUOTE_CONTENT_KEYS).map(key => [key, readNullableString(data[key])])) as CoreQuoteStoredContent
}
function readDecision(value: unknown): CoreQuoteDecisionRecord | null {
  if (value === null) return null
  const data = record(value)
  if (data.decision !== 'accepted' && data.decision !== 'rejected') throw coreQuoteError(null)
  return { id: coreQuoteId(data.id), decision: data.decision, evidence: readString(data.evidence), decidedAt: instant(data.decidedAt), recordedAt: instant(data.recordedAt), actorId: coreQuoteId(data.actorId), actorKind: readString(data.actorKind) }
}
function readResponse(value: unknown): CoreQuoteResponseRecord {
  const data = record(value)
  if (!['interested', 'contact_requested', 'revision_requested', 'not_interested'].includes(String(data.actionType))
    || (data.actorKind !== 'public' && data.actorKind !== 'portal')) throw coreQuoteError(null)
  const actorId = readNullableId(data.actorId)
  if ((data.actorKind === 'public' && actorId !== null) || (data.actorKind === 'portal' && actorId === null)) throw coreQuoteError(null)
  return {
    responseId: coreQuoteId(data.responseId), versionId: coreQuoteId(data.versionId), actionType: data.actionType as CoreQuoteResponseRecord['actionType'],
    customerName: readNullableString(data.customerName), customerEmail: readNullableString(data.customerEmail), customerPhone: readNullableString(data.customerPhone),
    note: readNullableString(data.note), recordedAt: instant(data.recordedAt), actorKind: data.actorKind, actorId,
  }
}
function readSupplier(value: unknown): CoreQuoteSupplier {
  const data = record(value)
  return Object.fromEntries(['name', 'company_number', 'vat_number', 'address', 'street', 'city', 'postal_code', 'country', 'email', 'phone', 'logo_url', 'bank_account', 'iban', 'bic'].map(key => [key, readNullableString(data[key])])) as CoreQuoteSupplier
}
function readCustomer(value: unknown): CoreQuoteCustomer {
  const data = record(value), customer: CoreQuoteCustomer = { name: readNullableString(data.name) }
  for (const key of ['billing_name', 'company_number', 'vat_number', 'billing_street', 'billing_city', 'billing_postal_code', 'billing_country', 'email', 'phone'] as const) {
    if (Object.prototype.hasOwnProperty.call(data, key)) customer[key] = readNullableString(data[key])
  }
  return customer
}
function readDocument(value: unknown): CoreQuoteDocument {
  const data = record(value)
  // A server projection containing private fields is a broken contract, never customer output.
  if (['internal_note', 'unit_cost', 'total_cost', 'margin', 'margin_amount'].some(key => key in data)) throw coreQuoteError(null)
  if (data.schema_version !== 1 || data.locale !== 'cs' || data.id !== data.quote_id
    || !['draft', 'captured', 'legacy_unknown'].includes(String(data.customer_identity_state))
    || ![null, 'net'].includes(data.pricing_mode as string | null) || !Array.isArray(data.items)) throw coreQuoteError(null)
  const document: CoreQuoteDocument = {
    id: coreQuoteId(data.id), quote_id: coreQuoteId(data.quote_id), version_id: readNullableId(data.version_id),
    version_number: data.version_number === null ? null : readInteger(data.version_number, 1), content_hash: readString(data.content_hash),
    title: readNullableString(data.title), quote_number: readNullableString(data.quote_number),
    quote_date: data.quote_date === null ? null : date(data.quote_date), valid_until: data.valid_until === null ? null : date(data.valid_until),
    currency: readNullableString(data.currency), pricing_mode: data.pricing_mode as 'net' | null,
    subtotal_price: data.subtotal_price === null ? null : readAmount(data.subtotal_price), discount_amount: data.discount_amount === null ? null : readAmount(data.discount_amount), total_price: data.total_price === null ? null : readAmount(data.total_price),
    customer_note: readNullableString(data.customer_note), customer_identity_state: data.customer_identity_state as CoreQuoteDocument['customer_identity_state'],
    customer: readCustomer(data.customer), supplier: readSupplier(data.supplier), content: readContent(data.content),
    items: data.items.map(value => {
      const item = record(value)
      if (['unit_cost', 'total_cost', 'margin', 'margin_amount', 'internal_note'].some(key => key in item)) throw coreQuoteError(null)
      return { id: coreQuoteId(item.id), sort_order: readInteger(item.sort_order, Number.MIN_SAFE_INTEGER), name: readNullableString(item.name), description: readNullableString(item.description),
        quantity: readAmount(item.quantity), unit: readNullableString(item.unit), unit_price: readAmount(item.unit_price), total_price: item.total_price === null ? null : readAmount(item.total_price),
        vat_rate: item.vat_rate === null ? null : readAmount(item.vat_rate), note: readNullableString(item.note) }
    }), locale: 'cs', schema_version: 1,
  }
  if (!/^[a-f0-9]{64}$/.test(document.content_hash) || (document.currency !== null && !/^[A-Z]{3}$/.test(document.currency))) throw coreQuoteError(null)
  return document
}
function readError(): CoreQuoteError { return new CoreQuoteError('Úplná data nabídky nejsou dostupná. Obnovte stránku; chybějící údaje nelze bezpečně doplnit z aktuální kalkulace.', 'unavailable', false) }
export function parseCoreQuoteDocumentRead(value: unknown, expected?: { quoteId?: string; versionId?: string }): CoreQuoteDocumentRead {
  try {
    const data = record(value)
    if (data.kind !== 'issued' && data.kind !== 'legacy' && data.kind !== 'draft') throw coreQuoteError(null)
    const document = readDocument(data.document)
    const result: CoreQuoteDocumentRead = { kind: data.kind, publishedAt: readInstant(data.publishedAt), legacyCapturedAt: readInstant(data.legacyCapturedAt),
      status: readString(data.status), acceptedAt: readInstant(data.acceptedAt), rejectedAt: readInstant(data.rejectedAt), document }
    if ((expected?.quoteId && document.quote_id !== expected.quoteId) || (expected?.versionId && document.version_id !== expected.versionId)
      || (result.kind === 'issued' && (!result.publishedAt || !document.version_id || !document.version_number || document.pricing_mode !== 'net'))
      || (result.kind === 'legacy' && (!result.legacyCapturedAt || document.version_id !== null || document.version_number !== null))
      || (result.kind === 'draft' && (result.publishedAt !== null || document.version_id !== null || document.version_number !== null))) throw coreQuoteError(null)
    if (result.kind === 'issued') {
      if (!document.title || !document.quote_date || !document.currency || document.discount_amount === null || document.subtotal_price === null || document.total_price === null
        || document.customer_identity_state === 'draft' || document.items.length === 0) throw coreQuoteError(null)
      const preview = previewCoreQuoteItems(document.items.map(item => ({
        name: item.name, description: item.description, quantity: item.quantity, unit: item.unit, unitPrice: item.unit_price, vatRate: item.vat_rate, note: item.note,
      })), document.discount_amount)
      if (preview.subtotalPrice !== normalizeCoreQuoteDecimal(document.subtotal_price) || preview.totalPrice !== normalizeCoreQuoteDecimal(document.total_price)
        || document.items.some((item, index) => item.sort_order < 0 || item.total_price === null || normalizeCoreQuoteDecimal(item.total_price) !== preview.items[index].totalPrice)) throw coreQuoteError(null)
    }
    return result
  } catch { throw readError() }
}
function readDraft(value: unknown): CoreQuoteDraftDocument {
  const data = record(value)
  if (!Array.isArray(data.items) || ![null, 'net'].includes(data.pricing_mode as string | null)) throw coreQuoteError(null)
  return {
    title: readNullableString(data.title), quote_date: data.quote_date === null ? null : date(data.quote_date), valid_until: data.valid_until === null ? null : date(data.valid_until),
    currency: readNullableString(data.currency), pricing_mode: data.pricing_mode as 'net' | null, discount_amount: data.discount_amount === null ? null : readAmount(data.discount_amount),
    customer_note: readNullableString(data.customer_note), internal_note: readNullableString(data.internal_note), content: readContent(data.content),
    items: data.items.map(value => {
      const item = record(value)
      return { name: readString(item.name), description: readNullableString(item.description), quantity: readAmount(item.quantity), unit: readNullableString(item.unit),
        unit_price: readAmount(item.unit_price), vat_rate: item.vat_rate === null ? null : readAmount(item.vat_rate), note: readNullableString(item.note) }
    }),
  }
}
export function parseCoreQuoteWorkspace(value: unknown, expected: { companyId: string; quoteId: string }): CoreQuoteWorkspace {
  try {
    const data = record(value)
    if (!['draft', 'captured', 'legacy_unknown'].includes(String(data.customerIdentityState)) || data.companyId !== expected.companyId || data.quoteId !== expected.quoteId || typeof data.draftOpen !== 'boolean' || !Array.isArray(data.versions) || !Array.isArray(data.responses) || data.responses.length > 200) throw coreQuoteError(null)
    const result: CoreQuoteWorkspace = {
      companyId: coreQuoteId(data.companyId), quoteId: coreQuoteId(data.quoteId), customerId: readNullableId(data.customerId),
      customerIdentityState: data.customerIdentityState as CoreQuoteWorkspace['customerIdentityState'], customerSnapshot: data.customerSnapshot === null ? null : record(data.customerSnapshot),
      currentCalculationRevision: data.currentCalculationRevision === null ? null : coreQuoteRevision(data.currentCalculationRevision),
      sourceCalculationId: readNullableId(data.sourceCalculationId), sourceCalculationRevision: data.sourceCalculationRevision === null ? null : coreQuoteRevision(data.sourceCalculationRevision),
      revision: coreQuoteRevision(data.revision), draftOpen: data.draftOpen, archivedAt: readInstant(data.archivedAt), currentVersionId: readNullableId(data.currentVersionId),
      acceptedVersionId: readNullableId(data.acceptedVersionId), draft: readDraft(data.draft),
      versions: data.versions.map(value => {
        const version = record(value)
        const shareToken = readNullableString(version.shareToken)
        if (shareToken !== null && !/^[0-9a-f]{64}$/.test(shareToken)) throw coreQuoteError(null)
        return { versionId: coreQuoteId(version.versionId), versionNumber: readInteger(version.versionNumber, 1), sourceRevision: coreQuoteRevision(version.sourceRevision),
          contentHash: readString(version.contentHash), publishedAt: instant(version.publishedAt), status: readString(version.status),
          acceptedAt: readInstant(version.acceptedAt), rejectedAt: readInstant(version.rejectedAt), shareToken, decision: readDecision(version.decision) }
      }),
      responses: data.responses.map(readResponse),
      legacy: data.legacy === null ? null : { capturedAt: instant(record(data.legacy).capturedAt), revokedAt: readInstant(record(data.legacy).revokedAt), document: readDocument(record(data.legacy).document) },
    }
    if (result.legacy && result.legacy.document.quote_id !== result.quoteId) throw coreQuoteError(null)
    if (result.responses.some(response => !result.versions.some(version => version.versionId === response.versionId))) throw coreQuoteError(null)
    return result
  } catch { throw readError() }
}
