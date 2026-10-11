import { NextResponse } from 'next/server'

import { getCompanyModules } from '@/lib/company-settings'
import { requireWorkerAccess } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const access = await requireWorkerAccess()

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = await createSupabaseServerClient()
  const [modules, navigation] = await Promise.all([
    getCompanyModules(access.value.companyId),
    supabase.rpc('module_navigation', { company: access.value.companyId }),
  ])

  return NextResponse.json({ companyId: access.value.companyId, modules,
    availableProducts: navigation.error || !Array.isArray(navigation.data) ? [] : navigation.data },
    { headers: { 'Cache-Control': 'private, no-store' } })
}
