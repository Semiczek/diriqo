import 'server-only'

import type { DalContext } from './auth'
import {
  coreQuoteId, coreQuoteRevision, coreQuoteError, coreQuoteDraftToRpc, parseCoreQuoteCreate, parseCoreQuoteDraft, parseCoreQuoteSync,
  parseCoreQuoteOpenRevision, parseCoreQuoteRevoke, parseCoreQuotePublish, parseCoreQuoteDecision, parseCoreQuoteArchive, parseCoreQuoteDelete,
  parseCoreQuoteReceipt, parseCoreQuoteWorkspace, parseCoreQuoteDocumentRead,
  type CoreQuoteScope, type CoreQuoteCommandInput, type CoreQuoteCommandKind, type CoreQuoteReceipt,
  type CoreQuoteCreateInput, type CoreQuoteDraftInput, type CoreQuoteSyncInput, type CoreQuoteOpenRevisionInput,
  type CoreQuoteRevokeInput, type CoreQuotePublishInput, type CoreQuoteDecisionInput, type CoreQuoteArchiveInput, type CoreQuoteDeleteInput,
  type CoreQuotePublicationReceipt, type CoreQuoteWorkspace, type CoreQuoteDocumentRead,
} from '@/lib/core-quote-lifecycle'

type WriteContext = Pick<DalContext, 'companyId' | 'profileId' | 'role' | 'supabase'>
type ReadContext = Pick<DalContext, 'companyId' | 'supabase'> & Partial<Pick<DalContext, 'profileId' | 'role'>>
async function authenticate(ctx: ReadContext, input?: CoreQuoteScope, role?: string | null) {
  if (input && (coreQuoteId(ctx.companyId) !== input.companyId
    || !['manager', 'company_admin', 'super_admin'].includes(role ?? ''))) {
    throw coreQuoteError({ message: 'CORE_QUOTE_FORBIDDEN' })
  }
  const auth = await ctx.supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw coreQuoteError({ message: 'CORE_QUOTE_FORBIDDEN' })
}
async function command(ctx: WriteContext, input: CoreQuoteCommandInput, kind: CoreQuoteCommandKind, rpc: string, args: Record<string, unknown>): Promise<CoreQuoteReceipt> {
  try {
    if (coreQuoteId(ctx.profileId) !== input.profileId) throw coreQuoteError({ message: 'CORE_QUOTE_FORBIDDEN' })
    await authenticate(ctx, input, ctx.role)
    const { data, error } = await ctx.supabase.rpc(rpc, { p_company_id: input.companyId, p_operation_id: input.operationId, ...args })
    if (error) throw coreQuoteError(error)
    // COMMIT may already have happened. An invalid/missing receipt is uncertain, never permission to issue a new operation.
    return parseCoreQuoteReceipt(data, input, kind)
  } catch (error) { throw coreQuoteError(error) }
}
export async function createCoreQuoteFromCalculation(ctx: WriteContext, value: CoreQuoteCreateInput) {
  const input = parseCoreQuoteCreate(value)
  return command(ctx, input, 'create', 'create_core_quote_from_calculation_atomic', {
    p_calculation_id: input.calculationId, p_expected_calculation_revision: input.expectedCalculationRevision,
  })
}
export async function updateQuote(ctx: WriteContext, value: CoreQuoteDraftInput) {
  const input = parseCoreQuoteDraft(value)
  return command(ctx, input, 'update', 'update_core_quote_draft_atomic', {
    p_quote_id: input.quoteId, p_expected_revision: input.expectedRevision, p_input: coreQuoteDraftToRpc(input),
  })
}
export const updateCoreQuoteDraft = updateQuote
export async function syncCoreQuoteDraft(ctx: WriteContext, value: CoreQuoteSyncInput) {
  const input = parseCoreQuoteSync(value)
  return command(ctx, input, 'sync', 'sync_core_quote_draft_atomic', {
    p_quote_id: input.quoteId, p_expected_revision: input.expectedRevision,
    p_calculation_id: input.calculationId, p_expected_calculation_revision: input.expectedCalculationRevision,
  })
}
export async function openCoreQuoteRevision(ctx: WriteContext, value: CoreQuoteOpenRevisionInput) {
  const input = parseCoreQuoteOpenRevision(value)
  return command(ctx, input, 'openRevision', 'open_core_quote_revision_atomic', {
    p_quote_id: input.quoteId, p_version_id: input.versionId, p_expected_revision: input.expectedRevision,
  })
}
export async function publishCoreQuoteVersion(ctx: WriteContext, value: CoreQuotePublishInput): Promise<CoreQuotePublicationReceipt> {
  const input = parseCoreQuotePublish(value)
  return await command(ctx, input, 'publish', 'publish_core_quote_version_atomic', {
    p_quote_id: input.quoteId, p_expected_revision: input.expectedRevision,
  }) as CoreQuotePublicationReceipt
}
export async function recordCoreQuoteDecision(ctx: WriteContext, value: CoreQuoteDecisionInput) {
  const input = parseCoreQuoteDecision(value)
  return command(ctx, input, 'decision', 'record_core_quote_decision_atomic', {
    p_quote_id: input.quoteId, p_version_id: input.versionId,
    p_input: { decision: input.decision, evidence: input.evidence, decided_at: input.decidedAt },
  })
}
export async function revokeCoreQuotePublication(ctx: WriteContext, value: CoreQuoteRevokeInput) {
  const input = parseCoreQuoteRevoke(value)
  return command(ctx, input, 'revoke', 'revoke_core_quote_publication_atomic', {
    p_quote_id: input.quoteId, p_version_id: input.versionId, p_expected_revision: input.expectedRevision,
  })
}
export async function archiveCoreQuote(ctx: WriteContext, value: CoreQuoteArchiveInput) {
  const input = parseCoreQuoteArchive(value)
  return command(ctx, input, 'archive', 'archive_core_quote_atomic', { p_quote_id: input.quoteId, p_expected_revision: input.expectedRevision })
}
export async function deleteCoreQuoteDraft(ctx: WriteContext, value: CoreQuoteDeleteInput) {
  const input = parseCoreQuoteDelete(value)
  return command(ctx, input, 'delete', 'delete_core_quote_draft_atomic', { p_quote_id: input.quoteId, p_expected_revision: input.expectedRevision })
}
export async function getCoreQuoteWorkspace(ctx: ReadContext, quoteId: string): Promise<CoreQuoteWorkspace> {
  try {
    const companyId = coreQuoteId(ctx.companyId), id = coreQuoteId(quoteId)
    await authenticate(ctx)
    const { data, error } = await ctx.supabase.rpc('get_core_quote_workspace', { p_company_id: companyId, p_quote_id: id })
    if (error) throw coreQuoteError(error)
    return parseCoreQuoteWorkspace(data, { companyId, quoteId: id })
  } catch (error) { throw coreQuoteError(error) }
}
export async function getCoreQuoteVersion(ctx: ReadContext, quoteId: string, versionId: string | null): Promise<CoreQuoteDocumentRead> {
  try {
    const companyId = coreQuoteId(ctx.companyId), id = coreQuoteId(quoteId), version = versionId === null ? null : coreQuoteId(versionId)
    await authenticate(ctx)
    const { data, error } = await ctx.supabase.rpc('get_core_quote_version', { p_company_id: companyId, p_quote_id: id, p_version_id: version })
    if (error) throw coreQuoteError(error)
    return parseCoreQuoteDocumentRead(data, { quoteId: id, ...(version ? { versionId: version } : {}) })
  } catch (error) { throw coreQuoteError(error) }
}


export async function getCoreQuoteDraftDocument(ctx: ReadContext, quoteId: string, expectedRevision: string): Promise<CoreQuoteDocumentRead> {
  try {
    const companyId = coreQuoteId(ctx.companyId), id = coreQuoteId(quoteId), revision = coreQuoteRevision(expectedRevision)
    await authenticate(ctx)
    const { data, error } = await ctx.supabase.rpc('get_core_quote_draft_document', { p_company_id: companyId, p_quote_id: id, p_expected_revision: revision })
    if (error) throw coreQuoteError(error)
    const document = parseCoreQuoteDocumentRead(data, { quoteId: id })
    if (document.kind !== 'draft') throw coreQuoteError(null)
    return document
  } catch (error) { throw coreQuoteError(error) }
}
