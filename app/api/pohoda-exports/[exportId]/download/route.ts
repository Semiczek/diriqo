import { NextRequest, NextResponse } from 'next/server'

import { requireHubAccess } from '@/lib/require-hub-access'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    exportId: string
  }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const activeCompany = await requireHubAccess()
  const { exportId } = await context.params
  const supabase = await createSupabaseServerClient()

  const response = await supabase
    .from('pohoda_exports')
    .select('id, xml_content, created_at')
    .eq('id', exportId)
    .eq('company_id', activeCompany.companyId)
    .maybeSingle()

  if (response.error) {
    return NextResponse.json({ error: response.error.message }, { status: 400 })
  }

  if (!response.data?.xml_content) {
    return NextResponse.json({ error: 'Export nebyl nalezen.' }, { status: 404 })
  }

  const createdDate = new Date(response.data.created_at ?? Date.now())
  const datePart = Number.isNaN(createdDate.getTime())
    ? 'export'
    : createdDate.toISOString().slice(0, 10)

  return new NextResponse(response.data.xml_content, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'content-disposition': `attachment; filename="pohoda-faktury-${datePart}.xml"`,
      'cache-control': 'no-store',
    },
  })
}
