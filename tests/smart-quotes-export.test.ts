import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/auth', () => ({ requireCompanyRoleDalContext: mocks.context }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }))
import { readWorkspace } from '../lib/smart-quotes/server'
const companyId = '11111111-1111-4111-8111-111111111111'
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ companyId, supabase: { rpc: mocks.rpc } }) })

describe('smart quote export entitlement', () => {
  it('does not load quote data when only history read is allowed', async () => {
    mocks.rpc.mockResolvedValue({ data: { can_read: true, can_export: false }, error: null })
    await expect(readWorkspace('quote-id', 'export')).rejects.toThrow('oprávnění k exportu')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('get_module_workspace_access', { company: companyId, product: 'smart_quotes' })
  })
  it('fails closed on entitlement lookup failure', async () => {
    mocks.rpc.mockResolvedValue({ data: { can_export: true }, error: { message: 'unavailable' } })
    await expect(readWorkspace(undefined, 'export')).rejects.toThrow('oprávnění k exportu')
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('exports retained history after commercial write access expires', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { can_read: true, can_write: false, can_export: true }, error: null }).mockResolvedValueOnce({ data: { companyId }, error: null })
    expect(await readWorkspace('quote-id', 'export')).toEqual({ companyId })
    expect(mocks.rpc).toHaveBeenLastCalledWith('smart_quotes_read', { target_company_id: companyId, target_quote_id: 'quote-id' })
  })
})
