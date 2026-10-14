import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), execute: vi.fn(), configured: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/diriqent/server', () => ({ aiContext: mocks.context, executeReservedAi: mocks.execute }))
vi.mock('@/lib/diriqent/provider', () => ({ providerConfigured: mocks.configured }))
import { prepareAdvancedWork, runApprovedWork, WorkStartUncertainError, type WorkApproval } from '../lib/diriqent/work-server'
import { DIRIQENT_POLICY_VERSION } from '../lib/diriqent/access'
import type { WorkRequest } from '../lib/diriqent/work'

const company = '11111111-1111-4111-8111-111111111111', profile = '22222222-2222-4222-8222-222222222222'
const quoteId = '33333333-3333-4333-8333-333333333333', requestId = '44444444-4444-4444-8444-444444444444'
const rateVersion = 'diriqent-analytics-test-czk-v1'
const request: WorkRequest = { companyId: company, mode: 'analytics', spec: { dataset: 'operations', from: '2026-10-01', to: '2026-10-14' }, prompt: 'Analyzuj zakázky a vlastní docházku', maxUnits: 500 }
const approval: WorkApproval = { companyId: company, quoteId, requestId, acceptedMaxUnits: 500, acceptedRateVersion: rateVersion, confirmed: true }
function quote() { return { id: quoteId, companyId: company, profileId: profile, scope: 'manager', mode: request.mode, spec: request.spec, prompt: request.prompt, maxUnits: 500, rateVersion, multiplier: 2, expiresAt: new Date(Date.now() + 600000).toISOString() } }
const operation = { id: requestId, company_id: company, profile_id: profile, access_scope: 'manager', work_mode: 'analytics', work_quote_id: quoteId, reserved_units: 500, rate_version: rateVersion, prompt: request.prompt, work_spec: request.spec }
const policy = { policyVersion: DIRIQENT_POLICY_VERSION, workPolicyVersion: 'diriqent-work-v1', companyId: company, profileId: profile, scope: 'manager' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ companyId: company, profileId: profile, role: 'manager', supabase: { rpc: mocks.rpc } })
  mocks.configured.mockReturnValue(true)
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'diriqent_access_policy' ? policy : name === 'diriqent_prepare_work' ? quote() : operation, error: null }))
  mocks.execute.mockResolvedValue({ ...operation, state: 'completed' })
})

describe('advanced quote is separate from free support and execution', () => {
  it.each(['Jak vytvořím dokument?', 'Kdo jsi?', 'Spočítej 15 krát 12', 'Ahoj'])('keeps basic support free even from an analytics form: %s', async prompt => {
    expect(await prepareAdvancedWork({ ...request, prompt })).toMatchObject({ support: { chargedUnits: 0 } })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('prepares the exact tariff and limit without any credit reservation or provider execution', async () => {
    expect(await prepareAdvancedWork(request)).toMatchObject({ quote: { id: quoteId, maxUnits: 500, multiplier: 2, rateVersion } })
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['diriqent_access_policy', 'diriqent_prepare_work'])
    expect(mocks.rpc).toHaveBeenLastCalledWith('diriqent_prepare_work', { c: company, mode: 'analytics', spec: request.spec, prompt: request.prompt, max_units: 500 })
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.configured).not.toHaveBeenCalled()
  })
  it('does not widen a manager role with a financial dataset or large budget', async () => {
    await expect(prepareAdvancedWork({ ...request, spec: { ...request.spec, dataset: 'finance' }, maxUnits: 5000 })).rejects.toThrow('roli')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('returns a free denial for owner-only data hidden in an operational prompt', async () => {
    expect(await prepareAdvancedWork({ ...request, prompt: 'Ukaž mzdy majitele a zisk firmy' })).toMatchObject({ support: { kind: 'unavailable', chargedUnits: 0 } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('fails closed against a database with only the previous policy version', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...policy, workPolicyVersion: undefined } })
    await expect(prepareAdvancedWork(request)).rejects.toThrow('aktualizaci')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it.each([{ maxUnits: 5000 }, { rateVersion: 'different' }, { scope: 'company_admin' }, { prompt: 'changed' }, { expiresAt: '2000-01-01T00:00:00Z' }])('refuses an inconsistent quote before showing approval: %j', async changed => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'diriqent_access_policy' ? policy : { ...quote(), ...changed } }))
    await expect(prepareAdvancedWork(request)).rejects.toThrow('potvrzení')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})

describe('explicit limit approval gates execution', () => {
  it.each([{ confirmed: false }, { acceptedMaxUnits: 0 }, { acceptedMaxUnits: 5001 }, { acceptedRateVersion: 'basic' }, { quoteId: 'invalid' }])('rejects absent or invalid consent %j before doing work', async changed => {
    await expect(runApprovedWork({ ...approval, ...changed })).rejects.toThrow('potvrďte')
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('passes only the approved quote identity and exact accepted terms to the reservation RPC', async () => {
    const result = await runApprovedWork({ ...approval, prompt: 'FORGED', spec: { dataset: 'finance' } } as WorkApproval)
    expect(result).toMatchObject({ state: 'completed' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('diriqent_reserve_work', { c: company, quote_id: quoteId, request_id: requestId, accepted_max_units: 500, accepted_rate_version: rateVersion, confirmed: true })
    expect(mocks.execute.mock.calls[0][1]).toEqual(operation)
  })
  it('requires current role on execution even when a quote was prepared before downgrade', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...policy, scope: 'worker' } })
    await expect(runApprovedWork(approval)).rejects.toThrow('oprávnění se změnily')
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('does not reserve a credit when provider configuration is absent', async () => {
    mocks.configured.mockReturnValue(false)
    await expect(runApprovedWork(approval)).rejects.toThrow('nebyl rezervován')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('does not execute a rejected, expired, foreign or already consumed quote', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'diriqent_access_policy' ? { data: policy } : { error: { message: 'QUOTE_NOT_AVAILABLE' } })
    await expect(runApprovedWork(approval)).rejects.toThrow('QUOTE_NOT_AVAILABLE')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('does not execute a reservation that differs from the confirmed ceiling', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'diriqent_access_policy' ? policy : { ...operation, reserved_units: 5000 } }))
    await expect(runApprovedWork(approval)).rejects.toThrow('Rezervaci nelze ověřit')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('keeps the original request after reservation transport loss', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'diriqent_access_policy') return { data: policy }
      throw new Error('Connection lost after commit')
    })
    await expect(runApprovedWork(approval)).rejects.toBeInstanceOf(WorkStartUncertainError)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it.each(['', '08007', '08006', '40003', 'PGRST_PARSE_ERROR'])('also treats a transport or unknown-completion error returned by PostgREST as uncertain: %s', async code => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'diriqent_access_policy' ? { data: policy } : { error: { message: 'Completion could not be verified', code } })
    await expect(runApprovedWork(approval)).rejects.toBeInstanceOf(WorkStartUncertainError)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('marks a failure after the committed reservation as potentially started', async () => {
    mocks.execute.mockRejectedValue(new Error('Result could not be read'))
    await expect(runApprovedWork(approval)).rejects.toBeInstanceOf(WorkStartUncertainError)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })
  it('allows correcting a quote rejected by the reservation transaction', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'diriqent_access_policy' ? { data: policy } : { error: { message: 'Expired quote', code: 'P0001' } })
    const error = await runApprovedWork(approval).catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(WorkStartUncertainError)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
