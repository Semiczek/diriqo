import { NextRequest, NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'
import { JOB_PHOTO_BUCKET, verifyJobPhotoAccess } from '@/lib/job-photo-storage'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type PhotoRow = {
  storage_path: string | null
  file_name: string | null
  job_id: string | null
  jobs?: { id: string; company_id: string | null } | { id: string; company_id: string | null }[] | null
}

function asSingle<T>(value: T | T[] | null | undefined) {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const photoId = searchParams.get('photoId')?.trim() ?? ''

  if (!photoId) {
    return NextResponse.json({ error: 'Chybí photoId.' }, { status: 400 })
  }

  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createSupabaseAdminClient()

  const { data, error } = await supabase
    .from('job_photos')
    .select(
      `
        storage_path,
        file_name,
        job_id,
        jobs!inner (
          id,
          company_id
        )
      `
    )
    .eq('id', photoId)
    .eq('jobs.company_id', activeCompany.companyId)
    .single()

  const photo = data as PhotoRow | null
  const job = asSingle(photo?.jobs)

  if (error || !photo?.storage_path || !photo.job_id || job?.company_id !== activeCompany.companyId) {
    return NextResponse.json(
      { error: `Nepodařilo se načíst fotografii: ${error?.message ?? 'Chybí storage path.'}` },
      { status: 404 }
    )
  }

  let hasJobAccess = false

  try {
    hasJobAccess = await verifyJobPhotoAccess(photo.job_id, activeCompany)
  } catch {
    return NextResponse.json({ error: 'Nepodařilo se ověřit přístup k fotografii.' }, { status: 500 })
  }

  if (!hasJobAccess) {
    return NextResponse.json({ error: 'Fotografie nebyla nalezena.' }, { status: 404 })
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from(JOB_PHOTO_BUCKET)
    .createSignedUrl(photo.storage_path, 60 * 30)

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json(
      { error: `Nepodařilo se vytvořit URL fotografie: ${signedError?.message ?? 'Chybí URL.'}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    url: signedData.signedUrl,
    fileName: photo.file_name ?? 'fotografie.jpg',
  })
}
