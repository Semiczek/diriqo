import { NextResponse } from 'next/server'
import { requireOfficeContext } from '@/lib/office/context'

export const dynamic = 'force-dynamic'

/** Read-only context check. It never selects a company or changes its cookie. */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const { actor } = await requireOfficeContext()
    return NextResponse.json({ ok: true, context: {
      tenantId: actor.tenantId, actorId: actor.actorId, readOnly: actor.role === 'reader',
    } }, { headers })
  } catch {
    // No redirects: an expired session must not discard a local unsaved draft.
    return NextResponse.json({ ok: false }, { status: 403, headers })
  }
}
