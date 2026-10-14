import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/dal/auth', () => ({ requireCompanyRoleDalContext: mocks.context }))
import { readSupportAnswer } from '../lib/diriqent/support-server'
import { GET } from '../app/api/diriqent/context/route'
import { assertDiriqentPolicy, assertDiriqentRecords, canReadDiriqentScope, DIRIQENT_POLICY_VERSION, matchesDiriqentIdentity } from '../lib/diriqent/access'

const identity = { companyId: 'company-a', profileId: 'person-a', role: 'manager' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ ...identity, supabase: { rpc: mocks.rpc } })
})

describe('free support server boundary', () => {
  it.each(['Jak vytvořím dokument?', 'Porovnej zakázky za měsíc', 'Kolik máme na účtu?', 'Nerozumím aplikaci'])('never calls a business or credit RPC for %s', async prompt => {
    const result = await readSupportAnswer(identity, prompt)
    expect(result.chargedUnits).toBe(0)
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith('super_admin', 'company_admin', 'manager', 'worker')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    { companyId: 'other-company' }, { profileId: 'other-person' }, { role: 'company_admin' }, { role: 'worker' },
  ])('rejects stale client identity %j before producing an answer', async changed => {
    await expect(readSupportAnswer({ ...identity, ...changed }, 'Jak vytvořím dokument?')).rejects.toThrow('oprávnění se změnily')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires a fresh active membership for every question', async () => {
    await readSupportAnswer(identity, 'Jak vytvořím dokument?')
    mocks.context.mockRejectedValueOnce(new Error('revoked'))
    await expect(readSupportAnswer(identity, 'Jak vytvořím dokument?')).rejects.toThrow('revoked')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['', ' '.repeat(4), 'x'.repeat(2001), null])('rejects invalid support input without work', async prompt => {
    await expect(readSupportAnswer(identity, prompt)).rejects.toThrow('2 000')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('returns only current identity and prohibits caching', async () => {
    const response = await GET()
    expect(await response.json()).toEqual(identity)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('fails closed on identity refresh after membership removal', async () => {
    mocks.context.mockRejectedValue(new Error('internal secret'))
    const response = await GET()
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('internal secret')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('role scope checks', () => {
  it.each([
    ['worker', 'worker', true], ['worker', 'manager', false], ['worker', 'company_admin', false],
    ['manager', 'worker', true], ['manager', 'manager', true], ['manager', 'company_admin', false],
    ['company_admin', 'company_admin', true], ['super_admin', 'company_admin', true],
    ['owner', 'worker', false], ['manager', undefined, false], ['manager', 'admin', false],
  ])('%s can read %s: %s', (role, scope, allowed) => {
    expect(canReadDiriqentScope(role, scope)).toBe(allowed)
  })
  it('rejects unversioned/old-schema history instead of guessing its sensitivity', () => {
    expect(() => assertDiriqentPolicy({ operations: [] })).toThrow('aktualizaci')
    expect(() => assertDiriqentPolicy({ policyVersion: DIRIQENT_POLICY_VERSION })).not.toThrow()
    expect(() => assertDiriqentRecords('manager', [{ access_scope: 'company_admin', result: 'owner secret' }])).toThrow()
    expect(() => assertDiriqentRecords('manager', [{}])).toThrow()
    expect(() => assertDiriqentRecords('manager', null)).toThrow()
  })
  it('detects role downgrades even when company and account stay the same', () => {
    expect(matchesDiriqentIdentity(identity, identity)).toBe(true)
    expect(matchesDiriqentIdentity({ ...identity, role: 'company_admin' }, identity)).toBe(false)
    expect(matchesDiriqentIdentity(identity, { ...identity, role: 'worker' })).toBe(false)
    expect(matchesDiriqentIdentity(identity, null)).toBe(false)
  })
})
