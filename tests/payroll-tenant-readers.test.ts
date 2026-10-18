import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import ExcelJS from 'exceljs'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ access: vi.fn(), server: vi.fn() }))
vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-guards', () => ({ requireWorkerAccess: mocks.access, requireCompanyRole: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.server }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/i18n/server', async () => {
  const { getDictionary } = await import('../lib/i18n/dictionaries')
  return { getRequestDictionary: async () => getDictionary('cs'), getRequestLocale: async () => 'cs' }
})
vi.mock('@/components/DashboardShell', () => ({ default: 'DashboardShell' }))
vi.mock('@/app/workers/[workerId]/WorkerSummaryStats', () => ({ default: 'WorkerSummaryStats' }))
vi.mock('@/app/workers/[workerId]/WorkerAdvancesSection', () => ({ default: 'WorkerAdvancesSection' }))
vi.mock('@/app/workers/[workerId]/WorkerAssignmentsSection', () => ({ default: 'WorkerAssignmentsSection' }))
vi.mock('@/app/workers/[workerId]/WorkerInvitePanel', () => ({ default: 'WorkerInvitePanel' }))
vi.mock('@/app/workers/[workerId]/WorkerShiftsSection', () => ({ default: 'WorkerShiftsSection' }))
import { companyPayrollQuery, readPayrollRows } from '../lib/dal/payroll-readers'
import { GET } from '../app/api/workers/export/route'
import WorkerDetailPage from '../app/workers/[workerId]/page'
import WorkersPage from '../app/workers/page'
import { readWorkerFinanceHistoryAction } from '../app/advance-requests/actions'
import AdvanceOverview from '../app/advance-requests/AdvanceOverview'
import type { AdvanceRequest } from '../lib/dal/worker-advances'
import type { SupabaseServerClient } from '../lib/dal/auth'

const A = 'a1111111-1111-4111-8111-111111111111'
const B = 'b1111111-1111-4111-8111-111111111111'
const worker = 'c1111111-1111-4111-8111-111111111111'
type Row = Record<string, unknown>
function database(tables: Record<string, Row[]>, failure?: { table: string; from: number; message?: string }) {
  const readTables: string[] = []
  const from = vi.fn((table: string) => {
    readTables.push(table)
    const filters: Array<(row: Row) => boolean> = []
    const value = (row: Row, key: string): unknown => key.split('.').reduce((v, part) => (v as Row)?.[part], row as unknown)
    const result = () => (tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
    const chain = {
      select() { return chain }, order() { return chain },
      eq(key: string, v: unknown) { filters.push(row => value(row, key) === v); return chain },
      is(key: string, v: unknown) { filters.push(row => (value(row, key) ?? null) === v); return chain },
      in(key: string, vs: unknown[]) { filters.push(row => vs.includes(value(row, key))); return chain },
      gte(key: string, v: string) { filters.push(row => String(value(row, key)) >= v); return chain },
      lt(key: string, v: string) { filters.push(row => String(value(row, key)) < v); return chain },
      or() { return chain },
      range(start: number, end: number) { return Promise.resolve(failure?.table === table && start >= failure.from
        ? { data: null, error: { code: '42501', message: failure.message ?? 'permission denied' } }
        : { data: result().slice(start, end + 1), error: null }) },
      limit(n: number) { return Promise.resolve({ data: result().slice(0, n), error: null }) },
      single() { return Promise.resolve({ data: result()[0] ?? null, error: null }) },
      maybeSingle() { return Promise.resolve({ data: result()[0] ?? null, error: null }) },
    }
    return chain
  })
  return { db: { from } as unknown as SupabaseServerClient, readTables }
}
function fixture() {
  const jobA = { id: 'jobA', company_id: A, title: 'A job', start_at: '2026-10-01', end_at: '2026-10-31', status: 'in_progress', price: 1000, is_paid: false }
  const jobB = { ...jobA, id: 'jobB', company_id: B, title: 'B secret job' }
  return {
    companies: [{ id: A, currency: 'CZK', default_currency: 'CZK' }],
    company_payroll_settings: [{ company_id: A, payday_day: 18, default_pay_type: 'monthly', advances_enabled: true }],
    company_members: [B, A].map(company_id => ({ id: company_id, company_id, profile_id: worker, is_active: true, role: 'worker' })),
    profiles: [{ id: worker, full_name: 'Shared worker', default_hourly_rate: 100, worker_type: 'employee' }],
    job_assignments: [jobB, jobA].map(jobs => ({ id: jobs.id, job_id: jobs.id, profile_id: worker, company_id: null, archived_at: null, jobs })),
    worker_job_assignment_summary: [jobB, jobA].map(j => ({ assignment_id: j.id, job_id: j.id, profile_id: worker, labor_hours_total: j.company_id === A ? 2 : 900, effective_hourly_rate: 100, labor_cost_total: j.company_id === A ? 200 : 90000 })),
    jobs: [jobB, jobA],
    work_shifts: [B, A].map(company_id => ({ id: company_id, company_id, profile_id: worker, job_id: company_id === A ? 'jobA' : 'jobB', shift_date: '2026-10-05', started_at: '2026-10-05T08:00:00Z', ended_at: '2026-10-05T10:00:00Z', hours_override: company_id === A ? 2 : 900 })),
    work_logs: [B, A].map(company_id => ({ id: company_id, company_id, profile_id: worker, work_date: '2026-10-05', hours: company_id === A ? 3 : 900 })),
    payroll_items: [B, A].map(company_id => ({ id: company_id, company_id, profile_id: worker, payroll_month: '2026-10', item_type: 'bonus', amount: company_id === A ? 50 : 90000 })),
    payroll_payments: [B, A].map(company_id => ({ id: company_id, company_id, profile_id: worker, payroll_month: '2026-10', amount: company_id === A ? 100 : 90000, paid_at: '2026-10-10' })),
    absence_requests: [B, A].map(company_id => ({ id: company_id, company_id, profile_id: worker, start_at: '2026-10-15', end_at: '2026-10-16', status: 'approved', note: company_id === A ? 'A absence' : 'B secret absence' })),
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('React', React)
  mocks.access.mockResolvedValue({ ok: true, value: { companyId: A, profileId: 'admin-both-companies', role: 'company_admin' } })
})
function elements(node: unknown): Array<{ type: unknown; props: Row }> {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement<Row>(node)) return []
  return [{ type: node.type, props: node.props }, ...elements(node.props.children)]
}
async function exportedRows() {
  const response = await GET(new NextRequest('https://example.test/api/workers/export?month=2026-10'))
  expect(response.status).toBe(200)
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(await response.arrayBuffer())
  const sheet = book.worksheets[0]
  const headers = sheet.getRow(1).values as string[]
  return Object.fromEntries(headers.map((label, index) => [label, sheet.getRow(2).getCell(index).value]).filter(([label]) => label))
}
describe('payroll current-company boundary for a shared worker and admin of A+B', () => {
  it('exports only A shifts, logs, jobs, bonus and paid amount even when B rows arrive first', async () => {
    mocks.server.mockResolvedValue(database(fixture()).db)
    const row = await exportedRows()
    expect(row).toMatchObject({ 'Směny h': 2, 'Work logy h': 3, 'Hodiny ze zakázek h': 2, 'Bonusy CZK': 50, 'Celkem k výplatě CZK': 250, 'Uhrazeno CZK': 100 })
  })
  it('uses A totals and excludes B assignments and absences on list and detail', async () => {
    mocks.server.mockResolvedValue(database(fixture()).db)
    const list = await WorkersPage({ searchParams: Promise.resolve({ month: '2026-10' }) })
    expect(JSON.stringify(list)).not.toContain('B secret')
    const detail = await WorkerDetailPage({ params: Promise.resolve({ workerId: worker }), searchParams: Promise.resolve({ month: '2026-10' }) })
    const nodes = elements(detail)
    expect(nodes.find(node => node.type === 'WorkerSummaryStats')?.props).toMatchObject({ totalShiftHours: 2, payrollBonusTotal: 50, totalRewardAfterAdvance: 250 })
    expect(JSON.stringify(detail)).not.toContain('B secret')
    expect(JSON.stringify(detail)).toContain('A absence')
  })
  it('rejects a detail worker outside A before reading profile or financial data', async () => {
    const data = fixture(); data.company_members = data.company_members.filter(m => m.company_id === B)
    const db = database(data); mocks.server.mockResolvedValue(db.db)
    await WorkerDetailPage({ params: Promise.resolve({ workerId: worker }) })
    expect(db.readTables).toEqual(['company_members'])
    const response = await readWorkerFinanceHistoryAction(worker)
    expect(response.data).toBeNull()
    expect(db.readTables.every(table => table === 'company_members')).toBe(true)
  })
  it('finance editor loads only A payroll history through the guarded server action', async () => {
    mocks.server.mockResolvedValue(database(fixture()).db)
    const response = await readWorkerFinanceHistoryAction(worker)
    expect(response.error).toBeNull()
    expect(response.data?.payrollItems).toHaveLength(1)
    expect(response.data?.payrollItems[0].amount).toBe(50)
  })
  it('exports all 1001 shifts instead of silently accepting the Data API row cap', async () => {
    const data = fixture()
    data.work_shifts = Array.from({ length: 1001 }, (_, index) => ({ ...data.work_shifts[1], id: String(index), hours_override: 1 }))
    mocks.server.mockResolvedValue(database(data).db)
    expect(await exportedRows()).toMatchObject({ 'Směny h': 1001, 'Odměna ze směn CZK': 100100 })
  })
  it('does not expose a partial total if page two fails', async () => {
    const db = database({ work_logs: Array.from({ length: 600 }, (_, id) => ({ id, company_id: A })) }, { table: 'work_logs', from: 500 })
    const response = await readPayrollRows(companyPayrollQuery(db.db, A, 'work_logs', 'id').order('id'))
    expect(response.data).toEqual([])
    expect(response.error).toBeTruthy()
  })
  it('does not export zero paid amount when payment permissions fail', async () => {
    mocks.server.mockResolvedValue(database(fixture(), { table: 'payroll_payments', from: 0, message: 'permission denied for table payroll_payments' }).db)
    const response = await GET(new NextRequest('https://example.test/api/workers/export?month=2026-10'))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'permission denied for table payroll_payments' })
  })
  it('shows a legacy NULL requested amount as undocumented, without inventing zero or approval controls', () => {
    const request: AdvanceRequest = { id: 'legacy', company_id: A, profile_id: worker, requested_amount: null, amount: 0,
      status: 'rejected', revision: 0, requested_at: '2026-10-01', approved_at: null, paid_at: null,
      reason: null, note: null, payroll_month: null, review_reason: null, currency: null }
    const tree = AdvanceOverview({ companyId: A, actorProfileId: 'admin', today: '2026-10-18', admin: true, currency: 'CZK', requests: [request], payments: [], settlements: [] })
    const values = elements(tree).filter(node => node.type === 'dd')
    expect(values[0].props.children).toBe('Původní částka není doložená')
  })
})
