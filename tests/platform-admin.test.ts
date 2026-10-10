import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), rpc: vi.fn(), from: vi.fn(), admin: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }),
}))
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }),
}))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`) } }))

import { requireSuperAdmin, logSuperadminAction } from '../lib/superadmin'
import { proxy } from '../proxy'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'auth-A', email: 'test@example.invalid' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: false, error: null })
  // Platform authorization must not derive authority from any tenant table.
  mocks.from.mockImplementation(() => { throw new Error('unexpected tenant query') })
})

describe('server platform guard', () => {
  it.each([false, null, 'true', 1, { is_super_admin: true }])('denies non-boolean grant %j', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    await expect(requireSuperAdmin()).rejects.toThrow('redirect:/sign-in?error=no-hub-access')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('denies RPC error even when data is true', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: { message: 'unavailable' } })
    await expect(requireSuperAdmin()).rejects.toThrow('redirect:')
  })

  it('denies missing RPC or transport failure', async () => {
    mocks.rpc.mockRejectedValue(new Error('RPC missing'))
    await expect(requireSuperAdmin()).rejects.toThrow('redirect:')
  })

  it('requires verified Auth before checking the grant', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'auth-A' } }, error: { message: 'invalid token' } })
    await expect(requireSuperAdmin()).rejects.toThrow('redirect:')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('allows an independent operator without any company/profile', async () => {
    mocks.rpc.mockImplementation(async (name) => ({ data: name === 'is_super_admin' ? true : null, error: null }))
    await expect(requireSuperAdmin()).resolves.toMatchObject({ authUserId: 'auth-A', profileId: null })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('checks revocation afresh on every invocation', async () => {
    mocks.rpc.mockImplementation(async (name) => ({ data: name === 'is_super_admin' ? true : null, error: null }))
    await expect(requireSuperAdmin()).resolves.toMatchObject({ authUserId: 'auth-A' })
    mocks.rpc.mockResolvedValue({ data: false, error: null })
    await expect(requireSuperAdmin()).rejects.toThrow('redirect:')
  })

  it('writes the Auth actor even without a legacy profile', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    mocks.admin.mockReturnValue({ from: () => ({ insert }) })
    await logSuperadminAction({ superadminAuthUserId: 'auth-A', superadminProfileId: null, action: 'company_opened' })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ actor_auth_user_id: 'auth-A', superadmin_user_id: null }))
  })
})

describe('admin route proxy', () => {
  it.each(['/admin', '/admin/companies', '/admin/companies/company-B'])('denies ungranted %s without tenant fallback', async (path) => {
    const response = await proxy(new NextRequest(`https://test.example${path}`))
    expect(response.headers.get('location')).toBe('https://test.example/sign-in?error=no-hub-access')
    expect(mocks.rpc).toHaveBeenCalledWith('is_super_admin')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('allows an operator without sending them to company onboarding', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    const response = await proxy(new NextRequest('https://test.example/admin/companies'))
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('denies invalid Auth before RPC', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const response = await proxy(new NextRequest('https://test.example/admin'))
    expect(response.headers.get('location')).toBe('https://test.example/sign-in')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('fails closed on RPC outage', async () => {
    mocks.rpc.mockRejectedValue(new Error('connection unavailable'))
    const response = await proxy(new NextRequest('https://test.example/admin'))
    expect(response.headers.get('location')).toContain('error=no-hub-access')
  })
})
