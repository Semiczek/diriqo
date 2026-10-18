import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), admin: vi.fn(), provider: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/auth', () => ({ requireCompanyRoleDalContext: mocks.context }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
vi.mock('@/lib/smart-quotes/server', () => ({ quoteError: (e: Error) => e.message }))
vi.mock('@/lib/diriqent/provider', () => ({ providerConfigured: mocks.provider, createResponse: vi.fn(), retrieveResponse: vi.fn(), requestBody: vi.fn(), responseText: vi.fn(), responseUsage: vi.fn(), ProviderRejectedError: class extends Error {} }))
import { aiWorkspace, readOwnAiOperation, startAi } from '../lib/diriqent/server'
import { DIRIQENT_POLICY_VERSION } from '../lib/diriqent/access'
const id = '11111111-1111-4111-8111-111111111111'
const input = { companyId: 'company-a', requestId: id, kind: 'chat' as const, prompt: 'Porovnej zakázky', conversationId: null, maxUnits: 100 }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ companyId: 'company-a', profileId: 'person-a', role: 'manager', supabase: { rpc: mocks.rpc } })
  mocks.rpc.mockResolvedValue({ error: null, data: { policyVersion: DIRIQENT_POLICY_VERSION, companyId: 'company-a', profileId: 'person-a', scope: 'manager' } })
})
describe('paid-work preflight and role authority', () => {
  it('stops on a missing database policy before any credit or provider work', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'missing function' } })
    await expect(startAi(input)).rejects.toThrow('aktualizaci')
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('diriqent_access_policy', { c: 'company-a' })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.provider).not.toHaveBeenCalled()
  })
  it('stops if membership changed between authentication and database preflight', async () => {
    mocks.rpc.mockResolvedValue({ data: { policyVersion: DIRIQENT_POLICY_VERSION, companyId: 'company-a', profileId: 'person-a', scope: 'worker' } })
    await expect(startAi(input)).rejects.toThrow('oprávnění se změnily')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('rejects a forged owner-only proposal even with a large budget', async () => {
    await expect(startAi({ ...input, kind: 'proposal', maxUnits: 5000 })).rejects.toThrow('správce firmy')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('does not reserve credit when the provider is unconfigured', async () => {
    mocks.provider.mockReturnValue(false)
    await expect(startAi(input)).rejects.toThrow('serverový klíč')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
describe('history and individual operation after downgrade', () => {
  it('rejects privileged conversation titles as well as operation data', async () => {
    mocks.rpc.mockResolvedValue({ data: { policyVersion: DIRIQENT_POLICY_VERSION, conversations: [{ access_scope: 'company_admin', title: 'OWNER SECRET' }], operations: [], proposals: [] } })
    await expect(aiWorkspace()).rejects.toThrow('Historie není dostupná')
  })
  it('rejects privileged individual results used by polling, source and OCR-to-quote paths', async () => {
    mocks.rpc.mockResolvedValue({ data: { policyVersion: DIRIQENT_POLICY_VERSION, access_scope: 'company_admin', result: 'OWNER SECRET' } })
    await expect(readOwnAiOperation('company-a', id)).rejects.toThrow('Historie není dostupná')
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('returns allowed operational history with proposal creation disabled', async () => {
    mocks.rpc.mockResolvedValue({ data: { policyVersion: DIRIQENT_POLICY_VERSION, companyId: 'company-a', profileId: 'person-a', conversations: [], operations: [{ access_scope: 'manager' }], proposals: [] } })
    expect(await aiWorkspace()).toMatchObject({ roleScope: 'manager', canCreateJobs: false, operations: [{ access_scope: 'manager' }] })
  })
})
