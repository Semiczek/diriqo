import {
  LaborHistoryError, parseLaborDraftInput, parseLaborSubmitInput, parseLaborReviewInput,
  type LaborDraftInput, type LaborSubmitInput, type LaborReviewInput,
  type LaborSubmissionDto, type LaborSourceOption, type LaborTimeLine,
} from '@/lib/labor-history'

export type LaborCommand = { kind: 'draft'; input: LaborDraftInput } | { kind: 'submit'; input: LaborSubmitInput } | { kind: 'review'; input: LaborReviewInput }
export type LaborWorkspace = {
  companyId: string; companyName: string | null; actorProfileId: string
  role: 'worker' | 'manager' | 'company_admin' | 'super_admin'
  items: LaborSubmissionDto[]; sources: LaborSourceOption[]; initialSubmissionId?: string
}
export type DraftFields = { sources: string[]; lines: LaborTimeLine[]; reason: string }
export function sourceKey(source: { kind: string; id: string }) { return `${source.kind}:${source.id}` }
export function parseLaborCommand(raw: unknown): LaborCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LaborHistoryError('Neplatný požadavek.', 'validation')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => key !== 'kind' && key !== 'input')) throw new LaborHistoryError('Neplatný požadavek.', 'validation')
  if (value.kind === 'draft') return { kind: value.kind, input: parseLaborDraftInput(value.input) }
  if (value.kind === 'submit') return { kind: value.kind, input: parseLaborSubmitInput(value.input) }
  if (value.kind === 'review') return { kind: value.kind, input: parseLaborReviewInput(value.input) }
  throw new LaborHistoryError('Neplatný požadavek.', 'validation')
}
export function assertLaborReceipt(command: LaborCommand, receipt: LaborSubmissionDto) {
  const input = command.input
  if (receipt.companyId !== input.companyId || receipt.actorProfileId !== input.actorProfileId || receipt.operationId !== input.operationId
    || BigInt(receipt.revision) !== BigInt(input.expectedRevision) + BigInt(1)
    || (input.submissionId && receipt.id !== input.submissionId)
    || (command.kind === 'draft' && (receipt.profileId !== command.input.profileId || receipt.jobId !== command.input.jobId))) {
    throw new LaborHistoryError('Výsledek není potvrzený.', 'unknown')
  }
  const current = receipt.versions.find(item => item.id === receipt.currentVersionId)
  const expectedState = command.kind === 'draft' ? 'draft' : command.kind === 'submit' ? 'submitted' : command.input.decision === 'approve' ? 'approved' : 'returned'
  if (!current || current.state !== expectedState) throw new LaborHistoryError('Výsledek není potvrzený.', 'unknown')
}
export function blankLaborLine(): LaborTimeLine { return { workDate: '', actualHours: '', payHours: '', billedHours: '', startedAt: null, endedAt: null } }
export function initialDraftFields(item: LaborSubmissionDto | null): DraftFields {
  const version = item?.versions.find(value => value.id === item.currentVersionId)
  return { sources: item?.sources.map(sourceKey) ?? [], reason: version?.state === 'draft' ? version.correctionReason ?? '' : '',
    lines: version?.lines.map(({ workDate, actualHours, payHours, billedHours, startedAt, endedAt }) => ({ workDate, actualHours, payHours, billedHours, startedAt, endedAt })) ?? [blankLaborLine()] }
}
export function createLaborDraftCommand(workspace: LaborWorkspace, item: LaborSubmissionDto | null, fields: DraftFields): LaborCommand {
  const selected = fields.sources.map(key => workspace.sources.find(source => sourceKey(source) === key))
  const existing = item?.sources ?? []
  if (!fields.sources.length || fields.sources.length > 100 || new Set(fields.sources).size !== fields.sources.length
    || selected.some((source, index) => !source && !existing.some(value => sourceKey(value) === fields.sources[index]))) throw new LaborHistoryError('Vyberte dostupný zdroj práce.', 'validation')
  const first = selected.find(source => source !== undefined)
  const profileId = item?.profileId ?? first?.profileId, jobId = item?.jobId ?? first?.jobId
  if (!profileId || !jobId || selected.some(source => source && (source.profileId !== profileId || source.jobId !== jobId || (source.submissionId !== null && source.submissionId !== item?.id)))) throw new LaborHistoryError('Zdroje musí patřit stejnému pracovníkovi a zakázce.', 'validation')
  if (workspace.role === 'worker' && profileId !== workspace.actorProfileId) throw new LaborHistoryError('Výkaz není pro tento účet dostupný.', 'forbidden')
  const current = item?.versions.find(version => version.id === item.currentVersionId)
  if (current?.state === 'submitted') throw new LaborHistoryError('Odeslaný výkaz už nelze upravit.', 'conflict')
  const revisionOf = current && current.state !== 'draft' ? current.id : current?.revisionOf ?? null
  return parseLaborCommand({ kind: 'draft', input: { companyId: workspace.companyId, actorProfileId: workspace.actorProfileId,
    operationId: crypto.randomUUID(), submissionId: item?.id ?? null, profileId, jobId, expectedRevision: item?.revision ?? '0', revisionOf,
    correctionReason: fields.reason || null, sources: fields.sources.map(key => {
      const source = workspace.sources.find(value => sourceKey(value) === key) ?? existing.find(value => sourceKey(value) === key)!
      return { kind: source.kind, id: source.id }
    }), lines: fields.lines } })
}
