import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageApiError } from '@supabase/storage-js'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), upload: vi.fn(), bucket: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: mocks.bucket } } }))
import { uploadJobPhotoDirect } from '../lib/job-photo-upload-client'

const company = '11111111-1111-4111-8111-111111111111'
const job = '22222222-2222-4222-8222-222222222222'
const photo = '33333333-3333-4333-8333-333333333333'
const path = `${company}/${job}/before/${photo}.png`
const target = { bucket: 'job-photos', path, token: 'one-signed-target', maxBytes: 1024 }
const item = { id: photo, photoType: 'before', fileName: 'proof.png', takenAt: '2026-10-11T12:00:00Z', thumbUrl: null }
const input = { jobId: job, file: new File(['synthetic-image'], 'proof.png', { type: 'image/png' }), photoType: 'before' as const }

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.bucket.mockReturnValue({ uploadToSignedUrl: mocks.upload })
  mocks.fetch.mockImplementation(async (_url, init: RequestInit) => Response.json(init.method === 'POST' ? target : { item }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('photo upload response recovery', () => {
  it.each([
    new StorageApiError('Already exists', 409, 'ResourceAlreadyExists'),
    new StorageApiError('Already exists', 400, '409'),
    new StorageApiError('Already exists', 400, 'KeyAlreadyExists'),
    new StorageApiError('Already exists', 409, 'already_exists'),
  ])('recovers a lost upload response with the same signed path (%j)', async conflict => {
    mocks.upload.mockRejectedValueOnce(new TypeError('Network response lost'))
      .mockResolvedValueOnce({ data: null, error: conflict })
    const result = uploadJobPhotoDirect(input)
    await vi.runAllTimersAsync()

    expect(await result).toEqual(item)
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    for (const call of mocks.upload.mock.calls) {
      expect(call).toEqual([path, target.token, input.file, { cacheControl: '3600', contentType: 'image/png', upsert: false }])
    }
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'PATCH'])
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toMatchObject({ storagePath: path, jobId: job, mimeType: 'image/png', sizeBytes: input.file.size })
  })

  it('retries a lost PATCH response without initiating a new object or uploading again', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: new StorageApiError('Already exists', 409, 'ResourceAlreadyExists') })
    mocks.fetch.mockResolvedValueOnce(Response.json(target))
      .mockRejectedValueOnce(new TypeError('Confirmation response lost'))
      .mockResolvedValueOnce(Response.json({ item }))
    const result = uploadJobPhotoDirect(input)
    await vi.runAllTimersAsync()

    expect(await result).toEqual(item)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'PATCH', 'PATCH'])
    expect(mocks.fetch.mock.calls.slice(1).map(([, init]) => JSON.parse(init.body).storagePath)).toEqual([path, path])
  })

  it('does not treat a conflict as success when server object validation rejects the file', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: new StorageApiError('Already exists', 409, 'ResourceAlreadyExists') })
    mocks.fetch.mockImplementation(async (_url, init: RequestInit) => init.method === 'POST'
      ? Response.json(target)
      : Response.json({ error: 'Stored file differs' }, { status: 400 }))
    const assertion = expect(uploadJobPhotoDirect(input)).rejects.toThrow('Stored file differs')
    await vi.runAllTimersAsync()
    await assertion

    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1)
    expect(mocks.fetch.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(4)
  })

  it('does not bypass storage authentication errors or even a conflict-like message', async () => {
    mocks.upload.mockResolvedValue({ data: null, error: new StorageApiError('Already exists but access denied', 403, 'AccessDenied') })
    const assertion = expect(uploadJobPhotoDirect(input)).rejects.toThrow('access denied')
    await vi.runAllTimersAsync()
    await assertion

    expect(mocks.upload).toHaveBeenCalledTimes(4)
    expect(mocks.fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST'])
  })
})
