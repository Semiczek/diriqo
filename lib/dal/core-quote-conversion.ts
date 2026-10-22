import 'server-only'

import type { DalContext } from './auth'
import { CoreQuoteConversionError, coreQuoteId, parseCoreQuoteConversion, type CoreQuoteConversionInput } from '@/lib/core-quote-conversion'

const errors: Record<string, [CoreQuoteConversionError['code'], string]> = {
  QUOTE_CUSTOMER_FORBIDDEN: ['forbidden', 'K převodu nemáte oprávnění v aktivní firmě.'],
  QUOTE_CUSTOMER_MODULE_REQUIRED: ['forbidden', 'Pro přijetí nabídky je potřeba aktivní základ Diriqo a nabídky.'],
  QUOTE_CUSTOMER_SCOPE_INVALID: ['forbidden', 'Zákazník nabídky není v aktivní firmě dostupný.'],
  QUOTE_CUSTOMER_SNAPSHOT_IMMUTABLE: ['conflict', 'Údaje vydané nabídky jsou chráněné. Obnovte její detail.'],
  CORE_QUOTE_VERSION_REQUIRED: ['conflict', 'Nový převod vyžaduje konkrétní přijatou verzi nabídky. Obnovte detail; staré nedokončené potvrzení lze pouze ověřit.'],
  CORE_QUOTE_VERSION_CONFLICT: ['conflict', 'Vybraná verze nabídky není pro tento převod dostupná. Obnovte její detail.'],
  CORE_QUOTE_ACCEPTANCE_REQUIRED: ['conflict', 'Nejprve zaznamenejte doložené přijetí vybrané verze nabídky.'],
  CORE_QUOTE_FORBIDDEN: ['forbidden', 'K převodu nemáte oprávnění v aktivní firmě. Ověřte přihlášení a vybranou firmu.'],
  CORE_QUOTE_MODULE_REQUIRED: ['forbidden', 'Pro vytvoření zakázky je potřeba aktivní základ Diriqo.'],
  CORE_QUOTE_INPUT_INVALID: ['validation', 'Zkontrolujte název, termín a vybrané dny realizace.'],
  CORE_QUOTE_NOT_FOUND: ['forbidden', 'Nabídka není v aktivní firmě dostupná.'],
  CORE_QUOTE_SCOPE_INVALID: ['forbidden', 'Nabídka nebo zákazník není v aktivní firmě dostupný.'],
  CORE_QUOTE_STATUS_INVALID: ['conflict', 'Stav nabídky se změnil a zakázku z ní nelze vytvořit. Obnovte nabídku.'],
  CORE_QUOTE_REQUEST_CONFLICT: ['conflict', 'Toto potvrzení už bylo použité pro jiné údaje. Zachovejte původní požadavek a ověřte stav nabídky.'],
  CORE_QUOTE_ALREADY_CONVERTED: ['conflict', 'Z nabídky už vznikla zakázka s jinými údaji. Otevřete existující zakázku v přehledu.'],
  CORE_QUOTE_LEGACY_CONVERSION: ['unavailable', 'U nabídky existuje starší zakázka bez ověřeného dokončení převodu. Před dalším převodem je potřeba zkontrolovat její podzakázky.'],
  CORE_QUOTE_RESULT_MISSING: ['unavailable', 'Převod je evidovaný, ale jeho zakázka už není dostupná. Nová zakázka se automaticky nevytvoří.'],
  CORE_QUOTE_CURRENCY_UNSUPPORTED: ['validation', 'Měna nabídky není podporovaná pro převod na zakázku.'],
}

export function coreQuoteConversionError(error: unknown): CoreQuoteConversionError {
  if (error instanceof CoreQuoteConversionError) return error
  const token = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
  const known = Object.prototype.hasOwnProperty.call(errors, token) ? errors[token] : undefined
  if (known) return new CoreQuoteConversionError(known[1], known[0])
  return new CoreQuoteConversionError('Výsledek převodu se nepodařilo potvrdit. Opakujte stejné potvrzení; původní údaje zůstávají zachované.', 'unknown')
}

export async function convertCoreQuoteToJobAtomic(
  ctx: Pick<DalContext, 'companyId' | 'supabase'>,
  input: CoreQuoteConversionInput,
): Promise<{ jobId: string; created: boolean }> {
  const parsed = parseCoreQuoteConversion(input)
  if (parsed.companyId !== coreQuoteId(ctx.companyId)) throw coreQuoteConversionError({ message: 'CORE_QUOTE_FORBIDDEN' })
  const auth = await ctx.supabase.auth.getUser()
  if (auth.error || !auth.data.user) throw coreQuoteConversionError({ message: 'CORE_QUOTE_FORBIDDEN' })
  try {
    const { data, error } = await ctx.supabase.rpc('convert_core_quote_to_job_atomic', {
      p_company_id: parsed.companyId, p_quote_id: parsed.quoteId, p_operation_id: parsed.operationId,
      ...(parsed.versionId ? { p_version_id: parsed.versionId } : {}),
      p_input: {
        title: parsed.title, description: parsed.description, address: parsed.address,
        start_at: parsed.startAt, end_at: parsed.endAt,
        split_days: parsed.splitDays.map(day => ({ label: day.label, start_at: day.startAt, end_at: day.endAt })),
      },
    })
    if (error) throw coreQuoteConversionError(error)
    // Even malformed successful responses may follow COMMIT; retain the original retry identity.
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || data.companyId !== parsed.companyId || data.quoteId !== parsed.quoteId || typeof data.created !== 'boolean'
      || typeof data.jobId !== 'string'
      || (parsed.versionId ? data.versionId !== parsed.versionId : data.created !== false)) throw coreQuoteConversionError(null)
    let jobId: string
    try { jobId = coreQuoteId(data.jobId) } catch { throw coreQuoteConversionError(null) }
    return { jobId, created: data.created }
  } catch (error) { throw coreQuoteConversionError(error) }
}
