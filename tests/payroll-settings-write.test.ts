import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), from: vi.fn(), upsert: vi.fn(), select: vi.fn(), single: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-guards', () => ({ requireWorkerAccess: mocks.context }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ from: mocks.from }) }))
import { saveCompanyPayrollSettings } from '../lib/dal/payroll-settings'

const input = { payType: 'monthly', payday: 31, weekday: null, advancesEnabled: false, advanceLimitAmount: null, advanceFrequency: 'monthly' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ ok: true, value: { companyId: 'company-A', role: 'company_admin' } })
  mocks.from.mockReturnValue({ upsert: mocks.upsert })
  mocks.upsert.mockReturnValue({ select: mocks.select })
  mocks.select.mockReturnValue({ single: mocks.single })
  mocks.single.mockResolvedValue({ data: { company_id: 'company-A' }, error: null })
})
describe('authorized company payroll writer', () => {
  it('uses one guarded write with synchronized aliases', async () => {
    await saveCompanyPayrollSettings('company-A', input)
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith()
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ company_id: 'company-A', payday_day: 31, payroll_day_of_month: 31, advances_enabled: false, allow_advances: false }), { onConflict: 'company_id' })
  })
  it.each(['company-B', ''])('rejects a stale or missing company %s without any database write', async (company) => {
    await expect(saveCompanyPayrollSettings(company, input)).rejects.toThrow(/Firma se změnila/)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('honors an authorization failure before touching settings', async () => {
    mocks.context.mockRejectedValue(new Error('role revoked'))
    await expect(saveCompanyPayrollSettings('company-A', input)).rejects.toThrow('role revoked')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('does not fall back from an active worker company to an admin company', async () => {
    mocks.context.mockResolvedValue({ ok: true, value: { companyId: 'company-A', role: 'worker' } })
    await expect(saveCompanyPayrollSettings('company-A', input)).rejects.toThrow(/oprávnění/)
    await expect(saveCompanyPayrollSettings('company-B', input)).rejects.toThrow(/Firma se změnila/)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejects fractional days rather than silently rounding them', async () => {
    await expect(saveCompanyPayrollSettings('company-A', { ...input, payday: 18.5 })).rejects.toThrow()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('returns a database failure rather than reporting a successful save', async () => {
    mocks.single.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    await expect(saveCompanyPayrollSettings('company-A', input)).rejects.toThrow('permission denied')
  })
})
