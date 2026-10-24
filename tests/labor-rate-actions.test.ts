import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), schedule: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/dal/auth', () => ({ requireCompanyRoleDalContext: mocks.guard }))
vi.mock('@/lib/dal/labor-history', () => ({ scheduleLaborRate: mocks.schedule }))
import { scheduleWorkerRateAction } from '../app/workers/[workerId]/rates/actions'
import { LaborHistoryError } from '../lib/labor-history'
const companyId = '11111111-1111-4111-8111-111111111111'
const actorProfileId = '22222222-2222-4222-8222-222222222222'
const profileId = '33333333-3333-4333-8333-333333333333'
const input = { companyId, actorProfileId, profileId, operationId: '44444444-4444-4444-8444-444444444444', expectedRevision: '0', effectiveFrom: '2026-11-01', hourlyRate: '200.00', currency: 'CZK', unit: 'hour', workerType: 'employee', billingType: 'hourly', reason: 'Smluvená sazba' }
const receipt = { companyId, profileId, operationId: input.operationId, revision: '1', rateId: '55555555-5555-4555-8555-555555555555' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockReset().mockResolvedValue({ companyId, profileId: actorProfileId, role: 'company_admin', supabase: {} })
  mocks.schedule.mockReset().mockResolvedValue(receipt)
  mocks.revalidate.mockReset()
})
describe('Rate server action boundary', () => {
  it('rejects invalid input before invoking a mutation', async () => {
    const result = await scheduleWorkerRateAction({ ...input, hourlyRate: '-1' })
    expect(result).toMatchObject({ ok: false, uncertain: false })
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
  it('requires a financial company role', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('no access'))
    expect(await scheduleWorkerRateAction(input)).toMatchObject({ ok: false, uncertain: false })
    expect(mocks.guard).toHaveBeenCalledWith('super_admin', 'company_admin')
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
  it('keeps a confirmed receipt when refresh fails after commit', async () => {
    mocks.revalidate.mockImplementation(() => { throw new Error('cache unavailable') })
    expect(await scheduleWorkerRateAction(input)).toEqual({ ok: true, data: receipt })
    expect(mocks.schedule).toHaveBeenCalledOnce()
  })
  it('keeps transport failure after dispatch uncertain', async () => {
    mocks.schedule.mockRejectedValueOnce(new Error('transport'))
    expect(await scheduleWorkerRateAction(input)).toMatchObject({ ok: false, uncertain: true })
  })
  it('preserves the confirmed conflict classification', async () => {
    mocks.schedule.mockRejectedValueOnce(new LaborHistoryError('Novější sazebník.', 'conflict', false))
    expect(await scheduleWorkerRateAction(input)).toEqual({ ok: false, error: 'Novější sazebník.', code: 'conflict', uncertain: false })
  })
})
