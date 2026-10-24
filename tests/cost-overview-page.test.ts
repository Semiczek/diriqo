import { createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ access: vi.fn(), client: vi.fn(), economics: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-guards', () => ({ requireCompanyRole: mocks.access }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.client }))
vi.mock('@/lib/dal/economics', () => ({ listJobEconomicsSummaries: mocks.economics }))
vi.mock('@/components/DashboardShell', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) }))
vi.mock('@/app/costs/actions', () => ({ createExpense: vi.fn(), createFixedCost: vi.fn(), deleteExpense: vi.fn(), deleteFixedCost: vi.fn(), updateExpense: vi.fn(), updateFixedCost: vi.fn() }))
import CostsPage from '../app/costs/page'

type Row = Record<string, unknown> & { id: string }
type QueryResult = { data: Row[] | { currency: string | null } | null; error: null | { message: string }; count: number | null }
const companyId = '11111111-1111-4111-8111-111111111111'
let data: Record<string, Row[]>, currency: string | null, unavailable: string | null
let reads: { table: string; from: number; exact: boolean; company: string | undefined; order: string | undefined }[]
function from(table: string) {
  let offset = 0, last = 499, exact = false, order: string | undefined
  const filters: { key: string; op: string; value: string }[] = []
  const result = (): QueryResult => {
    reads.push({ table, from: offset, exact, company: filters.find(filter => filter.key === 'company_id')?.value, order })
    if (table === unavailable && offset >= 500) return { data: null, error: { message: 'later page failed' }, count: null }
    const rows = (data[table] ?? []).filter(row => filters.every(filter => filter.op === 'eq' ? row[filter.key] === filter.value : filter.op === 'gte' ? String(row[filter.key]) >= filter.value : String(row[filter.key]) < filter.value))
      .sort((a, b) => a.id.localeCompare(b.id))
    return { data: rows.slice(offset, last + 1), error: null, count: exact ? rows.length : null }
  }
  const query = {
    select: (_columns: string, options?: { count?: string }) => { exact = options?.count === 'exact'; return query },
    eq: (key: string, value: string) => { filters.push({ key, value, op: 'eq' }); return query },
    gte: (key: string, value: string) => { filters.push({ key, value, op: 'gte' }); return query },
    lt: (key: string, value: string) => { filters.push({ key, value, op: 'lt' }); return query },
    order: (key: string) => { order = key; return query },
    range: (start: number, end: number) => { offset = start; last = end; return query },
    maybeSingle: async () => ({ data: { currency }, error: null }),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
  }
  return query
}
function kpi(node: ReactNode, label: string): string | undefined {
  if (Array.isArray(node)) return node.map(child => kpi(child, label)).find(value => value !== undefined)
  if (!isValidElement<{ label?: string; value?: string; children?: ReactNode }>(node)) return undefined
  if (node.props.label === label) return node.props.value
  return kpi(node.props.children, label)
}
const expense = (id: string, overrides: Partial<Row> = {}): Row => ({ id, company_id: companyId, job_id: null, name: 'Expense', category: 'Ostatní', amount: 1, currency: 'CZK', expense_date: '2026-10-01', ...overrides })
const page = () => CostsPage({ searchParams: Promise.resolve({ month: '2026-10' }) })
beforeEach(() => {
  vi.resetAllMocks(); currency = 'CZK'; unavailable = null; reads = []
  data = { fixed_costs: [], expenses: [], jobs: [] }
  mocks.access.mockResolvedValue({ ok: true, value: { companyId, profileId: 'actor', role: 'company_admin' } })
  mocks.client.mockResolvedValue({ from })
  mocks.economics.mockImplementation(async (_context, ids: string[]) => ids.map(id => ({ job_id: id, currency: 'CZK', labor_completeness: 'complete', profit_total: 1 })))
})
describe('cost overview server query and financial output', () => {
  it('includes more than 500 jobs and 1000 expenses, with exact count and tenant scope on every page', async () => {
    data.jobs = Array.from({ length: 501 }, (_, id) => ({ id: 'job-' + String(id).padStart(4, '0'), company_id: companyId, start_at: '2026-10-01', created_at: null }))
    data.expenses = Array.from({ length: 1001 }, (_, id) => expense('exp-' + String(id).padStart(4, '0')))
    data.expenses.push(expense('other-company', { company_id: 'other', amount: 9000 }))
    const tree = await page()
    expect(mocks.economics.mock.calls[0][1]).toHaveLength(501)
    expect(reads.every(read => read.exact && read.company === companyId && read.order === 'id')).toBe(true)
    expect(reads.filter(read => read.table === 'expenses').map(read => read.from)).toEqual([0, 500, 1000])
    expect(kpi(tree, 'Celkem tento měsíc')?.replace(/\s/g, '')).toBe('1001Kč')
    expect(kpi(tree, 'Orientační výsledek')?.replace(/\s/g, '')).toBe('-500Kč')
  })
  it('keeps costs and profit unavailable if a later expense page fails', async () => {
    data.expenses = Array.from({ length: 501 }, (_, id) => expense(String(id)))
    unavailable = 'expenses'
    const tree = await page()
    expect(kpi(tree, 'Celkem tento měsíc')).toBe('—')
    expect(kpi(tree, 'Orientační výsledek')).toBe('—')
    const html = renderToStaticMarkup(tree)
    expect(html).toContain('Seznam výdajů není dostupný')
    expect(html).not.toContain('Expense')
  })
  it('does not relabel foreign expense money or publish a mixed-currency total', async () => {
    data.expenses = [expense('eur', { amount: 99, currency: 'EUR' })]
    const tree = await page()
    expect(kpi(tree, 'Celkem tento měsíc')).toBe('—')
    expect(kpi(tree, 'Orientační výsledek')).toBe('—')
    expect(renderToStaticMarkup(tree)).toContain('99')
    expect(renderToStaticMarkup(tree)).toContain('€')
  })
  it('does not call job economics or invent zero when monthly jobs cannot be read completely', async () => {
    data.jobs = Array.from({ length: 501 }, (_, id) => ({ id: String(id), company_id: companyId, start_at: '2026-10-01' }))
    unavailable = 'jobs'
    const tree = await page()
    expect(mocks.economics).not.toHaveBeenCalled()
    expect(kpi(tree, 'Orientační výsledek')).toBe('—')
  })
  it('does not use CZK form default as authority for an unknown company currency', async () => {
    currency = null
    const tree = await page()
    expect(mocks.economics).not.toHaveBeenCalled()
    expect(kpi(tree, 'Celkem tento měsíc')).toBe('—')
    expect(kpi(tree, 'Orientační výsledek')).toBe('—')
  })
})
