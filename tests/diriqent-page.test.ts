import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), workspace: vi.fn(), configured: vi.fn() }))
vi.mock('@/lib/diriqent/server', () => ({ aiWorkspace: mocks.workspace, aiError: () => 'Práce nedostupná' }))
vi.mock('@/lib/diriqent/support-server', () => ({ supportContext: mocks.context }))
vi.mock('@/lib/diriqent/provider', () => ({ providerConfigured: mocks.configured }))
vi.mock('../app/diriqent/ChatClient', () => ({ default: () => null }))
vi.mock('../app/diriqent/WorkClient', () => ({ default: () => null }))
vi.mock('../app/diriqent/SupportClient', () => ({ default: () => null }))
vi.mock('../app/diriqent/ContextBoundary', () => ({ default: () => null }))
import DiriqentPage from '../app/diriqent/page'
const identity = { companyId: 'company-a', profileId: 'person-a', role: 'manager' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue(identity)
  mocks.workspace.mockRejectedValue(new Error('NO_CREDIT_OR_MODULE'))
})
describe('free support default entry point', () => {
  it.each([undefined, 'support', 'unexpected'])('opens support with no paid license, credit or API key check (mode=%s)', async mode => {
    const page = await DiriqentPage({ searchParams: Promise.resolve({ mode }) })
    expect(page).toBeTruthy()
    expect(mocks.context).toHaveBeenCalledOnce()
    expect(mocks.workspace).not.toHaveBeenCalled()
    expect(mocks.configured).not.toHaveBeenCalled()
  })
  it.each(['work', 'advanced'])('only enters paid workspace after explicit mode selection: %s', async mode => {
    await DiriqentPage({ searchParams: Promise.resolve({ mode }) })
    expect(mocks.workspace).toHaveBeenCalledOnce()
    expect(mocks.configured).not.toHaveBeenCalled()
  })
  it('does not render a workspace resolved for a previous role', async () => {
    mocks.workspace.mockResolvedValue({ ...identity, roleScope: 'company_admin' })
    await DiriqentPage({ searchParams: Promise.resolve({ mode: 'work' }) })
    expect(mocks.configured).not.toHaveBeenCalled()
  })
})
