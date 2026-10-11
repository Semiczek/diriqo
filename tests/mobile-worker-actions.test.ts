import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ access: vi.fn(), licence: vi.fn(), server: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/server-guards', () => ({ requireWorkerAccess: mocks.access }))
vi.mock('@/lib/module-access', () => ({ requireCompanyModule: mocks.licence }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.server }))
import { completeMyJobAction, startMyJobShiftAction, stopMyJobShiftAction } from '../app/moje-prace/actions'

const company = '11111111-1111-4111-8111-111111111111'
const profile = '22222222-2222-4222-8222-222222222222'
const job = '33333333-3333-4333-8333-333333333333'
const shift = '44444444-4444-4444-8444-444444444444'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.access.mockResolvedValue({ ok: true, value: { companyId: company, profileId: profile, role: 'worker' } })
  mocks.licence.mockResolvedValue({ ok: true })
  mocks.server.mockResolvedValue({ rpc: mocks.rpc })
  mocks.rpc.mockResolvedValue({ data: { shift_id: shift, job_id: job, reused: false }, error: null })
})
describe('atomic mobile employee actions', () => {
  it('denies all actions without a current membership', async () => {
    mocks.access.mockResolvedValue({ ok: false, error: 'Forbidden' })
    expect((await startMyJobShiftAction({ jobId: job })).ok).toBe(false)
    expect((await stopMyJobShiftAction({ shiftId: shift })).ok).toBe(false)
    expect((await completeMyJobAction({ jobId: job })).ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('checks the paid capability before starting or completing', async () => {
    mocks.licence.mockResolvedValue({ ok: false, error: 'MODULE_REQUIRED' })
    expect(await startMyJobShiftAction({ jobId: job })).toEqual({ ok: false, error: 'MODULE_REQUIRED' })
    expect(await completeMyJobAction({ jobId: job })).toEqual({ ok: false, error: 'MODULE_REQUIRED' })
    expect(mocks.licence).toHaveBeenCalledWith(company, 'shifts', 'core.time.record')
    expect(mocks.licence).toHaveBeenCalledWith(company, 'jobs', 'core.jobs.update')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([false, true])('returns the transaction result (reused=%s) without a second write', async (reused) => {
    mocks.rpc.mockResolvedValue({ data: { shift_id: shift, job_id: job, reused }, error: null })
    expect(await startMyJobShiftAction({ jobId: job })).toEqual({ ok: true, data: { shiftId: shift, reused } })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('mutate_my_job_work', {
      target_company_id: company, operation: 'start', target_job_id: job, target_shift_id: null,
    })
    expect(mocks.revalidate).toHaveBeenCalledWith('/mobile/my')
    expect(mocks.revalidate).toHaveBeenCalledWith('/mobile/manager')
  })
  it('settles an existing own shift after expiry using authenticated RPC', async () => {
    expect(await stopMyJobShiftAction({ shiftId: shift })).toEqual({ ok: true, data: { shiftId: shift, reused: false } })
    expect(mocks.licence).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('mutate_my_job_work', {
      target_company_id: company, operation: 'stop', target_job_id: null, target_shift_id: shift,
    })
  })
  it('completes work atomically', async () => {
    mocks.rpc.mockResolvedValue({ data: { job_id: job, reused: true }, error: null })
    expect(await completeMyJobAction({ jobId: job })).toEqual({ ok: true, data: { jobId: job, reused: true } })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('mutate_my_job_work', {
      target_company_id: company, operation: 'complete', target_job_id: job, target_shift_id: null,
    })
  })
  it.each([
    ['WORK_FORBIDDEN', 'Oprávnění se změnilo. Obnovte přihlášení a výběr firmy.'],
    ['WORK_JOB_NOT_ASSIGNED', 'Zakázka není přiřazena aktuálnímu pracovníkovi.'],
    ['WORK_ALREADY_COMPLETED', 'Dokončenou práci již nelze spustit. Obraťte se na správce.'],
    ['WORK_ANOTHER_SHIFT_RUNNING', 'Už máte spuštěnou jinou směnu. Nejdříve ji ukončete.'],
    ['WORK_MODULE_REQUIRED', 'Pro tuto operaci potřebujete aktivní modul.'],
    ['WORK_MODULE_DISABLED', 'Tento modul je pro aktivní firmu vypnutý.'],
  ])('respects transaction-time denial %s', async (message, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } })
    expect(await startMyJobShiftAction({ jobId: job })).toEqual({ ok: false, error: expected })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('requires ending work before completion even after a stale page was opened', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'WORK_SHIFT_STILL_RUNNING' } })
    expect(await completeMyJobAction({ jobId: job })).toEqual({ ok: false, error: 'Nejdříve ukončete směnu tlačítkem Stop.' })
  })
  it('handles a competing direct write rejected by the unique index', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'private db constraint details' } })
    expect((await startMyJobShiftAction({ jobId: job }))).toEqual({ ok: false, error: 'Už máte spuštěnou jinou směnu. Nejdříve ji ukončete.' })
  })
  it('does not expose database details or retry an uncertain write', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'sensitive sql details' } })
    const result = await startMyJobShiftAction({ jobId: job })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('sensitive')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it.each([null, {}, { job_id: job, reused: 'false' }, { job_id: company, shift_id: shift, reused: false }])(
    'refuses malformed or mismatched success %j', async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null })
      expect((await startMyJobShiftAction({ jobId: job })).ok).toBe(false)
      expect(mocks.revalidate).not.toHaveBeenCalled()
    },
  )
  it('refuses a mismatched shift in the stop response', async () => {
    mocks.rpc.mockResolvedValue({ data: { shift_id: profile, job_id: job, reused: false }, error: null })
    expect((await stopMyJobShiftAction({ shiftId: shift })).ok).toBe(false)
  })
  it('does not call the database for an invalid identifier', async () => {
    expect((await startMyJobShiftAction({ jobId: 'not-a-uuid' })).ok).toBe(false)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('canonicalizes valid uppercase identifiers before comparing the result', async () => {
    const upperJob = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'
    const upperShift = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB'
    mocks.rpc.mockResolvedValue({ data: { shift_id: shift, job_id: upperJob.toLowerCase(), reused: false }, error: null })
    expect((await startMyJobShiftAction({ jobId: upperJob })).ok).toBe(true)
    mocks.rpc.mockResolvedValue({ data: { shift_id: upperShift.toLowerCase(), job_id: job, reused: false }, error: null })
    expect((await stopMyJobShiftAction({ shiftId: upperShift })).ok).toBe(true)
  })
  it('reports transport rejection as uncertain without leaking details or replaying', async () => {
    mocks.rpc.mockRejectedValue(new Error('private provider details'))
    const result = await startMyJobShiftAction({ jobId: job })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('private provider')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
