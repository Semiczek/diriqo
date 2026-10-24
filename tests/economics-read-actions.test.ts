import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), read: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/auth', () => ({ requireCompanyRoleDalContext: mocks.guard }))
vi.mock('@/lib/dal/economics', () => ({ listJobEconomicsSummaries: mocks.read }))
import { readJobEconomicsAction } from '../app/jobs/economics-actions'
const companyId = '11111111-1111-4111-8111-111111111111'
const profileId = '22222222-2222-4222-8222-222222222222'
const jobIds = ['33333333-3333-4333-8333-333333333333']
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ companyId, profileId }); mocks.read.mockResolvedValue([]) })
describe('economics action scope', () => {
  it('pins the company and actor before any financial lookup', async () => {
    expect(await readJobEconomicsAction({ companyId, profileId, jobIds })).toEqual({ ok: true, companyId, profileId, summaries: [] })
    expect(mocks.guard).toHaveBeenCalledWith('company_admin', 'super_admin')
  })
  it.each(['companyId', 'profileId'])('rejects stale %s', async key => {
    const result = await readJobEconomicsAction({ companyId, profileId, jobIds, [key]: '44444444-4444-4444-8444-444444444444' })
    expect(result.ok).toBe(false); expect(mocks.read).not.toHaveBeenCalled()
  })
  it('does not expose raw database error details', async () => {
    mocks.read.mockRejectedValueOnce(new Error('secret database error'))
    const result = await readJobEconomicsAction({ companyId, profileId, jobIds })
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('rejects malformed request IDs before authentication or data lookup', async () => {
    expect((await readJobEconomicsAction({ companyId, profileId, jobIds: ['bad'] })).ok).toBe(false)
    expect(mocks.guard).not.toHaveBeenCalled()
  })
})
