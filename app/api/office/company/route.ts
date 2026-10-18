import { NextResponse } from 'next/server'
import { assertOfficeRequestOrigin } from '@diriqo/office/server'
import { hasCompanyMemberRole } from '@/lib/hub-access'
import { requireOfficeCompanySwitchContext } from '@/lib/office/context'
import { officePublicOrigin } from '@/lib/office/http-limits'

export const dynamic = 'force-dynamic'

/** Office-only selection for the existing Office roles; general Hub access is unchanged. */
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    assertOfficeRequestOrigin(request, officePublicOrigin())
    const body = await request.text()
    if (body.length > 1024) throw new Error('OFFICE_INVALID_REQUEST')
    const payload: unknown = JSON.parse(body)
    if (!payload || typeof payload !== 'object' || !('companyId' in payload)
      || typeof payload.companyId !== 'string') throw new Error('OFFICE_INVALID_REQUEST')
    const { supabase, actor, active } = await requireOfficeCompanySwitchContext(payload.companyId)
    const companyId = active.companyId
    // Recheck the target's active membership with the verified current profile.
    const member = await supabase.from('company_members').select('company_id,profile_id,role,is_active')
      .eq('company_id', companyId).eq('profile_id', actor.actorId).eq('is_active', true).maybeSingle()
    if (member.error || !member.data || member.data.company_id !== companyId
      || member.data.profile_id !== actor.actorId || member.data.is_active !== true
      || !hasCompanyMemberRole(member.data.role)) throw new Error('OFFICE_FORBIDDEN')
    const settings = await supabase.from('office_settings').select('enabled').eq('company_id', companyId).maybeSingle()
    if (settings.error || settings.data?.enabled !== true) throw new Error('OFFICE_DISABLED')
    const response = NextResponse.json({
      companyId, companyName: active.companyName,
    }, { headers })
    // Preserve the host's active-company cookie contract.
    response.cookies.set({ name: 'active_company_id', value: companyId, path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return NextResponse.json({
      error: message.match(/^OFFICE_[A-Z_]+/)?.[0] ?? 'OFFICE_COMPANY_SWITCH_FAILED',
    }, { status: 403, headers })
  }
}
