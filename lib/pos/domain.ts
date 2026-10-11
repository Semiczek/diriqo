export type PaymentMethod = 'cash' | 'external'
export const POS_COMMANDS = ['register_save', 'operator_save', 'catalog_save', 'shift_open', 'cash_move', 'sale', 'return', 'shift_close'] as const
export type PosCommand = (typeof POS_COMMANDS)[number]
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function decimalUnits(value: string, digits: number, maximum: number): number {
  const normalized = value.trim().replace(',', '.')
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(normalized)) throw new Error('Zadejte nezáporné číslo ve správném formátu.')
  const [whole, fraction = ''] = normalized.split('.')
  const result = Number(BigInt(whole) * BigInt(10 ** digits) + BigInt(fraction.padEnd(digits, '0')))
  if (!Number.isSafeInteger(result) || result > maximum) throw new Error('Částka nebo množství je příliš vysoké.')
  return result
}

export const moneyInput = (value: string) => decimalUnits(value, 2, 100_000_000_000)
export const quantityInput = (value: string) => decimalUnits(value, 3, 1_000_000_000)
export const money = (minor: number) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(minor / 100)
export const quantity = (mills: number) => mills / 1000

export function roundRatio(numerator: bigint, denominator: bigint): number {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) throw new Error('Neplatný poměr.')
  const rounded = (numerator * BigInt(2) + denominator) / (denominator * BigInt(2))
  const result = Number(rounded)
  if (!Number.isSafeInteger(result)) throw new Error('Částka překračuje bezpečný rozsah.')
  return result
}

export function lineTotal(priceMinor: number, quantityMills: number): number {
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0 || !Number.isSafeInteger(quantityMills) || quantityMills <= 0) throw new Error('Neplatná položka.')
  return roundRatio(BigInt(priceMinor) * BigInt(quantityMills), BigInt(1000))
}

export function payableTotal(total: number, method: PaymentMethod): number {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Neplatná částka.')
  return method === 'cash' ? roundRatio(BigInt(total), BigInt(100)) * 100 : total
}

// Cumulative allocation ensures splitting a return never refunds more than the original.
export function refundPart(originalMinor: number, originalMills: number, returnedMills: number, nextMills: number): number {
  if (![originalMinor, originalMills, returnedMills, nextMills].every(Number.isSafeInteger)
    || originalMinor < 0 || originalMills <= 0 || returnedMills < 0 || nextMills <= 0 || returnedMills + nextMills > originalMills) throw new Error('Vratka překračuje původní prodej.')
  return roundRatio(BigInt(originalMinor) * BigInt(returnedMills + nextMills), BigInt(originalMills))
    - roundRatio(BigInt(originalMinor) * BigInt(returnedMills), BigInt(originalMills))
}

export function cashRefund(originalGross: number, originalPaid: number, cumulativeGross: number, previouslyPaid: number): number {
  if (originalGross <= 0 || cumulativeGross < 0 || cumulativeGross > originalGross || previouslyPaid < 0 || previouslyPaid > originalPaid) throw new Error('Neplatná vratka.')
  return roundRatio(BigInt(cumulativeGross) * BigInt(originalPaid), BigInt(originalGross) * BigInt(100)) * 100 - previouslyPaid
}

export function validateEnvelope(value: unknown): { companyId: string; registerId: string; eventId: string; command: PosCommand; payload: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Neplatný požadavek.')
  const v = value as Record<string, unknown>
  for (const key of ['companyId', 'registerId', 'eventId']) if (typeof v[key] !== 'string' || !UUID.test(v[key] as string)) throw new Error('Neplatný identifikátor.')
  if (!POS_COMMANDS.includes(v.command as PosCommand) || !v.payload || typeof v.payload !== 'object' || Array.isArray(v.payload)) throw new Error('Neplatná operace.')
  return v as ReturnType<typeof validateEnvelope>
}

export function csvCell(value: unknown): string {
  let text = String(value ?? '')
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export const posError = (code: string) => ({
  POS_FORBIDDEN: 'K této operaci nemáte oprávnění pokladní.',
  MODULE_ACCESS_REQUIRED: 'Pro tuto operaci chybí platná licence pokladny.',
  MODULE_REQUIRED: 'Pro tuto operaci chybí platná licence pokladny.',
  MODULE_FORBIDDEN: 'K této operaci nemáte oprávnění v aktivní firmě.',
  INVENTORY_INSUFFICIENT: 'Na připojeném skladu není dostatek zásob. Prodej nebyl uložen.',
  INVENTORY_RESERVED: 'Požadované množství je rezervované. Prodej nebyl uložen.',
  INVENTORY_NOT_FOUND: 'Položka nebo připojený sklad už nejsou dostupné. Prodej nebyl uložen.',
  INVENTORY_MODULE_REQUIRED: 'Připojený sklad nemá aktivní licenci Inventáře. Prodej nebyl uložen. Správce může licenci obnovit nebo po uzavření směny výslovně odpojit sklad.',
  INVENTORY_RETURN_SOURCE: 'Původní skladový výdej nelze bezpečně vypořádat. Vratka nebyla uložena; kontaktujte správce.',
  POS_REGISTER_REQUIRED: 'Nejprve založte pokladnu z dostupné licence.',
  POS_SHIFT_OPEN: 'Na této pokladně už je otevřená směna. Obnovte stav.',
  POS_SHIFT_REQUIRED: 'Nejprve otevřete směnu.',
  POS_SESSION_CONFLICT: 'Směna je otevřená v jiném prohlížeči. Vraťte se na původní zařízení nebo požádejte správce o uzavření směny.',
  POS_PRICE_CHANGED: 'Cena nebo položka se od vložení do košíku změnila. Obnovte katalog a sestavte košík znovu.',
  POS_EVENT_CONFLICT: 'Tento požadavek už má jiný obsah. Nejprve ověřte původní výsledek v historii.',
  POS_RETURN_EXCEEDED: 'Množství vratky překračuje zbývající množství na původním dokladu.',
  POS_CASH_INSUFFICIENT: 'V pokladně není dostatek evidované hotovosti.',
  POS_TENDER_INSUFFICIENT: 'Přijatá hotovost je nižší než cena prodeje.',
  POS_INVENTORY_CONFIRM: 'Odpojení skladu vyžaduje výslovné potvrzení prodeje bez skladové evidence.',
  POS_ITEM_CONFLICT: 'Položku mezitím změnil jiný uživatel. Obnovte katalog.',
  POS_REGISTER_CONFLICT: 'Nastavení pokladny mezitím změnil jiný správce. Obnovte stav.',
  POS_COUNTRY_UNSUPPORTED: 'Webový prodej je nyní dostupný pouze pro český firemní profil a měnu CZK.',
  POS_INVALID: 'Zkontrolujte zadané hodnoty. Požadavek není platný.',
} as Record<string, string>)[code] ?? 'Operaci se nepodařilo dokončit. Ověřte stav a zkuste ji zopakovat se stejným požadavkem.'
