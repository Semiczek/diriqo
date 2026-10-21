import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), from: vi.fn(), revalidate: vi.fn(), active: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not-found') } }))
vi.mock('@/lib/dal/auth', () => ({ requireHubDalContext: mocks.guard }))
vi.mock('@/lib/active-company', () => ({ getActiveCompanyContext: mocks.active }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ from: mocks.from }) }))
vi.mock('@/components/DashboardShell', () => ({ default: 'DashboardShell' }))
vi.mock('@/lib/email/listEntityThreadMessages', () => ({ listEntityThreadMessages: async () => ({ feedItems: [] }) }))
vi.mock('@/lib/i18n/server', async () => {
  const { getDictionary } = await import('../lib/i18n/dictionaries')
  return { getRequestDictionary: async () => getDictionary('cs'), getRequestLocale: async () => 'cs' }
})
import { createCustomerAction, updateCustomerAction } from '../app/customers/actions'
import { loadCustomerBillingDetail } from '../lib/customer-billing'
import CustomerDetailPage from '../app/customers/[customerId]/page'

type Row = Record<string, unknown>
type Failure = { code: string; message: string }
type Query = { table: string; selection: string; filters: Array<[string, unknown]>; operation: 'read' | 'insert' | 'update'; payload?: Row }
const companyId = '11111111-1111-4111-8111-111111111111'
const customerId = '22222222-2222-4222-8222-222222222222'
const oldCheck = '2026-01-02T10:00:00Z'
const input = { name: ' Customer ', email: ' mail@example.invalid ', phone: ' 123456 ', billingName: ' Billing A ',
  billingStreet: ' Street A 10 ', billingCity: ' City A ', billingPostalCode: ' 10000 ', billingCountry: ' CZ ',
  companyNumber: '12 345 678', vatNumber: ' CZ12345678 ' }
const billing = { name: 'Customer', email: 'mail@example.invalid', phone: '123456', billing_name: 'Billing A',
  billing_street: 'Street A 10', billing_city: 'City A', billing_postal_code: '10000', billing_country: 'CZ',
  company_number: '12345678', vat_number: 'CZ12345678' }
let stored: Row
let queries: Query[]
let writeError: Failure | null
let billingError: Failure | null
let zeroUpdate: boolean
let web: Row | null
let legacy: Row | null
let webError: Failure | null
let legacyError: Failure | null
const missingWeb = { code: '42703', message: 'column customers.web_lead_source does not exist' }
const missingLegacy = { code: '42703', message: 'column customers.lead_contact_name does not exist' }
function query(table: string) {
  const q: Query = { table, selection: '', filters: [], operation: 'read' }
  queries.push(q)
  let single = false
  const result = () => {
    if (table !== 'customers') return { data: [], error: null }
    if (q.operation !== 'read') {
      if (writeError) return { data: null, error: writeError }
      if (q.operation === 'update' && zeroUpdate) return { data: null, error: null }
      if (q.operation === 'insert') stored = { id: customerId, ares_last_checked_at: null, ...q.payload }
      else Object.assign(stored, q.payload)
      return { data: { id: customerId }, error: null }
    }
    if (!q.filters.every(([key, value]) => stored[key] === value)) return { data: null, error: null }
    if (q.selection.startsWith('web_lead_')) return { data: web, error: webError }
    if (q.selection.startsWith('lead_')) return { data: legacy, error: legacyError }
    if (q.selection.includes('billing_name') && billingError) return { data: null, error: billingError }
    const row = Object.fromEntries(q.selection.split(',').map(field => [field.trim(), stored[field.trim()]]))
    return { data: single ? row : [row], error: null }
  }
  const builder = {
    select(value: string) { q.selection = value; return builder },
    insert(payload: Row) { q.operation = 'insert'; q.payload = payload; return builder },
    update(payload: Row) { q.operation = 'update'; q.payload = payload; return builder },
    eq(key: string, value: unknown) { q.filters.push([key, value]); return builder },
    order() { return builder }, limit() { return builder },
    maybeSingle() { single = true; return builder }, single() { single = true; return builder },
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
  }
  return builder
}
const context = () => ({ companyId, supabase: { from: mocks.from } })
const writes = () => queries.filter(q => q.operation !== 'read')
const readDetail = () => loadCustomerBillingDetail(context(), customerId)
function renderedText(value: unknown): string {
  if (Array.isArray(value)) return value.map(renderedText).join(' ')
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!React.isValidElement<{ children?: unknown }>(value)) return ''
  return renderedText(value.props.children)
}
beforeEach(() => {
  vi.clearAllMocks()
  queries = []; writeError = null; billingError = null; zeroUpdate = false
  stored = { id: customerId, company_id: companyId, created_at: oldCheck, ...billing, ares_last_checked_at: oldCheck }
  web = null; legacy = null; webError = null; legacyError = missingLegacy
  mocks.from.mockImplementation(query)
  mocks.guard.mockResolvedValue(context())
  mocks.active.mockResolvedValue({ companyId, profileId: 'verified-profile', role: 'company_admin' })
})

describe('customer saves preserve complete billing data', () => {
  it('creates all entered billing fields once without inventing an ARES verification', async () => {
    expect(await createCustomerAction(input)).toEqual({ ok: true, customerId })
    expect(writes()).toHaveLength(1)
    expect(writes()[0].payload).toEqual({ company_id: companyId, ...billing })
    expect(stored.ares_last_checked_at).toBeNull()
  })
  it('updates all billing fields once and preserves the previous ARES timestamp', async () => {
    stored.billing_street = 'Old street'
    expect(await updateCustomerAction({ ...input, customerId })).toEqual({ ok: true })
    expect(writes()).toHaveLength(1)
    expect(writes()[0].payload).toEqual(billing)
    expect(writes()[0].filters).toEqual([['id', customerId], ['company_id', companyId]])
    expect(stored.billing_street).toBe('Street A 10')
    expect(stored.ares_last_checked_at).toBe(oldCheck)
  })
  it.each(['create', 'update'] as const)('%s reports schema/write failures without retrying a stripped contact', async operation => {
    const before = { ...stored }
    for (const error of [
      { code: 'PGRST204', message: "Could not find the 'ares_last_checked_at' column" },
      { code: '42703', message: 'column customers.billing_street does not exist' },
      { code: '42501', message: 'row level security denied' },
    ]) {
      queries = []; mocks.revalidate.mockClear(); writeError = error
      const result = operation === 'create' ? await createCustomerAction(input) : await updateCustomerAction({ ...input, customerId })
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('fakturačních údajů') })
      expect(writes()).toHaveLength(1)
      expect(writes()[0].payload).toMatchObject(billing)
      expect(stored).toEqual(before)
      expect(mocks.revalidate).not.toHaveBeenCalled()
    }
  })
  it('rejects an update with no affected row instead of claiming success', async () => {
    zeroUpdate = true
    expect(await updateCustomerAction({ ...input, customerId })).toMatchObject({ ok: false })
    expect(writes()).toHaveLength(1)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each(['create', 'update'] as const)('%s stops before writing when auth is unavailable', async operation => {
    mocks.guard.mockRejectedValue(new Error('Přihlaste se znovu.'))
    const result = operation === 'create' ? await createCustomerAction(input) : await updateCustomerAction({ ...input, customerId })
    expect(result).toMatchObject({ ok: false })
    expect(queries).toHaveLength(0)
  })
  it('does not update a customer outside the selected company', async () => {
    stored.company_id = 'foreign-company'
    expect(await updateCustomerAction({ ...input, customerId })).toMatchObject({ ok: false })
    expect(writes()).toHaveLength(0)
  })
})

describe('billing reader is independent of optional lead schemas', () => {
  it('keeps the saved billing address when all optional lead fields are absent', async () => {
    webError = missingWeb
    const result = await readDetail()
    expect(result).toMatchObject({ customer: billing, error: null, leadMetadataUnavailable: false })
    expect(queries).toHaveLength(3)
    expect(queries[0].selection).not.toContain('lead_')
    for (const q of queries) expect(q.filters).toEqual([['id', customerId], ['company_id', companyId]])
  })
  it('reads the canonical web lead schema when legacy lead columns are absent', async () => {
    web = { web_lead_source: 'current-web', web_lead_locale: 'cs', web_lead_service_slug: 'cleaning', web_lead_message: 'Current inquiry' }
    expect(await readDetail()).toMatchObject({ customer: { ...billing, lead_source: 'current-web', lead_message: 'Current inquiry', lead_contact_name: null }, error: null })
  })
  it('retains historical lead metadata when only the old schema exists', async () => {
    webError = missingWeb; legacyError = null
    legacy = { lead_source: 'old-web', lead_contact_name: 'Historic contact', lead_message: 'Historic inquiry' }
    expect(await readDetail()).toMatchObject({ customer: { ...billing, ...legacy }, error: null })
  })
  it('does not mix fields of a newer canonical inquiry with an older legacy inquiry', async () => {
    web = { web_lead_source: 'current-web', web_lead_message: 'Current inquiry' }
    legacyError = null; legacy = { lead_contact_name: 'Old contact', lead_message: 'Old inquiry', lead_page_url: 'https://old.invalid/' }
    expect(await readDetail()).toMatchObject({ customer: { lead_source: 'current-web', lead_message: 'Current inquiry', lead_contact_name: null, lead_page_url: null } })
  })
  it('falls back to populated legacy metadata when canonical fields exist but are empty', async () => {
    web = { web_lead_source: null, web_lead_locale: null, web_lead_message: '' }
    legacyError = null; legacy = { lead_source: 'old-web', lead_message: 'Historic inquiry' }
    expect(await readDetail()).toMatchObject({ customer: { ...legacy }, error: null })
  })
  it('reports required billing read failures without an address-empty customer fallback', async () => {
    billingError = { code: '42703', message: 'column customers.billing_name does not exist' }
    expect(await readDetail()).toMatchObject({ customer: null, error: expect.stringContaining('Fakturační údaje') })
    expect(queries).toHaveLength(1)
  })
  it('reports a genuine optional metadata failure without losing the saved billing address', async () => {
    webError = { code: '42501', message: 'access denied' }
    expect(await readDetail()).toMatchObject({ customer: billing, error: null, leadMetadataUnavailable: true })
  })
  it('does not read lead metadata for a missing or foreign-company customer', async () => {
    stored.company_id = 'foreign-company'
    expect(await readDetail()).toMatchObject({ customer: null, error: null })
    expect(queries).toHaveLength(1)
  })
  it('renders the real customer page billing address even when both optional lead schemas are absent', async () => {
    webError = missingWeb
    const page = await CustomerDetailPage({ params: Promise.resolve({ customerId }) })
    const output = renderedText(page)
    for (const value of ['Billing A', 'Street A 10', 'City A', '10000']) expect(output).toContain(value)
    expect(output).not.toContain('Údaje webové poptávky se nepodařilo načíst.')
  })
  it('renders an explicit required billing error instead of a misleading blank customer detail', async () => {
    billingError = { code: '42703', message: 'column customers.billing_name does not exist' }
    const page = await CustomerDetailPage({ params: Promise.resolve({ customerId }) })
    expect(renderedText(page)).toContain('Fakturační údaje zákazníka se nepodařilo načíst.')
    expect(queries).toHaveLength(1)
  })
})
