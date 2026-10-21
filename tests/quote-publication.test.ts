import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn(), DalAuthError: class extends Error {} }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/dal/auth', () => ({
  requireCompanyRoleDalContext: mocks.guard, requireHubDalContext: mocks.guard, DalAuthError: mocks.DalAuthError,
}))
vi.mock('@/lib/public-app-url', () => ({ getPublicAppBaseUrl: () => 'https://app.diriqo.com' }))
import { publishQuoteAction } from '../app/business-actions'
const companyId = 'a1111111-1111-4111-8111-111111111111'
const quoteId = 'b1111111-1111-4111-8111-111111111111'
const result = () => ({ quoteId, shareToken: 'a'.repeat(48), state: 'captured', capturedAt: '2026-10-21T08:00:00Z' })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({ companyId, profileId: 'verified-profile', role: 'company_admin', supabase: { rpc: mocks.rpc, from: mocks.from } })
  mocks.rpc.mockResolvedValue({ data: result(), error: null })
})
describe('explicit quote publication', () => {
  it('publishes once through the scoped authenticated RPC and returns the preserved URL', async () => {
    expect(await publishQuoteAction({ companyId, quoteId })).toEqual({ ok: true, data: { shareUrl: 'https://app.diriqo.com/offer/' + 'a'.repeat(48) } })
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('manager', 'company_admin', 'super_admin')
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('publish_core_quote_customer_identity', { p_company_id: companyId, p_quote_id: quoteId })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejects a stale company form before the RPC', async () => {
    expect(await publishQuoteAction({ companyId: 'other-company', quoteId })).toMatchObject({ ok: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects missing current authorization before the RPC', async () => {
    mocks.guard.mockRejectedValue(new mocks.DalAuthError('Access removed'))
    expect(await publishQuoteAction({ companyId, quoteId })).toMatchObject({ ok: false, error: 'Access removed' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('retains a legacy link without claiming historical capture', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...result(), state: 'legacy_unknown', capturedAt: null }, error: null })
    expect(await publishQuoteAction({ companyId, quoteId })).toMatchObject({ ok: true })
  })
  it.each([
    null, {}, { ...result(), quoteId: 'other-quote' },
    { ...result(), shareToken: '' }, { ...result(), state: 'draft' },
    { ...result(), capturedAt: null }, { ...result(), capturedAt: 'invalid' },
    { ...result(), state: 'legacy_unknown', capturedAt: '2026-10-21T08:00:00Z' },
  ])('does not expose an unconfirmed result %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect(await publishQuoteAction({ companyId, quoteId })).toMatchObject({ ok: false })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('returns a safe access error and never falls back to table writes', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'private detail' } })
    const response = await publishQuoteAction({ companyId, quoteId })
    expect(response).toMatchObject({ ok: false })
    expect(JSON.stringify(response)).not.toContain('private detail')
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
