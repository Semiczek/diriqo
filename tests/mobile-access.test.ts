import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canUseMobileApp, isMemberWorkspacePath, mobileEntryPath } from '../lib/mobile-access'
import { hasHubAccessRole } from '../lib/hub-access'

const mocks = vi.hoisted(() => ({ access: vi.fn(), licence: vi.fn(), server: vi.fn(), admin: vi.fn(), rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/server-guards', () => ({ requireWorkerAccess: mocks.access }))
vi.mock('@/lib/module-access', () => ({ requireCompanyModule: mocks.licence }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.server }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
import { mobileContext, readManagerMobileOverview, readMyMobileWork, readMyOpenShifts } from '../app/mobile/data'

const company = '11111111-1111-4111-8111-111111111111'
const profile = '22222222-2222-4222-8222-222222222222'
const otherCompany = '33333333-3333-4333-8333-333333333333'
function query(data: unknown[] = [], count = data.length, error: unknown = null) {
  const result = { data, count, error }
  const builder = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), limit: vi.fn(), in: vi.fn(), then: (resolve: (result: unknown) => unknown) => Promise.resolve(result).then(resolve) }
  for (const key of ['select', 'eq', 'is', 'order', 'limit', 'in'] as const) builder[key].mockReturnValue(builder)
  return builder
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ ok: true, value: { companyId: company, profileId: profile, role: 'manager' } })
  mocks.licence.mockResolvedValue({ ok: true })
  mocks.server.mockResolvedValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: ['inventory', 'ai_assistant'], error: null })
})

describe('mobile app authorization', () => {
  it('does not turn manager into Core administrator', () => {
    expect(canUseMobileApp('manager', 'manager')).toBe(true)
    expect(hasHubAccessRole('manager')).toBe(false)
    expect(canUseMobileApp('worker', 'manager')).toBe(false)
    expect(canUseMobileApp('worker', 'my')).toBe(true)
    expect(canUseMobileApp('owner', 'manager')).toBe(false)
    expect(canUseMobileApp(null, 'my')).toBe(false)
  })
  it('accepts only known app destinations and exact path segments', () => {
    expect(mobileEntryPath('my')).toBe('/mobile/my')
    expect(mobileEntryPath('manager')).toBe('/mobile/manager')
    for (const value of ['//evil.test', 'https://evil.test', '/mobile/my', '../admin', 'manager/admin', '']) expect(mobileEntryPath(value)).toBeNull()
    expect(isMemberWorkspacePath('/api/job-photos/url')).toBe(true)
    expect(isMemberWorkspacePath('/mobile/manager')).toBe(true)
    for (const value of ['/jobs', '/workers', '/api/job-photos-admin', '/mobile/managerial']) expect(isMemberWorkspacePath(value)).toBe(false)
  })
  it('blocks an unauthenticated or demoted manager before privileged reads', async () => {
    mocks.access.mockResolvedValue({ ok: false, error: 'Forbidden' })
    await expect(readManagerMobileOverview()).rejects.toThrow('Přihlaste')
    mocks.access.mockResolvedValue({ ok: true, value: { companyId: company, profileId: profile, role: 'worker' } })
    await expect(readManagerMobileOverview()).rejects.toThrow('manažerům')
    expect(mocks.licence).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('requires an active Core licence before manager or employee data', async () => {
    mocks.licence.mockResolvedValue({ ok: false, error: 'MODULE_REQUIRED' })
    await expect(readManagerMobileOverview()).rejects.toThrow('aktivní Diriqo Core')
    await expect(readMyMobileWork()).rejects.toThrow('aktivní Diriqo Core')
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.server).not.toHaveBeenCalled()
    expect(mocks.licence).toHaveBeenCalledWith(company, 'jobs', 'core.jobs.update')
  })
  it('keeps the selected worker membership instead of seeking a manager in another company', async () => {
    mocks.access.mockResolvedValue({ ok: true, value: { companyId: company, profileId: profile, role: 'worker', companyMemberships: [{ companyId: otherCompany, role: 'manager' }] } })
    await expect(mobileContext('manager')).rejects.toThrow('manažerům')
  })
  it('scopes all privileged operational reads and name lookups to verified company rows', async () => {
    const jobs = query([{ id: 'job1', title: 'Work' }], 200)
    const members = query([{ id: 'member1', profile_id: profile, role: 'worker' }])
    const shifts = query([{ id: 'shift1', profile_id: profile, job_id: 'job1' }])
    const profiles = query([{ id: profile, full_name: 'Test Worker' }])
    const builders: Record<string, ReturnType<typeof query>> = { jobs, company_members: members, work_shifts: shifts, profiles }
    mocks.admin.mockReturnValue({ from: vi.fn((table: string) => builders[table]) })
    const result = await readManagerMobileOverview()
    for (const builder of [jobs, members, shifts]) {
      expect(builder.eq).toHaveBeenCalledWith('company_id', company)
      expect(builder.limit).toHaveBeenCalledWith(100)
    }
    expect(members.eq).toHaveBeenCalledWith('is_active', true)
    expect(shifts.is).toHaveBeenCalledWith('ended_at', null)
    expect(profiles.in).toHaveBeenCalledWith('id', [profile])
    expect(profiles.select).toHaveBeenCalledWith('id, full_name')
    expect(result.names.get(profile)).toBe('Test Worker')
    expect(result.jobCount).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('module_navigation', { company })
  })
  it('scopes personal work to both employee and company and rejects foreign nested jobs', async () => {
    const assignments = query([{ id: 'a1', job_id: 'j1', jobs: { id: 'j1', company_id: company, title: 'Allowed' } }, { id: 'a2', job_id: 'j2', jobs: { id: 'j2', company_id: otherCompany, title: 'Foreign' } }])
    const shifts = query([])
    mocks.server.mockResolvedValue({ from: vi.fn((table: string) => table === 'job_assignments' ? assignments : shifts) })
    const result = await readMyMobileWork()
    expect(result.jobs.map(job => job.title)).toEqual(['Allowed'])
    for (const builder of [assignments, shifts]) {
      expect(builder.eq).toHaveBeenCalledWith('company_id', company)
      expect(builder.eq).toHaveBeenCalledWith('profile_id', profile)
    }
    expect(assignments.eq).toHaveBeenCalledWith('jobs.company_id', company)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('does not return a misleading empty overview after a query failure', async () => {
    mocks.admin.mockReturnValue({ from: vi.fn(() => query([], 0, { message: 'failure' })) })
    await expect(readManagerMobileOverview()).rejects.toThrow('nepodařilo')
  })
  it('includes an older assigned job with a running shift beyond the latest 100 assignments', async () => {
    const latestRows = Array.from({ length: 100 }, (_, index) => ({ id: `a${index}`, job_id: `j${index}`, jobs: { id: `j${index}`, company_id: company, title: `Recent ${index}` } }))
    const latest = query(latestRows, 250)
    const shifts = query([{ id: 'running', job_id: 'old-job' }])
    const older = query([{ id: 'old-assignment', job_id: 'old-job', jobs: { id: 'old-job', company_id: company, title: 'Old running work' } }])
    const from = vi.fn().mockReturnValueOnce(latest).mockReturnValueOnce(shifts).mockReturnValueOnce(older)
    mocks.server.mockResolvedValue({ from })
    const result = await readMyMobileWork()
    expect(result.jobs).toHaveLength(101)
    expect(result.jobs[0]).toMatchObject({ jobId: 'old-job', openShiftId: 'running' })
    expect(result.total).toBe(250)
    expect(result.openShiftCount).toBe(1)
    expect(older.in).toHaveBeenCalledWith('job_id', ['old-job'])
    expect(older.eq).toHaveBeenCalledWith('company_id', company)
    expect(older.eq).toHaveBeenCalledWith('profile_id', profile)
    expect(older.eq).toHaveBeenCalledWith('jobs.company_id', company)
  })
  it('does not reload or duplicate already displayed running assignments', async () => {
    const latest = query([{ id: 'a1', job_id: 'j1', jobs: { id: 'j1', company_id: company, title: 'Running' } }])
    const shifts = query([{ id: 'shift1', job_id: 'j1' }])
    const from = vi.fn().mockReturnValueOnce(latest).mockReturnValueOnce(shifts)
    mocks.server.mockResolvedValue({ from })
    expect((await readMyMobileWork()).jobs).toHaveLength(1)
    expect(from).toHaveBeenCalledTimes(2)
  })
  it('makes settlement-only access available without Core and even after assignment removal', async () => {
    mocks.access.mockResolvedValue({ ok: true, value: { companyId: company, profileId: profile, role: 'worker' } })
    mocks.licence.mockResolvedValue({ ok: false, error: 'EXPIRED' })
    const shifts = query([{ id: 'shift1', job_id: 'orphan-job', started_at: '2026-10-11T09:00:00Z' }])
    const jobs = query([{ id: 'orphan-job', title: 'Work to finish' }])
    const from = vi.fn().mockReturnValueOnce(shifts).mockReturnValueOnce(jobs)
    mocks.admin.mockReturnValue({ from })
    const result = await readMyOpenShifts()
    expect(mocks.licence).not.toHaveBeenCalled()
    expect(shifts.eq).toHaveBeenCalledWith('company_id', company)
    expect(shifts.eq).toHaveBeenCalledWith('profile_id', profile)
    expect(shifts.is).toHaveBeenCalledWith('ended_at', null)
    expect(jobs.eq).toHaveBeenCalledWith('company_id', company)
    expect(jobs.in).toHaveBeenCalledWith('id', ['orphan-job'])
    expect(from.mock.calls.map(call => call[0])).toEqual(['work_shifts', 'jobs'])
    expect(result.shifts).toEqual([{ id: 'shift1', job_id: 'orphan-job', title: 'Work to finish', started_at: '2026-10-11T09:00:00Z' }])
  })
  it('does not expose settlement data to a revoked membership', async () => {
    mocks.access.mockResolvedValue({ ok: false, error: 'Revoked' })
    await expect(readMyOpenShifts()).rejects.toThrow('Přihlaste')
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
