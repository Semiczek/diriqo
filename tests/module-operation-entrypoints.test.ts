import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hub: vi.fn(), role: vi.fn(), module: vi.fn(), pageCompany: vi.fn(), paid: vi.fn(),
  from: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), client: vi.fn(),
  ModuleAccessError: class extends Error {
    constructor(readonly status: 403 | 503, message = 'Module access unavailable') { super(message) }
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/dal/auth', () => ({ requireHubDalContext: mocks.hub, requireCompanyRoleDalContext: mocks.role }))
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'cs' }))
vi.mock('@/lib/module-access', () => ({ requireCompanyModule: mocks.module }))
vi.mock('@/lib/require-hub-access', () => ({ requireHubAccess: mocks.pageCompany }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.client }))
vi.mock('@/lib/platform/module-operation-access', () => ({
  requirePaidCompanyCapability: mocks.paid, ModuleAccessError: mocks.ModuleAccessError,
}))
vi.mock('@/components/DashboardShell', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) => createElement('a', props, children),
}))
vi.mock('../app/jobs/new/NewJobClient', () => ({ default: () => null }))

import {
  attachJobToParentAction, createJobGroupFromDropAction, createJobsAction, createParentSummaryJobAction,
  deleteJobSafelyAction, detachCustomerFromJobAction, detachJobFromParentAction,
} from '../app/jobs/actions'
import NewJobPage from '../app/jobs/new/page'
import NewJobClient from '../app/jobs/new/NewJobClient'

const companyId = 'a1111111-1111-4111-8111-111111111111'
const jobId = 'b1111111-1111-4111-8111-111111111111'
const parentJobId = 'c1111111-1111-4111-8111-111111111111'
const supabase = { from: mocks.from, rpc: mocks.rpc }
const context = { companyId, profileId: 'verified-profile', role: 'company_admin', supabase }
const denied = 'Pro tuto operaci není aktivní předplatné.'
const actions = [
  { name: 'create jobs', capability: 'core.jobs.create', hub: true, invoke: () => createJobsAction({ title: 'Zakázka' }) },
  { name: 'create summary parent', capability: 'core.jobs.create', hub: false, invoke: () => createParentSummaryJobAction({ jobId }) },
  { name: 'create group by drop', capability: 'core.jobs.create', hub: false, invoke: () => createJobGroupFromDropAction({ draggedJobId: jobId, targetJobId: parentJobId }) },
  { name: 'attach parent', capability: 'core.jobs.update', hub: false, invoke: () => attachJobToParentAction({ childJobId: jobId, parentJobId }) },
  { name: 'detach parent', capability: 'core.jobs.update', hub: false, invoke: () => detachJobFromParentAction({ jobId }) },
  { name: 'detach customer', capability: 'core.jobs.update', hub: false, invoke: () => detachCustomerFromJobAction(jobId) },
  { name: 'delete job', capability: 'core.jobs.update', hub: false, invoke: () => deleteJobSafelyAction(jobId) },
] as const

beforeEach(() => {
  vi.resetAllMocks()
  mocks.hub.mockResolvedValue(context)
  mocks.role.mockResolvedValue(context)
  mocks.pageCompany.mockResolvedValue(context)
  mocks.client.mockResolvedValue(supabase)
  mocks.module.mockResolvedValue({ ok: false, error: denied })
  mocks.paid.mockResolvedValue(undefined)
  mocks.from.mockImplementation(() => { throw new Error('Unexpected domain database access') })
  mocks.rpc.mockImplementation(() => { throw new Error('Unexpected domain RPC') })
})

describe('job operation entry points', () => {
  it.each(actions)('$name refuses an unpaid operation before any domain reads or partial mutations', async ({ invoke, capability }) => {
    expect(await invoke()).toEqual({ ok: false, error: denied })
    expect(mocks.module).toHaveBeenCalledExactlyOnceWith(companyId, 'jobs', capability)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })

  it.each(actions)('$name verifies company role before asking for a license', async ({ invoke, hub }) => {
    const auth = hub ? mocks.hub : mocks.role
    auth.mockRejectedValue(new Error('Membership required'))
    expect(await invoke()).toEqual({ ok: false, error: 'Membership required' })
    if (!hub) expect(auth).toHaveBeenCalledWith('company_admin', 'super_admin')
    expect(mocks.module).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(actions.filter((entry) => entry.capability === 'core.jobs.create'))('$name cannot substitute update permission for creation', async ({ invoke }) => {
    mocks.module.mockImplementation(async (_company: string, _module: string, capability: string) =>
      capability === 'core.jobs.update' ? { ok: true } : { ok: false, error: denied })
    expect(await invoke()).toEqual({ ok: false, error: denied })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('an unavailable license stops customer/contact detach before either write', async () => {
    mocks.module.mockResolvedValue({ ok: false, error: 'Oprávnění nelze ověřit.' })
    expect(await detachCustomerFromJobAction(jobId)).toEqual({ ok: false, error: 'Oprávnění nelze ověřit.' })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('an allowed update keeps the existing active-company write filter', async () => {
    mocks.module.mockResolvedValue({ ok: true })
    const query = { error: null, update: vi.fn(), eq: vi.fn() }
    query.update.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    mocks.from.mockReturnValue(query)
    expect(await detachJobFromParentAction({ jobId })).toEqual({ ok: true })
    expect(mocks.module).toHaveBeenCalledExactlyOnceWith(companyId, 'jobs', 'core.jobs.update')
    expect(query.update).toHaveBeenCalledExactlyOnceWith({ parent_job_id: null })
    expect(query.eq.mock.calls).toEqual([['id', jobId], ['company_id', companyId]])
    expect(mocks.module.mock.invocationCallOrder[0]).toBeLessThan(mocks.from.mock.invocationCallOrder[0])
  })
})

describe('new job server page', () => {
  it('only renders the existing client form after verifying active-company creation permission', async () => {
    const page = await NewJobPage()
    expect(mocks.paid).toHaveBeenCalledExactlyOnceWith({ companyId, supabase }, 'core.jobs.create')
    expect(page.type).toBe(NewJobClient)
    expect(mocks.pageCompany.mock.invocationCallOrder[0]).toBeLessThan(mocks.paid.mock.invocationCallOrder[0])
  })

  it.each([403, 503] as const)('renders a recoverable %s panel instead of the creation form', async (status) => {
    mocks.paid.mockRejectedValue(new mocks.ModuleAccessError(status))
    const page = await NewJobPage()
    expect(page.type).not.toBe(NewJobClient)
    const html = renderToStaticMarkup(page)
    expect(html).toContain('role="alert"')
    expect(html).toContain('href="/billing/modules"')
    expect(html).toContain('href="/jobs"')
    expect(html).toContain(status === 503 ? 'Předplatné se nepodařilo ověřit' : 'Vytvoření zakázky není dostupné')
  })

  it('preserves the safe membership error instead of telling a stale session to buy a license', async () => {
    mocks.paid.mockRejectedValue(new mocks.ModuleAccessError(403, 'Oprávnění k aktivní firmě se změnilo.'))
    const html = renderToStaticMarkup(await NewJobPage())
    expect(html).toContain('Oprávnění k aktivní firmě se změnilo.')
    expect(html).not.toContain('Aktivujte Diriqo základ')
  })

  it('does not replace an auth redirect with a billing panel', async () => {
    const redirect = new Error('NEXT_REDIRECT')
    mocks.pageCompany.mockRejectedValue(redirect)
    await expect(NewJobPage()).rejects.toBe(redirect)
    expect(mocks.paid).not.toHaveBeenCalled()
  })

  it('does not swallow an unexpected server failure', async () => {
    const failure = new Error('Unexpected failure')
    mocks.paid.mockRejectedValue(failure)
    await expect(NewJobPage()).rejects.toBe(failure)
  })
})
