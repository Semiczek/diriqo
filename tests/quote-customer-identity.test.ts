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
import { getPortalOfferDetail, mapPortalOfferStatus } from '../lib/customer-portal/data'
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
import PortalOffersPage from '../app/portal/offers/page'
import PublicOfferDetailPage from '../app/offer/[token]/page'
function visibleText(value: unknown): string { if (typeof value === 'string' || typeof value === 'number') return String(value); if (Array.isArray(value)) return value.map(visibleText).join(' '); return React.isValidElement<{children?: unknown}>(value) ? visibleText(value.props.children) : '' }
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

import { quoteDocumentFixture, VERSION_FIXTURE_ID } from './fixtures/core-quote-document'
import type { CoreQuoteDocumentRead } from '../lib/core-quote-lifecycle'
let read: CoreQuoteDocumentRead
const rpc = vi.fn()
const forbiddenFrom = vi.fn(() => { throw new Error('No current-row fallback permitted') })
const pdfHex = (text: string) => Array.from(text).map(char => char.charCodeAt(0).toString(16).padStart(4, '0')).join('')
const requestPdf = (query = '?versionId=' + VERSION_FIXTURE_ID) => GET(new NextRequest('https://example.invalid/api/quotes/' + quoteId + '/pdf' + query), { params: Promise.resolve({ quoteId }) })
function legacy() {
  read.kind = 'legacy'; read.publishedAt = null; read.legacyCapturedAt = capturedAt
  Object.assign(read.document, { version_id: null, version_number: null, customer_identity_state: 'legacy_unknown', customer: { name: null }, pricing_mode: null })
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('React', React)
  read = quoteDocumentFixture()
  Object.assign(read.document, { id: quoteId, quote_id: quoteId, customer: {
    name: original.name, billing_name: original.billingName, company_number: original.companyNumber,
    vat_number: original.vatNumber, billing_street: original.billingStreet, billing_city: original.billingCity,
    billing_postal_code: original.billingPostalCode, billing_country: original.billingCountry, email: original.email, phone: original.phone,
  } })
  rpc.mockImplementation(async () => ({ data: read, error: null }))
  mocks.guard.mockResolvedValue({ ok: true, value: { companyId } })
  mocks.server.mockResolvedValue({ rpc, from: forbiddenFrom }); mocks.admin.mockReturnValue({ from: forbiddenFrom })
  mocks.public.mockReturnValue({ rpc })
})
afterEach(() => vi.unstubAllGlobals())

describe('version-bound customer identity in PDF and portal', () => {
  it('renders frozen A name/address/email with no current B row query', async () => {
    const response = await requestPdf()
    expect(response.status).toBe(200)
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
    for (const value of [original.billingName!, original.billingStreet!, original.email!, original.companyNumber!]) expect(pdf).toContain(pdfHex(value))
    for (const value of [current.name, current.billing_name, current.billing_street, current.email]) expect(pdf).not.toContain(pdfHex(value))
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_core_quote_version', { p_company_id: companyId, p_quote_id: quoteId, p_version_id: VERSION_FIXTURE_ID })
    expect(forbiddenFrom).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('labels the exact draft preview without creating a publication', async () => {
    read.kind = 'draft'; read.publishedAt = null
    Object.assign(read.document, { version_id: null, version_number: null, customer_identity_state: 'draft' })
    const response = await requestPdf('?draftRevision=3')
    expect(response.status).toBe(200)
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
    expect(pdf).toContain(pdfHex('KONCEPT - dosud nevydáno'))
    expect(pdf).toContain(pdfHex('Koncept - není vydanou nabídkou'))
    expect(rpc).toHaveBeenCalledWith('get_core_quote_draft_document', { p_company_id: companyId, p_quote_id: quoteId, p_expected_revision: '3' })
  })
  it('does not relabel an issued version after root status changes', async () => {
    read.status = 'draft'
    const response = await requestPdf()
    expect(response.status).toBe(200)
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
    expect(pdf).not.toContain(pdfHex('KONCEPT - dosud nevydáno'))
    expect(pdf).toContain(pdfHex('Verze 1'))
  })
  it('renders legacy uncertainty without current customer or invented version', async () => {
    legacy()
    const response = await requestPdf('?legacy=1')
    expect(response.status).toBe(200)
    const pdf = Buffer.from(await response.arrayBuffer()).toString('latin1')
    expect(pdf).toContain(pdfHex('Identita zákazníka v původní nabídce není doložena.'))
    expect(pdf).not.toContain(pdfHex(current.billing_name))
    expect(pdf).not.toContain(pdfHex('Verze 1'))
  })
  it.each(['missing-selector', 'two-selectors', 'foreign-version', 'failed-read', 'malformed-document'] as const)('fails closed for %s without fallback', async mode => {
    let selector = '?versionId=' + VERSION_FIXTURE_ID
    if (mode === 'missing-selector') selector = ''
    if (mode === 'two-selectors') selector += '&draftRevision=2'
    if (mode === 'foreign-version') read.document.version_id = companyId
    if (mode === 'failed-read') rpc.mockResolvedValue({ data: null, error: { message: 'Denied' } })
    if (mode === 'malformed-document') Object.assign(read.document, { customer_identity_state: 'invalid' })
    expect((await requestPdf(selector)).status).toBeGreaterThanOrEqual(400)
    expect(forbiddenFrom).not.toHaveBeenCalled()
  })
  it('rejects the guard before any data access', async () => {
    mocks.guard.mockResolvedValue({ ok: false, status: 403, error: 'Active company denied' })
    expect((await requestPdf()).status).toBe(403)
    expect(mocks.server).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('portal uses authenticated version RPC and never a service-role current-customer lookup', async () => {
    const offer = await getPortalOfferDetail(customerId, companyId, quoteId, VERSION_FIXTURE_ID)
    expect(offer?.customerName).toBe(original.billingName)
    expect(offer?.customerAddressLabel).toBe('Original street A, 12345 Original city A, CZ')
    expect(offer?.customerEmail).toBe(original.email)
    expect(offer?.customerPhone).toBe(original.phone)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_portal_core_quote_version', { p_company_id: companyId, p_customer_id: customerId, p_quote_id: quoteId, p_version_id: VERSION_FIXTURE_ID })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(forbiddenFrom).not.toHaveBeenCalled()
  })
  it('portal legacy read keeps missing identity missing', async () => {
    legacy()
    const offer = await getPortalOfferDetail(customerId, companyId, quoteId)
    expect(offer).toMatchObject({ customerIdentityState: 'legacy_unknown', customerName: null, customerAddressLabel: null, customerEmail: null, customerPhone: null })
  })
  it('portal renders historical A while the response email belongs to the current login', async () => {
    const tree = await PortalOfferDetailPage({ params: Promise.resolve({ offerId: quoteId }), searchParams: Promise.resolve({ versionId: VERSION_FIXTURE_ID }) })
    const document = elementList(tree).find(node => node.type === PublicOfferPage)!
    expect(document.props.customerName).toBe(original.billingName)
    expect(document.props.defaultCustomerEmail).toBe(current.email)
    expect(document.props.versionId).toBe(VERSION_FIXTURE_ID)
    expect(document.props.pdfHref).toContain(VERSION_FIXTURE_ID)
  })
  it('portal legacy page labels the historical capture and links its exact legacy PDF',async()=>{
    legacy();const tree=await PortalOfferDetailPage({params:Promise.resolve({offerId:quoteId}),searchParams:Promise.resolve({legacy:'1'})});
    const shown=elementList(tree).find(node=>node.type===PublicOfferPage)!;
    expect(shown.props).toMatchObject({versionId:null,preparedAt:null,canRespond:false,pdfHref:'/api/portal/offers/'+quoteId+'/pdf?legacy=1'});
    expect(visibleText(tree)).toContain('Starší nabídka');expect(visibleText(tree)).toContain('Dochovaný stav zachycen');expect(visibleText(tree)).toContain('nedokládá původní datum vydání');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_portal_core_quote_version',{p_company_id:companyId,p_customer_id:customerId,p_quote_id:quoteId,p_version_id:null});
  })
  it.each([{}, {legacy:'0'}, {versionId:VERSION_FIXTURE_ID,legacy:'1'}, {versionId:[VERSION_FIXTURE_ID,VERSION_FIXTURE_ID]}, {legacy:['1','1']}])('portal page rejects ambiguous or missing selection before reading records: %j',async query=>{
    await expect(PortalOfferDetailPage({params:Promise.resolve({offerId:quoteId}),searchParams:Promise.resolve(query)})).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();expect(forbiddenFrom).not.toHaveBeenCalled();
  })
  it('portal list links legacy explicitly and preserves the separate modern version link',async()=>{
    const issued=structuredClone(read);legacy();rpc.mockResolvedValue({data:[issued,read],error:null});
    const tree=await PortalOffersPage(),hrefs=elementList(tree).map(node=>node.props.href).filter(Boolean);
    expect(hrefs).toContain('/portal/offers/'+quoteId+'?versionId='+VERSION_FIXTURE_ID);expect(hrefs).toContain('/portal/offers/'+quoteId+'?legacy=1');
    expect(visibleText(tree)).toContain('Starší nabídka');expect(visibleText(tree)).toContain('Dochovaná historie');
  })
  it('public legacy document has a separate notice, no current customer default and one version read', async () => {
    legacy()
    const token = 'a'.repeat(64)
    const tree = await PublicOfferDetailPage({ params: Promise.resolve({ token }) })
    const nodes = elementList(tree), document = nodes.find(node => node.type === PublicOfferPage)!
    expect(nodes.find(node => node.props.role === 'status')?.props.children).toBe(QUOTE_CUSTOMER_IDENTITY_UNAVAILABLE_LABEL)
    expect(document.props.customerName).toBeNull()
    expect(document.props.defaultCustomerEmail).toBeUndefined()
    expect(document.props.canRespond).toBe(false)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_public_core_quote_version', { input_token: token })
  })
})


describe('portal lifecycle status labels', () => {
  it.each([['published','Publikovaná'],['revoked','Odkaz zneplatněn'],['archived','Archivovaná'],['superseded','Nahrazená'],['legacy','Dochovaná historie']])('does not present %s as a draft', (status,label) => {
    expect(mapPortalOfferStatus(status)).toBe(label)
  })
  it.each([['revoked','Odkaz zneplatněn'],['archived','Archivovaná'],['accepted','Schválená'],['rejected','Zamítnutá']])('retains %s instead of replacing its meaning with expiry', (status,label) => {
    expect(mapPortalOfferStatus(status,'2000-01-01')).toBe(label)
  })
})
