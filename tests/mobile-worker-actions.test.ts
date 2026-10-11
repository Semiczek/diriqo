import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ access: vi.fn(), licence: vi.fn(), server: vi.fn(), admin: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/server-guards', () => ({ requireWorkerAccess: mocks.access }))
vi.mock('@/lib/module-access', () => ({ requireCompanyModule: mocks.licence }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.server }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
import { completeMyJobAction, startMyJobShiftAction, stopMyJobShiftAction } from '../app/moje-prace/actions'

const company = '11111111-1111-4111-8111-111111111111'
const profile = '22222222-2222-4222-8222-222222222222'
const job = '33333333-3333-4333-8333-333333333333'
function query(data: unknown, error: unknown = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn(), insert: vi.fn(), update: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve) }
  for (const key of ['select', 'eq', 'is', 'order', 'limit', 'insert', 'update', 'maybeSingle', 'single'] as const) builder[key].mockReturnValue(builder)
  return builder
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ ok: true, value: { companyId: company, profileId: profile, role: 'worker' } })
  mocks.licence.mockResolvedValue({ ok: true })
  mocks.server.mockResolvedValue({ from: vi.fn(() => query([{ id: 'assignment', jobs: { id: job, company_id: company } }])) })
})
describe('mobile employee mutations', () => {
  it('denies all actions without a current membership', async () => {
    mocks.access.mockResolvedValue({ ok: false, error: 'Forbidden' })
    expect((await startMyJobShiftAction({ jobId: job })).ok).toBe(false)
    expect((await stopMyJobShiftAction({ shiftId: 'shift' })).ok).toBe(false)
    expect((await completeMyJobAction({ jobId: job })).ok).toBe(false)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('checks the paid capability before starting or completing work', async () => {
    mocks.licence.mockResolvedValue({ ok: false, error: 'MODULE_REQUIRED' })
    expect(await startMyJobShiftAction({ jobId: job })).toEqual({ ok: false, error: 'MODULE_REQUIRED' })
    expect(await completeMyJobAction({ jobId: job })).toEqual({ ok: false, error: 'MODULE_REQUIRED' })
    expect(mocks.licence).toHaveBeenCalledWith(company, 'shifts', 'core.time.record')
    expect(mocks.licence).toHaveBeenCalledWith(company, 'jobs', 'core.jobs.update')
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('refuses a foreign or unassigned job before any privileged query', async () => {
    const adminFrom = vi.fn()
    mocks.admin.mockReturnValue({ from: adminFrom })
    mocks.server.mockResolvedValue({ from: vi.fn(() => query([{ id: 'assignment', jobs: { company_id: 'foreign' } }])) })
    expect((await startMyJobShiftAction({ jobId: job })).ok).toBe(false)
    expect((await completeMyJobAction({ jobId: job })).ok).toBe(false)
    expect(adminFrom).not.toHaveBeenCalled()
  })
  it('cannot restart an already completed assignment', async () => {
    const adminFrom = vi.fn()
    mocks.admin.mockReturnValue({ from: adminFrom })
    mocks.server.mockResolvedValue({ from: vi.fn(() => query([{ id: 'assignment', completed_at: '2026-10-11', jobs: { company_id: company } }])) })
    const result = await startMyJobShiftAction({ jobId: job })
    expect(result.ok).toBe(false)
    expect(adminFrom).not.toHaveBeenCalled()
  })
  it('requires stopping the own open shift before marking work complete', async () => {
    const open = query([{ id: 'shift' }])
    mocks.admin.mockReturnValue({ from: vi.fn(() => open) })
    expect(await completeMyJobAction({ jobId: job })).toEqual({ ok: false, error: 'Nejdříve ukončete směnu tlačítkem Stop.' })
    expect(open.eq).toHaveBeenCalledWith('company_id', company)
    expect(open.eq).toHaveBeenCalledWith('profile_id', profile)
    expect(open.eq).toHaveBeenCalledWith('job_id', job)
    expect(open.update).not.toHaveBeenCalled()
  })
  it('lets an employee settle an existing own shift after licence expiry', async () => {
    const shift = query({ id: 'shift', job_id: job, ended_at: null })
    const update = query(null)
    mocks.admin.mockReturnValue({ from: vi.fn().mockReturnValueOnce(shift).mockReturnValueOnce(update) })
    expect((await stopMyJobShiftAction({ shiftId: 'shift' })).ok).toBe(true)
    expect(mocks.licence).not.toHaveBeenCalled()
    for (const builder of [shift, update]) {
      expect(builder.eq).toHaveBeenCalledWith('company_id', company)
      expect(builder.eq).toHaveBeenCalledWith('profile_id', profile)
      expect(builder.eq).toHaveBeenCalledWith('id', 'shift')
    }
    expect(mocks.revalidate).toHaveBeenCalledWith('/mobile/my')
    expect(mocks.revalidate).toHaveBeenCalledWith('/mobile/manager')
  })
  it('cannot stop a shift absent from the own company/profile scope', async () => {
    const shift = query(null)
    mocks.admin.mockReturnValue({ from: vi.fn(() => shift) })
    expect((await stopMyJobShiftAction({ shiftId: 'foreign-shift' })).ok).toBe(false)
    expect(shift.update).not.toHaveBeenCalled()
  })
})
