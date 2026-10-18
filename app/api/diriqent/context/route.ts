import { supportContext } from '@/lib/diriqent/support-server'

const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }
export async function GET() {
  try {
    const { companyId, profileId, role } = await supportContext()
    return Response.json({ companyId, profileId, role }, { headers })
  } catch {
    return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers })
  }
}
