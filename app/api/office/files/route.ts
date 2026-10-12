import { NextRequest, NextResponse } from 'next/server'
import { SupabaseOfficeService, importOfficeFileBounded, exportOfficeFile, readBoundedOfficeMultipart, assertOfficeRequestOrigin } from '@diriqo/office/server'
import { requireOfficeContext } from '@/lib/office/context'
import { OFFICE_HOST_UPLOAD_BYTES, OFFICE_HOST_RESPONSE_BYTES, OFFICE_HOST_MUTATION_BYTES, assertOfficeHostPayload, assertOfficeHostUpload, officePublicOrigin } from '@/lib/office/http-limits'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const MAX_UPLOAD = OFFICE_HOST_UPLOAD_BYTES
function officeJson(value: unknown) { assertOfficeHostPayload(value, OFFICE_HOST_RESPONSE_BYTES); return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } }) }
const safeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  const code = message === 'OFFICE_FORMAT: Upload size exceeds limit' ? 'OFFICE_HOST_LIMIT' : message.match(/OFFICE_[A-Z_]+/)?.[0] ?? 'OFFICE_REQUEST_FAILED'
  return NextResponse.json({ error: code }, { status: code === 'OFFICE_HOST_LIMIT' ? 413 : 400, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    assertOfficeRequestOrigin(request, officePublicOrigin())
    const { supabase, actor } = await requireOfficeContext(true)
    if (request.headers.get('x-office-tenant') !== actor.tenantId) throw new Error('OFFICE_TENANT_CHANGED')
    const length = Number(request.headers.get('content-length'))
    if (length > MAX_UPLOAD + 65536) throw new Error('OFFICE_HOST_LIMIT')
    const data = await readBoundedOfficeMultipart(request, MAX_UPLOAD + 65536); const file = data.get('file')
    if (!(file instanceof File)) throw new Error('OFFICE_FORMAT: Invalid file')
    assertOfficeHostUpload(file)
    const bytes = new Uint8Array(await file.arrayBuffer()); const imported = await importOfficeFileBounded(file.name, bytes, pathToFileURL(resolve(process.cwd(), 'node_modules/@diriqo/office/dist/import-worker.js')))
    const service = new SupabaseOfficeService(supabase)
    assertOfficeHostPayload(imported.content)
    assertOfficeHostPayload({ content: imported.content, warnings: imported.warnings, title: file.name }, OFFICE_HOST_MUTATION_BYTES)
    const result = await service.import(actor, { title: file.name, parentId: data.get('parentId')?String(data.get('parentId')):null, content: imported.content, original: { name: file.name, mime: imported.original.mime, bytes }, idempotencyKey: String(data.get('idempotencyKey') || crypto.randomUUID()) })
    return officeJson({ file: result.file, warnings: imported.warnings })
  } catch (error) { return safeError(error) }
}
export async function GET(request: NextRequest) {
  try {
    const { supabase, actor } = await requireOfficeContext()
    if (request.headers.get('x-office-tenant') !== actor.tenantId) throw new Error('OFFICE_TENANT_CHANGED')
    const id = request.nextUrl.searchParams.get('id') ?? ''; const format = request.nextUrl.searchParams.get('format') ?? ''
    const service = new SupabaseOfficeService(supabase)
    if (format === 'original') { const original = await service.original(actor, id); return officeJson({ name: original.name, mime: original.mime, base64: Buffer.from(original.bytes).toString('base64'), warnings: [] }) }
    const result = await service.request(actor, { op: 'read', id })
    if (!result.file?.content) throw new Error('OFFICE_NOT_FOUND')
    const exported = await exportOfficeFile(result.file.content, result.file.title, format)
    assertOfficeHostPayload(exported, OFFICE_HOST_RESPONSE_BYTES)
    await service.recordExport(actor, id, format)
    return officeJson(exported)
  } catch (error) { return safeError(error) }
}
