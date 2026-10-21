import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ cookie: vi.fn(), setCookie: vi.fn(), getUser: vi.fn(), from: vi.fn(), office: vi.fn(),
  refreshCookies: vi.fn(), platformAdmin: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie, set: mocks.setCookie }) }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`) },
  notFound: () => { throw new Error('not-found') },
}))
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('@/components/DashboardShell', () => ({ default: 'DashboardShell' }))
vi.mock('@/lib/i18n/server', async () => {
  const { getDictionary } = await import('../lib/i18n/dictionaries')
  return { getRequestDictionary: async () => getDictionary('cs'), getRequestLocale: async () => 'cs' }
})
vi.mock('@/lib/email/listEntityThreadMessages', () => ({ listEntityThreadMessages: async () => ({ feedItems: [] }) }))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}))
vi.mock('@/lib/office/availability', () => ({ readOfficeAvailability: mocks.office }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: unknown }) => ({
    auth: { getUser: async () => { mocks.refreshCookies(options.cookies); return mocks.getUser() } }, from: mocks.from,
  }),
}))
vi.mock('@/lib/platform/platform-admin', () => ({ hasPlatformAdminAccess: mocks.platformAdmin }))

import { getActiveCompanyContext, getCompanySwitchMemberships } from '../lib/active-company'
import { requireCompanyRole, requireWorkerAccess } from '../lib/server-guards'
import { requireHubAccess } from '../lib/require-hub-access'
import { GET, POST } from '../app/api/active-company/route'
import { POST as switchOfficeCompany } from '../app/api/office/company/route'
import { COMPANY_MEMBER_ROLES } from '../lib/hub-access'
import { requireOfficeContext } from '../lib/office/context'
import DashboardPage from '../app/(dashboard)/page'
import DashboardLayout from '../app/(dashboard)/layout'
import CustomerDetailPage from '../app/customers/[customerId]/page'
import CompanyOnboardingPage from '../app/onboarding/company/page'
import CompanySelectionRecovery from '../app/onboarding/company/CompanySelectionRecovery'
import CompanyOnboardingForm from '../app/onboarding/company/CompanyOnboardingForm'
import { selectExistingCompany } from '../app/onboarding/company/select-company'
import { proxy } from '../proxy'

type Row = Record<string, unknown>
type Query = { table: string; filters: Array<[string, unknown]>; includes: Array<[string, unknown[]]> }
let rows: Record<string, Row[]>
let queries: Query[]
let failures: Set<string>
let missingCustomerColumns: boolean
const A = 'a0000000-0000-4000-8000-000000000001'
const B = 'b0000000-0000-4000-8000-000000000002'
const FOREIGN = 'f0000000-0000-4000-8000-000000000003'
const PROFILE = 'p-A'

function elements(node: unknown): Array<{ type: unknown; props: Row }> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement<Row>(node)) return []
  return [{ type: node.type, props: node.props }, ...elements(node.props.children)]
}

function member(companyId: string, role: string, active = true): Row {
  return { id: `membership-${companyId}`, company_id: companyId, profile_id: PROFILE, role, is_active: active,
    companies: { id: companyId, name: companyId === A ? 'Company A' : 'Company B', timezone: 'Europe/Prague' } }
}

function mockQuery(table: string) {
  const query: Query = { table, filters: [], includes: [] }
  queries.push(query)
  let single = false
  let limit: number | undefined
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { query.filters.push([key, value]); return builder },
    in: (key: string, values: unknown[]) => { query.includes.push([key, values]); return builder },
    order: () => builder,
    limit: (value: number) => { limit = value; return builder },
    maybeSingle: () => { single = true; return builder },
    then: (resolve: (value: { data: Row[] | Row | null; error: null | { message: string } }) => unknown) => {
      if (table === 'customers' && missingCustomerColumns) {
        missingCustomerColumns = false
        return Promise.resolve(resolve({ data: null, error: { message: 'column customers.billing_name does not exist' } }))
      }
      const result = (rows[table] ?? []).filter(row => query.filters.every(([key, value]) => row[key] === value)
        && query.includes.every(([key, values]) => values.includes(row[key])))
      const data = limit === undefined ? result : result.slice(0, limit)
      return Promise.resolve(resolve({ data: single ? data[0] ?? null : data,
        error: failures.has(table) ? { message: 'synthetic unavailable' } : null }))
    },
  }
  return builder
}

function request(companyId: unknown, path = '/api/active-company') {
  return new Request(`https://diriqo.example${path}`, { method: 'POST',
    headers: { origin: 'https://diriqo.example', host: 'diriqo.example', 'content-type': 'application/json' },
    body: JSON.stringify({ companyId }) })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('React', React)
  vi.stubEnv('OFFICE_PUBLIC_ORIGIN', 'https://diriqo.example')
  queries = []
  failures = new Set()
  missingCustomerColumns = false
  rows = {
    profiles: [{ id: PROFILE, auth_user_id: 'auth-A', user_id: 'auth-A', full_name: 'Synthetic user', email: 'user@example.invalid' }],
    company_members: [member(A, 'company_admin'), member(B, 'worker')],
    jobs: [{ company_id: A }],
    office_settings: [{ company_id: A, enabled: true }, { company_id: B, enabled: true }],
  }
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'auth-A' } }, error: null })
  mocks.cookie.mockReturnValue({ value: B })
  mocks.from.mockImplementation(mockQuery)
  mocks.office.mockResolvedValue(true)
  mocks.platformAdmin.mockResolvedValue(true)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('real active company resolver and guards', () => {
  it('does not replace selected worker B with administrator A', async () => {
    expect(await getActiveCompanyContext()).toBeNull()
    expect(await requireCompanyRole('company_admin', 'super_admin')).toMatchObject({ ok: false, status: 403 })
    expect(await requireWorkerAccess()).toMatchObject({ ok: true, value: { companyId: B, role: 'worker' } })
    expect(queries.some(query => query.table === 'jobs')).toBe(false)
  })

  it('keeps a trimmed explicit administrator selection despite another latest-job company', async () => {
    rows.company_members[1] = member(B, ' Company_Admin ')
    mocks.cookie.mockReturnValue({ value: ` ${B} ` })
    expect(await getActiveCompanyContext()).toMatchObject({ companyId: B })
    expect(queries.some(query => query.table === 'jobs')).toBe(false)
  })

  it('reauthorizes the selected company after its membership is revoked', async () => {
    expect(await getActiveCompanyContext({ allowedRoles: COMPANY_MEMBER_ROLES })).toMatchObject({ companyId: B })
    rows.company_members[1].is_active = false
    expect(await getActiveCompanyContext({ allowedRoles: COMPANY_MEMBER_ROLES })).toBeNull()
    expect(await getActiveCompanyContext()).toBeNull()
    expect(queries.some(query => query.table === 'jobs')).toBe(false)
  })

  it.each([FOREIGN, 'not-a-company', `${B}%20`])('rejects unknown explicit selection %s without another-company fallback', async cookie => {
    mocks.cookie.mockReturnValue({ value: cookie })
    expect(await getActiveCompanyContext({ allowedRoles: COMPANY_MEMBER_ROLES })).toBeNull()
    expect(queries.some(query => query.table === 'jobs')).toBe(false)
  })

  it.each([undefined, '', '   '])('preserves the authorized no-cookie fallback for %j', async cookie => {
    mocks.cookie.mockReturnValue(cookie === undefined ? undefined : { value: cookie })
    expect(await getActiveCompanyContext()).toMatchObject({ companyId: A })
    rows.company_members[1] = member(B, 'company_admin')
    rows.jobs = [{ company_id: B }]
    expect(await getActiveCompanyContext()).toMatchObject({ companyId: B })
    expect(queries.find(query => query.table === 'jobs')?.includes).toEqual([['company_id', [A, B]]])
    rows.jobs = []
    expect(await getActiveCompanyContext()).toMatchObject({ companyId: A })
  })

  it('redirects a worker-selected dashboard to work without changing company', async () => {
    await expect(requireHubAccess()).rejects.toThrow('redirect:/moje-prace')
    expect(queries.some(query => query.table === 'jobs')).toBe(false)
    expect(await GET()).toMatchObject({ status: 200 })
    expect(await (await GET()).json()).toMatchObject({ companyId: B, role: 'worker' })
  })

  it.each([
    () => DashboardLayout({ children: null }),
    () => DashboardPage({ searchParams: Promise.resolve({}) }),
  ])('keeps both actual dashboard entrypoints on the worker path %#', async invoke => {
    await expect(invoke()).rejects.toThrow('redirect:/moje-prace')
    expect(queries.every(query => ['profiles', 'company_members'].includes(query.table))).toBe(true)
  })

  it('stops the actual customer page before business queries when selected company is denied', async () => {
    await expect(CustomerDetailPage({ params: Promise.resolve({ customerId: 'customer-A' }) })).rejects.toThrow('not-found')
    expect(queries.every(query => ['profiles', 'company_members'].includes(query.table))).toBe(true)
  })

  it('cannot open a customer of A while an authorized manager context selects B', async () => {
    rows.company_members[1] = member(B, 'manager')
    rows.customers = [{ id: 'customer-A', company_id: A, name: 'Private customer A' }]
    await CustomerDetailPage({ params: Promise.resolve({ customerId: 'customer-A' }) })
    expect(queries.find(query => query.table === 'customers')?.filters).toContainEqual(['company_id', B])
    expect(queries.some(query => ['customer_contacts', 'jobs_with_state', 'calculations', 'quotes'].includes(query.table))).toBe(false)
  })

  it.each([false, true])('keeps customer queries tenant-scoped and fails closed when billing columns are missing=%s', async legacy => {
    rows.company_members[1] = member(B, 'manager')
    rows.customers = [{ id: 'customer-B', company_id: B, name: 'Customer B', created_at: '2026-10-18T10:00:00Z' }]
    missingCustomerColumns = legacy
    expect(await CustomerDetailPage({ params: Promise.resolve({ customerId: 'customer-B' }) })).toBeDefined()
    const customerQueries = queries.filter(query => query.table === 'customers')
    expect(customerQueries).toHaveLength(legacy ? 1 : 3)
    for (const query of customerQueries) expect(query.filters).toContainEqual(['company_id', B])
    expect(queries.some(query => query.table === 'customer_contacts')).toBe(!legacy)
  })

  it('excludes inconsistent foreign-company child rows from the selected customer page', async () => {
    rows.company_members[1] = member(B, 'manager')
    rows.customers = [{ id: 'customer-B', company_id: B, name: 'Customer B', created_at: '2026-10-18T10:00:00Z' }]
    for (const table of ['customer_contacts', 'jobs_with_state', 'calculations', 'quotes']) {
      rows[table] = [A, B].map(company_id => ({ id: `${table}-${company_id}`, company_id, customer_id: 'customer-B',
        name: company_id === A ? 'FOREIGN PRIVATE CHILD' : 'Allowed child',
        full_name: company_id === A ? 'FOREIGN PRIVATE CHILD' : 'Allowed child',
        title: company_id === A ? 'FOREIGN PRIVATE CHILD' : 'Allowed child',
        quote_number: 'SYNTHETIC', status: 'draft', total_price: 10, created_at: '2026-10-18T10:00:00Z' }))
    }
    const page = await CustomerDetailPage({ params: Promise.resolve({ customerId: 'customer-B' }) })
    expect(JSON.stringify(page)).not.toContain('FOREIGN PRIVATE CHILD')
    expect(JSON.stringify(page)).toContain('Allowed child')
    for (const table of ['customer_contacts', 'jobs_with_state', 'calculations', 'quotes']) {
      expect(queries.find(query => query.table === table)?.filters).toContainEqual(['company_id', B])
    }
  })

  it('does not authorize partial membership data when the query failed', async () => {
    failures.add('company_members')
    expect(await requireWorkerAccess()).toMatchObject({ ok: false, status: 403 })
  })

  it('does not query company data without verified Auth', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect(await getActiveCompanyContext()).toBeNull()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('explicit unavailable-company recovery through the actual onboarding page and form action', () => {
  it('offers remaining live memberships without selecting a tenant or reading business data', async () => {
    rows.company_members[1].is_active = false
    await expect(requireHubAccess()).rejects.toThrow('redirect:/onboarding/company')
    const page = await CompanyOnboardingPage({})
    const recovery = elements(page).find(element => element.type === CompanySelectionRecovery)
    expect(recovery?.props.companies).toEqual([{ companyId: A, companyName: 'Company A' }])
    const recoveryForm = CompanySelectionRecovery(recovery!.props as React.ComponentProps<typeof CompanySelectionRecovery>)
    expect(elements(recoveryForm).find(element => element.type === 'form')?.props.action).toBe(selectExistingCompany)
    expect(elements(recoveryForm).filter(element => element.type === 'button').map(element => ({
      name: element.props.name, value: element.props.value, type: element.props.type,
    }))).toEqual([{ name: 'companyId', value: A, type: 'submit' }])
    expect(elements(page).some(element => element.type === CompanyOnboardingForm)).toBe(false)
    expect(queries.every(query => ['profiles', 'company_members'].includes(query.table))).toBe(true)
    expect(mocks.setCookie).not.toHaveBeenCalled()

    const formData = new FormData()
    formData.set('companyId', A)
    await expect(selectExistingCompany(formData)).rejects.toThrow('redirect:/')
    expect(mocks.setCookie).toHaveBeenCalledWith(expect.objectContaining({ name: 'active_company_id', value: A }))
  })

  it('reauthorizes the clicked membership and refuses revocation after choices were rendered', async () => {
    mocks.cookie.mockReturnValue({ value: FOREIGN })
    expect(await getCompanySwitchMemberships()).toHaveLength(2)
    rows.company_members[0].is_active = false
    const formData = new FormData()
    formData.set('companyId', A)
    await expect(selectExistingCompany(formData)).rejects.toThrow('redirect:/onboarding/company?selection=unavailable')
    expect(mocks.setCookie).not.toHaveBeenCalled()
  })

  it('lets a remaining worker membership recover to work without administrator privileges', async () => {
    mocks.cookie.mockReturnValue({ value: FOREIGN })
    const formData = new FormData()
    formData.set('companyId', B)
    await expect(selectExistingCompany(formData)).rejects.toThrow('redirect:/moje-prace')
    expect(mocks.setCookie).toHaveBeenCalledWith(expect.objectContaining({ value: B }))
  })

  it.each([false, true])('keeps no-cookie company onboarding with an existing worker membership=%s', async existingWorker => {
    mocks.cookie.mockReturnValue(undefined)
    rows.company_members = existingWorker ? [member(B, 'worker')] : []
    const page = await CompanyOnboardingPage({})
    expect(elements(page).some(element => element.type === CompanyOnboardingForm)).toBe(true)
    expect(elements(page).some(element => element.type === CompanySelectionRecovery)).toBe(false)
  })

  it('does not list memberships or accept a recovery choice without verified Auth', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect(await getCompanySwitchMemberships()).toEqual([])
    const formData = new FormData()
    formData.set('companyId', A)
    await expect(selectExistingCompany(formData)).rejects.toThrow('redirect:/onboarding/company?selection=unavailable')
    expect(mocks.setCookie).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('actual proxy recovery navigation', () => {
  it.each(['/', '/moje-prace', '/mobile/my'])('offers recovery from %s when only a worker membership remains', async path => {
    rows.company_members = [member(A, 'worker'), member(B, 'worker', false)]
    const response = await proxy(new NextRequest(`https://diriqo.example${path}`, { headers: { cookie: `active_company_id=${B}` } }))
    expect(response.headers.get('location')).toBe('https://diriqo.example/onboarding/company')
    expect(response.cookies.get('active_company_id')).toBeUndefined()
    expect(queries.every(query => ['profiles', 'company_members'].includes(query.table))).toBe(true)
  })

  it.each(['/api/active-company', '/api/office/company'])('leaves explicit API recovery reachable at %s', async path => {
    rows.company_members = [member(A, 'worker')]
    const response = await proxy(new NextRequest(`https://diriqo.example${path}`, {
      method: 'POST', headers: { cookie: `active_company_id=${B}` },
    }))
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it.each(['/logout', '/onboarding/company', '/sign-in', '/portal', '/admin'])('preserves the independent route %s with an unavailable company cookie', async path => {
    rows.company_members = []
    rows.customer_portal_users = [{ id: 'portal-user', auth_user_id: 'auth-A', is_active: true }]
    const response = await proxy(new NextRequest(`https://diriqo.example${path}`, { headers: { cookie: `active_company_id=${FOREIGN}` } }))
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(queries.some(query => query.table === 'company_members')).toBe(false)
    expect(mocks.platformAdmin).toHaveBeenCalledTimes(path === '/admin' ? 1 : 0)
  })

  it('preserves refreshed authentication cookies when redirecting to recovery', async () => {
    mocks.refreshCookies.mockImplementation((cookies: { set: (name: string, value: string, options: object) => void }) => {
      cookies.set('sb-synthetic-auth', 'synthetic-refreshed-value', { path: '/', httpOnly: true, secure: true, sameSite: 'lax' })
    })
    const response = await proxy(new NextRequest('https://diriqo.example/', { headers: { cookie: `active_company_id=${FOREIGN}` } }))
    expect(response.headers.get('location')).toBe('https://diriqo.example/onboarding/company')
    expect(response.cookies.get('sb-synthetic-auth')).toMatchObject({
      value: 'synthetic-refreshed-value', path: '/', httpOnly: true, secure: true, sameSite: 'lax',
    })
    expect(response.cookies.get('active_company_id')).toBeUndefined()
  })

  it('preserves both valid worker navigation and the no-cookie role redirect', async () => {
    rows.company_members = [member(B, 'worker')]
    const selected = await proxy(new NextRequest('https://diriqo.example/moje-prace', { headers: { cookie: `active_company_id=${B}` } }))
    expect(selected.headers.get('x-middleware-next')).toBe('1')
    const unselected = await proxy(new NextRequest('https://diriqo.example/'))
    expect(unselected.headers.get('location')).toBe('https://diriqo.example/moje-prace')
  })
})

describe('real company selection routes', () => {
  it('GET and the role guard agree on the cookie-selected company', async () => {
    expect(await (await GET()).json()).toMatchObject({ companyId: B, role: 'worker' })
    expect(mocks.office).toHaveBeenCalledWith(B)
    expect(await requireCompanyRole('company_admin')).toMatchObject({ ok: false, status: 403 })
  })

  it.each([FOREIGN, B])('permits an explicit live target after unavailable cookie %s', async cookie => {
    mocks.cookie.mockReturnValue({ value: cookie })
    rows.company_members[1].is_active = false
    const response = await POST(request(A))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ companyId: A })
    expect(response.cookies.get('active_company_id')?.value).toBe(A)
    expect(queries.some(query => query.table === 'jobs')).toBe(false)
  })

  it('permits selecting worker B without granting it administrator access', async () => {
    mocks.cookie.mockReturnValue({ value: A })
    const response = await POST(request(B))
    expect(response.status).toBe(200)
    mocks.cookie.mockReturnValue({ value: response.cookies.get('active_company_id')?.value })
    expect(await requireCompanyRole('company_admin')).toMatchObject({ ok: false, status: 403 })
  })

  it.each([FOREIGN, '', null, 42, { id: A }])('rejects an unavailable or malformed new target %j', async companyId => {
    const response = await POST(request(companyId))
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.cookies.get('active_company_id')).toBeUndefined()
  })

  it('refuses selection when the verified user has no active target membership', async () => {
    rows.company_members[0].is_active = false
    const response = await POST(request(A))
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.cookies.get('active_company_id')).toBeUndefined()
  })

  it('lets Office recover from an unavailable old cookie through a verified target', async () => {
    mocks.cookie.mockReturnValue({ value: FOREIGN })
    const response = await switchOfficeCompany(request(A, '/api/office/company'))
    expect(await response.json()).toEqual({ companyId: A, companyName: 'Company A' })
    expect(response.status).toBe(200)
    expect(response.cookies.get('active_company_id')?.value).toBe(A)
  })

  it.each(['membership', 'identity', 'enabled'])('Office recovery retains the target %s check', async boundary => {
    mocks.cookie.mockReturnValue({ value: FOREIGN })
    if (boundary === 'membership') rows.company_members[0].is_active = false
    if (boundary === 'identity') rows.profiles[0].user_id = 'other-auth'
    if (boundary === 'enabled') rows.office_settings[0].enabled = false
    const response = await switchOfficeCompany(request(A, '/api/office/company'))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: boundary === 'identity' ? 'OFFICE_IDENTITY_MISMATCH'
      : boundary === 'enabled' ? 'OFFICE_DISABLED' : 'OFFICE_FORBIDDEN' })
    expect(response.cookies.get('active_company_id')).toBeUndefined()
  })

  it('does not let the Office switch recovery relax ordinary Office context checks', async () => {
    mocks.cookie.mockReturnValue({ value: FOREIGN })
    await expect(requireOfficeContext()).rejects.toThrow('OFFICE_FORBIDDEN')
    mocks.cookie.mockReturnValue({ value: B })
    expect(await requireOfficeContext()).toMatchObject({ actor: { tenantId: B, role: 'reader' } })
    await expect(requireOfficeContext(true)).rejects.toThrow('OFFICE_FORBIDDEN')
  })

  it('Office refuses an untrusted origin before any identity or membership work', async () => {
    const hostile = request(A, '/api/office/company')
    hostile.headers.set('origin', 'https://foreign.example')
    expect((await switchOfficeCompany(hostile)).status).toBe(403)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it.each([POST, switchOfficeCompany])('does not switch companies without verified Auth %#', async invoke => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await invoke(request(A))
    expect(response.status).toBe(403)
    expect(response.cookies.get('active_company_id')).toBeUndefined()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
