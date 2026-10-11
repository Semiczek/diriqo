import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/fleet/server', () => ({ fleetContext: mocks.context, fleetError: (error: { message?: string } | null) => error?.message ?? 'Failed' }))
import { writeFleetAction } from '../app/fleet/actions'
const company = '11111111-1111-4111-8111-111111111111'
const vehicle = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
function form(operation = 'vehicle.save') {
  const result = new FormData()
  result.set('company_id', company); result.set('operation', operation); result.set('request_id', requestId)
  return result
}
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ companyId: company, manager: true, supabase: { rpc: mocks.rpc } }); mocks.rpc.mockResolvedValue({ data: vehicle, error: null }) })
describe('fleet server action boundary', () => {
  it('rejects a stale form after switching company without touching RPC', async () => {
    const data = form(); data.set('company_id', vehicle)
    expect((await writeFleetAction({ error: null }, data)).error).toContain('aktivní firmě')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('refuses vehicle and financial operations for a driver', async () => {
    mocks.context.mockResolvedValue({ companyId: company, manager: false, supabase: { rpc: mocks.rpc } })
    for (const operation of ['vehicle.save', 'cost.create', 'cost.allocate', 'service.save']) expect((await writeFleetAction({ error: null }, form(operation))).error).toContain('správce')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('passes only allowed fields and authoritative active company to RPC', async () => {
    const data = form(); data.set('name', 'Octavia'); data.set('company_id_payload', vehicle); data.set('status', 'active'); data.set('is_admin', 'true')
    const result = await writeFleetAction({ error: null }, data)
    expect(result.id).toBe(vehicle)
    expect(mocks.rpc).toHaveBeenCalledWith('fleet_write', expect.objectContaining({ target_company_id: company, target_request_id: requestId, target_payload: expect.objectContaining({ name: 'Octavia' }) }))
    expect(mocks.rpc.mock.calls[0][1].target_payload).not.toHaveProperty('is_admin')
    expect(mocks.revalidate).toHaveBeenCalledWith('/fleet')
  })
  it('keeps request ID for explicit retries and surfaces SQL conflict instead of success', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'FLEET_TRIP_OVERLAP' } })
    const result = await writeFleetAction({ error: null }, form('trip.save'))
    expect(result.error).toBe('FLEET_TRIP_OVERLAP')
    expect(result.success).toBeUndefined()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('blocks unknown operations, malformed IDs and unauthenticated contexts', async () => {
    expect((await writeFleetAction({ error: null }, form('vehicle.delete'))).error).toBeTruthy()
    const data = form(); data.set('driver_id', '../other')
    expect((await writeFleetAction({ error: null }, data)).error).toBeTruthy()
    mocks.context.mockRejectedValue(new Error('Přihlaste se znovu.'))
    expect((await writeFleetAction({ error: null }, form())).error).toBe('Přihlaste se znovu.')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
