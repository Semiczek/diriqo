import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/active-company', () => ({ getActiveCompanyContext: mocks.context }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: async () => ({ rpc: mocks.rpc }) }))
import { GET, POST } from '../app/pos/api/route'
const c = '11111111-1111-4111-8111-111111111111'
const r = '22222222-2222-4222-8222-222222222222'
const e = '33333333-3333-4333-8333-333333333333'
const request = (changes = {}, origin = 'https://app.diriqo.com') => new Request('https://app.diriqo.com/pos/api', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ companyId: c, registerId: r, eventId: e, command: 'sale', payload: { lines: [] }, ...changes }) })
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ companyId: c, profileId: 'profile' }); mocks.rpc.mockResolvedValue({ data: { sale_id: 'sale', replayed: false }, error: null }) })
describe('POS tenant/API boundary', () => {
  it('rejects a stale company before making any RPC', async () => {
    mocks.context.mockResolvedValue({ companyId: 'different-company' })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects cross-origin write and unauthenticated membership before RPC', async () => {
    expect((await POST(request({}, 'https://untrusted.example'))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.context.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('uses the same event ID and exact payload on transport replay, without a Core gate', async () => {
    await POST(request()); await POST(request())
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1])
    expect(mocks.rpc).toHaveBeenCalledWith('pos_command', { company_id: c, register_id: r, event_id: e, command: 'sale', payload: { lines: [] } })
    expect(mocks.context).toHaveBeenCalledWith({ allowedRoles: ['super_admin', 'company_admin', 'manager', 'worker'] })
  })
  it('reports SQL event/payload conflicts as conflict instead of retrying a new sale', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'POS_EVENT_CONFLICT' } })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('preserves an uncertain database transport result as retryable, without declaring rollback', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('Connection lost after commit'))
    expect((await POST(request())).status).toBe(503)
    mocks.rpc.mockResolvedValueOnce({ data: { sale_id: 'original-sale', replayed: true }, error: null })
    const retry = await POST(request())
    expect((await retry.json()).data.sale_id).toBe('original-sale')
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1])
  })
  it('rejects invalid command data before contacting the database', async () => {
    expect((await POST(request({ registerId: 'not-a-uuid' }))).status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('scopes receipt history by active company and register', async () => {
    const response = await GET(new Request(`https://app.diriqo.com/pos/api?company=${c}&register=${r}&mode=receipt&id=${e}&kind=return`))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.rpc).toHaveBeenCalledWith('pos_read', { company_id: c, register_id: r, mode: 'receipt', params: { id: e, kind: 'return' } })
  })
  it('refuses oversized export rather than silently producing the first page', async () => {
    mocks.rpc.mockResolvedValue({ data: { rows: [], has_more: true }, error: null })
    const response = await GET(new Request(`https://app.diriqo.com/pos/api?company=${c}&register=${r}&mode=export`))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('10 000')
  })
})
