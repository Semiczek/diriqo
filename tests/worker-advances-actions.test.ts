import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/server-guards', () => ({ requireWorkerAccess: mocks.guard }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from }) }))
import { payAdvanceAction, requestAdvanceAction, reviewAdvanceAction, settleAdvanceAction } from '../app/advance-requests/actions'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const profileId = 'b1111111-1111-4111-8111-111111111111'
const requestId = 'c1111111-1111-4111-8111-111111111111'
const operationId = 'd1111111-1111-4111-8111-111111111111'
const paymentId = 'e1111111-1111-4111-8111-111111111111'
const input = { companyId, requestId, profileId, revision: 1, operationId, amount: '1000,00', issuedOn: '2026-10-18', note: '', method: 'cash' as const, reference: '' }
const payment = () => ({ id: paymentId, company_id: companyId, profile_id: profileId, advance_request_id: requestId,
  operation_id: operationId, amount: 1000, issued_at: '2026-10-18', payment_method: 'cash', payment_reference: null })
const request = () => ({ id: requestId, company_id: companyId, profile_id: profileId, revision: 2, status: 'approved', requested_amount: 5000, amount: 3000 })
const result = () => ({ request: request(), payment: payment(), paid_total: 1000, remaining_amount: 2000, changed: true })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({ ok: true, value: { companyId, profileId, role: 'company_admin' } })
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: result(), error: null })
  mocks.from.mockImplementation(() => { throw new Error('No split financial table writes allowed') })
})

describe('advance server action boundary', () => {
  it('uses one authenticated scoped RPC; browser cannot pick another company', async () => {
    expect(await payAdvanceAction(input)).toMatchObject({ ok: true, data: { changed: true } })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('pay_worker_advance_atomic', {
      target_company_id: companyId, target_profile_id: profileId, target_request_id: requestId, operation_id: operationId,
      payment_amount: '1000.00', issued_on: '2026-10-18', payment_note: '', expected_revision: 1, payment_method: 'cash', payment_reference: '',
    })
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0])
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith(`/workers/${profileId}`)
  })
  it.each(['worker', 'manager'])('does not let %s approve or pay', async role => {
    mocks.guard.mockResolvedValue({ ok: true, value: { companyId, profileId, role } })
    expect(await payAdvanceAction(input)).toMatchObject({ ok: false, uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not switch a worker to an admin membership in a different company', async () => {
    expect(await payAdvanceAction({ ...input, companyId: operationId })).toMatchObject({ ok: false, uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects expired authentication before invoking the database', async () => {
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null })
    expect(await payAdvanceAction(input)).toMatchObject({ ok: false, uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('accepts an original operation retry and forwards the same id and payload', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), changed: false }, error: null })
    expect(await payAdvanceAction(input)).toMatchObject({ ok: true, data: { changed: false } })
    expect(mocks.rpc.mock.calls[0][1].operation_id).toBe(operationId)
  })
  it.each(['ADVANCE_STALE', 'ADVANCE_OPERATION_CONFLICT', 'ADVANCE_MODULE_REQUIRED', 'ADVANCE_BALANCE_EXCEEDED'])('shows definite %s failure without inventing success', async message => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } })
    expect(await payAdvanceAction(input)).toMatchObject({ ok: false, uncertain: false })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('keeps an unconfirmed timeout eligible only for the same-operation retry', async () => {
    mocks.rpc.mockRejectedValue(new Error('network timeout'))
    expect(await payAdvanceAction(input)).toMatchObject({ ok: false, uncertain: true })
  })
  it.each(['review', 'pay'])('treats PT409 stale %s as a definite conflict without retrying', async operation => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'ADVANCE_STALE', details: null, hint: null } })
    const response = operation === 'pay' ? await payAdvanceAction(input)
      : await reviewAdvanceAction({ companyId, requestId, revision: 0, operationId, status: 'approved', amount: 3000, reason: 'Dílčí schválení' })
    expect(response).toMatchObject({ ok: false, uncertain: false, error: expect.stringContaining('Žádost mezitím změnil') })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each(['company_id', 'profile_id', 'operation_id'])('does not accept a mismatched payment %s', async key => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), payment: { ...payment(), [key]: requestId } }, error: null })
    expect(await payAdvanceAction(input)).toMatchObject({ ok: false, uncertain: true })
  })
  it('validates precision before any write', async () => {
    expect(await payAdvanceAction({ ...input, amount: '1000.001' })).toMatchObject({ ok: false, uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('allows a worker request only for the authenticated own profile', async () => {
    mocks.guard.mockResolvedValue({ ok: true, value: { companyId, profileId, role: 'worker' } })
    mocks.rpc.mockResolvedValue({ data: { ...result(), payment: undefined, request: { ...request(), status: 'pending', amount: 0, revision: 0 }, paid_total: 0, remaining_amount: 0 }, error: null })
    expect(await requestAdvanceAction({ companyId, requestId, amount: 5000, reason: 'Žádost' })).toMatchObject({ ok: true })
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('target_profile_id')
  })
  it('sends explicit zero approved amount for rejection, not SQL NULL', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), request: { ...request(), status: 'rejected', amount: 0 }, payment: undefined, paid_total: 0, remaining_amount: 0 }, error: null })
    expect(await reviewAdvanceAction({ companyId, requestId, revision: 0, operationId, status: 'rejected', amount: '', reason: 'Zamítnuto' })).toMatchObject({ ok: true })
    expect(mocks.rpc.mock.calls[0][1].approved_amount).toBe('0.00')
  })
  it('records settlement evidence in one RPC tied to the original payment', async () => {
    mocks.rpc.mockResolvedValue({ data: { payment: payment(), settlement: { company_id: companyId, worker_advance_id: paymentId, operation_id: operationId, amount: 1000, method: 'returned', reference: 'Pokladní doklad1', settled_on: '2026-10-18' }, settled_total: 1000, outstanding_amount: 0, changed: true }, error: null })
    expect(await settleAdvanceAction({ companyId, paymentId, operationId, amount: 1000, method: 'returned', reference: 'Pokladní doklad1', settledOn: '2026-10-18' })).toMatchObject({ ok: true })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc.mock.calls[0][0]).toBe('settle_worker_advance_atomic')
  })
})
