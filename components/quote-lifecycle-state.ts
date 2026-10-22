export type QuoteOperationScope = { companyId: string; profileId: string; entityId: string; slot: string }
export type QuoteOperationInput = { companyId: string; profileId: string; operationId: string }
export type QuoteOperationReceipt = { companyId: string; operationId: string; quoteId: string; revision: string; replayed: boolean }
export type PendingQuoteOperation<T, R> = { version: 1; scope: QuoteOperationScope; command: T; receipt?: R }
export const QUOTE_UNKNOWN_RESULT = 'Výsledek zatím nelze potvrdit. Požadavek je uložený. Ověřte stejnou operaci; nový zápis nevytváříme.'
export const QUOTE_STORAGE_ERROR = 'Požadavek nelze bezpečně uchovat v prohlížeči. Ukládání je pozastavené. Povolte úložiště a obnovte stránku.'
export const QUOTE_PENDING_ERROR = 'Uložený požadavek nelze bezpečně obnovit. Zůstává zachován; před dalším zápisem ověřte jeho výsledek.'

export function quoteOperationKey(scope: QuoteOperationScope) {
  return ['diriqo-quote-operation-v1', scope.companyId, scope.profileId, scope.entityId, scope.slot].join(':')
}

export function readPendingQuoteOperation<T, R>(raw: string | null, scope: QuoteOperationScope,
  parseCommand: (value: unknown) => T, parseReceipt: (value: unknown, command: T) => R): PendingQuoteOperation<T, R> | null {
  if (raw === null) return null
  try {
    const value = JSON.parse(raw)
    if (!value || value.version !== 1 || !value.scope || quoteOperationKey(value.scope) !== quoteOperationKey(scope)) throw new Error()
    const command = parseCommand(value.command)
    return { version: 1, scope: { ...scope }, command,
      ...(value.receipt === undefined ? {} : { receipt: parseReceipt(value.receipt, command) }) }
  } catch { throw new Error(QUOTE_PENDING_ERROR) }
}

export async function verifyQuoteActiveScope(scope: Pick<QuoteOperationScope, 'companyId' | 'profileId'>) {
  const response = await fetch('/api/active-company', { cache: 'no-store' })
  const current = response.ok ? await response.json() : null
  if (current?.companyId !== scope.companyId || current?.profileId !== scope.profileId) {
    throw new Error('Aktivní firma nebo přihlášení se změnilo. Výsledek je uložený; vraťte se do původní firmy a ověřte jej.')
  }
}

export function quoteDetailHref(quoteId: string, customerId: string | null, versionId?: string | null) {
  const base = customerId ? `/customers/${encodeURIComponent(customerId)}/quotes/${encodeURIComponent(quoteId)}` : `/cenove-nabidky/${encodeURIComponent(quoteId)}`
  return base + (versionId ? '?version=' + encodeURIComponent(versionId) : '')
}
