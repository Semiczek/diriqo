import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), admin: vi.fn(), redirect: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }) }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { getPortalUserContext, requirePortalUserContext } from '../lib/customer-portal/auth'

const AUTH = '10000000-0000-4000-8000-000000000001'
const row = {
  portalUserId: '10000000-0000-4000-8000-000000000002',
  companyId: '10000000-0000-4000-8000-000000000003',
  customerId: '10000000-0000-4000-8000-000000000004',
  contactId: null, email: 'portal@example.invalid', fullName: 'Customer contact', customerName: 'Customer',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: AUTH } }, error: null })
  mocks.rpc.mockResolvedValue({ data: { ...row }, error: null })
  mocks.redirect.mockImplementation(() => { throw new Error('REDIRECT') })
})

describe('customer portal context', () => {
  it('uses the verified Auth identity and only the current-user scoped RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...row, authUserId: 'wrong-identity', internalCost: 123.45 }, error: null })
    expect(await getPortalUserContext()).toEqual({ ...row, authUserId: AUTH })
    expect(mocks.getUser).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('get_customer_portal_context')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: AUTH } }, error: { message: 'expired' } },
  ])('does not fetch a context without a verified user: %j', async value => {
    mocks.getUser.mockResolvedValue(value)
    expect(await getPortalUserContext()).toBeNull()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('fails closed on an RPC error even if a stale payload accompanies it', async () => {
    mocks.rpc.mockResolvedValue({ data: row, error: { message: 'forbidden' } })
    expect(await getPortalUserContext()).toBeNull()
  })

  it.each([
    null, [], [row], 'unexpected', { ...row, companyId: null }, { ...row, customerId: '' },
    { ...row, portalUserId: '' }, { ...row, email: null }, { ...row, fullName: {} },
    { ...row, customerName: undefined }, { ...row, contactId: 2 },
  ])('fails closed on missing, ambiguous or malformed context: %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect(await getPortalUserContext()).toBeNull()
  })

  it('keeps optional contact and name values explicitly null', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...row, contactId: null, fullName: null, customerName: null }, error: null })
    expect(await getPortalUserContext()).toEqual({ ...row, contactId: null, fullName: null, customerName: null, authUserId: AUTH })
  })

  it('rechecks revoked access on the next request with the same Auth identity', async () => {
    expect(await getPortalUserContext()).not.toBeNull()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(await getPortalUserContext()).toBeNull()
    expect(mocks.getUser).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })

  it('redirects missing access to portal login', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(requirePortalUserContext()).rejects.toThrow('REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith('/portal/login')
  })
})
