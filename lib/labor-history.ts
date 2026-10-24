export type LaborHistoryCode = 'validation' | 'forbidden' | 'conflict' | 'unavailable' | 'unknown'
export class LaborHistoryError extends Error {
  constructor(message: string, readonly code: LaborHistoryCode, readonly uncertain = code === 'unknown') {
    super(message)
    this.name = 'LaborHistoryError'
  }
}
const errorMessages: Record<string, [LaborHistoryCode, string]> = {
  LABOR_SOURCE_OPTIONS_LIMIT: ['validation', 'Výběr obsahuje příliš mnoho zdrojů práce. Omezte jej na konkrétního pracovníka.'],
  LABOR_NOT_FOUND: ['forbidden', 'Záznam není v aktivní firmě dostupný.'],
  LABOR_INVALID: ['validation', 'Zkontrolujte datum, sazbu, měnu a všechny údaje práce.'],
  LABOR_INVALID_STATE: ['conflict', 'Stav záznamu se změnil nebo tuto akci nepovoluje. Načtěte jeho aktuální verzi.'],
  LABOR_FORBIDDEN: ['forbidden', 'K této operaci nemáte oprávnění v aktivní firmě.'],
  LABOR_MODULE_REQUIRED: ['forbidden', 'Pro tuto operaci je potřeba aktivní základ Diriqo.'],
  LABOR_REVISION_CONFLICT: ['conflict', 'Záznam mezitím někdo změnil. Porovnejte aktuální verzi se svým návrhem.'],
  LABOR_OPERATION_CONFLICT: ['conflict', 'Stejné potvrzení už bylo použito pro jiné údaje. Zachovejte původní požadavek.'],
  LABOR_PREVIEW_CONFLICT: ['conflict', 'Ocenění se změnilo. Zkontrolujte nový náhled před schválením.'],
  LABOR_MISSING_RATE: ['validation', 'Pro práci chybí doložená sazba. Chybějící náklad nelze nahradit nulou.'],
}
export function laborHistoryError(error: unknown): LaborHistoryError {
  if (error instanceof LaborHistoryError) return error
  const row = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const mapped = typeof row.message === 'string' && Object.hasOwn(errorMessages, row.message) ? errorMessages[row.message] : null
  if (mapped) return new LaborHistoryError(mapped[1], mapped[0])
  if (row.code === '40001' || row.code === 'PT409') return new LaborHistoryError('Operaci nelze potvrdit nad zastaralou verzí. Načtěte aktuální stav.', 'conflict')
  if (row.code === '42501') return new LaborHistoryError('K této operaci nemáte oprávnění v aktivní firmě.', 'forbidden')
  if (row.code === '22023' || row.code === '23514') return new LaborHistoryError('Databáze odmítla neplatné údaje nebo stav záznamu.', 'validation')
  return new LaborHistoryError('Výsledek operace se nepodařilo potvrdit. Zachovejte údaje a opakujte stejné potvrzení operace.', 'unknown')
}
export function isLaborHistoryUnknownOutcome(error: unknown): boolean { return laborHistoryError(error).uncertain }
function invalid(message = 'Zkontrolujte všechny údaje práce a sazby.'): never { throw new LaborHistoryError(message, 'validation') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid()
  return value as Record<string, unknown>
}
function fields(row: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  if (Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))
    || required.some(key => !Object.hasOwn(row, key))) invalid('Formulář obsahuje nepodporované nebo chybějící údaje.')
}
export function laborHistoryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) return invalid('Identifikátor není platný.')
  return value.toLowerCase()
}
export function laborHistoryRevision(value: unknown): string {
  const revision = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof revision !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(revision) || BigInt(revision) > BigInt('2147483647')) return invalid('Verze není platná.')
  return revision
}
export function laborHistoryDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return invalid('Vyberte platné datum účinnosti.')
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid('Vyberte platné datum účinnosti.')
  return value
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value)) return invalid('Čas musí obsahovat platné časové pásmo.')
  laborHistoryDate(value.slice(0, 10))
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return invalid()
  return value
}
function microseconds(value: string): bigint {
  const fraction = value.match(/\.(\d+)(?:Z|[+-])/)
  const extra = fraction ? BigInt(fraction[1].padEnd(6, '0').slice(3, 6)) : BigInt(0)
  return BigInt(Date.parse(value)) * BigInt(1000) + extra
}
function decimal(value: unknown, places: number, max: bigint): string {
  if (typeof value !== 'string' || value.length > 40) return invalid('Částku zadejte jako přesné desetinné číslo.')
  const clean = value.trim().replace(',', '.')
  if (!new RegExp('^\\d+(?:\\.\\d{1,' + places + '})?$').test(clean)) return invalid('Částka nebo hodiny nejsou platné.')
  const [whole, fraction = ''] = clean.split('.')
  const units = BigInt(whole) * BigInt(10) ** BigInt(places) + BigInt(fraction.padEnd(places, '0'))
  if (units > max) return invalid('Částka nebo hodiny překračují povolený rozsah.')
  return (units / BigInt(10) ** BigInt(places)).toString() + '.' + (units % BigInt(10) ** BigInt(places)).toString().padStart(places, '0')
}
export function normalizeLaborRate(value: unknown): string { return decimal(value, 2, BigInt('999999999999')) }
export function normalizeLaborHours(value: unknown): string { return decimal(value, 4, BigInt('250000')) }
function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) return invalid('Měna musí být výslovně uvedený třípísmenný kód.')
  return value
}
function text(value: unknown, required = false, max = 2000): string | null {
  if (value != null && typeof value !== 'string') return invalid()
  const cleaned = typeof value === 'string' ? value.trim() || null : null
  if ((required && cleaned === null) || (cleaned !== null && (cleaned.includes('\0') || [...cleaned].length > max))) return invalid('Doplňte přiměřeně dlouhý důvod.')
  return cleaned
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) return invalid()
  return value as T
}
function response<T>(read: () => T): T {
  try { return read() } catch { throw laborHistoryError(null) }
}
export type LaborWriteScope = { companyId: string; actorProfileId: string; operationId: string }
const scopeKeys = ['companyId', 'actorProfileId', 'operationId'] as const
function scope(row: Record<string, unknown>): LaborWriteScope {
  return { companyId: laborHistoryId(row.companyId), actorProfileId: laborHistoryId(row.actorProfileId), operationId: laborHistoryId(row.operationId) }
}
export type LaborRate = {
  id: string; effectiveFrom: string; hourlyRate: string; currency: string; unit: 'hour' | 'fixed'
  workerType: 'employee' | 'contractor'; billingType: 'hourly' | 'fixed' | 'invoice'; reason: string; createdAt: string
}
export type LaborRateScheduleInput = LaborWriteScope & Omit<LaborRate, 'id' | 'createdAt'> & { profileId: string; expectedRevision: string }
export type LaborRateListDto = { companyId: string; profileId: string; revision: string; currency: string; companyName: string | null; profileName: string | null; rates: LaborRate[] }
export type LaborRateMutationReceipt = { companyId: string; profileId: string; operationId: string; revision: string; rateId: string }
export function parseLaborRateScheduleInput(value: unknown): LaborRateScheduleInput {
  const row = record(value)
  fields(row, [...scopeKeys, 'profileId', 'expectedRevision', 'effectiveFrom', 'hourlyRate', 'currency', 'unit', 'workerType', 'billingType', 'reason'])
  return { ...scope(row), profileId: laborHistoryId(row.profileId), expectedRevision: laborHistoryRevision(row.expectedRevision),
    effectiveFrom: laborHistoryDate(row.effectiveFrom), hourlyRate: normalizeLaborRate(row.hourlyRate), currency: currency(row.currency),
    unit: choice(row.unit, ['hour', 'fixed']), workerType: choice(row.workerType, ['employee', 'contractor']),
    billingType: choice(row.billingType, ['hourly', 'fixed', 'invoice']), reason: text(row.reason, true)! }
}
function rate(value: unknown): LaborRate {
  const row = record(value)
  fields(row, ['id', 'effective_from', 'amount', 'currency', 'unit', 'worker_type', 'billing_type', 'reason', 'created_at'])
  return { id: laborHistoryId(row.id), effectiveFrom: laborHistoryDate(row.effective_from), hourlyRate: normalizeLaborRate(row.amount),
    currency: currency(row.currency), unit: choice(row.unit, ['hour', 'fixed']), workerType: choice(row.worker_type, ['employee', 'contractor']),
    billingType: choice(row.billing_type, ['hourly', 'fixed', 'invoice']), reason: text(row.reason, true)!, createdAt: instant(row.created_at) }
}
export function parseLaborRateListDto(value: unknown, expected: { companyId: string; profileId: string }): LaborRateListDto {
  return response(() => {
    const row = record(value)
    fields(row, ['company_id', 'profile_id', 'schedule_revision', 'currency', 'company_name', 'profile_name', 'rates'])
    const companyId = laborHistoryId(row.company_id), profileId = laborHistoryId(row.profile_id)
    if (companyId !== laborHistoryId(expected.companyId) || profileId !== laborHistoryId(expected.profileId) || !Array.isArray(row.rates)) return invalid()
    const rates = row.rates.map(rate)
    if (new Set(rates.map(item => item.id)).size !== rates.length || new Set(rates.map(item => item.effectiveFrom)).size !== rates.length) return invalid()
    return { companyId, profileId, revision: laborHistoryRevision(row.schedule_revision), currency: currency(row.currency), companyName: text(row.company_name, false, 300), profileName: text(row.profile_name, false, 300), rates }
  })
}
export function parseLaborRateMutationReceipt(value: unknown, input: LaborRateScheduleInput): LaborRateMutationReceipt {
  return response(() => {
    const row = record(value)
    fields(row, ['company_id', 'profile_id', 'actor_profile_id', 'operation_id', 'schedule_revision', 'rate'])
    if (row.company_id !== input.companyId || row.profile_id !== input.profileId || row.actor_profile_id !== input.actorProfileId || row.operation_id !== input.operationId
      || BigInt(laborHistoryRevision(row.schedule_revision)) !== BigInt(input.expectedRevision) + BigInt(1)) return invalid()
    const saved = rate(row.rate)
    if (saved.effectiveFrom !== input.effectiveFrom || saved.hourlyRate !== input.hourlyRate || saved.currency !== input.currency
      || saved.unit !== input.unit || saved.workerType !== input.workerType || saved.billingType !== input.billingType || saved.reason !== input.reason) return invalid()
    return { companyId: input.companyId, profileId: input.profileId, operationId: input.operationId, revision: laborHistoryRevision(row.schedule_revision), rateId: saved.id }
  })
}


export type LaborSource = { kind: 'shift' | 'log' | 'assignment'; id: string }
export type LaborTimeLine = {
  workDate: string; startedAt: string | null; endedAt: string | null
  actualHours: string; payHours: string; billedHours: string
}
export type LaborDraftInput = LaborWriteScope & {
  submissionId: string | null; profileId: string; jobId: string; expectedRevision: string
  revisionOf: string | null; correctionReason: string | null; sources: LaborSource[]; lines: LaborTimeLine[]
}
export type LaborSubmitInput = LaborWriteScope & { submissionId: string; versionId: string; expectedRevision: string }
export type LaborReviewInput = LaborSubmitInput & { decision: 'approve' | 'return'; reason: string | null; expectedCostPreviewHash: string | null }
function nullableId(value: unknown): string | null { return value == null ? null : laborHistoryId(value) }
function source(value: unknown): LaborSource {
  const row = record(value); fields(row, ['kind', 'id'])
  return { kind: choice(row.kind, ['shift', 'log', 'assignment']), id: laborHistoryId(row.id) }
}
function sourceList(value: unknown): LaborSource[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return invalid('Vyberte 1 až 100 zdrojových záznamů.')
  const result = value.map(source)
  if (new Set(result.map(item => item.kind + ':' + item.id)).size !== result.length) return invalid('Zdrojové záznamy se nesmějí opakovat.')
  return result
}
function timeLine(value: unknown, stored = false): LaborTimeLine & { lineNo?: number } {
  const row = record(value)
  const names = stored ? ['work_date', 'started_at', 'ended_at', 'actual_hours', 'pay_hours', 'billed_hours', 'line_no']
    : ['workDate', 'actualHours', 'payHours', 'billedHours']
  fields(row, names, stored ? [] : ['startedAt', 'endedAt'])
  const workDate = laborHistoryDate(row[stored ? 'work_date' : 'workDate'])
  const start = row[stored ? 'started_at' : 'startedAt'], end = row[stored ? 'ended_at' : 'endedAt']
  if ((start == null) !== (end == null)) return invalid('Začátek a konec musí být uvedeny společně.')
  const startedAt = start == null ? null : instant(start), endedAt = end == null ? null : instant(end)
  const actualHours = normalizeLaborHours(row[stored ? 'actual_hours' : 'actualHours'])
  const payHours = normalizeLaborHours(row[stored ? 'pay_hours' : 'payHours'])
  const billedHours = normalizeLaborHours(row[stored ? 'billed_hours' : 'billedHours'])
  if (startedAt && endedAt) {
    const elapsed = microseconds(endedAt) - microseconds(startedAt)
    if (elapsed < BigInt(0) || elapsed > BigInt('90000000000')) return invalid('Časový interval musí být mezi nulou a 25 hodinami.')
    // Membership in workDate uses the company's time zone and is enforced by SQL.
    if ((elapsed + BigInt(180000)) / BigInt(360000) !== BigInt(actualHours.replace('.', ''))) return invalid('Skutečné hodiny neodpovídají začátku a konci.')
  }
  const result = { workDate, startedAt, endedAt, actualHours, payHours, billedHours }
  if (!stored) return result
  if (typeof row.line_no !== 'number' || !Number.isInteger(row.line_no) || row.line_no < 1 || row.line_no > 366) return invalid()
  return { ...result, lineNo: row.line_no }
}
function timeLines(value: unknown, stored = false): (LaborTimeLine & { lineNo?: number })[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 366) return invalid('Zadejte 1 až 366 řádků práce.')
  const lines = value.map(item => timeLine(item, stored))
  if (stored && lines.some((line, index) => line.lineNo !== index + 1)) return invalid()
  return lines
}
export function parseLaborDraftInput(value: unknown): LaborDraftInput {
  const row = record(value)
  fields(row, [...scopeKeys, 'profileId', 'jobId', 'expectedRevision', 'sources', 'lines'],
    ['submissionId', 'revisionOf', 'correctionReason'])
  const submissionId = nullableId(row.submissionId), expectedRevision = laborHistoryRevision(row.expectedRevision)
  if (submissionId === null ? expectedRevision !== '0' : expectedRevision === '0') return invalid('Nový nebo existující záznam nemá správnou revizi.')
  const revisionOf = nullableId(row.revisionOf), correctionReason = text(row.correctionReason, revisionOf !== null)
  return { ...scope(row), submissionId, profileId: laborHistoryId(row.profileId), jobId: laborHistoryId(row.jobId),
    expectedRevision, revisionOf, correctionReason, sources: sourceList(row.sources), lines: timeLines(row.lines) }
}
function submitFields(row: Record<string, unknown>): LaborSubmitInput {
  const expectedRevision = laborHistoryRevision(row.expectedRevision)
  if (expectedRevision === '0') return invalid()
  return { ...scope(row), submissionId: laborHistoryId(row.submissionId), versionId: laborHistoryId(row.versionId), expectedRevision }
}
export function parseLaborSubmitInput(value: unknown): LaborSubmitInput {
  const row = record(value); fields(row, [...scopeKeys, 'submissionId', 'versionId', 'expectedRevision'])
  return submitFields(row)
}
export function parseLaborReviewInput(value: unknown): LaborReviewInput {
  const row = record(value)
  fields(row, [...scopeKeys, 'submissionId', 'versionId', 'expectedRevision', 'decision'], ['reason', 'expectedCostPreviewHash'])
  const decision = choice(row.decision, ['approve', 'return']), reason = text(row.reason, decision === 'return')
  const hash = row.expectedCostPreviewHash ?? null
  if (hash !== null && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) return invalid('Náhled ocenění není platný.')
  if (decision === 'approve' && hash === null) return invalid('Před schválením načtěte aktuální náhled ocenění.')
  return { ...submitFields(row), decision, reason, expectedCostPreviewHash: hash as string | null }
}

export type LaborCostLine = {
  lineNo: number; rateVersionId: string; rateAmount: string; currency: string; unit: 'hour' | 'fixed'
  workerType: 'employee' | 'contractor'; billingType: 'hourly' | 'fixed' | 'invoice'; costQuantity: string; costAmount: string
}
export type LaborCost = { currency: string; amount: string; lines: LaborCostLine[] }
export type LaborVersion = {
  id: string; version: string; state: 'draft' | 'submitted' | 'approved' | 'returned'; revisionOf: string | null
  correctionReason: string | null; createdAt: string; submittedAt: string | null; reviewedAt: string | null; reviewReason: string | null
  lines: (LaborTimeLine & { lineNo: number })[]; cost?: LaborCost | null
}
export type LaborSubmissionDto = {
  id: string; companyId: string; profileId: string; jobId: string; revision: string
  currentVersionId: string; approvedVersionId: string | null; versions: LaborVersion[]; sources: LaborSource[]
  operationId?: string; actorProfileId?: string
}
export type LaborSubmissionListDto = { companyId: string; items: LaborSubmissionDto[] }
export type LaborCostPreviewDto = {
  companyId: string; submissionId: string; versionId: string; previewHash: string
  completeness: 'complete' | 'incomplete'; reasons: string[]; cost?: LaborCost
}
function amount(value: unknown, maximumIntegerDigits = 100): string {
  if (typeof value !== 'string' || !new RegExp('^\\d{1,' + maximumIntegerDigits + '}(?:\\.\\d{1,2})?$').test(value)) return invalid()
  const [whole, fraction = ''] = value.split('.')
  return (BigInt(whole)).toString() + '.' + fraction.padEnd(2, '0')
}
function cost(value: unknown): LaborCost {
  const row = record(value); fields(row, ['currency', 'amount', 'lines'])
  if (!Array.isArray(row.lines) || row.lines.length > 366) return invalid()
  const moneyCurrency = currency(row.currency)
  const lines = row.lines.map(value => {
    const line = record(value)
    fields(line, ['line_no', 'rate_version_id', 'rate_amount', 'currency', 'unit', 'worker_type', 'billing_type', 'cost_quantity', 'cost_amount'])
    if (typeof line.line_no !== 'number' || !Number.isInteger(line.line_no) || line.line_no < 1 || line.line_no > 366) return invalid()
    if (currency(line.currency) !== moneyCurrency) return invalid()
    return { lineNo: line.line_no, rateVersionId: laborHistoryId(line.rate_version_id), rateAmount: normalizeLaborRate(line.rate_amount),
      currency: moneyCurrency, unit: choice(line.unit, ['hour', 'fixed']), workerType: choice(line.worker_type, ['employee', 'contractor']),
      billingType: choice(line.billing_type, ['hourly', 'fixed', 'invoice']), costQuantity: normalizeLaborHours(line.cost_quantity),
      costAmount: amount(line.cost_amount, 16) }
  })
  if (new Set(lines.map(line => line.lineNo)).size !== lines.length) return invalid()
  for (const line of lines) {
    const quantity = BigInt(line.costQuantity.replace('.', ''))
    const expectedCents = (BigInt(line.rateAmount.replace('.', '')) * quantity + BigInt(5000)) / BigInt(10000)
    if (expectedCents !== BigInt(line.costAmount.replace('.', ''))
      || (line.unit === 'fixed' && !['0.0000', '1.0000'].includes(line.costQuantity))) return invalid()
  }
  const total = amount(row.amount)
  if (lines.reduce((sum, line) => sum + BigInt(line.costAmount.replace('.', '')), BigInt(0)) !== BigInt(total.replace('.', ''))) return invalid()
  return { currency: moneyCurrency, amount: total, lines }
}
function version(value: unknown, financial: boolean): LaborVersion {
  const row = record(value)
  fields(row, ['id', 'version', 'state', 'revision_of', 'correction_reason', 'created_at', 'submitted_at', 'reviewed_at', 'review_reason', 'lines', ...(financial ? ['cost'] : [])])
  const state = choice(row.state, ['draft', 'submitted', 'approved', 'returned'])
  const versionNumber = laborHistoryRevision(row.version)
  if (versionNumber === '0') return invalid()
  const submittedAt = row.submitted_at === null ? null : instant(row.submitted_at)
  const reviewedAt = row.reviewed_at === null ? null : instant(row.reviewed_at)
  if ((state === 'submitted' || state === 'approved' || state === 'returned') && submittedAt === null) return invalid()
  if ((state === 'approved' || state === 'returned') && reviewedAt === null) return invalid()
  const lines = timeLines(row.lines, true) as LaborVersion['lines']
  const money = financial ? row.cost === null ? null : cost(row.cost) : undefined
  if (financial && ((state === 'approved') !== (money !== null))) return invalid()
  if (money && (money.lines.length !== lines.length || money.lines.some(line => !lines.some(time => time.lineNo === line.lineNo
    && (line.unit === 'fixed' || line.costQuantity === time.payHours))))) return invalid()
  return { id: laborHistoryId(row.id), version: versionNumber, state, revisionOf: nullableId(row.revision_of),
    correctionReason: text(row.correction_reason), createdAt: instant(row.created_at), submittedAt, reviewedAt,
    reviewReason: text(row.review_reason), lines, ...(financial ? { cost: money } : {}) }
}
function submission(value: unknown, expected: { companyId: string; submissionId?: string; profileId?: string; jobId?: string }, financial: boolean, mutation = false): LaborSubmissionDto {
  const row = record(value)
  fields(row, ['id', 'company_id', 'profile_id', 'job_id', 'revision', 'current_version_id', 'approved_version_id', 'versions', 'sources',
    ...(mutation ? ['operation_id', 'actor_profile_id'] : [])])
  const id = laborHistoryId(row.id), companyId = laborHistoryId(row.company_id)
  const profileId = laborHistoryId(row.profile_id), jobId = laborHistoryId(row.job_id)
  if (companyId !== laborHistoryId(expected.companyId) || (expected.submissionId && id !== laborHistoryId(expected.submissionId))
    || (expected.profileId && profileId !== laborHistoryId(expected.profileId)) || (expected.jobId && jobId !== laborHistoryId(expected.jobId))) return invalid()
  if (!Array.isArray(row.versions) || row.versions.length === 0) return invalid()
  const versions = row.versions.map(item => version(item, financial))
  if (new Set(versions.map(item => item.id)).size !== versions.length || new Set(versions.map(item => item.version)).size !== versions.length) return invalid()
  const currentVersionId = laborHistoryId(row.current_version_id), approvedVersionId = nullableId(row.approved_version_id)
  if (!versions.some(item => item.id === currentVersionId)
    || (approvedVersionId && !versions.some(item => item.id === approvedVersionId && item.state === 'approved'))) return invalid()
  const revision = laborHistoryRevision(row.revision)
  if (revision === '0') return invalid()
  return { id, companyId, profileId, jobId, revision, currentVersionId, approvedVersionId, versions, sources: sourceList(row.sources),
    ...(mutation ? { operationId: laborHistoryId(row.operation_id), actorProfileId: laborHistoryId(row.actor_profile_id) } : {}) }
}
export function parseLaborSubmissionDto(value: unknown, expected: { companyId: string; submissionId: string; profileId?: string }, financial: boolean): LaborSubmissionDto {
  return response(() => submission(value, expected, financial))
}
export function parseLaborSubmissionListDto(value: unknown, expected: { companyId: string; profileId?: string; jobId?: string }, financial: boolean): LaborSubmissionListDto {
  return response(() => {
    const row = record(value); fields(row, ['company_id', 'items'])
    if (row.company_id !== expected.companyId || !Array.isArray(row.items)) return invalid()
    const items = row.items.map(item => submission(item, expected, financial))
    if (new Set(items.map(item => item.id)).size !== items.length) return invalid()
    return { companyId: expected.companyId, items }
  })
}
export function parseLaborMutationReceipt(value: unknown, input: LaborDraftInput | LaborSubmitInput | LaborReviewInput, operation: 'draft' | 'submit' | 'review', financial: boolean): LaborSubmissionDto {
  return response(() => {
    const result = submission(value, { companyId: input.companyId, ...(input.submissionId ? { submissionId: input.submissionId } : {}),
      ...('profileId' in input ? { profileId: input.profileId, jobId: input.jobId } : {}) }, financial, true)
    if (result.operationId !== input.operationId || result.actorProfileId !== input.actorProfileId
      || BigInt(result.revision) !== BigInt(input.expectedRevision) + BigInt(1)) return invalid()
    const current = result.versions.find(item => item.id === result.currentVersionId)!
    if ('versionId' in input && result.currentVersionId !== input.versionId) return invalid()
    const expectedState = operation === 'draft' ? 'draft' : operation === 'submit' ? 'submitted' : 'decision' in input && input.decision === 'approve' ? 'approved' : 'returned'
    if (current.state !== expectedState || (expectedState === 'approved' && result.approvedVersionId !== result.currentVersionId)) return invalid()
    if ('lines' in input) {
      const sameInstant = (a: string | null, b: string | null) => a === null || b === null ? a === b : microseconds(a) === microseconds(b)
      if (current.revisionOf !== input.revisionOf || current.correctionReason !== input.correctionReason
        || current.lines.length !== input.lines.length || current.lines.some((line, index) => {
          const sent = input.lines[index]
          return line.workDate !== sent.workDate || line.actualHours !== sent.actualHours || line.payHours !== sent.payHours || line.billedHours !== sent.billedHours
            || !sameInstant(line.startedAt, sent.startedAt) || !sameInstant(line.endedAt, sent.endedAt)
        }) || result.sources.length !== input.sources.length
        || result.sources.some(saved => !input.sources.some(sent => sent.kind === saved.kind && sent.id === saved.id))) return invalid()
    }
    if ('decision' in input && current.reviewReason !== input.reason) return invalid()
    return result
  })
}
export function parseLaborCostPreviewDto(value: unknown, expected: { companyId: string; submissionId: string; versionId: string }, financial: boolean): LaborCostPreviewDto {
  return response(() => {
    const row = record(value)
    fields(row, ['company_id', 'submission_id', 'version_id', 'preview_hash', 'completeness', 'reasons', ...(financial ? ['cost'] : [])])
    if (row.company_id !== expected.companyId || row.submission_id !== expected.submissionId || row.version_id !== expected.versionId
      || typeof row.preview_hash !== 'string' || !/^[a-f0-9]{64}$/.test(row.preview_hash)
      || !Array.isArray(row.reasons) || row.reasons.length > 366 || row.reasons.some(reason => typeof reason !== 'string' || reason.length > 2000)) return invalid()
    const completeness = choice(row.completeness, ['complete', 'incomplete'])
    if ((completeness === 'complete') !== (row.reasons.length === 0)) return invalid()
    return { companyId: expected.companyId, submissionId: expected.submissionId, versionId: expected.versionId, previewHash: row.preview_hash, completeness, reasons: row.reasons as string[],
      ...(financial ? { cost: cost(row.cost) } : {}) }
  })
}


export type JobLaborCostTotal = {
  jobId: string; currency: string; approvedCost: string; approvedInternalCost: string; approvedExternalCost: string
  approvedHours: string; unconvertedCosts: { currency: string; amount: string }[]; provisionalKnownCost: string
  missingRateHours: string; unapprovedHours: string; legacyUnverifiedCount: number
  completeness: 'complete' | 'provisional' | 'incomplete'; reasons: string[]; totalCost: string | null
}
export type JobLaborCostTotalsDto = { companyId: string; items: JobLaborCostTotal[] }
export function parseLaborJobIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) return invalid('Vyberte nejvýše 500 zakázek.')
  const ids = value.map(laborHistoryId)
  if (new Set(ids).size !== ids.length) return invalid('Zakázky se nesmějí opakovat.')
  return ids
}
function aggregateHours(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,100}(?:\.\d{1,4})?$/.test(value)) return invalid()
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole).toString() + '.' + fraction.padEnd(4, '0')
}
export function parseJobLaborCostTotalsDto(value: unknown, expected: { companyId: string; jobIds: string[] }): JobLaborCostTotalsDto {
  return response(() => {
    const row = record(value); fields(row, ['company_id', 'items'])
    const companyId = laborHistoryId(row.company_id), jobIds = parseLaborJobIds(expected.jobIds)
    if (companyId !== laborHistoryId(expected.companyId) || !Array.isArray(row.items) || row.items.length !== jobIds.length) return invalid()
    const items = row.items.map((value): JobLaborCostTotal => {
      const item = record(value)
      fields(item, ['job_id', 'currency', 'approved_cost', 'approved_internal_cost', 'approved_external_cost', 'approved_hours',
        'unconverted_costs', 'provisional_known_cost', 'missing_rate_hours', 'unapproved_hours', 'legacy_unverified_count', 'completeness', 'reasons', 'total_cost'])
      const jobId = laborHistoryId(item.job_id), moneyCurrency = currency(item.currency)
      if (!jobIds.includes(jobId) || !Array.isArray(item.unconverted_costs) || item.unconverted_costs.length > 1000
        || !Array.isArray(item.reasons) || item.reasons.length > 366 || item.reasons.some(reason => typeof reason !== 'string' || !reason || reason.length > 2000)
        || new Set(item.reasons).size !== item.reasons.length
        || typeof item.legacy_unverified_count !== 'number' || !Number.isSafeInteger(item.legacy_unverified_count) || item.legacy_unverified_count < 0) return invalid()
      const unconvertedCosts = item.unconverted_costs.map(value => {
        const cost = record(value); fields(cost, ['currency', 'amount'])
        const costCurrency = currency(cost.currency)
        if (costCurrency === moneyCurrency) return invalid()
        return { currency: costCurrency, amount: amount(cost.amount) }
      })
      if (new Set(unconvertedCosts.map(cost => cost.currency)).size !== unconvertedCosts.length) return invalid()
      const approvedCost = amount(item.approved_cost), approvedInternalCost = amount(item.approved_internal_cost), approvedExternalCost = amount(item.approved_external_cost)
      if (BigInt(approvedCost.replace('.', '')) !== BigInt(approvedInternalCost.replace('.', '')) + BigInt(approvedExternalCost.replace('.', ''))) return invalid()
      const completeness = choice(item.completeness, ['complete', 'provisional', 'incomplete'])
      const reasons = item.reasons as string[], totalCost = item.total_cost === null ? null : amount(item.total_cost)
      if (completeness === 'complete' ? reasons.length !== 0 || totalCost !== approvedCost : reasons.length === 0 || totalCost !== null) return invalid()
      if (completeness === 'provisional' && (reasons.length !== 1 || reasons[0] !== 'unapproved_work')) return invalid()
      if (unconvertedCosts.length > 0 && (completeness !== 'incomplete' || !reasons.includes('currency_mismatch'))) return invalid()
      if (item.legacy_unverified_count > 0 && (completeness !== 'incomplete' || !reasons.includes('legacy_unverified'))) return invalid()
      const missingRateHours = aggregateHours(item.missing_rate_hours), unapprovedHours = aggregateHours(item.unapproved_hours)
      if (BigInt(missingRateHours.replace('.', '')) > BigInt(0) && (completeness !== 'incomplete' || !reasons.includes('missing_rate'))) return invalid()
      return { jobId, currency: moneyCurrency, approvedCost, approvedInternalCost, approvedExternalCost,
        approvedHours: aggregateHours(item.approved_hours), unconvertedCosts, provisionalKnownCost: amount(item.provisional_known_cost),
        missingRateHours, unapprovedHours, legacyUnverifiedCount: item.legacy_unverified_count, completeness, reasons, totalCost }
    })
    if (new Set(items.map(item => item.jobId)).size !== items.length) return invalid()
    return { companyId, items }
  })
}


export type LaborSourceOption = LaborSource & {
  profileId: string; profileName: string | null; jobId: string; jobTitle: string | null
  workDate: string | null; startedAt: string | null; endedAt: string | null
  actualHours: string | null; submissionId: string | null
}
export type LaborSourceOptionsDto = { companyId: string; companyName: string | null; items: LaborSourceOption[] }
export function parseLaborSourceOptionsDto(value: unknown, expected: { companyId: string; profileId?: string }): LaborSourceOptionsDto {
  return response(() => {
    const row = record(value); fields(row, ['company_id', 'company_name', 'items'])
    const companyId = laborHistoryId(row.company_id)
    if (companyId !== laborHistoryId(expected.companyId) || !Array.isArray(row.items) || row.items.length > 2000) return invalid()
    const items = row.items.map((value): LaborSourceOption => {
      const item = record(value)
      fields(item, ['kind', 'id', 'profile_id', 'profile_name', 'job_id', 'job_title', 'work_date', 'started_at', 'ended_at', 'actual_hours', 'submission_id'])
      const profileId = laborHistoryId(item.profile_id)
      if ((expected.profileId && profileId !== laborHistoryId(expected.profileId)) || (item.started_at === null) !== (item.ended_at === null)) return invalid()
      const startedAt = item.started_at === null ? null : instant(item.started_at), endedAt = item.ended_at === null ? null : instant(item.ended_at)
      if (startedAt && endedAt && microseconds(endedAt) < microseconds(startedAt)) return invalid()
      return { kind: choice(item.kind, ['shift', 'log', 'assignment']), id: laborHistoryId(item.id), profileId,
        profileName: text(item.profile_name, false, 300), jobId: laborHistoryId(item.job_id), jobTitle: text(item.job_title, false, 1000),
        workDate: item.work_date === null ? null : laborHistoryDate(item.work_date), startedAt, endedAt,
        actualHours: item.actual_hours === null ? null : normalizeLaborHours(item.actual_hours), submissionId: nullableId(item.submission_id) }
    })
    if (new Set(items.map(item => item.kind + ':' + item.id)).size !== items.length) return invalid()
    return { companyId, companyName: text(row.company_name, false, 300), items }
  })
}
