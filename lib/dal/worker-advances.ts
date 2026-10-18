import 'server-only'
import type { SupabaseServerClient } from './auth'
import { advanceAmount, type AdvancePayment, type AdvanceSettlement } from '@/lib/payroll/advances'

export type AdvanceContext = { companyId: string; profileId: string; supabase: SupabaseServerClient }
export type AdvanceRequest = {
  id: string; company_id: string; profile_id: string; requested_amount: number | string | null
  amount: number | string; status: 'pending' | 'approved' | 'rejected' | 'paid'
  revision: number; requested_at: string; approved_at: string | null; paid_at: string | null
  reason: string | null; note: string | null; payroll_month: string | null
  review_reason: string | null; currency: string | null; worker_name?: string
}
export type AdvanceResult = {
  request: AdvanceRequest | null; payment?: AdvancePayment
  paid_total: number; remaining_amount: number; changed: boolean
}
export class AdvanceError extends Error {
  constructor(message: string, readonly uncertain = false) { super(message); this.name = 'AdvanceError' }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function id(value: string) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new AdvanceError('Identifikátor žádosti nebo firmy není platný. Obnovte stránku.')
  return value.toLowerCase()
}
function revision(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new AdvanceError('Verze žádosti není platná. Obnovte stránku.')
  return value
}
function money(value: unknown) {
  try { return advanceAmount(value) } catch (error) { throw new AdvanceError(error instanceof Error ? error.message : 'Neplatná částka.') }
}
const errors: Record<string, string> = {
  ADVANCE_INVALID: 'Doplňte platnou částku a všechny požadované údaje.',
  ADVANCE_HISTORY_IMMUTABLE: 'Historický záznam je neměnný. Opravu doložte novým vypořádáním.',
  ADVANCE_INVALID_DATE: 'Datum nesmí být v budoucnosti ani před původní výplatou.',
  ADVANCE_BALANCE_EXCEEDED: 'Částka překračuje nevyplacený schválený zůstatek.',
  ADVANCES_DISABLED: 'Zálohy jsou pro tohoto pracovníka vypnuté.',
  ADVANCE_CURRENCY_CONFLICT: 'Měna firmy se od schválení žádosti změnila. Výplatu musí prověřit správce.',
  ADVANCE_LEGACY_RECONCILIATION_REQUIRED: 'Historický záznam vyžaduje doložené odsouhlasení správcem.',
  ADVANCE_SETTINGS_INVALID: 'Nastavení záloh není platné. Požádejte správce o kontrolu.',
  ADVANCE_SETTINGS_UNSUPPORTED: 'Tento typ limitu záloh zatím nelze bezpečně vyčíslit. Správce musí nastavit explicitní částkový limit.',
  ADVANCE_WORKER_UNAVAILABLE: 'Pracovník nemá aktivní členství ve vybrané firmě.',
  ADVANCE_FORBIDDEN: 'K této operaci nemáte oprávnění. Obnovte přihlášení a výběr firmy.',
  ADVANCE_NOT_FOUND: 'Žádost nebyla v aktivní firmě nalezena.',
  ADVANCE_STALE: 'Žádost mezitím změnil jiný uživatel. Načtěte aktuální stav; zadaná částka zůstala zachována.',
  ADVANCE_OPERATION_CONFLICT: 'Toto potvrzení už patří jiné operaci. Neopakujte výplatu s jinou částkou.',
  ADVANCE_INVALID_STATE: 'V tomto stavu nelze žádost změnit. Načtěte aktuální stav.',
  ADVANCE_AMOUNT_INVALID: 'Zadejte platnou kladnou částku nejvýše se dvěma desetinnými místy.',
  ADVANCE_OVERPAYMENT: 'Částka překračuje nevyplacený schválený zůstatek.',
  ADVANCE_LIMIT_EXCEEDED: 'Výplatou by byl překročen nastavený limit záloh pracovníka.',
  ADVANCE_DISABLED: 'Zálohy jsou pro tohoto pracovníka vypnuté.',
  ADVANCE_MODULE_REQUIRED: 'Pro novou žádost nebo výplatu je potřeba aktivní Diriqo Core.',
  ADVANCE_REVIEW_REASON_REQUIRED: 'Při změně požadované částky doplňte důvod rozhodnutí.',
  ADVANCE_SETTLEMENT_EXCEEDED: 'Vypořádání překračuje dosud nevypořádanou částku.',
  ADVANCE_REFERENCE_REQUIRED: 'Doplňte referenci skutečného dokladu nebo převodu.',
}
export function advanceError(error: unknown): AdvanceError {
  if (error instanceof AdvanceError) return error
  const code = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  if (errors[code]) return new AdvanceError(errors[code])
  return new AdvanceError('Výsledek se nepodařilo potvrdit. Zkontrolujte aktuální stav nebo opakujte stejné potvrzení; nezakládejte novou výplatu.', true)
}
async function mutate(ctx: AdvanceContext, name: string, args: Record<string, unknown>, requestId?: string): Promise<AdvanceResult> {
  const companyId = id(ctx.companyId)
  const auth = await ctx.supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw new AdvanceError(errors.ADVANCE_FORBIDDEN)
  let response
  try { response = await ctx.supabase.rpc(name, { target_company_id: companyId, ...args }) }
  catch (error) { throw advanceError(error) }
  if (response.error) throw advanceError(response.error)
  const data = response.data
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.changed !== 'boolean'
    || !validTotal(data.paid_total) || !validTotal(data.remaining_amount)
    || (requestId && (!data.request || data.request.id !== requestId || data.request.company_id !== companyId
      || !uuid.test(data.request.profile_id) || !Number.isSafeInteger(data.request.revision)
      || data.request.revision < 0 || !['pending', 'approved', 'rejected', 'paid'].includes(data.request.status)))
    || (name === 'request_advance_atomic' && (data.request?.profile_id !== ctx.profileId
      || Number(data.request?.requested_amount) !== Number(args.requested_amount)))
    || (name === 'pay_worker_advance_atomic' && (!data.payment || data.payment.company_id !== companyId
      || data.payment.operation_id !== args.operation_id || data.payment.profile_id !== args.target_profile_id
      || data.payment.advance_request_id !== args.target_request_id || Number(data.payment.amount) !== Number(args.payment_amount)
      || data.payment.issued_at !== args.issued_on || data.payment.payment_method !== args.payment_method
      || (data.payment.payment_reference ?? '') !== args.payment_reference))) throw advanceError(null)
  return { ...data, paid_total: Number(data.paid_total), remaining_amount: Number(data.remaining_amount) } as AdvanceResult
}
function validTotal(value: unknown) {
  return (typeof value === 'number' || typeof value === 'string') && /^\d+(?:\.\d{1,2})?$/.test(String(value)) && Number.isFinite(Number(value))
}
export async function requestAdvance(ctx: AdvanceContext, input: { requestId: string; amount: unknown; reason: string }) {
  const requestId = id(input.requestId)
  return mutate(ctx, 'request_advance_atomic', { target_request_id: requestId, requested_amount: money(input.amount), request_reason: input.reason.trim(), requested_for_month: null }, requestId)
}
export async function reviewAdvance(ctx: AdvanceContext, input: { requestId: string; revision: number; operationId: string; status: 'approved' | 'rejected'; amount: unknown; reason: string }) {
  const requestId = id(input.requestId)
  if (!['approved', 'rejected'].includes(input.status)) throw new AdvanceError('Neplatné rozhodnutí.')
  return mutate(ctx, 'review_advance_request_atomic', {
    target_request_id: requestId, expected_revision: revision(input.revision), operation_id: id(input.operationId),
    target_status: input.status, approved_amount: input.status === 'approved' ? money(input.amount) : '0.00', review_reason: input.reason.trim(),
  }, requestId)
}
export async function payAdvance(ctx: AdvanceContext, input: {
  requestId: string | null; profileId: string; revision: number | null; operationId: string
  amount: unknown; issuedOn: string; note: string; method: 'cash' | 'bank_transfer'; reference: string
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issuedOn)) throw new AdvanceError('Vyberte datum skutečného vyplacení.')
  if (!['cash', 'bank_transfer'].includes(input.method)) throw new AdvanceError('Vyberte způsob výplaty.')
  const requestId = input.requestId ? id(input.requestId) : null
  return mutate(ctx, 'pay_worker_advance_atomic', {
    target_profile_id: id(input.profileId), target_request_id: requestId,
    operation_id: id(input.operationId), payment_amount: money(input.amount), issued_on: input.issuedOn,
    payment_note: input.note.trim(), expected_revision: requestId ? revision(input.revision as number) : null,
    payment_method: input.method, payment_reference: input.reference.trim(),
  }, requestId ?? undefined)
}
/** Paginate immutable evidence by a stable order. Never silently use PostgREST's
 * default row cap as a financial total. Stop explicitly if the safety cap is hit. */
async function allRows<T>(query: { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> }): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; offset < 100000; offset += 500) {
    const result = await query.range(offset, offset + 499)
    if (result.error) throw new AdvanceError('Přehled záloh se nepodařilo načíst. Obnovte stránku.')
    rows.push(...(result.data ?? []))
    if (!result.data || result.data.length < 500) return rows
  }
  throw new AdvanceError('Historie překročila velikost jednoho přehledu. Požádejte správce o export užšího období.')
}
export async function readAdvanceLedger(supabase: AdvanceContext['supabase'], companyId: string, options: {
  profileId?: string; startDate?: string; endExclusiveDate?: string; payrollMonth?: string; currency?: string
} = {}) {
  let query = supabase.from('worker_advances')
    .select('id, company_id, profile_id, advance_request_id, amount, issued_at, payroll_month, paid_at, note, payment_method, payment_reference, currency, operation_id')
    .eq('company_id', id(companyId)).order('created_at').order('id')
  if (options.profileId) query = query.eq('profile_id', id(options.profileId))
  if (options.payrollMonth) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(options.payrollMonth)) throw new AdvanceError('Neplatné mzdové období.')
    query = query.or('payroll_month.eq.' + options.payrollMonth + ',payroll_month.is.null')
  }
  else {
    if (options.startDate) query = query.gte('issued_at', options.startDate)
    if (options.endExclusiveDate) query = query.lt('issued_at', options.endExclusiveDate)
  }
  const payments = await allRows(query) as AdvancePayment[]
  if (options.payrollMonth && payments.some(p => !p.payroll_month)) throw new AdvanceError('Historická výplata nemá doložené mzdové období. Před výpočtem ji musí správce odsouhlasit.')
  const settlements: AdvanceSettlement[] = []
  for (let offset = 0; offset < payments.length; offset += 200) {
    const batch = payments.slice(offset, offset + 200)
    const records = await allRows(supabase.from('worker_advance_settlements')
      .select('id, company_id, profile_id, worker_advance_id, amount, method, reference, settled_on, created_at, currency, operation_id')
      .eq('company_id', companyId).in('worker_advance_id', batch.map(p => p.id)).order('created_at').order('id'))
    settlements.push(...records as AdvanceSettlement[])
  }
  if (payments.some(p => p.company_id !== companyId || (options.profileId && p.profile_id !== options.profileId))
    || settlements.some(s => s.company_id !== companyId || !payments.some(p => p.id === s.worker_advance_id && p.profile_id === s.profile_id))) {
    throw new AdvanceError('Přehled neodpovídá aktivní firmě.')
  }
  return { payments, settlements }
}
/** Adapter for existing payroll screens, preserving their explicit error paths. */
export async function readPayrollAdvanceLedger(...args: Parameters<typeof readAdvanceLedger>) {
  try {
    const { payments, settlements } = await readAdvanceLedger(...args)
    const currencies = new Set(payments.map(payment => payment.currency))
    if (currencies.size > 1 || (payments.length > 0 && (!payments[0].currency || !/^[A-Z]{3}$/.test(payments[0].currency)
      || (args[2]?.currency && payments[0].currency !== args[2].currency)))) {
      throw new AdvanceError('Měnu historických záloh nelze bezpečně sečíst. Požádejte správce o odsouhlasení.')
    }
    return { data: payments, settlements, currency: payments[0]?.currency ?? null, error: null }
  } catch (error) {
    return { data: [] as AdvancePayment[], settlements: [] as AdvanceSettlement[], currency: null, error: { message: advanceError(error).message } }
  }
}
export async function readAdvances(ctx: AdvanceContext, ownOnly = false) {
  let query = ctx.supabase.from('advance_requests').select('id, company_id, profile_id, requested_amount, amount, status, revision, requested_at, approved_at, paid_at, reason, note, payroll_month, review_reason, currency, profiles:profile_id(full_name)')
    .eq('company_id', id(ctx.companyId)).order('id')
  if (ownOnly) query = query.eq('profile_id', ctx.profileId)
  const [requests, ledger, company] = await Promise.all([
    allRows(query), readAdvanceLedger(ctx.supabase, ctx.companyId, ownOnly ? { profileId: ctx.profileId } : {}),
    ctx.supabase.from('companies').select('default_currency, currency').eq('id', ctx.companyId).single(),
  ])
  const currency = company.data?.default_currency || company.data?.currency
  if (company.error || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new AdvanceError(errors.ADVANCE_SETTINGS_INVALID)
  return {
    currency,
    requests: requests.map(row => {
      if (row.company_id !== ctx.companyId || (ownOnly && row.profile_id !== ctx.profileId)) throw new AdvanceError('Přehled neodpovídá aktivní firmě.')
      const relation = row.profiles as { full_name: string | null } | { full_name: string | null }[] | null
      const worker = Array.isArray(relation) ? relation[0] : relation
      return { ...row, worker_name: worker?.full_name ?? 'Pracovník' } as AdvanceRequest
    }).sort((a, b) => b.requested_at.localeCompare(a.requested_at)),
    ...ledger,
  }
}

export async function settleAdvance(ctx: AdvanceContext, input: {
  paymentId: string; operationId: string; amount: unknown; method: 'returned' | 'payroll_offset'; reference: string; settledOn: string
}): Promise<AdvanceResult> {
  if (!['returned', 'payroll_offset'].includes(input.method) || !input.reference.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.settledOn)) throw new AdvanceError('Doplňte způsob, datum a referenci doloženého vypořádání.')
  const companyId = id(ctx.companyId)
  const paymentId = id(input.paymentId)
  const amount = money(input.amount)
  const operationId = id(input.operationId)
  const auth = await ctx.supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw new AdvanceError(errors.ADVANCE_FORBIDDEN)
  const result = await ctx.supabase.rpc('settle_worker_advance_atomic', {
    target_company_id: companyId, target_payment_id: paymentId, operation_id: operationId,
    settlement_amount: amount, settlement_method: input.method, settlement_reference: input.reference.trim(), settled_on: input.settledOn,
  })
  if (result.error) throw advanceError(result.error)
  const data = result.data
  if (!data || typeof data.changed !== 'boolean' || data.payment?.id !== paymentId || data.payment?.company_id !== companyId
    || data.settlement?.worker_advance_id !== paymentId || data.settlement?.company_id !== companyId
    || data.settlement?.operation_id !== operationId || Number(data.settlement?.amount) !== Number(amount)
    || data.settlement?.method !== input.method || data.settlement?.reference !== input.reference.trim()
    || data.settlement?.settled_on !== input.settledOn || !validTotal(data.settled_total) || !validTotal(data.outstanding_amount)) throw advanceError(null)
  return { request: null, payment: data.payment, paid_total: Number(data.payment.amount), remaining_amount: 0, changed: data.changed }
}
