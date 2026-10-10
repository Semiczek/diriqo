import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), modules: vi.fn(), from: vi.fn(), role: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/company-settings', () => ({ getCompanyModules: mocks.modules }))
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: mocks.auth }, rpc: mocks.rpc, from: mocks.from }),
}))
vi.mock('@/lib/server-guards', () => ({ requireCompanyRole: mocks.role }))
vi.mock('@/lib/dal/flow', () => ({ markJobCompleted: vi.fn(), markReadyForInvoice: vi.fn() }))

import {
  COMPANY_OPERATION_CAPABILITIES, getPaidCompanyCapabilityAccess, requirePaidCompanyCapability,
  type CompanyOperationCapability, type ModuleOperationContext,
} from '../lib/platform/module-operation-access'
import { CAPABILITIES } from '../lib/platform/capabilities'
import { requireCompanyModule } from '../lib/module-access'
import { PATCH } from '../app/api/jobs/[jobId]/route'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const otherCompany = 'b1111111-1111-4111-8111-111111111111'
const jobId = 'c1111111-1111-4111-8111-111111111111'
const capability = 'core.jobs.create' as const
const paid = (changes = {}) => ({ company_id: companyId, capability, enforced: true, allowed: true, reason: 'paid', livemode: false, ...changes })
const legacy = (changes = {}) => paid({ enforced: false, allowed: true, reason: 'legacy', livemode: null, ...changes })
const ctx = () => ({ companyId, supabase: { auth: { getUser: mocks.auth }, rpc: mocks.rpc } }) as unknown as ModuleOperationContext

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', 'test')
  mocks.auth.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null })
  mocks.rpc.mockImplementation(async (_name, args) => ({ data: paid({ capability: args.target_capability }), error: null }))
  mocks.modules.mockResolvedValue({ jobs: true, invoices: true, calendar: true, quotes: true, payroll: true, workers: true })
  mocks.role.mockResolvedValue({ ok: true, value: { companyId, profileId: 'verified-profile' } })
  mocks.from.mockImplementation(() => { throw new Error('Unexpected business write') })
})
afterEach(() => vi.unstubAllEnvs())

describe('paid operation boundary', () => {
  it('uses fresh auth and the DB clock/rollout with no caller-supplied mode, time, grants or role', async () => {
    await expect(requirePaidCompanyCapability(ctx(), capability)).resolves.toBeUndefined()
    expect(mocks.auth).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_company_capability_access', {
      target_company_id: companyId, target_capability: capability,
    })
  })
  it('canonicalizes the trusted company UUID', async () => {
    await expect(getPaidCompanyCapabilityAccess({ ...ctx(), companyId: companyId.toUpperCase() }, capability)).resolves.toMatchObject({ companyId })
  })
  it('does not authorize unsupported history, settlement, AI budget or register-scoped operations through this guard', () => {
    const supported = Object.entries(CAPABILITIES).filter(([, cap]) => cap.purpose === 'new_operation' && cap.scope === 'company' && !cap.requiresBudget).map(([key]) => key)
    expect([...COMPANY_OPERATION_CAPABILITIES].sort()).toEqual(supported.sort())
  })
  it.each(['core.history.read', 'invoicing.payment.settle', 'pos.sale.create', 'ai_assistant.conversation.run', 'inventory.ocr.request', 'unknown'])('rejects unsupported %s before calling the DB', async (value) => {
    await expect(requirePaidCompanyCapability(ctx(), value as CompanyOperationCapability)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each(['', 'company-A', '../other'])('rejects malformed company scope %s', async (value) => {
    await expect(requirePaidCompanyCapability({ ...ctx(), companyId: value }, capability)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([{ data: { user: null }, error: null }, { data: { user: { id: 'unverified' } }, error: { message: 'invalid' } }])('rejects unverified identity', async (auth) => {
    mocks.auth.mockResolvedValue(auth)
    await expect(requirePaidCompanyCapability(ctx(), capability)).rejects.toMatchObject({ status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects unpaid operation with a safe 403 and never retries automatically', async () => {
    mocks.rpc.mockResolvedValue({ data: paid({ allowed: false, reason: 'module_required' }), error: null })
    await expect(requirePaidCompanyCapability(ctx(), capability)).rejects.toMatchObject({ status: 403, message: expect.stringContaining('placený modul') })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('keeps explicit legacy access when DB confirms no rollout, without inventing paid entitlement', async () => {
    vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', '')
    mocks.rpc.mockResolvedValue({ data: legacy(), error: null })
    expect(await getPaidCompanyCapabilityAccess(ctx(), capability)).toEqual({ companyId, capability, enforced: false, allowed: true, reason: 'legacy' })
  })
  it.each(['', 'live', 'invalid'])('fails closed for an enrolled test company when server mode is %s', async (mode) => {
    vi.stubEnv('DIRIQO_MODULE_BILLING_MODE', mode)
    await expect(requirePaidCompanyCapability(ctx(), capability)).rejects.toMatchObject({ status: 503 })
  })
  it.each([
    null, [], true, {}, paid({ company_id: otherCompany }), paid({ capability: 'core.jobs.update' }),
    paid({ allowed: 'true' }), paid({ enforced: 'true' }), paid({ livemode: null }), paid({ livemode: 'false' }),
    paid({ reason: 'legacy' }), paid({ allowed: false, reason: 'paid' }),
    legacy({ allowed: false }), legacy({ reason: 'paid' }), legacy({ livemode: false }),
  ])('denies malformed or mismatched result %j', async (data) => {
    mocks.rpc.mockResolvedValue({ data, error: null })
    await expect(requirePaidCompanyCapability(ctx(), capability)).rejects.toMatchObject({ status: 503 })
  })
  it('does not treat missing RPC output as legacy access', async () => {
    mocks.rpc.mockResolvedValue(undefined)
    await expect(requirePaidCompanyCapability(ctx(), capability)).rejects.toMatchObject({ status: 503 })
  })
  it.each([
    ['MODULE_CAPABILITY_FORBIDDEN', 403], ['MODULE_CAPABILITY_UNSUPPORTED', 403], ['private SQL details', 503],
  ])('safely handles database error %s', async (message, status) => {
    mocks.rpc.mockResolvedValue({ data: paid(), error: { message } })
    await expect(requirePaidCompanyCapability(ctx(), capability)).rejects.toMatchObject({ status })
    await expect(requirePaidCompanyCapability(ctx(), capability)).rejects.not.toThrow('private SQL details')
  })
  it('fails closed on network failure', async () => {
    mocks.rpc.mockRejectedValue(new Error('provider internals'))
    await expect(requirePaidCompanyCapability(ctx(), capability)).rejects.toMatchObject({ status: 503 })
  })
})

describe('legacy module setting combined with a purchased operation', () => {
  it('requires both paid access and the enabled local setting', async () => {
    expect(await requireCompanyModule(companyId, 'jobs', 'core.jobs.create')).toEqual({ ok: true })
    expect(mocks.rpc.mock.calls[0][1].target_capability).toBe('core.jobs.create')
    mocks.modules.mockResolvedValue({ jobs: false })
    expect(await requireCompanyModule(companyId, 'jobs', 'core.jobs.create')).toMatchObject({ ok: false })
  })
  it('denies unpaid use before the legacy loader can insert defaults', async () => {
    mocks.rpc.mockResolvedValue({ data: paid({ allowed: false, reason: 'module_required' }), error: null })
    expect(await requireCompanyModule(companyId, 'jobs', 'core.jobs.create')).toMatchObject({ ok: false, status: 403 })
    expect(mocks.modules).not.toHaveBeenCalled()
  })
  it.each([
    ['calendar', 'core.calendar.manage'], ['quotes', 'core.quotes.create'],
    ['payroll', 'core.rates.manage'], ['workers', 'core.workers.manage'], ['jobs', 'core.jobs.update'],
  ] as const)('maps existing %s mutation guard to %s', async (module, expected) => {
    expect(await requireCompanyModule(companyId, module)).toEqual({ ok: true })
    expect(mocks.rpc.mock.calls[0][1].target_capability).toBe(expected)
  })
  it('cannot check an unrelated cheaper capability instead of the required operation', async () => {
    expect(await requireCompanyModule(companyId, 'invoices', 'core.jobs.create')).toMatchObject({ ok: false, status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('does not invent a licensing mapping for an unsupported legacy key', async () => {
    expect(await requireCompanyModule(companyId, 'email')).toMatchObject({ ok: false, status: 403 })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('surfaces licence-check unavailability without silently falling back to a UI toggle', async () => {
    mocks.rpc.mockRejectedValue(new Error('timeout'))
    expect(await requireCompanyModule(companyId, 'jobs')).toMatchObject({ ok: false, status: 503 })
    expect(mocks.modules).not.toHaveBeenCalled()
  })
})

describe('direct job PATCH entrypoint', () => {
  const request = () => new NextRequest('https://diriqo.example/api/jobs/' + jobId, { method: 'PATCH', body: JSON.stringify({ title: 'Changed', company_id: otherCompany, licensed: true }) })
  const params = () => ({ params: Promise.resolve({ jobId }) })
  it('checks roles before licence or business data', async () => {
    mocks.role.mockResolvedValue({ ok: false, status: 403, error: 'role denied' })
    expect((await PATCH(request(), params())).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([false, 'timeout'])('denies unpaid/unavailable operation %s before business access', async (value) => {
    if (value === false) mocks.rpc.mockResolvedValue({ data: paid({ capability: 'core.jobs.update', allowed: false, reason: 'module_required' }), error: null })
    else mocks.rpc.mockRejectedValue(new Error('timeout'))
    expect((await PATCH(request(), params())).status).toBe(value === false ? 403 : 503)
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('allows licensed update under existing role/company checks, ignoring client licensing claims', async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), update: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: jobId, company_id: companyId }, error: null }) }
    mocks.from.mockReturnValue(query)
    expect((await PATCH(request(), params())).status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_company_capability_access', { target_company_id: companyId, target_capability: 'core.jobs.update' })
    expect(query.eq).toHaveBeenCalledWith('company_id', companyId)
    expect(query.update.mock.calls[0][0]).not.toHaveProperty('company_id')
    expect(query.update.mock.calls[0][0]).not.toHaveProperty('licensed')
  })
  it('requires close access before any business access when completing a job', async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({ data: paid({ capability: args.target_capability,
      allowed: args.target_capability !== 'core.jobs.close',
      reason: args.target_capability === 'core.jobs.close' ? 'module_required' : 'paid' }), error: null }))
    const completeRequest = new NextRequest('https://diriqo.example/api/jobs/' + jobId, {
      method: 'PATCH', body: JSON.stringify({ status: 'done' }),
    })
    expect((await PATCH(completeRequest, params())).status).toBe(403)
    expect(mocks.rpc.mock.calls.map((call) => call[1].target_capability)).toEqual(['core.jobs.update', 'core.jobs.close'])
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
