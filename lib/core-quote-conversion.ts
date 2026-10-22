export type CoreQuoteConversionCode = 'validation' | 'forbidden' | 'conflict' | 'unavailable' | 'unknown'
export type CoreQuoteConversionInput = {
  companyId: string; quoteId: string; operationId: string
  /** Missing only when replaying a request saved before versioned quotes. */
  versionId?: string
  title: string; description: string | null; address: string | null
  startAt: string; endAt: string
  splitDays: Array<{ label: string; startAt: string; endAt: string }>
}
export type CoreQuoteConversionResult =
  | { ok: true; data: { jobId: string; created: boolean } }
  | { ok: false; error: string; code: CoreQuoteConversionCode; uncertain: boolean }

export class CoreQuoteConversionError extends Error {
  constructor(message: string, readonly code: CoreQuoteConversionCode, readonly uncertain = code === 'unknown') {
    super(message); this.name = 'CoreQuoteConversionError'
  }
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
function invalid(message = 'Zkontrolujte název, termín a vybrané dny realizace.'): never {
  throw new CoreQuoteConversionError(message, 'validation')
}
export function coreQuoteId(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) return invalid('Formulář není platný. Obnovte stránku nabídky.')
  return value.toLowerCase()
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, required = false): string | null {
  if (value != null && typeof value !== 'string') return invalid()
  const result = (value as string | null | undefined)?.trim() || null
  if ((required && !result) || (result && [...result].length > max)) return invalid()
  return result
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !instantPattern.test(value)) return invalid('Termín musí obsahovat platné datum, čas a časové pásmo.')
  const result = new Date(value), day = value.slice(0, 10), parsedDay = new Date(day + 'T00:00:00Z')
  if (!Number.isFinite(result.getTime()) || result.getUTCFullYear() < 1900 || result.getUTCFullYear() > 9999
    || !Number.isFinite(parsedDay.getTime()) || parsedDay.toISOString().slice(0, 10) !== day) return invalid()
  return result.toISOString()
}

/** Prices and source identities are resolved by the database, never accepted from the form. */
export function parseCoreQuoteConversion(value: unknown): CoreQuoteConversionInput {
  const input = record(value)
  const startAt = instant(input.startAt), endAt = instant(input.endAt)
  if (endAt <= startAt) return invalid('Konec realizace musí být později než začátek.')
  if (!Array.isArray(input.splitDays) || input.splitDays.length > 366) return invalid('Vyberte nejvýše 366 dnů realizace.')
  const splitDays = input.splitDays.map(value => {
    const day = record(value)
    return { label: text(day.label, 200, true)!, startAt: instant(day.startAt), endAt: instant(day.endAt) }
  }).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.endAt.localeCompare(b.endAt))
  for (let index = 0; index < splitDays.length; index++) {
    const day = splitDays[index]
    if (day.endAt <= day.startAt || day.startAt < startAt || day.endAt > endAt
      || (index > 0 && splitDays[index - 1].endAt > day.startAt)) {
      return invalid('Vybrané dny se nesmějí překrývat ani přesahovat termín zakázky.')
    }
  }
  return {
    companyId: coreQuoteId(input.companyId), quoteId: coreQuoteId(input.quoteId), operationId: coreQuoteId(input.operationId),
    ...(Object.prototype.hasOwnProperty.call(input, 'versionId') ? { versionId: coreQuoteId(input.versionId) } : {}),
    title: text(input.title, 300, true)!, description: text(input.description, 10_000), address: text(input.address, 2_000),
    startAt, endAt, splitDays,
  }
}
