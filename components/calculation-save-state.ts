import {
  parseCoreCalculationSave,
  parseCoreCalculationSaveReceipt,
  type CoreCalculationSaveInput,
  type CoreCalculationSaveReceipt,
} from '@/lib/core-calculation-save'

export type CalculationSaveScope = {
  companyId: string
  profileId: string
  customerId: string | null
  calculationId?: string
}
export type PendingCalculationSave = { version: 1; scope: CalculationSaveScope; payload: CoreCalculationSaveInput; receipt?: CoreCalculationSaveReceipt }
export const CALCULATION_PENDING_ERROR = 'Uložený požadavek nelze bezpečně načíst. Neodesíláme novou kalkulaci. Obnovte původní přihlášení nebo požádejte o kontrolu uložené operace.'
export const CALCULATION_STORAGE_ERROR = 'Prohlížeč nemůže bezpečně uchovat požadavek. Ukládání je pozastavené; povolte úložiště pro tuto stránku a obnovte ji.'

export function calculationSaveStorageKey(scope: CalculationSaveScope) {
  return ['diriqo-calculation-save-v1', scope.companyId, scope.profileId,
    scope.calculationId ? 'calculation:' + scope.calculationId : scope.customerId ? 'customer:' + scope.customerId : 'standalone'].join(':')
}

export function readPendingCalculationSave(raw: string | null, scope: CalculationSaveScope): PendingCalculationSave | null {
  if (raw === null) return null
  try {
    const stored = JSON.parse(raw) as PendingCalculationSave
    if (!stored || stored.version !== 1 || !stored.scope || !stored.payload
      || calculationSaveStorageKey(stored.scope) !== calculationSaveStorageKey(scope)
      || stored.scope.customerId !== scope.customerId) throw new Error('scope')
    const payload = parseCoreCalculationSave(stored.payload, scope.calculationId ? 'update' : 'create')
    if (payload.companyId !== scope.companyId || payload.profileId !== scope.profileId
      || payload.customerId !== scope.customerId
      || (scope.calculationId && (!('calculationId' in payload) || payload.calculationId !== scope.calculationId))) throw new Error('scope')
    return { version: 1, scope: { ...scope }, payload, ...(stored.receipt === undefined ? {} : { receipt: parseCoreCalculationSaveReceipt(stored.receipt, payload, scope.calculationId ? 'update' : 'create') }) }
  } catch {
    throw new Error(CALCULATION_PENDING_ERROR)
  }
}

export function calculationReceiptMatches(value: unknown, payload: CoreCalculationSaveInput): value is CoreCalculationSaveReceipt {
  try {
    parseCoreCalculationSaveReceipt(value, payload, 'calculationId' in payload ? 'update' : 'create')
    return true
  } catch { return false }
}

export type CalculationDraftItem = {
  id: string; itemType: string; name: string; description: string; quantity: string; unit: string
  unitCost: string; unitPrice: string; vatRate: string; note: string
  persisted?: boolean
}

export function emptyCalculationItem(itemType: 'customer' | 'material', id: string): CalculationDraftItem {
  return { id, itemType, name: '', description: '', quantity: '1', unit: '', unitCost: itemType === 'customer' ? '0' : '',
    unitPrice: itemType === 'customer' ? '' : '0', vatRate: '21', note: '' }
}

// Only a pristine, unused new row may be omitted. Explicit zero and partially filled rows are retained for validation.
export function calculationPayloadItems(items: CalculationDraftItem[]) {
  return items.filter(item => item.persisted || !(
    !item.name.trim() && !item.description.trim() && !item.unit.trim() && !item.note.trim()
    && item.quantity === '1' && item.vatRate === '21'
    && ((item.itemType === 'customer' && item.unitPrice === '' && item.unitCost === '0')
      || (item.itemType === 'material' && item.unitCost === '' && item.unitPrice === '0'))
  )).map(item => ({ itemType: item.itemType, name: item.name, description: item.description, quantity: item.quantity, unit: item.unit, unitCost: item.unitCost, unitPrice: item.unitPrice, vatRate: item.vatRate, note: item.note }))
}

export function formatCalculationMoney(value: string | undefined) {
  if (value === undefined) return '—'
  const [whole, fraction = '00'] = value.split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + ',' + fraction.padEnd(2, '0') + '\u00a0Kč'
}
