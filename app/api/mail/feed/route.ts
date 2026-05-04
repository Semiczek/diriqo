import { NextRequest, NextResponse } from 'next/server'

import { getActiveCompanyContext } from '@/lib/active-company'
import { listEntityThreadMessages } from '@/lib/email/listEntityThreadMessages'
import type { RelatedEntityType } from '@/lib/email/types'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'

const allowedEntityTypes: RelatedEntityType[] = ['job', 'offer', 'inquiry', 'customer']

export async function GET(request: NextRequest) {
  try {
    const activeCompany = await getActiveCompanyContext()

    if (!activeCompany) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }

    const entityType = request.nextUrl.searchParams.get('entityType') as RelatedEntityType | null
    const entityId = request.nextUrl.searchParams.get('entityId')?.trim() ?? ''

    if (!entityType || !allowedEntityTypes.includes(entityType) || !entityId) {
      return NextResponse.json({ ok: false, error: 'Invalid entity query.' }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const result = await listEntityThreadMessages(
      supabase,
      activeCompany.companyId,
      entityType,
      entityId,
    )

    return NextResponse.json({
      ok: true,
      feedItems: result.feedItems,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    console.error('[EMAIL] Feed route failed', { error: message })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
