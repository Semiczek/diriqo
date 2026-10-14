import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), start: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/diriqent/server', () => ({ aiContext: mocks.context, startAi: mocks.start, aiError: (e: Error) => e.message, pollAi: vi.fn(), readOwnAiOperation: vi.fn() }))
vi.mock('@/app/smart-quotes/actions', () => ({ runQuoteCommand: vi.fn() }))
import { startChat } from '../app/diriqent/actions'
import { GET } from '../app/diriqent/export/route'
import { DIRIQENT_POLICY_VERSION } from '../lib/diriqent/access'
const input = { companyId: 'company-a', requestId: 'request-a', kind: 'chat' as const, prompt: 'Jak vytvořím dokument?', conversationId: null, maxUnits: 500 }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ companyId: 'company-a', profileId: 'person-a', role: 'manager', supabase: { rpc: mocks.rpc } })
  mocks.start.mockResolvedValue({ id: 'paid-operation' })
  mocks.rpc.mockResolvedValue({ data: { policyVersion: DIRIQENT_POLICY_VERSION, operations: [], proposals: [] }, error: null })
})

describe('support versus explicitly requested paid work', () => {
  it('intercepts a known guide inside paid chat without reserving or calling the provider', async () => {
    expect(await startChat(input)).toMatchObject({ ok: true, support: { kind: 'guide', chargedUnits: 0 } })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('does not charge a manager for denying an owner-only topic', async () => {
    expect(await startChat({ ...input, prompt: 'Ukaž mzdy a marže firmy' })).toMatchObject({ ok: true, support: { kind: 'unavailable', chargedUnits: 0 } })
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it.each(['Kdo jsi?', 'Jaké formáty podporuje Office?', 'Spočítej 15 krát 12', 'Ahoj', 'Kdo vymyslel Diriqo?'])('keeps basic and ambiguous questions free even in the paid workspace: %s', async prompt => {
    expect(await startChat({ ...input, prompt })).toMatchObject({ ok: true, support: { chargedUnits: 0 } })
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('passes an operational data request to the existing paid flow with its explicit limit', async () => {
    const paid = { ...input, prompt: 'Jaký stav má zakázka?', maxUnits: 100 }
    expect(await startChat(paid)).toEqual({ ok: true, value: { id: 'paid-operation' } })
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(paid)
  })
  it.each([
    ['Porovnej zakázky na tento měsíc', 'analytics'],
    ['Analyzuj zakázky za říjen', 'analytics'],
    ['Připrav plán práce na zakázkách', 'plan'],
  ])('requires separate approval for advanced work without reserving credit: %s', async (prompt, advanced) => {
    expect(await startChat({ ...input, prompt })).toEqual({ ok: true, advanced })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('authenticates support submitted from paid chat and rejects a stale company', async () => {
    mocks.context.mockRejectedValue(new Error('Firma se změnila'))
    expect(await startChat(input)).toMatchObject({ ok: false })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.context).toHaveBeenCalledWith(input.companyId)
  })
  it.each(['', 'x'.repeat(4001)])('does not charge invalid input', async prompt => {
    expect(await startChat({ ...input, prompt })).toMatchObject({ ok: false })
    expect(mocks.start).not.toHaveBeenCalled()
  })
})

describe('export after a role change', () => {
  it('refuses owner-scoped operations even if a database response contains them', async () => {
    mocks.rpc.mockResolvedValue({ data: { policyVersion: DIRIQENT_POLICY_VERSION, operations: [{ access_scope: 'company_admin', result: 'OWNER-SECRET' }], proposals: [] } })
    const response = await GET(new Request('https://example.test/diriqent/export'))
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('OWNER-SECRET')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('also refuses an owner proposal attached to an otherwise allowed operation', async () => {
    mocks.rpc.mockResolvedValue({ data: { policyVersion: DIRIQENT_POLICY_VERSION, operations: [{ access_scope: 'manager' }], proposals: [{ access_scope: 'company_admin', payload: 'OWNER-SECRET' }] } })
    const response = await GET(new Request('https://example.test/diriqent/export'))
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('OWNER-SECRET')
  })
  it('will not export from an old schema without the access-policy marker', async () => {
    mocks.rpc.mockResolvedValue({ data: { operations: [], proposals: [] } })
    expect((await GET(new Request('https://example.test/diriqent/export'))).status).toBe(403)
  })
  it('exports allowed history for the current active company without caching', async () => {
    const records = [{ access_scope: 'manager', prompt: 'Allowed' }]
    mocks.rpc.mockResolvedValue({ data: { policyVersion: DIRIQENT_POLICY_VERSION, operations: records, proposals: [] } })
    const response = await GET(new Request('https://example.test/diriqent/export?companyId=forged'))
    expect(response.status).toBe(200)
    expect((await response.json()).operations).toEqual(records)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('diriqent_export', { c: 'company-a', k: 'chat', operation: null })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
