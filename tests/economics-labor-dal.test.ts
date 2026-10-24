import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/auth', () => ({ DalAuthError: class extends Error {} }))
import { listJobEconomicsSummaries } from '../lib/dal/economics'
import type { DalContext } from '../lib/dal/auth'
const companyId = '11111111-1111-4111-8111-111111111111'
const profileId = '22222222-2222-4222-8222-222222222222'
const jobId = '33333333-3333-4333-8333-333333333333'
function setup(overrides: Record<string, unknown> = {}) {
  const item = { job_id: jobId, currency: 'CZK', approved_cost: '1600.00', approved_internal_cost: '1600.00', approved_external_cost: '0.00', approved_hours: '8.0000', unconverted_costs: [], provisional_known_cost: '0.00', missing_rate_hours: '0.0000', unapproved_hours: '0.0000', legacy_unverified_count: 0, completeness: 'complete', reasons: [], total_cost: '1600.00', ...overrides }
  const tables: Record<string, {data: unknown[]; error: unknown}> = {
    jobs: { data: [{ id: jobId, company_id: companyId, price: 2500, currency: 'CZK' }], error: null },
    job_cost_items: { data: [{ id: 'cost1', job_id: jobId, total_price: 10 }], error: null },
    invoice_items: { data: [{ id: 'invoice-item1', source_job_id: jobId, total_without_vat: 2500, invoices: { status: 'issued', currency: 'CZK' } }], error: null },
  }
  const filters: [string, string, unknown][] = []
  const from = vi.fn((table: string) => {
    if (!tables[table]) throw new Error(`Forbidden legacy read: ${table}`)
    let offset = 0, end = 499
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((column: string, value: unknown) => { filters.push([table, column, value]); return chain }),
      in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn((start: number, last: number) => { offset = start; end = last; return chain }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ ...tables[table], data: tables[table].data.slice(offset, end + 1), count: tables[table].data.length }).then(resolve),
    }
    return chain
  })
  const rpc = vi.fn(async (name: string) => ({ data: name === 'get_job_labor_cost_totals' ? { company_id: companyId, items: [item] } : [], error: null }))
  const getUser = vi.fn(async () => ({ data: { user: { id: profileId } }, error: null }))
  const ctx = { companyId, profileId, role: 'company_admin', supabase: { from, rpc, auth: { getUser } } } as unknown as DalContext
  return { ctx, tables, item, rpc, from, filters, getUser }
}
describe('canonical approved labour economics', () => {
  it('uses only approved snapshot totals and never reads a current profile rate', async () => {
    const m = setup()
    const [row] = await listJobEconomicsSummaries(m.ctx, [jobId, jobId])
    expect(row).toMatchObject({ labor_cost_total: 1600, total_cost_total: 1610, profit_total: 890, margin_percent: 35.6 })
    expect(m.getUser).toHaveBeenCalledOnce()
    expect(m.rpc).toHaveBeenCalledWith('get_job_labor_cost_totals', { target_company_id: companyId, job_ids: [jobId] })
    expect(m.from.mock.calls.map(call => call[0]).sort()).toEqual(['invoice_items', 'job_cost_items', 'jobs'])
    expect(m.filters).toContainEqual(['jobs', 'company_id', companyId])
    expect(m.filters).toContainEqual(['job_cost_items', 'company_id', companyId])
    expect(m.filters).toContainEqual(['invoice_items', 'invoices.company_id', companyId])
  })
  it('does not manufacture a profit when any source lacks a historical rate', async () => {
    const m = setup({ completeness: 'incomplete', total_cost: null, missing_rate_hours: '2.0000', reasons: ['missing_rate'] })
    expect((await listJobEconomicsSummaries(m.ctx, [jobId]))[0]).toMatchObject({ known_cost_total: 1610, missing_rate_hours: 2, profit_total: null, margin_percent: null })
  })
  it('retains unapproved and unresolved legacy evidence beside the approved subtotal', async () => {
    const m = setup({ completeness: 'incomplete', total_cost: null, unapproved_hours: '3.0000', legacy_unverified_count: 2, provisional_known_cost: '600.00', reasons: ['legacy_unverified', 'unapproved_work'] })
    expect((await listJobEconomicsSummaries(m.ctx, [jobId]))[0]).toMatchObject({ known_labor_cost_total: 1600, provisional_labor_cost_total: 600, unapproved_labor_hours: 3, legacy_unverified_labor_count: 2, total_cost_total: null })
  })
  it.each(['worker', 'manager', null])('denies financial reads for role %s before reading tables', async role => {
    const m = setup(); m.ctx.role = role
    await expect(listJobEconomicsSummaries(m.ctx, [jobId])).rejects.toThrow()
    expect(m.from).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled()
  })
  it('rejects unavailable or foreign requested jobs instead of returning a partial total', async () => {
    const m = setup(); m.tables.jobs.data = []
    await expect(listJobEconomicsSummaries(m.ctx, [jobId])).rejects.toThrow('této firmě')
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('does not fall back to live profile rates when the new RPC is unavailable', async () => {
    const m = setup(); m.rpc.mockRejectedValueOnce(new Error('RPC missing'))
    await expect(listJobEconomicsSummaries(m.ctx, [jobId])).rejects.toThrow()
    expect(m.from.mock.calls.map(call => call[0])).not.toContain('profiles')
  })
  it('does not return a summary when a money source failed', async () => {
    const m = setup(); m.tables.job_cost_items.error = { message: 'permission denied' }
    await expect(listJobEconomicsSummaries(m.ctx, [jobId])).rejects.toEqual({ message: 'permission denied' })
  })
})

describe('large economics sources', () => {
  it('includes all 1201 material rows and 1001 invoice items', async () => {
    const m = setup()
    m.tables.job_cost_items.data = Array.from({ length: 1201 }, (_, index) => ({ id: `cost-${index}`, job_id: jobId, total_price: 1 }))
    m.tables.invoice_items.data = Array.from({ length: 1001 }, (_, index) => ({ id: `invoice-${index}`, source_job_id: jobId, total_without_vat: 5, invoices: { status: 'issued', currency: 'CZK' } }))
    expect((await listJobEconomicsSummaries(m.ctx, [jobId]))[0]).toMatchObject({ other_cost_total: 1201, revenue_total: 5005, total_cost_total: 2801, profit_total: 2204 })
  })
  it('does not count draft, cancelled or unknown invoice status as invoiced revenue', async () => {
    const m = setup()
    m.tables.invoice_items.data = ['draft', 'cancelled', null, 'issued'].map((status, index) => ({ id: `invoice-${index}`, source_job_id: jobId, total_without_vat: 5, invoices: { status, currency: status === 'issued' ? 'CZK' : null } }))
    expect((await listJobEconomicsSummaries(m.ctx, [jobId]))[0].revenue_total).toBe(5)
  })
})

describe('job and invoice currency boundaries', () => {
  it.each([null, undefined, '', 'czk'])('rejects an unavailable job currency %s before calculating money', async currency => {
    const m = setup()
    m.tables.jobs.data = [{ id: jobId, company_id: companyId, price: 2500, currency }]
    await expect(listJobEconomicsSummaries(m.ctx, [jobId])).rejects.toThrow(/měna zakázky/i)
    expect(m.rpc).not.toHaveBeenCalled()
  })
  it('rejects a job currency that changed between its row and canonical labour read', async () => {
    const m = setup({ currency: 'EUR' })
    await expect(listJobEconomicsSummaries(m.ctx, [jobId])).rejects.toThrow(/měna zakázky/i)
  })
  it.each(['CZK', null, undefined, ''])('rejects issued invoice item currency %s for an EUR job', async currency => {
    const m = setup({ currency: 'EUR' })
    m.tables.jobs.data = [{ id: jobId, company_id: companyId, price: 2500, currency: 'EUR' }]
    m.tables.invoice_items.data = [{ id: 'issued', source_job_id: jobId, total_without_vat: 100, invoices: { status: 'issued', currency } }]
    await expect(listJobEconomicsSummaries(m.ctx, [jobId])).rejects.toThrow(/měna vydané faktury/i)
  })
  it('allows matching EUR revenue while excluding draft and cancelled invoices with another or missing currency', async () => {
    const m = setup({ currency: 'EUR' })
    m.tables.jobs.data = [{ id: jobId, company_id: companyId, price: 2500, currency: 'EUR' }]
    m.tables.invoice_items.data = [
      { id: 'issued', source_job_id: jobId, total_without_vat: 100, invoices: { status: 'issued', currency: 'EUR' } },
      { id: 'draft', source_job_id: jobId, total_without_vat: 9999, invoices: { status: 'draft', currency: 'CZK' } },
      { id: 'cancelled', source_job_id: jobId, total_without_vat: 9999, invoices: { status: 'cancelled', currency: null } },
    ]
    expect((await listJobEconomicsSummaries(m.ctx, [jobId]))[0]).toMatchObject({ currency: 'EUR', revenue_total: 100 })
  })
  it.each(['EUR', null, undefined, ''])('rejects legacy issued invoice currency %s for a CZK job', async currency => {
    const m = setup()
    m.tables.invoice_items.error = { code: '42703', message: 'column source_job_id does not exist' }
    m.tables.invoices = { data: [{ id: 'legacy', job_id: jobId, status: 'paid', total_without_vat: 100, currency }], error: null }
    await expect(listJobEconomicsSummaries(m.ctx, [jobId])).rejects.toThrow(/měna vydané faktury/i)
  })
  it('checks matching currency in legacy fallback and excludes draft and cancelled invoices', async () => {
    const m = setup()
    m.tables.invoice_items.error = { code: 'PGRST204', message: 'source_job_id missing' }
    m.tables.invoices = { data: [
      { id: 'paid', job_id: jobId, status: 'paid', total_without_vat: 100, currency: 'CZK' },
      { id: 'draft', job_id: jobId, status: 'draft', total_without_vat: 9999, currency: 'EUR' },
      { id: 'cancelled', job_id: jobId, status: 'cancelled', total_without_vat: 9999 },
    ], error: null }
    expect((await listJobEconomicsSummaries(m.ctx, [jobId]))[0].revenue_total).toBe(100)
    expect(m.filters).toContainEqual(['invoices', 'company_id', companyId])
  })
})
