import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import React from 'react'
import { resolveQuoteCustomerIdentity, QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL, type QuoteCustomerSnapshot } from '../lib/quote-customer-identity'

const mocks = vi.hoisted(() => ({ guard: vi.fn(), server: vi.fn(), admin: vi.fn(), public: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-guards', () => ({ requireHubAccess: mocks.guard }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.server }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
import { GET } from '../app/api/quotes/[quoteId]/pdf/route'
import { getPortalOfferDetail } from '../lib/customer-portal/data'
vi.mock('@/lib/customer-portal/auth', () => ({ requirePortalUserContext: async () => ({
  customerId: '22222222-2222-4222-8222-222222222222', companyId: '11111111-1111-4111-8111-111111111111',
  customerName: 'Current B', email: 'current-b@example.invalid',
}) }))
vi.mock('@/lib/i18n/server', () => ({ getRequestDictionary: async () => ({ publicOffer: {} }) }))
vi.mock('@/lib/supabase-public', () => ({ createSupabasePublicClient: mocks.public }))
vi.mock('@/components/PublicOfferPage', () => ({ default: () => null }))
vi.mock('@/components/portal/PortalShell', () => ({ default: () => null }))
import PublicOfferPage from '@/components/PublicOfferPage'
import PortalOfferDetailPage from '../app/portal/offers/[offerId]/page'
import PublicOfferDetailPage from '../app/offer/[token]/page'
function elementList(value: unknown): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(value)) return value.flatMap(elementList)
  if (!React.isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...elementList(value.props.children)]
}

const companyId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const quoteId = '33333333-3333-4333-8333-333333333333'
const capturedAt = '2026-10-21T10:00:00.123456+00:00'
const original: QuoteCustomerSnapshot = {
  version: 1, name: 'Original A', billingName: 'Original billing A', companyNumber: '12345678',
  vatNumber: 'CZ12345678', billingStreet: 'Original street A', billingCity: 'Original city A',
  billingPostalCode: '12345', billingCountry: 'CZ', email: 'original-a@example.invalid', phone: '111111111',
}
const current = {
  id: customerId, company_id: companyId, name: 'Current B', billing_name: 'Current billing B',
  company_number: '99999999', vat_number: 'CZ99999999', billing_street: 'Current street B',
  billing_city: 'Current city B', billing_postal_code: '98765', billing_country: 'DE',
  email: 'current-b@example.invalid', phone: '999999999',
}
const source = {
  company_id: companyId, customer_id: customerId, customer_identity_state: 'captured',
  customer_snapshot: original, customer_snapshot_captured_at: capturedAt,
}
const draft = { ...source, customer_identity_state: 'draft', customer_snapshot: null, customer_snapshot_captured_at: null }
const unknownIdentity = { state: 'legacy_unknown', customer: null, capturedAt: null }

describe('quote customer identity contract', () => {
  it('keeps every historical A field when the current customer is B, removed or unavailable', () => {
    for (const customer of [current, null, undefined]) {
      expect(resolveQuoteCustomerIdentity(source, customer)).toEqual({ state: 'captured', customer: original, capturedAt })
    }
  })
  it('preserves all explicit nulls without mixing current customer or quote contact data', () => {
    const nulls = Object.fromEntries(Object.keys(original).map(key => [key, key === 'version' ? 1 : null]))
    const quote = { ...source, customer_snapshot: nulls, contact_name: 'Changed contact', contact_email: 'changed-contact@example.invalid' }
    expect(resolveQuoteCustomerIdentity(quote, current)).toEqual({ state: 'captured', customer: nulls, capturedAt })
  })
  it('uses the current customer only for an explicitly un-captured draft in the same company', () => {
    expect(resolveQuoteCustomerIdentity(draft, current)).toEqual({ state: 'draft', capturedAt: null, customer: {
      version: 1, name: current.name, billingName: current.billing_name, companyNumber: current.company_number,
      vatNumber: current.vat_number, billingStreet: current.billing_street, billingCity: current.billing_city,
      billingPostalCode: current.billing_postal_code, billingCountry: current.billing_country, email: current.email, phone: current.phone,
    } })
    for (const customer of [null, { ...current, company_id: 'another-company' }, { ...current, id: 'another-customer' }, { name: 'unscoped' }]) {
      expect(resolveQuoteCustomerIdentity(draft, customer)).toEqual({ state: 'draft', customer: null, capturedAt: null })
    }
  })
  it.each([
    {}, { ...source, customer_identity_state: undefined }, { ...source, customer_identity_state: 'legacy_unknown' },
    { ...source, customer_identity_state: 'unexpected' }, { ...source, customer_snapshot: null },
    { ...source, customer_snapshot: [] }, { ...source, customer_snapshot: { ...original, version: 2 } },
    { ...source, customer_snapshot: { ...original, email: 123 } },
    { ...source, customer_snapshot: { version: 1, name: 'Partial' } },
    { ...source, customer_snapshot_captured_at: undefined }, { ...source, customer_snapshot_captured_at: null },
    { ...source, customer_snapshot_captured_at: 'not a date' }, { ...source, customer_snapshot_captured_at: '2026-02-30T10:00:00Z' },
    { ...draft, customer_snapshot: original }, { ...draft, customer_snapshot: undefined }, { ...draft, customer_snapshot_captured_at: capturedAt },
  ])('fails closed for missing or malformed protection fields: %j', quote => {
    expect(resolveQuoteCustomerIdentity(quote, current)).toEqual(unknownIdentity)
  })
  it('copies only the declared schema and does not mutate or expose extra properties', () => {
    const snapshot = { ...original, privateNote: 'not a published identity field' }
    const identity = resolveQuoteCustomerIdentity({ ...source, customer_snapshot: snapshot }, current)
    expect(identity.customer).toEqual(original)
    expect(identity.customer).not.toBe(snapshot)
    expect(snapshot.privateNote).toBe('not a published identity field')
  })
})

type Row = Record<string, unknown>
let quote: Row
let quoteError: { message: string } | null
let queries: Array<{ table: string; select?: string; filters: Array<[string, unknown]> }>
const from = vi.fn((table: string) => {
  const log = { table, filters: [] as Array<[string, unknown]>, select: undefined as string | undefined }
  queries.push(log)
  const result = () => ({
    data: table === 'quotes' ? quote : table === 'quote_items' ? [] : { id: companyId, name: 'Supplier' },
    error: table === 'quotes' ? quoteError : null,
  })
  const chain = {
    select(value: string) { log.select = value; return chain },
    eq(key: string, value: unknown) { log.filters.push([key, value]); return chain },
    neq(key: string, value: unknown) { log.filters.push(['not:' + key, value]); return chain },
    order() { return chain },
    maybeSingle: async () => result(),
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
  }
  return chain
})
const pdfHex = (text: string) => Array.from(text).map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')
const requestPdf = () => GET(new NextRequest('https://example.invalid/api/quotes/' + quoteId + '/pdf'), { params: Promise.resolve({ quoteId }) })
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('React', React); queries = []; quoteError = null
  quote = { ...source, id: quoteId, quote_number: 'TEST-1', title: 'Offer', status: 'sent', customers: current,
    quote_date: '2026-10-21', valid_until: null, subtotal_price: 100, total_price: 100, accepted_at: null,
    created_at: capturedAt, updated_at: capturedAt, contact_name: 'Contact now', contact_email: 'contact-now@example.invalid' }
  mocks.guard.mockResolvedValue({ ok: true, value: { companyId } })
  mocks.server.mockResolvedValue({ from }); mocks.admin.mockReturnValue({ from })
})

afterEach(() => vi.unstubAllGlobals())

describe('internal quote PDF identity integration', () => {
  it('renders historical name/address/email in the actual generated PDF, even when current data changed', async () => {
    const response = await requestPdf()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
    for (const value of [original.billingName!, original.billingStreet!, original.email!, original.companyNumber!]) expect(pdf).toContain(pdfHex(value))
    for (const value of [current.name, current.billing_name, current.billing_street, current.email, 'contact-now@example.invalid']) expect(pdf).not.toContain(pdfHex(value))
    const query = queries.find(query => query.table === 'quotes')!
    for (const field of ['customer_identity_state', 'customer_snapshot', 'customer_snapshot_captured_at']) expect(query.select).toContain(field)
    expect(query.filters).toContainEqual(['company_id', companyId])
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('labels both pages of a live-customer draft as a concept, including its footer', async () => {
    Object.assign(quote, draft, { status: 'draft' })
    const response = await requestPdf()
    expect(response.status).toBe(200)
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
    expect(pdf.split(pdfHex('Koncept nabídky')).length - 1).toBe(4)
    expect(pdf).toContain(pdfHex(current.billing_name))
    expect(pdf).not.toContain(pdfHex('Cenová nabídka byla vystavena elektronicky v Diriqo.'))
  })
  it.each(['captured', 'legacy_unknown'])('does not label published %s identity as draft after a status rollback', async state => {
    Object.assign(quote, { customer_identity_state: state, status: 'draft' })
    const response = await requestPdf()
    expect(response.status).toBe(200)
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
    expect(pdf).not.toContain(pdfHex('Koncept nabídky'))
    expect(pdf).not.toContain(pdfHex(current.billing_name))
    expect(pdf).toContain(pdfHex('Cenová nabídka'))
  })
  it('renders the legacy marker and no current identity for old or malformed quotes', async () => {
    quote.customer_snapshot = { version: 99, name: 'Invalid historical identity' }
    const response = await requestPdf()
    expect(response.status).toBe(200)
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
    expect(pdf).toContain(pdfHex('Původní údaje zákazníka nejsou'))
    expect(pdf).not.toContain(pdfHex(current.billing_name))
    expect(pdf).not.toContain(pdfHex(current.billing_street))
    expect(pdf).not.toContain(pdfHex('Invalid historical identity'))
  })
  it('does not retry a failed protected-field query using a legacy current-customer fallback', async () => {
    quoteError = { message: 'column customer_identity_state unavailable' }
    expect((await requestPdf()).status).toBe(400)
    expect(queries.filter(query => query.table === 'quotes')).toHaveLength(1)
  })
  it('handles a failed guard union before loading any business data', async () => {
    mocks.guard.mockResolvedValue({ ok: false, status: 403, error: 'Active company denied' })
    const response = await requestPdf()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Active company denied' })
    expect(mocks.server).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
})

describe('customer portal offer identity integration', () => {
  it('returns historical customer A and address without fetching the current customer B', async () => {
    const offer = await getPortalOfferDetail(customerId, companyId, quoteId)
    expect(offer?.customerName).toBe(original.billingName)
    expect(offer?.customerAddressLabel).toBe('Original street A, 12345 Original city A, CZ')
    expect(offer?.customerEmail).toBe(original.email)
    expect(offer?.customerPhone).toBe(original.phone)
    expect(queries.map(query => query.table)).toEqual(['quotes', 'quote_items'])
    expect(queries[0].filters).toContainEqual(['customer_id', customerId])
    expect(queries[0].filters).toContainEqual(['company_id', companyId])
    for (const field of ['customer_identity_state', 'customer_snapshot', 'customer_snapshot_captured_at']) expect(queries[0].select).toContain(field)
  })
  it('returns the explicit unavailable marker for legacy with no address, email or phone', async () => {
    quote.customer_identity_state = 'legacy_unknown'
    const offer = await getPortalOfferDetail(customerId, companyId, quoteId)
    expect(offer?.customerIdentityState).toBe('legacy_unknown')
    expect(offer?.customerName).toBeNull()
    expect(offer?.customerAddressLabel).toBeNull()
    expect(offer?.customerEmail).toBeNull()
    expect(offer?.customerPhone).toBeNull()
  })
})


describe('offer pages do not prefill a warning or current account identity as historical customer data', () => {
  it('renders historical A in the portal document while replying from the current login email', async () => {
    const tree = await PortalOfferDetailPage({ params: Promise.resolve({ offerId: quoteId }) })
    const document = elementList(tree).find(node => node.type === PublicOfferPage)!
    expect(document.props.customerName).toBe(original.billingName)
    expect(document.props.defaultCustomerEmail).toBe(current.email)
    expect(document.props.defaultCustomerPhone).toBeNull()
    expect(elementList(tree).find(node => node.type === 'p' &&
      node.props.children === 'Original street A, 12345 Original city A, CZ')).toBeDefined()
  })
  it('renders a separate portal legacy notice and keeps the current login email for a new reply', async () => {
    quote.customer_identity_state = 'legacy_unknown'
    const tree = await PortalOfferDetailPage({ params: Promise.resolve({ offerId: quoteId }) })
    const nodes = elementList(tree), document = nodes.find(node => node.type === PublicOfferPage)!
    expect(nodes.find(node => node.props.role === 'status')?.props.children).toBe(QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL)
    expect(document.props.customerName).toBeNull()
    expect(document.props.defaultCustomerEmail).toBe(current.email)
    expect(document.props.defaultCustomerPhone).toBeNull()
  })
  it('renders public NULL as a separate notice, without adding identity fields to public RPCs', async () => {
    const rpc = vi.fn((name: string) => name === 'get_public_offer_by_token'
      ? { maybeSingle: async () => ({ data: { ...quote, customer_name: null }, error: null }) }
      : Promise.resolve({ data: [], error: null }))
    mocks.public.mockReturnValue({ rpc })
    const tree = await PublicOfferDetailPage({ params: Promise.resolve({ token: 'synthetic-token' }) })
    const nodes = elementList(tree), document = nodes.find(node => node.type === PublicOfferPage)!
    expect(nodes.find(node => node.props.role === 'status')?.props.children).toBe(QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL)
    expect(document.props.customerName).toBeNull()
    expect(document.props.defaultCustomerEmail).toBeUndefined()
    expect(document.props.defaultCustomerPhone).toBeUndefined()
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['get_public_offer_by_token', 'get_public_offer_items_by_token'])
  })
})
