import { revalidatePath } from 'next/cache'
import { fleetContext, fleetError } from '@/lib/fleet/server'
import { uuidPattern } from '@/lib/fleet/domain'

async function uploadContext(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new Error('Neplatný původ požadavku.')
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('Neplatný formát požadavku.')
  const text = await request.text()
  if (text.length > 2000) throw new Error('Příliš velký požadavek.')
  const payload = JSON.parse(text)
  const context = await fleetContext()
  if (!context.manager || payload.companyId !== context.companyId || !uuidPattern.test(payload.vehicleId ?? '') || !uuidPattern.test(payload.requestId ?? '')
    || typeof payload.fileName !== 'string' || !payload.fileName.trim() || payload.fileName.length > 180
    || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(payload.mimeType)
    || !Number.isInteger(payload.sizeBytes) || payload.sizeBytes < 1 || payload.sizeBytes > 3 * 1024 * 1024) throw new Error('Zkontrolujte firmu a soubor PDF, JPG, PNG nebo WebP do 3 MB.')
  const { data, error } = await context.supabase.rpc('fleet_upload_intent', { target_company_id: context.companyId, target_vehicle_id: payload.vehicleId, target_request_id: payload.requestId, target_file_name: payload.fileName, target_mime_type: payload.mimeType, target_size_bytes: payload.sizeBytes })
  if (error || typeof data !== 'string') throw new Error(fleetError(error))
  if (!data.startsWith(`${context.companyId}/${payload.vehicleId}/`)) throw new Error('Neplatná cesta dokumentu.')
  return { context, payload, path: data }
}

export async function POST(request: Request) {
  try {
    const { context, path } = await uploadContext(request)
    const { data, error } = await context.supabase.storage.from('fleet-documents').createSignedUploadUrl(path)
    if (error || !data?.token) throw new Error('Nahrání souboru se nepodařilo připravit.')
    return Response.json({ path, token: data.token }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Příprava nahrání selhala.' }, { status: 400 }) }
}

export async function PATCH(request: Request) {
  try {
    const { context, payload, path } = await uploadContext(request)
    // The RPC checks authoritative Storage metadata (scope, owner intent, MIME and exact size).
    const { data, error } = await context.supabase.rpc('fleet_write', { target_company_id: context.companyId, target_operation: 'document.create', target_request_id: payload.requestId, target_payload: { vehicle_id: payload.vehicleId, file_name: payload.fileName, object_path: path } })
    if (error || typeof data !== 'string') throw new Error(fleetError(error))
    revalidatePath(`/fleet/${payload.vehicleId}`)
    return Response.json({ id: data }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Dokument se nepodařilo dokončit.' }, { status: 400 }) }
}
