export const CORE_CALCULATION_MAX_REQUEST_BYTES = 512 * 1024
export const CORE_CALCULATION_LIMITS = {
  title: 300, name: 300, description: 10_000, internalNote: 10_000,
  itemDescription: 4_000, note: 4_000, unit: 50, items: 500,
} as const

export const CORE_CALCULATION_ITEM_TYPES = ['customer', 'labor', 'material', 'rental', 'transport', 'accommodation'] as const
export type CoreCalculationItemType = typeof CORE_CALCULATION_ITEM_TYPES[number]
export type CoreCalculationSaveMode = 'create' | 'update'
export type CoreCalculationSaveCode = 'validation' | 'forbidden' | 'conflict' | 'unavailable' | 'unknown'
export type CoreCalculationItemInput = {
  itemType: CoreCalculationItemType; name: string; description: string | null
  quantity: string; unit: string | null; unitCost: string; unitPrice: string; vatRate: string; note: string | null
}
export type CoreCalculationCreateInput = {
  companyId: string; profileId: string; operationId: string; customerId: string | null
  title: string; description: string | null; status: 'draft' | 'ready'; calculationDate: string
  internalNote: string | null; currency: 'CZK'; items: CoreCalculationItemInput[]
}
export type CoreCalculationUpdateInput = CoreCalculationCreateInput & { calculationId: string; expectedRevision: string }
export type CoreCalculationSaveInput = CoreCalculationCreateInput | CoreCalculationUpdateInput
export type CoreCalculationSaveReceipt = {
  companyId: string; operationId: string; calculationId: string; revision: string; replayed: boolean
}
export type CoreCalculationSaveResult =
  | { ok: true; data: CoreCalculationSaveReceipt }
  | { ok: false; error: string; code: CoreCalculationSaveCode; uncertain: boolean }

export class CoreCalculationSaveError extends Error {
  constructor(message: string, readonly code: CoreCalculationSaveCode, readonly uncertain = code === 'unknown') {
    super(message)
    this.name = 'CoreCalculationSaveError'
  }
}
const errors: Record<string, [CoreCalculationSaveCode, string]> = {
  CALCULATION_INVALID_INPUT: ['validation', 'Zkontrolujte název, datum a všechny položky kalkulace.'],
  CALCULATION_FORBIDDEN: ['forbidden', 'K uložení kalkulace nemáte oprávnění v aktivní firmě. Ověřte přihlášení a vybranou firmu.'],
  CALCULATION_MODULE_REQUIRED: ['forbidden', 'Pro uložení kalkulace je potřeba aktivní základ Diriqo a nabídky.'],
  CALCULATION_NOT_FOUND: ['forbidden', 'Kalkulace není v aktivní firmě dostupná.'],
  CALCULATION_CUSTOMER_NOT_FOUND: ['forbidden', 'Zákazník není v aktivní firmě dostupný.'],
  CALCULATION_OPERATION_CONFLICT: ['conflict', 'Toto potvrzení už bylo použité pro jiné údaje. Zachovejte původní požadavek a ověřte stav kalkulace.'],
  CALCULATION_REVISION_CONFLICT: ['conflict', 'Kalkulaci mezitím někdo změnil. Načtěte aktuální verzi a porovnejte ji se svými změnami.'],
  CALCULATION_NUMERIC_OVERFLOW: ['validation', 'Množství, částka položky nebo součet přesahuje nejvyšší hodnotu 9 999 999 999,99.'],
  CALCULATION_RESULT_MISSING: ['unavailable', 'Uložení je evidované, ale jeho kalkulace už není dostupná. Nová kalkulace se automaticky nevytvoří.'],
}
export function coreCalculationSaveError(error: unknown): CoreCalculationSaveError {
  if (error instanceof CoreCalculationSaveError) return error
  const token = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const known = Object.prototype.hasOwnProperty.call(errors, token) ? errors[token] : undefined
  if (known) return new CoreCalculationSaveError(known[1], known[0])
  return new CoreCalculationSaveError(
    'Výsledek uložení se nepodařilo potvrdit. Opakujte stejný požadavek; původní údaje a potvrzení musí zůstat zachované.',
    'unknown',
  )
}

const ZERO = BigInt(0)
const ONE = BigInt(1)
const HUNDRED = BigInt(100)
const MAX_DECIMAL = BigInt('999999999999')
const MAX_REVISION = BigInt('9223372036854775807')
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function invalid(message = 'Zkontrolujte název, datum a všechny položky kalkulace.'): never {
  throw new CoreCalculationSaveError(message, 'validation')
}
function overflow(): never { throw coreCalculationSaveError({ message: 'CALCULATION_NUMERIC_OVERFLOW' }) }
export function coreCalculationId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) return invalid('Formulář není platný. Obnovte stránku kalkulace.')
  return value.toLowerCase()
}
export function coreCalculationRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > MAX_REVISION) {
    return invalid('Verze kalkulace není platná. Obnovte její detail.')
  }
  return value
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function onlyKeys(input: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(input).some(key => !keys.includes(key))) invalid('Formulář obsahuje nepodporované údaje. Obnovte stránku kalkulace.')
}
function text(value: unknown, max: number, required = false): string | null {
  if (value != null && typeof value !== 'string') return invalid()
  const result = (value as string | null | undefined)?.trim() || null
  if ((required && !result) || (result !== null && ([...result].length > max || result.includes('\0')))) return invalid()
  return result
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    return invalid('Vyberte platné datum kalkulace.')
  }
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid('Vyberte platné datum kalkulace.')
  return value
}
function fromCents(value: bigint): string {
  const negative = value < ZERO
  const absolute = negative ? -value : value
  return (negative ? '-' : '') + (absolute / HUNDRED).toString() + '.' + (absolute % HUNDRED).toString().padStart(2, '0')
}
function toCents(value: string): bigint { return BigInt(value.replace('.', '')) }

/** Exact, bounded numeric(12,2) input. Blank is never converted to zero. */
export function normalizeCoreCalculationDecimal(value: unknown): string {
  if (typeof value !== 'string') return invalid('Množství a částky zadejte jako čísla s nejvýše dvěma desetinnými místy.')
  const cleaned = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return invalid('Množství a částky zadejte jako čísla s nejvýše dvěma desetinnými místy.')
  const [rawWhole, fraction = ''] = cleaned.split('.')
  const whole = rawWhole.replace(/^0+/, '') || '0'
  if (whole.length > 10) return overflow()
  const cents = BigInt(whole) * HUNDRED + BigInt(fraction.padEnd(2, '0'))
  if (cents > MAX_DECIMAL) return overflow()
  return fromCents(cents)
}
const itemKeys = ['itemType', 'name', 'description', 'quantity', 'unit', 'unitCost', 'unitPrice', 'vatRate', 'note'] as const
function parseItem(value: unknown): CoreCalculationItemInput {
  const item = record(value)
  onlyKeys(item, itemKeys)
  if (!CORE_CALCULATION_ITEM_TYPES.includes(item.itemType as CoreCalculationItemType)) return invalid('Vyberte známý typ položky.')
  const quantity = normalizeCoreCalculationDecimal(item.quantity)
  const unitCost = normalizeCoreCalculationDecimal(item.unitCost)
  const unitPrice = normalizeCoreCalculationDecimal(item.unitPrice)
  const vatRate = normalizeCoreCalculationDecimal(item.vatRate)
  if (toCents(quantity) <= ZERO) return invalid('Množství každé položky musí být větší než nula.')
  if (toCents(vatRate) > BigInt(10_000)) return invalid('Sazba DPH musí být mezi 0 a 100 procenty.')
  if (item.itemType === 'customer' ? toCents(unitCost) !== ZERO : toCents(unitPrice) !== ZERO) {
    return invalid('Zákaznická položka nemá interní náklad; interní položka nemá prodejní cenu.')
  }
  return {
    itemType: item.itemType as CoreCalculationItemType, name: text(item.name, CORE_CALCULATION_LIMITS.name, true)!,
    description: text(item.description, CORE_CALCULATION_LIMITS.itemDescription),
    quantity, unit: text(item.unit, CORE_CALCULATION_LIMITS.unit), unitCost, unitPrice, vatRate,
    note: text(item.note, CORE_CALCULATION_LIMITS.note),
  }
}
function parseItems(value: unknown, allowEmpty: boolean): CoreCalculationItemInput[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > CORE_CALCULATION_LIMITS.items) {
    return invalid('Kalkulace musí mít 1 až 500 položek.')
  }
  return value.map(parseItem)
}
function storedAmount(value: bigint): bigint {
  if (value < -MAX_DECIMAL || value > MAX_DECIMAL) return overflow()
  return value
}
// All multiplicands here are non-negative. This matches PostgreSQL numeric round(...,2).
function roundedProduct(left: bigint, right: bigint, divisor = HUNDRED): bigint {
  return (left * right + divisor / BigInt(2)) / divisor
}
export type CoreCalculationItemPreview = CoreCalculationItemInput & {
  totalCost: string; totalPrice: string; vatAmount: string; costVatAmount: string; totalWithVat: string; totalCostWithVat: string
}
export type CoreCalculationPreview = {
  items: CoreCalculationItemPreview[]
  subtotalCost: string; subtotalPrice: string; totalPrice: string; marginAmount: string
  vatAmount: string; costVatAmount: string; totalWithVat: string; totalCostWithVat: string; laborCost: string; otherCost: string
}
function previewNormalized(items: CoreCalculationItemInput[]): CoreCalculationPreview {
  let cost = ZERO, price = ZERO, vat = ZERO, costVat = ZERO, labor = ZERO
  const rows = items.map(item => {
    const quantity = toCents(item.quantity), rate = toCents(item.vatRate)
    const totalCost = storedAmount(roundedProduct(quantity, toCents(item.unitCost)))
    const totalPrice = storedAmount(roundedProduct(quantity, toCents(item.unitPrice)))
    const rowVat = roundedProduct(totalPrice, rate, BigInt(10_000))
    const rowCostVat = roundedProduct(totalCost, rate, BigInt(10_000))
    cost = storedAmount(cost + totalCost)
    price = storedAmount(price + totalPrice)
    vat += rowVat
    costVat += rowCostVat
    if (item.itemType === 'labor') labor += totalCost
    return {
      ...item, totalCost: fromCents(totalCost), totalPrice: fromCents(totalPrice),
      vatAmount: fromCents(rowVat), costVatAmount: fromCents(rowCostVat),
      totalWithVat: fromCents(totalPrice + rowVat), totalCostWithVat: fromCents(totalCost + rowCostVat),
    }
  })
  return {
    items: rows, subtotalCost: fromCents(cost), subtotalPrice: fromCents(price), totalPrice: fromCents(price),
    marginAmount: fromCents(storedAmount(price - cost)), vatAmount: fromCents(vat), costVatAmount: fromCents(costVat),
    totalWithVat: fromCents(price + vat), totalCostWithVat: fromCents(cost + costVat), laborCost: fromCents(labor), otherCost: fromCents(cost - labor),
  }
}
export function previewCoreCalculationItems(raw: unknown[]): CoreCalculationPreview {
  return previewNormalized(parseItems(raw, true))
}
const headerKeys = ['companyId', 'profileId', 'operationId', 'customerId', 'title', 'description', 'status', 'calculationDate', 'internalNote', 'currency', 'items'] as const
export function parseCoreCalculationSave(value: unknown, mode?: 'create'): CoreCalculationCreateInput
export function parseCoreCalculationSave(value: unknown, mode: 'update'): CoreCalculationUpdateInput
export function parseCoreCalculationSave(value: unknown, mode: CoreCalculationSaveMode): CoreCalculationSaveInput
export function parseCoreCalculationSave(value: unknown, mode: CoreCalculationSaveMode = 'create'): CoreCalculationSaveInput {
  const input = record(value)
  if (mode !== 'create' && mode !== 'update') return invalid()
  onlyKeys(input, mode === 'update' ? [...headerKeys, 'calculationId', 'expectedRevision'] : headerKeys)
  if (input.status !== 'draft' && input.status !== 'ready') return invalid('Vyberte stav koncept nebo připraveno.')
  if (input.currency !== 'CZK') return invalid('Tato kalkulace podporuje měnu CZK.')
  const items = parseItems(input.items, false)
  previewNormalized(items) // Reject row and sum overflow before persisting a pending request.
  const parsed: CoreCalculationCreateInput = {
    companyId: coreCalculationId(input.companyId), profileId: coreCalculationId(input.profileId), operationId: coreCalculationId(input.operationId),
    customerId: input.customerId === null ? null : coreCalculationId(input.customerId), title: text(input.title, CORE_CALCULATION_LIMITS.title, true)!,
    description: text(input.description, CORE_CALCULATION_LIMITS.description), status: input.status, calculationDate: date(input.calculationDate),
    internalNote: text(input.internalNote, CORE_CALCULATION_LIMITS.internalNote), currency: 'CZK', items,
  }
  const result: CoreCalculationSaveInput = mode === 'update' ? {
    ...parsed, calculationId: coreCalculationId(input.calculationId), expectedRevision: coreCalculationRevision(input.expectedRevision),
  } : parsed
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > CORE_CALCULATION_MAX_REQUEST_BYTES) {
    return invalid('Kalkulace obsahuje příliš mnoho textu. Zkraťte dlouhé popisy nebo poznámky a zkuste ji uložit znovu.')
  }
  return result
}
export function parseCoreCalculationCreate(value: unknown): CoreCalculationCreateInput { return parseCoreCalculationSave(value, 'create') }
export function parseCoreCalculationUpdate(value: unknown): CoreCalculationUpdateInput { return parseCoreCalculationSave(value, 'update') }
export function nextCoreCalculationRevision(value: string): string {
  const current = BigInt(coreCalculationRevision(value))
  if (current === MAX_REVISION) return overflow()
  return (current + ONE).toString()
}


/** The response may be lost after COMMIT: malformed receipts always remain uncertain. */
export function parseCoreCalculationSaveReceipt(
  value: unknown, input: CoreCalculationSaveInput, mode: CoreCalculationSaveMode = 'create',
): CoreCalculationSaveReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw coreCalculationSaveError(null)
  const row = value as Record<string, unknown>
  if (row.companyId !== input.companyId || row.operationId !== input.operationId || typeof row.replayed !== 'boolean') {
    throw coreCalculationSaveError(null)
  }
  let calculationId: string, revision: string
  try {
    calculationId = coreCalculationId(row.calculationId)
    revision = coreCalculationRevision(row.revision)
    if (mode === 'update') {
      if (!('calculationId' in input) || !('expectedRevision' in input)
        || calculationId !== input.calculationId || revision !== nextCoreCalculationRevision(input.expectedRevision)) {
        throw new Error('Unexpected calculation receipt')
      }
    } else if (mode !== 'create' || revision !== '1') {
      throw new Error('Unexpected calculation receipt')
    }
  } catch { throw coreCalculationSaveError(null) }
  return { companyId: input.companyId, operationId: input.operationId, calculationId, revision, replayed: row.replayed }
}