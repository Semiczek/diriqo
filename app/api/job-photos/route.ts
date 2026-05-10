import { NextRequest, NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'
import {
  buildJobPhotoStoragePath,
  hasJobPhotoAdminAccess,
  isExpectedJobPhotoStoragePath,
  isSupportedJobPhotoMimeType,
  JOB_PHOTO_BUCKET,
  MAX_JOB_PHOTO_UPLOAD_BYTES,
  normalizeJobPhotoCategory,
  resolveJobPhotoAccessScope,
  verifyJobPhotoAccess,
} from '@/lib/job-photo-storage'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const RETRY_DELAYS_MS = [200, 700, 1500]
const STORAGE_READ_TIMEOUT_MS = 8000

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

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
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

function normalizeTakenAt(value: unknown) {
  const rawValue = String(value ?? '').trim()
  if (!rawValue) return new Date().toISOString()

  const date = new Date(rawValue)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeFileName(value: unknown) {
  const fileName = String(value ?? '').trim()
  return fileName ? fileName.slice(0, 255) : 'fotografie.jpg'
}

function normalizeUploadPayload(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const row = value as Record<string, unknown>
  const sizeBytes = Number(row.sizeBytes)

  return {
    jobId: String(row.jobId ?? '').trim(),
    photoType: normalizeJobPhotoCategory(row.photoType),
    fileName: normalizeFileName(row.fileName),
    mimeType: String(row.mimeType ?? '').trim(),
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : Number.NaN,
    takenAt: normalizeTakenAt(row.takenAt),
    storagePath: String(row.storagePath ?? '').trim(),
    note: normalizeNote(row.note),
  }
}

function normalizeNote(value: unknown) {
  const note = String(value ?? '').trim()
  return note ? note.slice(0, 1000) : null
}

function isUploadFile(value: FormDataEntryValue): value is File {
  return typeof File !== 'undefined' && value instanceof File && value.size > 0
}

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
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

  let photoScope: Awaited<ReturnType<typeof resolveJobPhotoAccessScope>>

  try {
    photoScope = await resolveJobPhotoAccessScope(jobId, activeCompany)
  } catch (error) {
    logJobPhotoWarning({
      operation: 'job_access_verify',
      status: 'failed',
      errorName: getErrorName(error),
      errorCode: getErrorCode(error),
    })
    return NextResponse.json(
      { error: 'Nepodarilo se overit zakazku.' },
      { status: 500 }
    )
  }

  if (!photoScope.hasAccess || photoScope.jobIds.length === 0) {
    return NextResponse.json({ error: 'Zakazka nebyla nalezena.' }, { status: 404 })
  }

  const supabase = createSupabaseAdminClient()

  const { data, error, count } = await supabase
    .from('job_photos')
    .select(
      `
        id,
        photo_type,
        file_name,
        note,
        taken_at,
        thumb_storage_path,
        storage_path
      `,
      { count: 'exact' }
    )
    .in('job_id', photoScope.jobIds)
    .eq('company_id', activeCompany.companyId)
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
    const signedPreviewResponse = await withTimeout(
      supabase.storage.from(JOB_PHOTO_BUCKET).createSignedUrls(previewPaths, 60 * 30),
      STORAGE_READ_TIMEOUT_MS
    )

    if (!signedPreviewResponse) {
      logJobPhotoWarning({
        operation: 'preview_signed_urls',
        status: 'timeout',
      })
    } else if (signedPreviewResponse.error) {
      return NextResponse.json(
        { error: `Nepodarilo se vytvorit nahledy fotek: ${signedPreviewResponse.error.message}` },
        { status: 500 }
      )
    } else {
      const signedPreviews = signedPreviewResponse.data

      for (let index = 0; index < previewPaths.length; index += 1) {
        signedPreviewMap.set(previewPaths[index], signedPreviews?.[index]?.signedUrl ?? null)
      }
    }
  }

  let storageObjectDetectedWithoutMetadata = false
  if (rows.length === 0) {
    for (const scopedJobId of photoScope.jobIds.slice(0, 10)) {
      const storageListResponse = await withTimeout(
        supabase.storage.from(JOB_PHOTO_BUCKET).list(scopedJobId, { limit: 1 }),
        STORAGE_READ_TIMEOUT_MS
      )

      if (!storageListResponse) {
        logJobPhotoWarning({
          operation: 'metadata_orphan_check',
          status: 'timeout',
        })
        break
      }

      if (storageListResponse.error) {
        logJobPhotoWarning({
          operation: 'metadata_orphan_check',
          status: 'failed',
          errorName: getErrorName(storageListResponse.error),
          errorCode: getErrorCode(storageListResponse.error),
        })
        continue
      }

      storageObjectDetectedWithoutMetadata = (storageListResponse.data ?? []).some((item) => Boolean(item.name))
      if (storageObjectDetectedWithoutMetadata) {
        break
      }
    }
  }

  return NextResponse.json({
    items: rows.map((row) => {
      const previewPath = row.thumb_storage_path ?? row.storage_path ?? null

      return {
        id: row.id,
        photoType: normalizeJobPhotoCategory(row.photo_type),
        fileName: row.file_name ?? 'Fotografie',
        note: row.note ?? null,
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

  if (request.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) {
    if (!hasJobPhotoAdminAccess(activeCompany)) {
      return NextResponse.json({ error: 'K nahravani fotek nema uzivatel opravneni.' }, { status: 403 })
    }

    const formData = await request.formData()
    const jobId = getFormValue(formData, 'jobId').trim()
    const photoType = normalizeJobPhotoCategory(getFormValue(formData, 'photoType'))
    const files = formData.getAll('files').filter(isUploadFile)
    const notes = formData.getAll('notes').map((value) => normalizeNote(value))

    if (!jobId) {
      return NextResponse.json({ error: 'Chybi jobId.' }, { status: 400 })
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'Vyberte alespon jednu fotografii.' }, { status: 400 })
    }

    let jobExists = false

    try {
      jobExists = await verifyJobPhotoAccess(jobId, activeCompany)
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
    const uploadedPaths: string[] = []
    const insertedItems = []

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const fileName = normalizeFileName(file.name)
      const mimeType = file.type
      const sizeBytes = file.size

      if (sizeBytes <= 0 || sizeBytes > MAX_JOB_PHOTO_UPLOAD_BYTES) {
        return NextResponse.json({ error: `Fotografie ${fileName} je prazdna nebo prilis velka.` }, { status: 400 })
      }

      if (!isSupportedJobPhotoMimeType(mimeType)) {
        return NextResponse.json({ error: `Soubor ${fileName} musi byt fotografie JPG, PNG, WEBP, HEIC nebo HEIF.` }, { status: 400 })
      }

      const photoId = crypto.randomUUID()
      const storagePath = buildJobPhotoStoragePath({
        companyId: activeCompany.companyId,
        jobId,
        category: photoType,
        fileName,
        mimeType,
        photoId,
      })

      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const { error: uploadError } = await supabase.storage
          .from(JOB_PHOTO_BUCKET)
          .upload(storagePath, bytes, {
            cacheControl: '3600',
            contentType: mimeType,
            upsert: false,
          })

        if (uploadError) throw uploadError
        uploadedPaths.push(storagePath)

        const { data: inserted, error: insertError } = await supabase
          .from('job_photos')
          .insert({
            id: photoId,
            company_id: activeCompany.companyId,
            job_id: jobId,
            uploaded_by: activeCompany.profileId,
            photo_type: photoType,
            file_name: fileName,
            note: notes[index] ?? null,
            mime_type: mimeType,
            size_bytes: sizeBytes,
            taken_at: new Date().toISOString(),
            storage_path: storagePath,
            thumb_storage_path: storagePath,
          })
          .select('id, photo_type, file_name, note, taken_at, storage_path, thumb_storage_path')
          .single()

        if (insertError) throw insertError
        insertedItems.push(inserted)
      } catch (error) {
        logJobPhotoWarning({
          operation: 'admin_upload',
          status: 'failed',
          fileSize: sizeBytes,
          mimeType,
          errorName: getErrorName(error),
          errorCode: getErrorCode(error),
        })

        if (uploadedPaths.length > 0) {
          await supabase.storage.from(JOB_PHOTO_BUCKET).remove(uploadedPaths)
        }

        return NextResponse.json({ error: `Fotografii ${fileName} se nepodarilo nahrat.` }, { status: 500 })
      }
    }

    return NextResponse.json({
      items: insertedItems.map((item) => ({
        id: item.id,
        photoType: normalizeJobPhotoCategory(item.photo_type),
        fileName: item.file_name ?? 'Fotografie',
        note: item.note ?? null,
        takenAt: item.taken_at ?? null,
        thumbUrl: null,
      })),
    }, { status: 201 })
  }

  const payload = normalizeUploadPayload(await request.json().catch(() => null))

  if (!payload?.jobId) {
    return NextResponse.json({ error: 'Chybi jobId.' }, { status: 400 })
  }

  if (payload.sizeBytes <= 0 || payload.sizeBytes > MAX_JOB_PHOTO_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Fotografie je prazdna nebo prilis velka.' }, { status: 400 })
  }

  if (!isSupportedJobPhotoMimeType(payload.mimeType)) {
    return NextResponse.json({ error: 'Soubor musi byt fotografie JPG, PNG, WEBP, HEIC nebo HEIF.' }, { status: 400 })
  }

  let jobExists = false

  try {
    jobExists = await verifyJobPhotoAccess(payload.jobId, activeCompany)
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
  const uploadContext = { fileSize: payload.sizeBytes, mimeType: payload.mimeType }

  try {
    await withRetry('bucket_verify', async () => {
      const { error } = await supabase.storage.from(JOB_PHOTO_BUCKET).list('', { limit: 1 })
      if (error) throw error
    })
  } catch {
    return NextResponse.json({ error: 'Bucket job-photos neni dostupny.' }, { status: 500 })
  }

  const storagePath = buildJobPhotoStoragePath({
    companyId: activeCompany.companyId,
    jobId: payload.jobId,
    category: payload.photoType,
    fileName: payload.fileName,
    mimeType: payload.mimeType,
  })

  try {
    const signedUpload = await withRetry('signed_upload_create', async () => {
      const { data, error } = await supabase.storage
        .from(JOB_PHOTO_BUCKET)
        .createSignedUploadUrl(storagePath)

      if (error || !data?.token) throw error ?? new Error('Missing signed upload token.')
      return data
    }, uploadContext)

    return NextResponse.json({
      bucket: JOB_PHOTO_BUCKET,
      path: storagePath,
      token: signedUpload.token,
      signedUrl: signedUpload.signedUrl,
      maxBytes: MAX_JOB_PHOTO_UPLOAD_BYTES,
    })
  } catch {
    return NextResponse.json({ error: 'Nepodarilo se pripravit upload fotografie.' }, { status: 502 })
  }
}

export async function PATCH(request: NextRequest) {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const payload = normalizeUploadPayload(await request.json().catch(() => null))

  if (!payload?.jobId || !payload.storagePath) {
    return NextResponse.json({ error: 'Chybi metadata fotografie.' }, { status: 400 })
  }

  if (!isExpectedJobPhotoStoragePath({
    storagePath: payload.storagePath,
    companyId: activeCompany.companyId,
    jobId: payload.jobId,
    category: payload.photoType,
  })) {
    return NextResponse.json({ error: 'Storage path neodpovida tenant/job scope.' }, { status: 400 })
  }

  if (payload.sizeBytes <= 0 || payload.sizeBytes > MAX_JOB_PHOTO_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'Fotografie je prazdna nebo prilis velka.' }, { status: 400 })
  }

  if (!isSupportedJobPhotoMimeType(payload.mimeType)) {
    return NextResponse.json({ error: 'Soubor musi byt fotografie JPG, PNG, WEBP, HEIC nebo HEIF.' }, { status: 400 })
  }

  let jobExists = false

  try {
    jobExists = await verifyJobPhotoAccess(payload.jobId, activeCompany)
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
  const uploadContext = { fileSize: payload.sizeBytes, mimeType: payload.mimeType }

  try {
    const inserted = await withRetry(
      'metadata_insert',
      async () => {
        const { data, error } = await supabase
          .from('job_photos')
          .insert({
            company_id: activeCompany.companyId,
            job_id: payload.jobId,
            uploaded_by: activeCompany.profileId,
            photo_type: payload.photoType,
            file_name: payload.fileName,
            note: payload.note,
            mime_type: payload.mimeType,
            size_bytes: payload.sizeBytes,
            taken_at: payload.takenAt,
            storage_path: payload.storagePath,
            thumb_storage_path: payload.storagePath,
          })
          .select('id, photo_type, file_name, note, taken_at, storage_path, thumb_storage_path')
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
        photoType: normalizeJobPhotoCategory(inserted.photo_type),
        fileName: inserted.file_name ?? payload.fileName,
        note: inserted.note ?? null,
        takenAt: inserted.taken_at ?? payload.takenAt,
        thumbUrl: null,
      },
    }, { status: 201 })
  } catch {
    logJobPhotoWarning({ operation: 'metadata_insert', status: 'cleanup_storage_after_db_failure', ...uploadContext })

    const { error: cleanupError } = await supabase.storage.from(JOB_PHOTO_BUCKET).remove([payload.storagePath])
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

export async function DELETE(request: NextRequest) {
  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!hasJobPhotoAdminAccess(activeCompany)) {
    return NextResponse.json({ error: 'Ke smazani fotky nema uzivatel opravneni.' }, { status: 403 })
  }

  const payload = (await request.json().catch(() => null)) as { photoId?: unknown } | null
  const photoId = String(payload?.photoId ?? '').trim()

  if (!photoId) {
    return NextResponse.json({ error: 'Chybi photoId.' }, { status: 400 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: photo, error: photoError } = await supabase
    .from('job_photos')
    .select('id, company_id, job_id, storage_path, thumb_storage_path')
    .eq('id', photoId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (photoError) {
    return NextResponse.json({ error: `Nepodarilo se nacist fotku: ${photoError.message}` }, { status: 500 })
  }

  if (!photo?.id) {
    return NextResponse.json({ error: 'Fotka nebyla nalezena.' }, { status: 404 })
  }

  let jobExists = false

  try {
    jobExists = await verifyJobPhotoAccess(photo.job_id, activeCompany)
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

  const storagePaths = Array.from(
    new Set([photo.storage_path, photo.thumb_storage_path].filter((value): value is string => Boolean(value)))
  )

  if (storagePaths.length > 0) {
    const { error: storageError } = await supabase.storage.from(JOB_PHOTO_BUCKET).remove(storagePaths)
    if (storageError) {
      return NextResponse.json({ error: `Nepodarilo se smazat soubor ze storage: ${storageError.message}` }, { status: 500 })
    }
  }

  const { error: deleteError } = await supabase
    .from('job_photos')
    .delete()
    .eq('id', photo.id)
    .eq('company_id', activeCompany.companyId)

  if (deleteError) {
    return NextResponse.json({ error: `Nepodarilo se smazat metadata fotky: ${deleteError.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, photoId: photo.id })
}
