'use server'
import { SupabaseOfficeService } from '@diriqo/office/server'
import type { OfficeActor, OfficeRequest, OfficeResponse } from '@diriqo/office/core'
import { requireOfficeContext } from '@/lib/office/context'
import { assertOfficeHostPayload, OFFICE_HOST_RESPONSE_BYTES, OFFICE_HOST_MUTATION_BYTES } from '@/lib/office/http-limits'

const reads = new Set(['list', 'listFiles', 'listVersions', 'readVersion', 'listProposals', 'readProposal', 'read', 'versions', 'permissions', 'proposals'])
async function assertMutationBudget(service: SupabaseOfficeService, actor: OfficeActor, request: OfficeRequest) {
  if (!['save', 'rename', 'move', 'copy', 'restore', 'link', 'approve', 'reject'].includes(request.op) || !('id' in request)) return
  const current = (await service.request(actor, { op: 'read', id: request.id })).file
  if (!current) throw new Error('OFFICE_NOT_FOUND')
  let result: OfficeResponse = { file: current }
  if (request.op === 'restore') {
    const version = (await service.request(actor, { op: 'readVersion', id: request.id, revision: request.revision })).version
    if (!version) throw new Error('OFFICE_NOT_FOUND')
    result = { file: { ...current, content: version.content, title: version.title } }
  } else if (request.op === 'approve' || request.op === 'reject') {
    const proposal = (await service.request(actor, { op: 'readProposal', id: request.id, proposalId: request.proposalId })).proposal
    if (!proposal) throw new Error('OFFICE_NOT_FOUND')
    result = request.op === 'approve' ? { file: { ...current, content: proposal.content } } : { proposal }
  } else if (request.op === 'save') result = { file: { ...current, content: request.content } }
  else if (request.op === 'rename' || request.op === 'copy') result = { file: { ...current, title: request.title } }
  // Reserve metadata/framing headroom. RPC CAS and receipts remain authoritative.
  // This preflight is not atomic with the write (notably copy has no CAS field).
  assertOfficeHostPayload({ ok: true, result }, OFFICE_HOST_MUTATION_BYTES)
}
export async function officeAction(expectedTenantId: string, request: OfficeRequest) {
  try {
    const { supabase, actor } = await requireOfficeContext(!reads.has(request?.op))
    if (actor.tenantId !== expectedTenantId) throw new Error('OFFICE_TENANT_CHANGED')
    assertOfficeHostPayload({ expectedTenantId, request })
    const service = new SupabaseOfficeService(supabase)
    await assertMutationBudget(service, actor, request)
    let result = await service.request(actor, request)
    // Approval returns the installed file; repeating proposal.content doubles the
    // response for no UI benefit and can turn a committed approval into a limit error.
    if (request.op === 'approve' && result.file && result.proposal) {
      const { proposal: _proposal, ...installed } = result
      void _proposal
      result = installed
    }
    assertOfficeHostPayload({ ok: true, result }, OFFICE_HOST_RESPONSE_BYTES)
    return { ok: true as const, result }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return { ok: false as const, error: message.match(/OFFICE_[A-Z_]+/)?.[0] ?? 'OFFICE_REQUEST_FAILED' }
  }
}

export async function officeTemplateVariables(expectedTenantId: string, link?: { type: 'job' | 'customer'; id: string }) {
  const { supabase, actor, active } = await requireOfficeContext()
  if (actor.tenantId !== expectedTenantId) throw new Error('OFFICE_TENANT_CHANGED')
  const values: Record<string, string | number> = { companyName: active.companyName ?? '', date: new Date().toISOString().slice(0, 10), currency: 'CZK', customerName: '', jobName: '', price: 0 }
  if (link) {
    if (!['job', 'customer'].includes(link.type) || !/^[a-f\d-]{36}$/i.test(link.id)) throw new Error('OFFICE_INVALID_LINK')
    if (link.type === 'job') {
      const { data, error } = await supabase.from('jobs').select('id,title,price,customer_id').eq('company_id', actor.tenantId).eq('id', link.id).maybeSingle()
      if (error || !data) throw new Error('OFFICE_NOT_FOUND')
      values.jobName = data.title ?? ''; values.price = Number(data.price) || 0
      if (data.customer_id) { const result = await supabase.from('customers').select('name').eq('company_id', actor.tenantId).eq('id', data.customer_id).maybeSingle(); if (result.error) throw new Error('OFFICE_REQUEST_FAILED'); values.customerName = result.data?.name ?? '' }
    } else {
      const { data, error } = await supabase.from('customers').select('name').eq('company_id', actor.tenantId).eq('id', link.id).maybeSingle()
      if (error || !data) throw new Error('OFFICE_NOT_FOUND'); values.customerName = data.name ?? ''
    }
  }
  return values
}
