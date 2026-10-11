import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ context: vi.fn(), licence: vi.fn(), verify: vi.fn(), admin: vi.fn(), server: vi.fn(), scope: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/active-company', () => ({ getActiveCompanyContext: mocks.context }))
vi.mock('@/lib/module-access', () => ({ requireCompanyModule: mocks.licence }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.server }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
vi.mock('@/lib/job-photo-storage', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/job-photo-storage')>(), verifyJobPhotoAccess: mocks.verify, resolveJobPhotoAccessScope: mocks.scope }))
import { DELETE, GET, PATCH, POST } from '../app/api/job-photos/route'
import { COMPANY_MEMBER_ROLES } from '../lib/hub-access'
const company = '11111111-1111-4111-8111-111111111111'
const job = '22222222-2222-4222-8222-222222222222'
const payload = { jobId: job, photoType: 'before', fileName: 'test.jpg', mimeType: 'image/jpeg', sizeBytes: 50, storagePath: `${job}/before/test.jpg` }
function request(method: string) { return new NextRequest('https://app.diriqo.com/api/job-photos', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ companyId: company, profileId: 'worker1', role: 'worker' })
  mocks.licence.mockResolvedValue({ ok: true })
  mocks.verify.mockResolvedValue(false)
  mocks.scope.mockResolvedValue({ hasAccess: false, jobIds: [] })
})
describe('mobile photo boundaries', () => {
  it('accepts member context but rejects unassigned jobs before storage access', async () => {
    expect((await POST(request('POST'))).status).toBe(404)
    expect((await PATCH(request('PATCH'))).status).toBe(404)
    expect(mocks.context).toHaveBeenCalledWith({ allowedRoles: COMPANY_MEMBER_ROLES })
    expect(mocks.verify).toHaveBeenCalledWith(job, expect.objectContaining({ companyId: company, role: 'worker' }))
    expect(mocks.server).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('blocks uploads and metadata commits without a paid file capability', async () => {
    mocks.licence.mockResolvedValue({ ok: false, error: 'MODULE_REQUIRED', status: 403 })
    expect((await POST(request('POST'))).status).toBe(403)
    expect((await PATCH(request('PATCH'))).status).toBe(403)
    expect(mocks.licence).toHaveBeenCalledWith(company, 'photos', 'core.files.upload')
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.server).not.toHaveBeenCalled()
  })
  it('keeps photo deletion restricted to administrators', async () => {
    expect((await DELETE(request('DELETE'))).status).toBe(403)
    expect(mocks.server).not.toHaveBeenCalled()
  })
  it('preserves assignment checking on photo reads without imposing a new-operation licence', async () => {
    expect((await GET(new NextRequest(`https://app.diriqo.com/api/job-photos?jobId=${job}`))).status).toBe(404)
    expect(mocks.scope).toHaveBeenCalledWith(job, expect.objectContaining({ companyId: company, role: 'worker' }))
    expect(mocks.licence).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
