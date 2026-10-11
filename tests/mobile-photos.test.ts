import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ context: vi.fn(), licence: vi.fn(), verify: vi.fn(), admin: vi.fn(), server: vi.fn(), scope: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/active-company', () => ({ getActiveCompanyContext: mocks.context }))
vi.mock('@/lib/module-access', () => ({ requireCompanyModule: mocks.licence }))
vi.mock('@/lib/supabase-server', () => ({ createSupabaseServerClient: mocks.server }))
vi.mock('@/lib/supabase-admin', () => ({ createSupabaseAdminClient: mocks.admin }))
vi.mock('@/lib/job-photo-storage', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/job-photo-storage')>(), verifyJobPhotoAccess: mocks.verify, resolveJobPhotoAccessScope: mocks.scope }))
import { DELETE, GET, PATCH, POST } from '../app/api/job-photos/route'
import { GET as GET_URL } from '../app/api/job-photos/url/route'
import { COMPANY_MEMBER_ROLES } from '../lib/hub-access'
import { buildJobPhotoStoragePath, isExpectedJobPhotoStoragePath } from '../lib/job-photo-storage'
const company = '11111111-1111-4111-8111-111111111111'
const job = '22222222-2222-4222-8222-222222222222'
const photo = '33333333-3333-4333-8333-333333333333'
const payload = { jobId: job, photoType: 'before', fileName: 'test.jpg', mimeType: 'image/jpeg', sizeBytes: 50, storagePath: `${company}/${job}/before/${photo}.jpg` }
function request(method: string, changes: Record<string, unknown> = {}) { return new NextRequest('https://app.diriqo.com/api/job-photos', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, ...changes }) }) }

function storageClient() {
  const storage = {
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { token: 'upload-token', signedUrl: 'https://storage.test/upload' }, error: null }),
    info: vi.fn().mockResolvedValue({ data: { size: 50, contentType: 'image/jpeg' }, error: null }),
    createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.test/signed-photo' }, error: null }),
    remove: vi.fn(),
  }
  const client = { storage: { from: vi.fn().mockReturnValue(storage) }, from: vi.fn() }
  mocks.admin.mockReturnValue(client)
  return { client, storage }
}

function metadataQuery() {
  return {
    insert: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    single: vi.fn(), maybeSingle: vi.fn(),
  }
}

const savedPhoto = { id: photo, photo_type: 'before', file_name: 'test.jpg', note: null, taken_at: '2026-10-11T12:00:00Z', storage_path: payload.storagePath, thumb_storage_path: payload.storagePath }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue({ companyId: company, profileId: 'worker1', role: 'worker' })
  mocks.licence.mockResolvedValue({ ok: true })
  mocks.verify.mockResolvedValue(false)
  mocks.scope.mockResolvedValue({ hasAccess: false, jobIds: [] })
})
afterEach(() => vi.useRealTimers())
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

  it('issues a service signed upload only after paid capability and assignment verification', async () => {
    mocks.verify.mockResolvedValue(true)
    const { client, storage } = storageClient()
    const response = await POST(request('POST'))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.path).toMatch(new RegExp(`^${company}/${job}/before/[0-9a-f-]{36}\\.jpg$`))
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(result.path)
    expect(result.token).toBe('upload-token')
    expect(client.storage.from).toHaveBeenCalledWith('job-photos')
    expect(mocks.licence.mock.invocationCallOrder[0]).toBeLessThan(mocks.verify.mock.invocationCallOrder[0])
    expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(mocks.admin.mock.invocationCallOrder[0])
    expect(mocks.server).not.toHaveBeenCalled()
  })

  it.each([
    `${job}/before/${photo}.jpg`,
    `${job}/${job}/before/${photo}.jpg`,
    `${company}/${company}/before/${photo}.jpg`,
    `${company}/${job}/after/${photo}.jpg`,
    `${company}/${job}/before/../${photo}.jpg`,
    `${company}/${job}/before/not-generated.jpg`,
  ])('rejects a metadata path outside its exact canonical scope: %s', async storagePath => {
    mocks.verify.mockResolvedValue(true)
    expect((await PATCH(request('PATCH', { storagePath }))).status).toBe(400)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('does not create metadata for an upload which does not exist', async () => {
    mocks.verify.mockResolvedValue(true)
    const { client, storage } = storageClient()
    storage.info.mockResolvedValue({ data: null, error: { status: 404 } })
    expect((await PATCH(request('PATCH'))).status).toBe(409)
    expect(storage.info).toHaveBeenCalledWith(payload.storagePath)
    expect(client.from).not.toHaveBeenCalled()
  })

  it.each([undefined, 'not-a-size', 0.5, 0, -1])('rejects invalid byte size %j before creating an upload or metadata', async sizeBytes => {
    mocks.verify.mockResolvedValue(true)
    expect((await POST(request('POST', { sizeBytes }))).status).toBe(400)
    expect((await PATCH(request('PATCH', { sizeBytes }))).status).toBe(400)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it.each([
    { size: 51, contentType: 'image/jpeg' },
    { size: 50, contentType: 'image/png' },
    { size: undefined, contentType: 'image/jpeg' },
    { size: 50, contentType: 'text/html' },
  ])('validates actual storage metadata before recording the photo: %j', async info => {
    mocks.verify.mockResolvedValue(true)
    const { client, storage } = storageClient()
    storage.info.mockResolvedValue({ data: info, error: null })
    expect((await PATCH(request('PATCH'))).status).toBe(400)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('records an assigned worker upload once and returns the same row on PATCH retry', async () => {
    mocks.verify.mockResolvedValue(true)
    const { client, storage } = storageClient()
    const query = metadataQuery()
    query.single.mockResolvedValueOnce({ data: savedPhoto, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23505' } })
    query.maybeSingle.mockResolvedValue({ data: savedPhoto, error: null })
    client.from.mockReturnValue(query)
    const first = await PATCH(request('PATCH'))
    const second = await PATCH(request('PATCH'))
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await second.json()).toEqual(await first.json())
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: photo, company_id: company, job_id: job, uploaded_by: 'worker1',
      storage_path: payload.storagePath, size_bytes: 50, mime_type: 'image/jpeg',
    }))
    expect(query.eq.mock.calls).toEqual([
      ['id', photo], ['company_id', company], ['job_id', job], ['storage_path', payload.storagePath],
    ])
    expect(query.maybeSingle).toHaveBeenCalledTimes(1)
    expect(storage.remove).not.toHaveBeenCalled()
    expect(mocks.server).not.toHaveBeenCalled()
  })

  it('retains an uploaded object after uncertain metadata writes so confirmation can retry safely', async () => {
    vi.useFakeTimers()
    mocks.verify.mockResolvedValue(true)
    const { client, storage } = storageClient()
    const query = metadataQuery()
    query.single.mockResolvedValue({ data: null, error: { code: 'network_timeout' } })
    client.from.mockReturnValue(query)
    const result = PATCH(request('PATCH'))
    await vi.runAllTimersAsync()
    expect((await result).status).toBe(503)
    expect(query.insert).toHaveBeenCalledTimes(4)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('signs the real legacy storage path from metadata after the current assignment guard', async () => {
    mocks.verify.mockResolvedValue(true)
    const { client, storage } = storageClient()
    const query = metadataQuery()
    const legacyPath = `${job}/before/old-existing-image.jpg`
    query.single.mockResolvedValue({ data: { storage_path: legacyPath, file_name: 'old.jpg', job_id: job, jobs: { id: job, company_id: company } }, error: null })
    client.from.mockReturnValue(query)
    expect((await GET_URL(new NextRequest(`https://app.diriqo.com/api/job-photos/url?photoId=${photo}`))).status).toBe(200)
    expect(query.eq).toHaveBeenCalledWith('jobs.company_id', company)
    expect(mocks.verify).toHaveBeenCalledWith(job, expect.objectContaining({ companyId: company, profileId: 'worker1' }))
    expect(storage.createSignedUrl).toHaveBeenCalledWith(legacyPath, 1800)
    expect(mocks.licence).not.toHaveBeenCalled()
  })
})

describe('canonical job photo paths', () => {
  it('generates a company/job/category/object path accepted by metadata validation', () => {
    const input = { companyId: company, jobId: job, category: 'before' as const, fileName: 'test.JPG', mimeType: 'image/jpeg', photoId: photo }
    const storagePath = buildJobPhotoStoragePath(input)
    expect(storagePath).toBe(payload.storagePath)
    expect(isExpectedJobPhotoStoragePath({ ...input, storagePath })).toBe(true)
  })
})
