import { isValidElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), economics: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }))
vi.mock('@/lib/require-hub-access', () => ({ requireHubAccess: mocks.access }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.client }))
vi.mock('@/lib/dal/economics', () => ({ listJobEconomicsSummaries: mocks.economics }))
vi.mock('@/lib/dal/worker-advances', () => ({ readPayrollAdvanceLedger: async () => ({ data: [], settlements: [], currency: 'CZK', error: null }) }))
vi.mock('@/lib/onboarding', () => ({ getCompanyOnboardingChecklist: async () => null }))
vi.mock('@/lib/i18n/server', async () => ({ getRequestLocale: async () => 'cs', getRequestDictionary: async () => (await import('../lib/i18n/dictionaries/cs')).csDictionary }))
vi.mock('@/components/DashboardShell', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/DashboardMonthPicker', () => ({ default: () => null }))
vi.mock('@/components/DashboardQuickNotes', () => ({ default: () => null }))
vi.mock('@/components/onboarding/OnboardingChecklist', () => ({ default: () => null }))
import DashboardPage from '../app/(dashboard)/page'
import { buildJobEconomicsSummary } from '../lib/economics'
import { csDictionary } from '../lib/i18n/dictionaries/cs'

type Job = { id: string; parent_job_id: string | null; title: string; company_id: string; price: number; start_at: string | null; end_at: string | null; work_state: string; time_state: string; status: string; billing_state_resolved: string }
const companyId = '11111111-1111-4111-8111-111111111111'
let jobs: Job[], costs: Record<string, number>
function job(id: string, start: string | null, end: string | null, parent: string | null = null): Job {
  return { id, parent_job_id: parent, title: id, company_id: companyId, price: parent ? 0 : 1000, start_at: start, end_at: end,
    work_state: 'done', time_state: 'finished', status: 'done', billing_state_resolved: 'waiting_for_invoice' }
}
function from(table: string) {
  let first = 0, last = 499, exact = false
  const filters: { key: string; value: unknown }[] = []
  const query = {
    select: (_columns: string, options?: { count?: string }) => { exact = options?.count === 'exact'; return query },
    eq: (key: string, value: unknown) => { filters.push({ key, value }); return query },
    in: () => query, is: () => query, not: () => query, order: () => query, limit: () => query,
    range: (start: number, end: number) => { first = start; last = end; return query },
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (['jobs', 'jobs_with_state'].includes(table) ? jobs : []).filter(row => filters.every(filter => row[filter.key as keyof Job] === filter.value)).sort((a, b) => a.id.localeCompare(b.id))
      return Promise.resolve({ data: rows.slice(first, last + 1), error: null, count: exact ? rows.length : null }).then(resolve)
    },
  }
  return query
}
function findProps(node: ReactNode, predicate: (props: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  if (Array.isArray(node)) return node.map(child => findProps(child, predicate)).find(Boolean)
  if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) return undefined
  return predicate(node.props) ? node.props : findProps(node.props.children, predicate)
}
function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  return isValidElement<{ children?: ReactNode }>(node) ? textContent(node.props.children) : ''
}
const kpi = (tree: ReactNode, tour: string) => findProps(tree, props => props.dataTour === tour)?.value
const line = (tree: ReactNode, label: string) => findProps(tree, props => props.label === label)?.value
const money = (value: unknown) => typeof value === 'string' ? value.replace(/\s/g, '') : value
const page = (month: string) => DashboardPage({ searchParams: Promise.resolve({ summary_month: month }) })
beforeEach(() => {
  vi.resetAllMocks()
  jobs = [job('parent', '2026-10-01T08:00:00Z', '2026-11-30T16:00:00Z'), job('oct', '2026-10-15T08:00:00Z', '2026-10-15T16:00:00Z', 'parent'), job('nov', '2026-11-15T08:00:00Z', '2026-11-15T16:00:00Z', 'parent')]
  costs = { parent: 200, oct: 100, nov: 300 }
  mocks.access.mockResolvedValue({ companyId, profileId: 'actor', role: 'company_admin', timeZone: 'Europe/Prague' })
  mocks.client.mockResolvedValue({ from })
  mocks.economics.mockImplementation(async (_context, ids: string[]) => ids.map(id => buildJobEconomicsSummary({ jobId: id, companyId, currency: 'CZK', quotedRevenue: jobs.find(row => row.id === id)!.price,
    invoicedRevenue: 0, laborHours: 1, internalLaborCost: costs[id], externalLaborCost: 0, directCost: 0 })))
})
describe('dashboard financial allocation across months', () => {
  it('keeps both monthly amounts unknown when the parent spans October and November, without changing the job count', async () => {
    for (const month of ['2026-10', '2026-11']) {
      const tree = await page(month)
      expect(kpi(tree, 'dashboard-kpi-profit')).toBe('—')
      expect(kpi(tree, 'dashboard-kpi-waiting-invoice')).toBe('—')
      expect(line(tree, csDictionary.dashboard.laborCosts)).toBe('—')
      expect(kpi(tree, 'dashboard-kpi-completed-jobs')).toBe('1')
      expect(textContent(findProps(tree, props => props.role === 'status')?.children as ReactNode)).toContain('Měsíční částky nejsou dostupné')
      expect(findProps(tree, props => props.href === '/jobs')).toBeDefined()
    }
  })
  it('counts a parent with an unambiguous October period once and retains all 600 in approved parent and child costs', async () => {
    jobs[0].end_at = '2026-10-31T16:00:00Z'
    const october = await page('2026-10'), november = await page('2026-11')
    expect(money(kpi(october, 'dashboard-kpi-profit'))).toBe('700Kč')
    expect(money(kpi(november, 'dashboard-kpi-profit'))).toBe('-300Kč')
    expect(money(line(october, csDictionary.dashboard.laborCosts))).toBe('300Kč')
    expect(money(line(november, csDictionary.dashboard.laborCosts))).toBe('300Kč')
    expect(money(kpi(october, 'dashboard-kpi-waiting-invoice'))).toBe('1000Kč')
    expect(money(kpi(november, 'dashboard-kpi-waiting-invoice'))).toBe('0Kč')
  })
  it('retains the parent in its own month even when all children are in the following month', async () => {
    jobs[0].end_at = '2026-10-31T16:00:00Z'
    jobs = jobs.filter(row => row.id !== 'oct')
    const october = await page('2026-10'), november = await page('2026-11')
    expect(money(kpi(october, 'dashboard-kpi-profit'))).toBe('800Kč')
    expect(money(kpi(november, 'dashboard-kpi-profit'))).toBe('-300Kč')
    expect(kpi(october, 'dashboard-kpi-completed-jobs')).toBe('0')
    expect(kpi(november, 'dashboard-kpi-completed-jobs')).toBe('1')
  })
  it('does not invent an allocation when a parent has no own dates', async () => {
    jobs[0].start_at = null; jobs[0].end_at = null
    expect(kpi(await page('2026-10'), 'dashboard-kpi-profit')).toBe('—')
    expect(kpi(await page('2026-11'), 'dashboard-kpi-profit')).toBe('—')
  })
  it('uses the company time zone to assign a parent whose UTC dates cross a month boundary', async () => {
    jobs[0].start_at = '2026-10-31T23:30:00Z'; jobs[0].end_at = '2026-11-01T00:30:00Z'
    expect(money(kpi(await page('2026-10'), 'dashboard-kpi-profit'))).toBe('-100Kč')
    expect(money(kpi(await page('2026-11'), 'dashboard-kpi-profit'))).toBe('500Kč')
  })
  it('does not repeat a standalone job amount when its own period spans two months', async () => {
    jobs = [jobs[0]]
    expect(kpi(await page('2026-10'), 'dashboard-kpi-profit')).toBe('—')
    expect(kpi(await page('2026-11'), 'dashboard-kpi-profit')).toBe('—')
  })
  it('retains the existing point-in-time period semantics when only one endpoint exists', async () => {
    jobs[0].end_at = null
    expect(money(kpi(await page('2026-10'), 'dashboard-kpi-profit'))).toBe('700Kč')
    expect(money(kpi(await page('2026-11'), 'dashboard-kpi-profit'))).toBe('-300Kč')
  })
  it('retains the complete 600 cost and 400 profit when all group members belong to the same month', async () => {
    jobs[0].end_at = '2026-10-31T16:00:00Z'
    jobs[2].start_at = '2026-10-20T08:00:00Z'; jobs[2].end_at = '2026-10-20T16:00:00Z'
    const tree = await page('2026-10')
    expect(money(kpi(tree, 'dashboard-kpi-profit'))).toBe('400Kč')
    expect(money(line(tree, csDictionary.dashboard.laborCosts))).toBe('600Kč')
    expect(kpi(tree, 'dashboard-kpi-completed-jobs')).toBe('1')
  })
})
