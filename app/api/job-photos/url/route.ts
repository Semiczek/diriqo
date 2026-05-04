import { NextRequest, NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const BUCKET = 'job-photos'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const photoId = searchParams.get('photoId')?.trim() ?? ''

  if (!photoId) {
    return NextResponse.json({ error: 'Chybi photoId.' }, { status: 400 })
  }

  const activeCompany = await getActiveCompanyContext()

  if (!activeCompany) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('job_photos')
    .select(
      `
        storage_path,
        file_name,
        jobs!inner (
          id,
          company_id
        )
      `
    )
    .eq('id', photoId)
    .eq('jobs.company_id', activeCompany.companyId)
    .single()

  if (error || !data?.storage_path) {
    return NextResponse.json(
      { error: `Nepodarilo se nacist fotografii: ${error?.message ?? 'Chybi storage path.'}` },
      { status: 404 }
    )
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.storage_path, 60 * 30)

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json(
      { error: `Nepodarilo se vytvorit URL fotografie: ${signedError?.message ?? 'Chybi URL.'}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    url: signedData.signedUrl,
    fileName: data.file_name ?? 'fotografie.jpg',
  })
}
