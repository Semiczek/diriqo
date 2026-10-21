/** Identity stored on the quote; optional/malformed protection fields fail closed. */
export type QuoteCustomerIdentitySource = {
  company_id?: unknown
  customer_id?: unknown
  customer_identity_state?: unknown
  customer_snapshot?: unknown
  customer_snapshot_captured_at?: unknown
}

const customerFields = [
  'name', 'billingName', 'companyNumber', 'vatNumber', 'billingStreet', 'billingCity',
  'billingPostalCode', 'billingCountry', 'email', 'phone',
] as const

type CustomerField = typeof customerFields[number]
export type QuoteCustomerSnapshot = { version: 1 } & Record<CustomerField, string | null>
export type QuoteCustomerIdentity =
  | { state: 'captured'; customer: QuoteCustomerSnapshot; capturedAt: string }
  | { state: 'draft'; customer: QuoteCustomerSnapshot | null; capturedAt: null }
  | { state: 'legacy_unknown'; customer: null; capturedAt: null }

export const QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL = 'Původní údaje zákazníka nejsou uložené.'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function snapshot(value: unknown): QuoteCustomerSnapshot | null {
  const input = record(value)
  if (!input || input.version !== 1 || customerFields.some(key =>
    !Object.hasOwn(input, key) || (input[key] !== null && typeof input[key] !== 'string'))) return null
  // Copy only the published schema; never merge contact or current customer fields.
  return Object.fromEntries([['version', 1], ...customerFields.map(key => [key, input[key]])]) as QuoteCustomerSnapshot
}

function capturedTime(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) === value.slice(0, 10)
}

export function resolveQuoteCustomerIdentity(
  quote: QuoteCustomerIdentitySource,
  currentCustomer?: unknown,
): QuoteCustomerIdentity {
  const unavailable: QuoteCustomerIdentity = { state: 'legacy_unknown', customer: null, capturedAt: null }
  if (quote.customer_identity_state === 'captured') {
    const customer = snapshot(quote.customer_snapshot)
    return customer && capturedTime(quote.customer_snapshot_captured_at)
      ? { state: 'captured', customer, capturedAt: quote.customer_snapshot_captured_at }
      : unavailable
  }
  if (quote.customer_identity_state !== 'draft' || quote.customer_snapshot !== null ||
    quote.customer_snapshot_captured_at !== null) return unavailable

  const current = record(currentCustomer)
  if (!current || typeof quote.company_id !== 'string' || !quote.company_id ||
    typeof quote.customer_id !== 'string' || !quote.customer_id ||
    current.company_id !== quote.company_id || current.id !== quote.customer_id) {
    return { state: 'draft', customer: null, capturedAt: null }
  }
  const fieldMap: Record<CustomerField, string> = {
    name: 'name', billingName: 'billing_name', companyNumber: 'company_number', vatNumber: 'vat_number',
    billingStreet: 'billing_street', billingCity: 'billing_city', billingPostalCode: 'billing_postal_code',
    billingCountry: 'billing_country', email: 'email', phone: 'phone',
  }
  const customer = Object.fromEntries([['version', 1], ...customerFields.map(key => {
    const value = current[fieldMap[key]]
    return [key, typeof value === 'string' ? value : null]
  })]) as QuoteCustomerSnapshot
  return { state: 'draft', customer, capturedAt: null }
}
