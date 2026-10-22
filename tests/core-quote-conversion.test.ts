import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCoreQuoteConversion, type CoreQuoteConversionInput } from '../lib/core-quote-conversion'
const mocks = vi.hoisted(() => ({
  guard: vi.fn(), auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn(),
  DalAuthError: class extends Error {},
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/dal/auth', () => ({
  requireCompanyRoleDalContext: mocks.guard, requireHubDalContext: mocks.guard, DalAuthError: mocks.DalAuthError,
}))
import { createJobFromQuoteAction } from '../app/business-actions'
const companyId = 'a1111111-1111-4111-8111-111111111111'
const otherCompany = 'a2222222-2222-4222-8222-222222222222'
const quoteId = 'b1111111-1111-4111-8111-111111111111'
const operationId = 'c1111111-1111-4111-8111-111111111111'
const jobId = 'd1111111-1111-4111-8111-111111111111'
const versionId = 'e1111111-1111-4111-8111-111111111111'
const input: CoreQuoteConversionInput = {
  companyId, quoteId, operationId, versionId, title: 'Úklid', description: 'Rozpis', address: 'Test',
  startAt: '2026-10-19T08:00:00.000Z', endAt: '2026-10-21T16:00:00.000Z',
  splitDays: [
    { label: 'Pondělí', startAt: '2026-10-19T08:00:00.000Z', endAt: '2026-10-19T16:00:00.000Z' },
    { label: 'Středa', startAt: '2026-10-21T08:00:00.000Z', endAt: '2026-10-21T16:00:00.000Z' },
  ],
}
const successful = () => ({ companyId, quoteId, versionId, jobId, created: true })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({ companyId, profileId: 'verified-profile', role: 'company_admin',
    supabase: { auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from } })
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: successful(), error: null })
  mocks.from.mockImplementation(() => { throw new Error('Split table access is forbidden') })
})

describe('core quote conversion action', () => {
  it('sends the entire tree in one authenticated company-scoped operation', async () => {
    expect(await createJobFromQuoteAction(input)).toEqual({ ok: true, data: { jobId, created: true } })
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('company_admin', 'super_admin')
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('convert_core_quote_to_job_atomic', {
      p_company_id: companyId, p_quote_id: quoteId, p_version_id: versionId, p_operation_id: operationId,
      p_input: { title: input.title, description: input.description, address: input.address, start_at: input.startAt,
        end_at: input.endAt, split_days: input.splitDays.map(d => ({ label: d.label, start_at: d.startAt, end_at: d.endAt })) },
    })
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0])
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith('/jobs/' + jobId)
  })
  it('preserves the one selected child instead of silently converting the whole period to a standalone job', async () => {
    await createJobFromQuoteAction({ ...input, splitDays: [input.splitDays[1]] })
    expect(mocks.rpc.mock.calls[0][1].p_input.split_days).toEqual([
      { label: 'Středa', start_at: input.splitDays[1].startAt, end_at: input.splitDays[1].endAt },
    ])
  })
  it('uses no split children for a standalone job', async () => {
    await createJobFromQuoteAction({ ...input, splitDays: [] })
    expect(mocks.rpc.mock.calls[0][1].p_input.split_days).toEqual([])
  })
  it('returns an authoritative completed replay without any table query or fresh operation ID', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...successful(), created: false }, error: null })
    expect(await createJobFromQuoteAction(input)).toEqual({ ok: true, data: { jobId, created: false } })
    expect(mocks.rpc.mock.calls[0][1].p_operation_id).toBe(operationId)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejects a form belonging to the previous company before any RPC', async () => {
    expect(await createJobFromQuoteAction({ ...input, companyId: otherCompany })).toMatchObject({ ok: false, code: 'forbidden', uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires current authentication and fresh server authorization', async () => {
    mocks.guard.mockRejectedValueOnce(new mocks.DalAuthError('not a company admin'))
    expect(await createJobFromQuoteAction(input)).toMatchObject({ ok: false, code: 'forbidden' })
    mocks.auth.mockResolvedValue({ data: { user: null }, error: null })
    expect(await createJobFromQuoteAction(input)).toMatchObject({ ok: false, code: 'forbidden' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    ['QUOTE_CUSTOMER_FORBIDDEN', 'forbidden'], ['QUOTE_CUSTOMER_MODULE_REQUIRED', 'forbidden'],
    ['QUOTE_CUSTOMER_SCOPE_INVALID', 'forbidden'], ['QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE', 'conflict'],
    ['CORE_QUOTE_FORBIDDEN', 'forbidden'], ['CORE_QUOTE_MODULE_REQUIRED', 'forbidden'],
    ['CORE_QUOTE_SCOPE_INVALID', 'forbidden'], ['CORE_QUOTE_NOT_FOUND', 'forbidden'],
    ['CORE_QUOTE_VERSION_REQUIRED', 'conflict'], ['CORE_QUOTE_VERSION_CONFLICT', 'conflict'], ['CORE_QUOTE_ACCEPTANCE_REQUIRED', 'conflict'],
    ['CORE_QUOTE_INPUT_INVALID', 'validation'], ['CORE_QUOTE_STATUS_INVALID', 'conflict'],
    ['CORE_QUOTE_REQUEST_CONFLICT', 'conflict'], ['CORE_QUOTE_ALREADY_CONVERTED', 'conflict'],
    ['CORE_QUOTE_LEGACY_CONVERSION', 'unavailable'], ['CORE_QUOTE_RESULT_MISSING', 'unavailable'],
    ['CORE_QUOTE_CURRENCY_UNSUPPORTED', 'validation'],
  ])('handles %s without exposing SQL or inventing success', async (message, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message, details: 'private provider data' } })
    const result = await createJobFromQuoteAction(input)
    expect(result).toMatchObject({ ok: false, code, uncertain: false })
    expect(JSON.stringify(result)).not.toContain('private provider')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each(['reject', 'error', 'malformed', 'wrong-company', 'wrong-quote', 'bad-id', 'bad-created', 'cache-failure'])(
    'preserves an uncertain outcome after %s and never returns a partial root',
    async failure => {
      if (failure === 'reject') mocks.rpc.mockRejectedValue(new Error('secret connection string'))
      if (failure === 'error') mocks.rpc.mockResolvedValue({ data: null, error: { code: '503', message: 'secret proxy failure' } })
      if (failure === 'malformed') mocks.rpc.mockResolvedValue({ data: null, error: null })
      if (failure === 'wrong-company') mocks.rpc.mockResolvedValue({ data: { ...successful(), companyId: otherCompany }, error: null })
      if (failure === 'wrong-quote') mocks.rpc.mockResolvedValue({ data: { ...successful(), quoteId: jobId }, error: null })
      if (failure === 'bad-id') mocks.rpc.mockResolvedValue({ data: { ...successful(), jobId: 'secret' }, error: null })
      if (failure === 'bad-created') mocks.rpc.mockResolvedValue({ data: { ...successful(), created: 'true' }, error: null })
      if (failure === 'cache-failure') mocks.revalidate.mockImplementation(() => { throw new Error('secret cache') })
      const original = structuredClone(input), result = await createJobFromQuoteAction(input)
      expect(result).toMatchObject({ ok: false, code: 'unknown', uncertain: true })
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(input).toEqual(original)
      expect(mocks.rpc).toHaveBeenCalledTimes(1)
      expect(mocks.from).not.toHaveBeenCalled()
    },
  )
})

describe('core quote conversion input boundaries', () => {
  it.each([
    { versionId: null }, { versionId: 'invalid' }, { operationId: undefined }, { companyId: 'invalid' }, { quoteId: 'invalid' },
    { title: '' }, { title: 'x'.repeat(301) }, { description: 'x'.repeat(10_001) }, { address: 'x'.repeat(2001) },
    { startAt: '2026-10-19T08:00' }, { startAt: '2026-02-30T08:00:00Z' }, { endAt: input.startAt },
    { splitDays: null }, { splitDays: Array.from({ length: 367 }, () => input.splitDays[0]) },
    { splitDays: [input.splitDays[0], input.splitDays[0]] },
    { splitDays: [{ ...input.splitDays[0], startAt: '2026-10-18T08:00:00Z' }] },
    { splitDays: [{ ...input.splitDays[1], endAt: '2026-10-22T08:00:00Z' }] },
    { splitDays: [{ ...input.splitDays[0], label: '' }] },
  ])('rejects invalid payload before any mutation: %j', async change => {
    const result = await createJobFromQuoteAction({ ...input, ...change } as CoreQuoteConversionInput)
    expect(result).toMatchObject({ ok: false, code: 'validation', uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('normalizes offsets and ordering without accepting caller prices', () => {
    const result = parseCoreQuoteConversion({ ...input, title: '  Úklid  ', price: 1,
      companyId: companyId.toUpperCase(), splitDays: [...input.splitDays].reverse(),
      startAt: '2026-10-19T10:00:00+02:00' })
    expect(result).toEqual(input)
    expect(result).not.toHaveProperty('price')
  })
})


describe('historical pending conversion compatibility', () => {
  it('replays the unchanged historical operation without attaching a current version', async () => {
    const historical = { ...input }; delete historical.versionId
    mocks.rpc.mockResolvedValue({ data: { companyId, quoteId, jobId, created: false }, error: null })
    expect(await createJobFromQuoteAction(historical)).toEqual({ ok: true, data: { jobId, created: false } })
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_version_id')
    expect(mocks.rpc.mock.calls[0][1].p_operation_id).toBe(operationId)
    expect(historical).not.toHaveProperty('versionId')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('never accepts a new unversioned conversion as a valid historical replay', async () => {
    const historical = { ...input }; delete historical.versionId
    expect(await createJobFromQuoteAction(historical)).toMatchObject({ ok: false, code: 'unknown', uncertain: true })
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'CORE_QUOTE_VERSION_REQUIRED' } })
    expect(await createJobFromQuoteAction(historical)).toMatchObject({ ok: false, code: 'conflict', uncertain: false })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejects a receipt for another accepted version after the RPC without discarding the request', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...successful(), versionId: quoteId }, error: null })
    expect(await createJobFromQuoteAction(input)).toMatchObject({ ok: false, code: 'unknown', uncertain: true })
    expect(mocks.rpc.mock.calls[0][1].p_version_id).toBe(versionId)
  })
  it('rejects explicitly invalid version identity instead of treating it as a historical request', async () => {
    for (const versionId of [null, '', 'bad', undefined]) {
      expect(await createJobFromQuoteAction({ ...input, versionId } as unknown as CoreQuoteConversionInput)).toMatchObject({ ok: false, code: 'validation' })
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
