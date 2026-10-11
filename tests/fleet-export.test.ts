import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/fleet/server', () => ({ fleetContext: mocks.context }))
import { GET } from '../app/fleet/export/route'

const company = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ companyId: company, manager: true, supabase: { rpc: mocks.rpc, from: mocks.from } })
})

describe('fleet export entitlement', () => {
  it('denies a history reader without the separate export capability before loading records', async () => {
    mocks.rpc.mockResolvedValue({ data: { can_read: true, can_write: true, can_export: false }, error: null })
    const response = await GET(new Request('https://example.invalid/fleet/export'))
    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('fails closed when retention or authorization cannot be established', async () => {
    for (const result of [{ data: null, error: null }, { data: { can_export: true }, error: { message: 'unavailable' } }]) {
      mocks.rpc.mockResolvedValue(result)
      expect((await GET(new Request('https://example.invalid/fleet/export'))).status).toBe(403)
    }
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('allows retained exports without active write access using the authoritative company', async () => {
    mocks.rpc.mockResolvedValue({ data: { can_read: true, can_write: false, can_export: true }, error: null })
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: [], error: null }) }
    mocks.from.mockReturnValue(query)
    const response = await GET(new Request('https://example.invalid/fleet/export?company=foreign'))
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('get_module_workspace_access', { company, product: 'fleet' })
    expect(query.eq).toHaveBeenCalledWith('company_id', company)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
