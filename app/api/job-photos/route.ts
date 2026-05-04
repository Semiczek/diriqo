import { NextRequest, NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const BUCKET = 'job-photos'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const RETRY_DELAYS_MS = [200, 700, 1500]

type LogContext = {
  operation: string
  attempt?: number
  status?: string
  fileSize?: number
  mimeType?: string
  errorName?: string
  errorCode?: string
}

function logJobPhotoEvent(context: LogContext) {
  console.info('[job-photo-flow]', context)
}

function logJobPhotoWarning(context: LogContext) {
  console.warn('[job-photo-flow]', context)
}

function getErrorName(error: unknown) {
  return error instanceof Error ? error.name : 'UnknownError'
}

function getErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }

  return undefined
}

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(
  operation: string,
  callback: (attempt: number) => Promise<T>,
  context: Omit<LogContext, 'operation' | 'attempt' | 'status' | 'errorName' | 'errorCode'> = {}
) {
  let lastError: unknown

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt += 1) {
    try {
      const result = await callback(attempt)
      if (attempt > 1) {
        logJobPhotoEvent({ operation, attempt, status: 'retry_succeeded', ...context })
      }
      return result
    } catch (error) {
      lastError = error
      logJobPhotoWarning({
        operation,
        attempt,
        status: attempt <= RETRY_DELAYS_MS.length ? 'retrying' : 'failed',
        errorName: getErrorName(error),
        errorCode: getErrorCode(error),
        ...context,
      })

      const delay = RETRY_DELAYS_MS[attempt - 1]
      if (delay) {
        await wait(delay)
      }
    }
  }

  throw lastError
}

function normalizePhotoType(value: FormDataEntryValue | null) {
  return String(value ?? '').trim() === 'after' ? 'after' : 'before'
}

function getSafeFileExtension(fileName: string, mimeType: string) {
  const extension = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''

  if (extension) {
    return extension.slice(0, 12)
  }

  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/heic') return 'heic'
  if (mimeType === 'image/heif') return 'heif'

  return 'jpg'
}

function normalizeTakenAt(value: FormDataEntryValue | null) {
  const rawValue = String(value ?? '').trim()
  if (!rawValue) return new Date().toISOString()

  const date = new Date(rawValue)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function isImageFile(file: File) {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type)
}

async function verifyJobAccess(jobId: string, companyId: string) {
  const supabase = await createSupabaseServerClient()
  const jobResponse = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (jobResponse.error) {
    throw new Error(`Nepodarilo se overit zakazku: ${jobResponse.error.message}`)
  }

  return Boolean(jobResponse.data?.id)
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const jobId = searchParams.get('jobId')?.trim() ?? ''
  const offset = Number(searchParams.get('offset') ?? '0')
  const rawLimit = Number(searchParams.get('limit') ?? String(DEFAULT_LIMIT))
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit))

  if (!jobId) {
    return NextResponse.json({ error: 'Chybi jobId.' }, { status: 400 })
  }

  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createSupabaseServerClient()

  const jobResponse = await supabase
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (jobResponse.error) {
    return NextResponse.json(
      { error: `Nepodarilo se overit zakazku: ${jobResponse.error.message}` },
      { status: 500 }
    )
  }

  if (!jobResponse.data?.id) {
    return NextResponse.json({ error: 'Zakazka nebyla nalezena.' }, { status: 404 })
  }

  const { data, error, count } = await supabase
    .from('job_photos')
    .select(
      `
        id,
        photo_type,
        file_name,
        taken_at,
        thumb_storage_path,
        storage_path
      `,
      { count: 'exact' }
    )
    .eq('job_id', jobId)
    .order('taken_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return NextResponse.json(
      { error: `Nepodarilo se nacist metadata fotek: ${error.message}` },
      { status: 500 }
    )
  }

  const rows = data ?? []
  const metadataIncompleteCount = rows.filter((row) => !row.storage_path || !row.file_name || !row.taken_at).length
  const previewPaths = rows
    .map((row) => row.thumb_storage_path ?? row.storage_path ?? null)
    .filter((value): value is string => Boolean(value))

  const signedPreviewMap = new Map<string, string | null>()

  if (previewPaths.length > 0) {
    const { data: signedPreviews, error: signedPreviewError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(previewPaths, 60 * 30)

    if (signedPreviewError) {
      return NextResponse.json(
        { error: `Nepodarilo se vytvorit nahledy fotek: ${signedPreviewError.message}` },
        { status: 500 }
      )
    }

    for (let index = 0; index < previewPaths.length; index += 1) {
      signedPreviewMap.set(previewPaths[index], signedPreviews?.[index]?.signedUrl ?? null)
    }
  }

  let storageObjectDetectedWithoutMetadata = false
  if (rows.length === 0) {
    const { data: storageObjects, error: storageListError } = await supabase.storage
      .from(BUCKET)
      .list(jobId, { limit: 1 })

    if (storageListError) {
      logJobPhotoWarning({
        operation: 'metadata_orphan_check',
        status: 'failed',
        errorName: getErrorName(storageListError),
        errorCode: getErrorCode(storageListError),
      })
    } else {
      storageObjectDetectedWithoutMetadata = (storageObjects ?? []).some((item) => Boolean(item.name))
    }
  }

  return NextResponse.json({
    items: rows.map((row) => {
      const previewPath = row.thumb_storage_path ?? row.storage_path ?? null

      return {
        id: row.id,
        photoType: row.photo_type === 'after' ? 'after' : 'before',
        fileName: row.file_name ?? 'Fotografie',
        takenAt: row.taken_at ?? null,
        thumbUrl: previewPath ? signedPreviewMap.get(previewPath) ?? null : null,
      }
    }),
    total: count ?? rows.length,
    hasMore: offset + rows.length < (count ?? rows.length),
    metadataMissing: storageObjectDetectedWithoutMetadata,
    metadataIncompleteCount,
  })
}

export async function POST(request: NextRequest) {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let formData: FormData

  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Neplatny upload formulare.' }, { status: 400 })
  }

  const jobId = String(formData.get('jobId') ?? '').trim()
  const file = formData.get('file')
  const photoType = normalizePhotoType(formData.get('photoType'))
  const takenAt = normalizeTakenAt(formData.get('takenAt'))

  if (!jobId) {
    return NextResponse.json({ error: 'Chybi jobId.' }, { status: 400 })
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Chybi soubor fotografie.' }, { status: 400 })
  }

  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Fotografie je prazdna nebo prilis velka.' }, { status: 400 })
  }

  if (!isImageFile(file)) {
    return NextResponse.json({ error: 'Soubor musi byt fotografie JPG, PNG, WEBP, HEIC nebo HEIF.' }, { status: 400 })
  }

  let jobExists = false

  try {
    jobExists = await verifyJobAccess(jobId, activeCompany.companyId)
  } catch (error) {
    logJobPhotoWarning({
      operation: 'job_access_verify',
      status: 'failed',
      errorName: getErrorName(error),
      errorCode: getErrorCode(error),
    })
    return NextResponse.json({ error: 'Nepodarilo se overit zakazku.' }, { status: 500 })
  }

  if (!jobExists) {
    return NextResponse.json({ error: 'Zakazka nebyla nalezena.' }, { status: 404 })
  }

  const supabase = await createSupabaseServerClient()
  const uploadContext = { fileSize: file.size, mimeType: file.type }

  try {
    await withRetry('bucket_verify', async () => {
      const { error } = await supabase.storage.from(BUCKET).list('', { limit: 1 })
      if (error) throw error
    })
  } catch {
    return NextResponse.json({ error: 'Bucket job-photos neni dostupny.' }, { status: 500 })
  }

  const extension = getSafeFileExtension(file.name, file.type)
  const storagePath = `${jobId}/${crypto.randomUUID()}.${extension}`
  const arrayBuffer = await file.arrayBuffer()
  const uploadBody = new Uint8Array(arrayBuffer)

  try {
    await withRetry(
      'storage_upload',
      async () => {
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, uploadBody, {
            cacheControl: '3600',
            contentType: file.type,
            upsert: false,
          })

        if (error) throw error
      },
      uploadContext
    )
  } catch {
    return NextResponse.json({ error: 'Nepodarilo se nahrat fotografii.' }, { status: 502 })
  }

  try {
    const inserted = await withRetry(
      'metadata_insert',
      async () => {
        const { data, error } = await supabase
          .from('job_photos')
          .insert({
            job_id: jobId,
            photo_type: photoType,
            file_name: file.name,
            taken_at: takenAt,
            storage_path: storagePath,
            thumb_storage_path: storagePath,
          })
          .select('id, photo_type, file_name, taken_at, storage_path, thumb_storage_path')
          .single()

        if (error) throw error
        return data
      },
      uploadContext
    )

    logJobPhotoEvent({ operation: 'upload_complete', status: 'metadata_saved', ...uploadContext })

    return NextResponse.json({
      item: {
        id: inserted.id,
        photoType: inserted.photo_type === 'after' ? 'after' : 'before',
        fileName: inserted.file_name ?? file.name,
        takenAt: inserted.taken_at ?? takenAt,
        thumbUrl: null,
      },
    }, { status: 201 })
  } catch {
    logJobPhotoWarning({ operation: 'metadata_insert', status: 'cleanup_storage_after_db_failure', ...uploadContext })

    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([storagePath])
    if (cleanupError) {
      logJobPhotoWarning({
        operation: 'storage_cleanup',
        status: 'failed',
        errorName: getErrorName(cleanupError),
        errorCode: getErrorCode(cleanupError),
      })
    }

    return NextResponse.json({ error: 'Fotografie byla nahrana, ale metadata se nepodarilo ulozit.' }, { status: 500 })
  }
}
