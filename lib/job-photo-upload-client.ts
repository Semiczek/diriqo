import { supabase } from '@/lib/supabase'

export type JobPhotoUploadCategory = 'before' | 'after' | 'progress' | 'issue' | 'document'

export type JobPhotoUploadResult = {
  id: string
  photoType: JobPhotoUploadCategory
  fileName: string
  note?: string | null
  takenAt: string | null
  thumbUrl: string | null
}

const RETRY_DELAYS_MS = [350, 1200, 2500]

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function retry<T>(callback: () => Promise<T>) {
  let lastError: unknown

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await callback()
    } catch (error) {
      lastError = error
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay) {
        await wait(delay)
      }
    }
  }

  throw lastError
}

async function parseJsonResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null

  if (!response.ok) {
    throw new Error(payload?.error ?? 'Upload fotografie selhal.')
  }

  if (!payload) {
    throw new Error('Server vratil prazdnou odpoved.')
  }

  return payload
}

export async function uploadJobPhotoDirect(input: {
  jobId: string
  file: File
  photoType: JobPhotoUploadCategory
  note?: string | null
  takenAt?: string | null
}) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('Zarizeni je offline. Fotku muzes zkusit odeslat znovu po pripojeni.')
  }

  const initiate = await retry(async () => {
    const response = await fetch('/api/job-photos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jobId: input.jobId,
        photoType: input.photoType,
        fileName: input.file.name,
        mimeType: input.file.type,
        sizeBytes: input.file.size,
        note: input.note ?? null,
        takenAt: input.takenAt ?? new Date().toISOString(),
      }),
    })

    return parseJsonResponse<{
      bucket: string
      path: string
      token: string
      maxBytes: number
    }>(response)
  })

  await retry(async () => {
    const { error } = await supabase.storage
      .from(initiate.bucket)
      .uploadToSignedUrl(initiate.path, initiate.token, input.file, {
        cacheControl: '3600',
        contentType: input.file.type,
        upsert: false,
      })

    if (error) {
      throw new Error(error.message)
    }
  })

  const completed = await retry(async () => {
    const response = await fetch('/api/job-photos', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jobId: input.jobId,
        photoType: input.photoType,
        storagePath: initiate.path,
        fileName: input.file.name,
        mimeType: input.file.type,
        sizeBytes: input.file.size,
        note: input.note ?? null,
        takenAt: input.takenAt ?? new Date().toISOString(),
      }),
    })

    return parseJsonResponse<{ item: JobPhotoUploadResult }>(response)
  })

  return completed.item
}
