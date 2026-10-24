import { NextRequest, NextResponse } from 'next/server'
import { requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getAssignmentBatchWorkspace, getAssignmentBatchReceipt, mutateAssignmentBatch, cancelAssignmentBatch } from '@/lib/dal/job-assignment-batch'
import { ASSIGNMENT_BATCH_LIMITS, AssignmentBatchError, parseAssignmentBatchCommand, type AssignmentBatchScope } from '@/lib/job-assignment-batch'
import { approvedLaborSourceCode } from '@/lib/labor-source-navigation'
import { laborHistoryId } from '@/lib/labor-history'

type RouteContext = { params: Promise<{jobId:string}> }
function failure(error: unknown) {
  const e = error instanceof AssignmentBatchError ? error : new AssignmentBatchError('Výsledek operace není potvrzený. Nejdříve ověřte původní operaci.', 'unknown')
  const status = e.code === 'validation' ? 400 : e.code === 'forbidden' ? 403 : e.code === 'conflict' || e.code === 'protected' ? 409 : e.code === 'unavailable' ? 503 : 500
  return NextResponse.json({ok:false,error:e.message,code:e.code === 'protected' ? approvedLaborSourceCode : e.code,category:e.code,uncertain:e.uncertain,
    ...(e.reviewHref ? {reviewHref:e.reviewHref} : {})},{status,headers:{'Cache-Control':'no-store'}})
}
function identity(value: unknown): string {
  try { return laborHistoryId(value).toLowerCase() } catch { throw new AssignmentBatchError('Neplatná identita operace.', 'validation') }
}
async function authorized() {
  const result = await requireCompanyRole('company_admin','super_admin')
  if (!result.ok) throw new AssignmentBatchError('Nemáte oprávnění měnit přiřazení v aktivní firmě.', 'forbidden')
  return {supabase:await createSupabaseServerClient(),companyId:result.value.companyId,profileId:result.value.profileId,role:result.value.role}
}
async function requestBody(request: NextRequest): Promise<Record<string,unknown>> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > ASSIGNMENT_BATCH_LIMITS.bytes) throw new AssignmentBatchError('Příkaz je příliš velký.', 'validation')
  const reader = request.body?.getReader()
  if (!reader) throw new AssignmentBatchError('Chybí příkaz.', 'validation')
  const chunks:Uint8Array[]=[];let bytes=0
  try {
    for (;;) {
      const {done,value}=await reader.read()
      if(done) break
      bytes+=value.byteLength
      if(bytes>ASSIGNMENT_BATCH_LIMITS.bytes) { await reader.cancel(); throw new AssignmentBatchError('Příkaz je příliš velký.', 'validation') }
      chunks.push(value)
    }
    const buffer=new Uint8Array(bytes);let offset=0
    for(const chunk of chunks) {buffer.set(chunk,offset);offset+=chunk.byteLength}
    const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer))
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error('object required')
    return parsed as Record<string,unknown>
  } catch(error) {
    if(error instanceof AssignmentBatchError) throw error
    throw new AssignmentBatchError('Neplatný příkaz.', 'validation')
  } finally {reader.releaseLock()}
}
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const ctx=await authorized(), jobId=identity((await context.params).jobId)
    const query=request.nextUrl.searchParams
    for(const key of ['companyId','actorProfileId','operationId']) if(query.getAll(key).length>1) throw new AssignmentBatchError('Nejednoznačná identita operace.', 'validation')
    const scope:AssignmentBatchScope={companyId:identity(query.get('companyId')),actorProfileId:identity(query.get('actorProfileId')),jobId}
    const operation=query.get('operationId')
    const result=operation===null ? {workspace:await getAssignmentBatchWorkspace(ctx,scope)} : {receipt:await getAssignmentBatchReceipt(ctx,scope,identity(operation))}
    return NextResponse.json({ok:true,...result},{headers:{'Cache-Control':'no-store'}})
  } catch(error) {return failure(error)}
}
async function mutate(request:NextRequest, context:RouteContext, method:'POST'|'PUT'|'DELETE') {
  try {
    const ctx=await authorized(),jobId=identity((await context.params).jobId),body=await requestBody(request)
    const command=parseAssignmentBatchCommand({companyId:body.companyId,actorProfileId:body.actorProfileId,operationId:body.operationId,scopeToken:body.scopeToken,jobId,
      ...(method==='DELETE' ? {kind:'delete',assignmentId:body.assignmentId} : {kind:'upsert',assignments:method==='POST'?[body]:body.assignments})})
    const receipt=await mutateAssignmentBatch(ctx,command)
    return NextResponse.json({ok:true,receipt},{headers:{'Cache-Control':'no-store'}})
  } catch(error) {return failure(error)}
}
export async function POST(request:NextRequest,context:RouteContext) {return mutate(request,context,'POST')}
export async function PUT(request:NextRequest,context:RouteContext) {return mutate(request,context,'PUT')}
export async function DELETE(request:NextRequest,context:RouteContext) {return mutate(request,context,'DELETE')}

export async function PATCH(request:NextRequest,context:RouteContext) {
  try {
    const ctx=await authorized(),jobId=identity((await context.params).jobId),body=await requestBody(request)
    if(body.jobId!==undefined && body.jobId!==jobId) throw new AssignmentBatchError('Neplatná zakázka operace.', 'validation')
    const command=parseAssignmentBatchCommand({...body,jobId})
    const receipt=await cancelAssignmentBatch(ctx,command)
    return NextResponse.json({ok:true,receipt},{headers:{'Cache-Control':'no-store'}})
  } catch(error) {return failure(error)}
}
