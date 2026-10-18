import 'server-only'
import { aiContext, executeReservedAi, type Operation } from './server'
import { assertDiriqentPolicy, assertDiriqentRecords, diriqentScope } from './access'
import { providerConfigured } from './provider'
import { answerSupport } from './support'
import { canUseWorkDataset, validateWorkRequest, WORK_MULTIPLIERS, WORK_RATE_VERSIONS, type WorkQuote, type WorkRequest } from './work'

export const WORK_POLICY_VERSION = 'diriqent-work-v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type Context = Awaited<ReturnType<typeof aiContext>>
export type WorkApproval = { companyId: string; quoteId: string; requestId: string; acceptedMaxUnits: number; acceptedRateVersion: string; confirmed: boolean }
export class WorkStartUncertainError extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : 'Spuštění je nutné ověřit.') }
}

async function assertWorkPolicy(ctx: Context) {
  const { data, error } = await ctx.supabase.rpc('diriqent_access_policy', { c: ctx.companyId })
  if (error) throw new Error('Analytika čeká na aktualizaci databáze. Podpora bez kreditu zůstává dostupná.')
  assertDiriqentPolicy(data)
  if (data.workPolicyVersion !== WORK_POLICY_VERSION) throw new Error('Analytika čeká na aktualizaci databáze.')
  if (data.companyId !== ctx.companyId || data.profileId !== ctx.profileId || data.scope !== diriqentScope(ctx.role)) throw new Error('Firma nebo oprávnění se změnily. Obnovte stránku.')
}

function checkedQuote(value: unknown, input: WorkRequest, ctx: Context): WorkQuote {
  if (!value || typeof value !== 'object') throw new Error('Cenový limit se nepodařilo připravit.')
  const quote = value as WorkQuote
  if (!UUID.test(quote.id) || quote.companyId !== ctx.companyId || quote.profileId !== ctx.profileId
    || quote.scope !== diriqentScope(ctx.role) || quote.mode !== input.mode
    || quote.spec?.dataset !== input.spec.dataset || quote.spec.from !== input.spec.from || quote.spec.to !== input.spec.to
    || quote.prompt !== input.prompt || quote.maxUnits !== input.maxUnits
    || quote.rateVersion !== WORK_RATE_VERSIONS[input.mode] || quote.multiplier !== WORK_MULTIPLIERS[input.mode]
    || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()) {
    throw new Error('Zadání nebo sazba se změnily. Připravte nové potvrzení.')
  }
  return quote
}

/** A review/quote does not reserve credit, load company records or start a provider request. */
export async function prepareAdvancedWork(value: unknown) {
  const input = validateWorkRequest(value)
  const ctx = await aiContext(input.companyId)
  if (!canUseWorkDataset(ctx.role, input.spec.dataset)) throw new Error('Tato data nejsou pro vaši roli dostupná.')
  const support = answerSupport(input.prompt, ctx.role)
  if (support.kind !== 'needs_data') return { support }
  await assertWorkPolicy(ctx)
  const { data, error } = await ctx.supabase.rpc('diriqent_prepare_work', {
    c: ctx.companyId, mode: input.mode, spec: input.spec, prompt: input.prompt, max_units: input.maxUnits,
  })
  if (error) throw new Error(error.message)
  return { quote: checkedQuote(data, input, ctx) }
}

/** Only the immutable DB quote supplies prompt, scope, period and tariff at execution. */
export async function runApprovedWork(input: WorkApproval): Promise<Operation> {
  if (!input || input.confirmed !== true || !UUID.test(input.companyId) || !UUID.test(input.quoteId) || !UUID.test(input.requestId)
    || !Number.isSafeInteger(input.acceptedMaxUnits) || input.acceptedMaxUnits < 100 || input.acceptedMaxUnits > 5000
    || !Object.values(WORK_RATE_VERSIONS).includes(input.acceptedRateVersion as typeof WORK_RATE_VERSIONS[keyof typeof WORK_RATE_VERSIONS])) {
    throw new Error('Před spuštěním potvrďte konkrétní zadání, sazbu a cenový limit.')
  }
  const ctx = await aiContext(input.companyId)
  await assertWorkPolicy(ctx)
  if (!providerConfigured()) throw new Error('AI služba zatím nemá nastavený serverový klíč. Kredit nebyl rezervován.')
  // A transport failure may hide a committed reservation. Never tell the UI it is safe to replace its request ID.
  const { data, error } = await Promise.resolve(ctx.supabase.rpc('diriqent_reserve_work', {
    c: ctx.companyId, quote_id: input.quoteId, request_id: input.requestId,
    accepted_max_units: input.acceptedMaxUnits, accepted_rate_version: input.acceptedRateVersion, confirmed: input.confirmed,
  })).catch(error => { throw new WorkStartUncertainError(error) })
  if (error) {
    const failure = new Error(error.message)
    // PostgREST may return transport/parse failures as an error value, not a rejected promise.
    // Only known validation, constraint and application rejections are definite.
    // Connection/unknown-completion codes (including 08007 and 40003) retain the request ID.
    if (!/^(?:22[0-9A-Z]{3}|23[0-9A-Z]{3}|P0[0-9A-Z]{3}|42501)$/.test(error.code ?? '')) throw new WorkStartUncertainError(failure)
    throw failure
  }
  try {
    assertDiriqentRecords(ctx.role, [data])
    const operation = data as Operation
    if (operation.company_id !== ctx.companyId || operation.profile_id !== ctx.profileId
      || operation.work_quote_id !== input.quoteId || operation.id !== input.requestId
      || operation.reserved_units !== input.acceptedMaxUnits || operation.rate_version !== input.acceptedRateVersion
      || (operation.work_mode !== 'analytics' && operation.work_mode !== 'plan')) {
      throw new Error('Rezervaci nelze ověřit. Požadavek znovu neposílejte.')
    }
    return await executeReservedAi(ctx, operation)
  } catch (error) { throw new WorkStartUncertainError(error) }
}
