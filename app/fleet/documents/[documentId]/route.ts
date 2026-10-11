import { fleetContext } from '@/lib/fleet/server'
import { uuidPattern } from '@/lib/fleet/domain'

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  try {
    const context = await fleetContext()
    const { documentId } = await params
    if (!uuidPattern.test(documentId)) return new Response('Dokument nebyl nalezen.', { status: 404 })
    const { data, error } = await context.supabase.from('fleet_documents').select('object_path,file_name').eq('company_id', context.companyId).eq('id', documentId).maybeSingle()
    if (error || !data) return new Response('Dokument nebyl nalezen.', { status: 404 })
    const file = await context.supabase.storage.from('fleet-documents').createSignedUrl(data.object_path, 60, { download: data.file_name })
    if (file.error || !file.data?.signedUrl) return new Response('Dokument nyní nelze stáhnout.', { status: 403 })
    return new Response(null, { status: 303, headers: { Location: file.data.signedUrl, 'Cache-Control': 'private, no-store' } })
  } catch { return new Response('K dokumentu nemáte přístup.', { status: 403 }) }
}
