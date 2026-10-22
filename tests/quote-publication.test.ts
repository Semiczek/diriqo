import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), auth: vi.fn(), rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn(), DalAuthError: class extends Error {} }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/dal/auth', () => ({
  requireCompanyRoleDalContext: mocks.guard, requireHubDalContext: mocks.guard, DalAuthError: mocks.DalAuthError,
}))
import { publishQuoteAction, revokeQuotePublicationAction, deleteQuoteAction, archiveQuoteAction, recordQuoteDecisionAction, createQuoteFromCalculationAction } from '../app/business-actions'
const companyId = 'a1111111-1111-4111-8111-111111111111', quoteId = 'b1111111-1111-4111-8111-111111111111'
const profileId = 'c1111111-1111-4111-8111-111111111111', operationId = 'd1111111-1111-4111-8111-111111111111'
const versionId = 'e1111111-1111-4111-8111-111111111111', calculationId = 'f1111111-1111-4111-8111-111111111111'
const input = { companyId, profileId, quoteId, operationId, expectedRevision: '3' }
const base = () => ({ companyId, operationId, quoteId, revision: '4', replayed: false })
const result = () => ({ ...base(), versionId, versionNumber: 1, shareToken: 'a'.repeat(64), publishedAt: '2026-10-21T08:00:00.000Z' })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.guard.mockResolvedValue({ companyId, profileId, role: 'manager', supabase: { auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from } })
  mocks.auth.mockResolvedValue({ data: { user: { id: profileId } }, error: null })
  mocks.rpc.mockResolvedValue({ data: result(), error: null })
  mocks.from.mockImplementation(() => { throw new Error('Split table writes forbidden') })
})
describe('explicit versioned quote publication', () => {
  it('issues one authenticated scoped CAS operation and returns the immutable publication receipt', async () => {
    expect(await publishQuoteAction(input)).toEqual({ ok: true, data: result() })
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith('manager', 'company_admin', 'super_admin')
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('publish_core_quote_version_atomic', {
      p_company_id: companyId, p_quote_id: quoteId, p_operation_id: operationId, p_expected_revision: '3',
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([{ companyId: calculationId }, { profileId: calculationId }])('rejects stale company or account before RPC %j', async change => {
    expect(await publishQuoteAction({ ...input, ...change })).toMatchObject({ ok: false, code: 'forbidden', uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects missing current authorization before RPC without exposing a raw guard error', async () => {
    mocks.guard.mockRejectedValue(new mocks.DalAuthError('private access detail'))
    expect(await publishQuoteAction(input)).toMatchObject({ ok: false, code: 'forbidden', uncertain: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires explicit revision/operation rather than an old identity-only publication request', async () => {
    expect(await publishQuoteAction({ companyId, quoteId })).toMatchObject({ ok: false, code: 'validation' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    null, {}, { ...result(), quoteId: calculationId }, { ...result(), operationId: calculationId },
    { ...result(), revision: '3' }, { ...result(), versionId: null }, { ...result(), shareToken: '' },
    { ...result(), publishedAt: null }, { ...result(), versionNumber: 0 },
    { quoteId, shareToken: 'a'.repeat(64), state: 'captured', capturedAt: '2026-10-21T08:00:00Z' },
  ])('retains an uncertain outcome for malformed or old publication response %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    expect(await publishQuoteAction(input)).toMatchObject({ ok: false, code: 'unknown', uncertain: true })
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it('can reconcile the same completed publication after a cache failure', async () => {
    mocks.revalidate.mockImplementationOnce(() => { throw new Error('secret cache failure') })
    expect(await publishQuoteAction(input)).toMatchObject({ ok: false, uncertain: true })
    mocks.rpc.mockResolvedValue({ data: { ...result(), replayed: true }, error: null })
    expect(await publishQuoteAction(input)).toMatchObject({ ok: true, data: { replayed: true, versionId } })
    expect(mocks.rpc.mock.calls[0][1]).toEqual(mocks.rpc.mock.calls[1][1])
  })
  it('returns safe known conflict errors and never falls back to direct writes', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT409', message: 'CORE_QUOTE_REVISION_CONFLICT', details: 'private detail' } })
    const response = await publishQuoteAction(input)
    expect(response).toMatchObject({ ok: false, code: 'conflict', uncertain: false })
    expect(JSON.stringify(response)).not.toContain('private detail')
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
describe('quote lifecycle action routing', () => {
  it.each([[deleteQuoteAction, 'delete_core_quote_draft_atomic'], [archiveQuoteAction, 'archive_core_quote_atomic']])('routes destructive changes through a scoped receipt-bearing RPC', async (action, rpc) => {
    mocks.rpc.mockResolvedValue({ data: base(), error: null })
    expect(await action(input)).toEqual({ ok: true, data: base() })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(rpc, { p_company_id: companyId, p_quote_id: quoteId, p_expected_revision: '3', p_operation_id: operationId })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('passes source revision and operation identity when creating from calculation', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...base(), revision: '1' }, error: null })
    expect(await createQuoteFromCalculationAction({ companyId, profileId, operationId, calculationId, expectedCalculationRevision: '6' })).toMatchObject({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('create_core_quote_from_calculation_atomic', {
      p_company_id: companyId, p_calculation_id: calculationId, p_expected_calculation_revision: '6', p_operation_id: operationId,
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('requires a documented version-specific manual acceptance', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...base(), versionId, decisionId: calculationId, decision: 'accepted', recordedAt: '2026-10-21T08:00:00.000Z' }, error: null })
    expect(await recordQuoteDecisionAction({ companyId, profileId, operationId, quoteId, versionId, decision: 'accepted', evidence: 'Souhlas zákazníka v e-mailu', decidedAt: '2026-10-21T10:00:00+02:00' })).toMatchObject({ ok: true })
    expect(mocks.rpc.mock.calls[0]).toEqual(['record_core_quote_decision_atomic', {
      p_company_id: companyId, p_quote_id: quoteId, p_version_id: versionId, p_operation_id: operationId,
      p_input: { decision: 'accepted', evidence: 'Souhlas zákazníka v e-mailu', decided_at: '2026-10-21T08:00:00.000Z' },
    }])
  })
})


describe('publication revocation action', () => {
  it.each([versionId, null])('revokes only explicit version %j through one CAS receipt', async selectedVersion => {
    mocks.rpc.mockResolvedValue({ data: { ...base(), versionId: selectedVersion }, error: null })
    expect(await revokeQuotePublicationAction({ ...input, versionId: selectedVersion })).toEqual({ ok: true, data: { ...base(), versionId: selectedVersion } })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('revoke_core_quote_publication_atomic', { p_company_id: companyId, p_quote_id: quoteId, p_version_id: selectedVersion, p_expected_revision: '3', p_operation_id: operationId })
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('rejects a stale account and missing version selector before reserving any operation', async () => {
    expect(await revokeQuotePublicationAction({ ...input, profileId: calculationId, versionId })).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await revokeQuotePublicationAction(input)).toMatchObject({ ok: false, code: 'validation' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('reconciles an identical revoke operation after a cache failure', async () => {
    const command = { ...input, versionId: null }
    mocks.rpc.mockResolvedValue({ data: { ...base(), versionId: null }, error: null })
    mocks.revalidate.mockImplementationOnce(() => { throw new Error('cache failed after commit') })
    expect(await revokeQuotePublicationAction(command)).toMatchObject({ ok: false, uncertain: true })
    mocks.rpc.mockResolvedValue({ data: { ...base(), versionId: null, replayed: true }, error: null })
    expect(await revokeQuotePublicationAction(command)).toMatchObject({ ok: true, data: { versionId: null, replayed: true } })
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]); expect(mocks.from).not.toHaveBeenCalled()
  })
})
