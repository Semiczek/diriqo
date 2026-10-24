// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { csDictionary } from '../lib/i18n/dictionaries/cs'
import { buildJobEconomicsSummary, type JobEconomicsSummary } from '../lib/economics'
import { aggregateJobEconomics } from '../lib/job-grouping'
import { OFFICE_CONTEXT_EVENT } from '../lib/office/client-context'

const mocks = vi.hoisted(() => ({
  read: vi.fn(), from: vi.fn(), mutations: vi.fn(),
  router: { refresh: vi.fn(), replace: vi.fn(), push: vi.fn() },
  params: new URLSearchParams('month='),
}))
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router, usePathname: () => '/jobs', useSearchParams: () => mocks.params }))
vi.mock('next/link', () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement('a', { ...props, href }, children) }))
vi.mock('@/components/DashboardShell', () => ({ default: ({ children }: { children: ReactNode }) => createElement('div', null, children) }))
vi.mock('@/components/I18nProvider', () => ({ useI18n: () => ({ locale: 'cs', dictionary: csDictionary }) }))
vi.mock('@/components/JobPhotosSection', () => ({ default: () => null }))
vi.mock('@/components/JobCommunicationSection', () => ({ default: () => null }))
vi.mock('@/components/JobDangerZone', () => ({ default: () => null }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/app/jobs/economics-actions', () => ({ readJobEconomicsAction: mocks.read }))
vi.mock('@/app/jobs/actions', () => ({ createJobGroupFromDropAction: mocks.mutations }))
vi.mock('@/app/business-actions', () => ({
  createJobCostItemAction: mocks.mutations, deleteJobCostItemAction: mocks.mutations, updateJobPriceAction: mocks.mutations,
}))
import JobsPage from '../app/jobs/page'
import JobEconomicsSection from '../components/JobEconomicsSection'
import JobDetailPageClient from '../app/jobs/[jobId]/JobDetailPageClient'

const companyA = '11111111-1111-4111-8111-111111111111'
const companyB = '22222222-1111-4111-8111-111111111111'
const actor = '33333333-1111-4111-8111-111111111111'
const jobA = '44444444-1111-4111-8111-111111111111'
const jobB = '55555555-1111-4111-8111-111111111111'
let activeCompany = companyA
let root: Root
let container: HTMLDivElement
let queries: { table: string; filters: Record<string, unknown>; select: string }[]

function summary(jobId = jobA, companyId = companyA, extra: Partial<JobEconomicsSummary> = {}): JobEconomicsSummary {
  return { ...buildJobEconomicsSummary({ jobId, companyId, quotedRevenue: 1000, invoicedRevenue: 1000,
    laborHours: 1, internalLaborCost: 100, externalLaborCost: 0, directCost: 10, currency: 'CZK' }), ...extra }
}
function job(companyId: string) {
  return { id: companyId === companyA ? jobA : jobB, company_id: companyId, currency: 'CZK',
    title: companyId === companyA ? 'Zakázka A' : 'Zakázka B', status: 'new', price: 1000, parent_job_id: null,
    start_at: '2026-10-24T08:00:00Z', end_at: '2026-10-24T09:00:00Z', created_at: '2026-10-24T08:00:00Z',
    work_state: 'not_started', time_state: 'future', billing_state_resolved: 'not_ready', assigned_total: 0, active_workers: 0 }
}
function setupQueries() {
  mocks.from.mockImplementation((table: string) => {
    const query = { table, filters: {} as Record<string, unknown>, select: '' }
    queries.push(query)
    const builder = {
      select(value: string) { query.select = value; return builder },
      eq(key: string, value: unknown) { query.filters[key] = value; return builder },
      in(key: string, value: unknown) { query.filters[key] = value; return builder },
      is() { return builder }, not() { return builder }, order() { return builder },
      then(resolve: (value: unknown) => unknown) {
        const companyId = String(query.filters.company_id ?? activeCompany)
        const data = table === 'jobs_with_state' ? [job(companyId)] : table === 'jobs' ? [{ id: job(companyId).id, parent_job_id: null }] : []
        return Promise.resolve({ data, error: null }).then(resolve)
      },
    }
    return builder
  })
}
async function mount(element: ReactNode) { await act(async () => { root.render(element) }) }
async function flush() { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  activeCompany = companyA; queries = []
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ companyId: activeCompany, profileId: actor, role: 'company_admin', timeZone: 'Europe/Prague' }) })))
  setupQueries()
  mocks.read.mockImplementation(async input => ({ ok: true, companyId: input.companyId, profileId: input.profileId,
    summaries: input.jobIds.map((id: string) => summary(id, input.companyId)) }))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

describe('job group economics', () => {
  it('includes parent revenue once and costs from both parent and child', () => {
    const parent = summary()
    const child = summary(jobB, companyA, { quoted_revenue_total: 0, revenue_total: 0 })
    const result = aggregateJobEconomics([parent, child], [jobA, jobB], 'CZK')
    expect(result).toMatchObject({ quoted_revenue_total: 1000, revenue_total: 1000, total_cost_total: 220, profit_total: 780 })
  })
  it('does not treat an incomplete child as zero cost or a profitable group', () => {
    const child = summary(jobB, companyA, { labor_completeness: 'incomplete', labor_cost_total: null, total_cost_total: null,
      profit_total: null, margin_percent: null, labor_cost_reasons: ['missing_rate'], missing_rate_hours: 2 })
    expect(aggregateJobEconomics([summary(), child], [jobA, jobB], 'CZK')).toMatchObject({
      labor_completeness: 'incomplete', total_cost_total: null, profit_total: null, margin_percent: null, missing_rate_hours: 2, known_cost_total: 220,
    })
  })
  it('refuses mixed currencies, tenants, missing or duplicate child rows', () => {
    for (const rows of [[summary()], [summary(), summary()], [summary(), summary(jobB, companyB)],
      [summary(), summary(jobB, companyA, { currency: 'EUR' })]]) {
      expect(aggregateJobEconomics(rows, [jobA, jobB], 'CZK')).toBeNull()
    }
  })
})

describe('economic React consumers', () => {
  it('loads jobs with company filters and reads economics only through the scoped action', async () => {
    await mount(createElement(JobsPage)); await flush()
    expect(container.textContent).toContain('Zakázka A')
    expect(mocks.read).toHaveBeenCalledWith({ companyId: companyA, profileId: actor, jobIds: [jobA] })
    expect(queries.some(query => query.table === 'job_economics_summary')).toBe(false)
    expect(queries.filter(query => ['jobs', 'jobs_with_state', 'customers', 'job_assignments', 'work_shifts'].includes(query.table))
      .every(query => query.filters.company_id === companyA)).toBe(true)
    expect(queries.every(query => !query.select.includes('default_hourly_rate'))).toBe(true)
  })
  it('discards a delayed company A action after switching to company B', async () => {
    let release!: (value: unknown) => void
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    await mount(createElement(JobsPage)); await flush()
    expect(mocks.read).toHaveBeenCalledOnce()
    activeCompany = companyB
    await act(async () => window.dispatchEvent(new Event(OFFICE_CONTEXT_EVENT)))
    await flush()
    expect(container.textContent).toContain('Zakázka B')
    await act(async () => release({ ok: true, companyId: companyA, profileId: actor, summaries: [summary()] }))
    await flush()
    expect(container.textContent).toContain('Zakázka B')
    expect(container.textContent).not.toContain('Zakázka A')
  })
  it('rejects an action acknowledgement for another actor', async () => {
    mocks.read.mockResolvedValue({ ok: true, companyId: companyA, profileId: companyB, summaries: [summary()] })
    await mount(createElement(JobsPage)); await flush()
    expect(container.textContent).not.toContain('Zakázka A')
    expect(container.textContent).toContain(csDictionary.jobs.loadError)
  })
  it('preserves unknown profit and the warning when opening the actual cost editor', async () => {
    const incomplete = summary(jobA, companyA, { labor_completeness: 'incomplete', labor_cost_total: null, total_cost_total: null,
      profit_total: null, margin_percent: null, labor_cost_reasons: ['missing_rate'], missing_rate_hours: 2 })
    await mount(createElement(JobEconomicsSection, { jobId: jobA, companyId: companyA, price: 1000, assignments: [], costItems: [],
      accountingRevenue: 1000, laborCost: 100, externalLaborCost: 0, otherCosts: 0, profit: null, summary: incomplete }))
    expect(container.textContent).toContain('Náklady práce nejsou úplné')
    expect(container.textContent).toContain('Hodiny bez sazby: 2')
    const profitTile = [...container.querySelectorAll('div')].find(node => node.firstElementChild?.textContent === csDictionary.jobs.profit)
    expect(profitTile?.lastElementChild?.textContent).toBe('—')
    await act(async () => container.querySelector('button')!.click())
    expect(container.textContent).toContain('Náklady práce nejsou úplné')
    expect(container.textContent).not.toContain('900,00')
    expect(container.textContent).toContain('Pouze plán přiřazení')
  })
  it('renders financial amounts in the job currency and preserves an explicit zero', async () => {
    await mount(createElement(JobEconomicsSection, { jobId: jobA, companyId: companyA, price: 0, assignments: [], costItems: [],
      accountingRevenue: 0, laborCost: 0, externalLaborCost: 0, otherCosts: 0, profit: 0, summary: summary(jobA, companyA, { currency: 'EUR' }) }))
    expect(container.textContent).toContain('€')
    expect(container.textContent).not.toContain('Kč')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
})


describe('job detail financial snapshot', () => {
  function props(economics = summary()) {
    return {
      jobId: jobA, referenceTime: Date.parse('2026-10-24T12:00:00Z'), initialActorProfileId: actor, initialActorRole: 'company_admin',
      initialJob: { id: jobA, company_id: companyA, currency: 'CZK', title: 'Zakázka A', description: null, status: 'new',
        price: 1000, is_paid: false, customer_id: null, start_at: null, end_at: null },
      initialJobState: null, initialCustomer: null, initialMainCustomerContact: null, initialJobCustomerContacts: [],
      initialAssignments: [], initialWorkShifts: [], initialGroupParentJob: null, initialGroupMemberJobs: [],
      initialGroupMemberJobStates: [], initialGroupWorkShifts: [], initialGroupEconomicsSummaries: [],
      initialWorkLogs: [], initialCostItems: [], initialJobEconomicsSummary: economics, initialCommunicationFeed: [],
      canManageCommunication: false, canManageJobPhotos: false,
    }
  }
  it('displays unknown profit consistently in the detail and cost section', async () => {
    const incomplete = summary(jobA, companyA, { labor_completeness: 'incomplete', labor_cost_total: null, total_cost_total: null,
      profit_total: null, margin_percent: null, labor_cost_reasons: ['missing_rate'], missing_rate_hours: 2 })
    await mount(createElement(JobDetailPageClient, props(incomplete))); await flush()
    expect(container.textContent).toContain('Zakázka A')
    expect(container.textContent).toContain('Náklady práce nejsou úplné')
    const profitTiles = [...container.querySelectorAll('div')].filter(node => node.firstElementChild?.textContent === csDictionary.jobs.profit)
    expect(profitTiles.length).toBeGreaterThan(0)
    expect(profitTiles.every(node => node.lastElementChild?.textContent === '—')).toBe(true)
    expect(queries.find(query => query.table === 'company_members')?.filters.company_id).toBe(companyA)
  })
  it('hides the complete old financial snapshot when role changes on focus', async () => {
    await mount(createElement(JobDetailPageClient, props())); await flush()
    expect(container.textContent).toContain('Zakázka A')
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ companyId: companyA, profileId: actor, role: 'worker' }) } as Response)
    await act(async () => window.dispatchEvent(new Event('focus'))); await flush()
    expect(container.textContent).toContain('Firma, účet nebo oprávnění se změnily')
    expect(container.textContent).not.toContain('Zakázka A')
    expect(container.textContent).not.toContain('Finanční přehled')
  })
  it('refuses a mixed-currency group rather than summing it under the parent currency', async () => {
    const member = (id: string, parent: string | null) => ({ id, parent_job_id: parent, title: id === jobA ? 'Parent' : 'Child',
      description: null, status: 'new', address: null, start_at: null, end_at: null, created_at: null, price: 0, customer_id: null })
    await mount(createElement(JobDetailPageClient, { ...props(), initialGroupMemberJobs: [member(jobA, null), member(jobB, jobA)],
      initialGroupEconomicsSummaries: [summary(), summary(jobB, companyA, { currency: 'EUR' })] })); await flush()
    const laborGroup = [...container.querySelectorAll('div')].find(node => node.firstElementChild?.textContent === csDictionary.jobs.detail.groupLabor)
    expect(laborGroup?.lastElementChild?.textContent).toBe('—')
    expect(container.textContent).toContain('Náklady práce nejsou úplné')
  })
})
