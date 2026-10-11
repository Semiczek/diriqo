export const inventoryOperations = ['item','warehouse','supplier','order','order_status','document','post','receive_order','reserve','release','revalue'] as const
export type InventoryOperation = typeof inventoryOperations[number]
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function decimalToMinor(value: string, scale = 2): number {
  const normalized = value.trim().replace(',', '.')
  const match = /^(\d{1,9})(?:\.(\d+))?$/.exec(normalized)
  if (!match || (match[2]?.length ?? 0) > scale) throw new Error('Zadejte platné nezáporné číslo s nejvýše '+scale+' desetinnými místy.')
  const minor = BigInt(match[1]) * BigInt(10) ** BigInt(scale) + BigInt((match[2] ?? '').padEnd(scale,'0'))
  if (minor > BigInt(100000000000)) throw new Error('Částka nebo množství je příliš vysoké.')
  return Number(minor)
}
export function quantityValue(value: string): string {
  const scaled = decimalToMinor(value,3)
  return `${Math.floor(scaled/1000)}.${String(scaled%1000).padStart(3,'0')}`
}
export function validateInventoryCommand(operation: string, payload: unknown, requestId: string): asserts payload is Record<string, unknown> {
  if (!(inventoryOperations as readonly string[]).includes(operation) || !uuidPattern.test(requestId)
    || !payload || typeof payload!=='object' || Array.isArray(payload) || JSON.stringify(payload).length>90000) throw new Error('Neplatný požadavek.')
  const p=payload as Record<string, unknown>
  for (const key of ['id','warehouse_id','destination_id','item_id','job_id','supplier_id','customer_id','lot_id']) {
    if (p[key]!==undefined && p[key]!==null && p[key]!=='' && (typeof p[key]!=='string' || !uuidPattern.test(p[key] as string))) throw new Error('Neplatný výběr záznamu.')
  }
  if ('version' in p && (!Number.isSafeInteger(p.version) || (p.version as number)<1)) throw new Error('Obnovte stránku a zkuste to znovu.')
  if ('name' in p && (typeof p.name!=='string' || !p.name.trim() || p.name.length>200)) throw new Error('Vyplňte název, nejvýše 200 znaků.')
  if ('lines' in p) {
    if (!Array.isArray(p.lines) || p.lines.length<1 || p.lines.length>100) throw new Error('Doklad musí mít 1 až 100 položek.')
    const seen=new Set<string>()
    for (const line of p.lines) {
      if (!line || typeof line!=='object') throw new Error('Neplatná položka.')
      const l=line as Record<string, unknown>; const id=l.item_id??l.line_id
      if (typeof id!=='string' || !uuidPattern.test(id) || seen.has(id.toLowerCase())) throw new Error('Každou položku vyberte právě jednou.')
      seen.add(id.toLowerCase())
      quantityValue(String(l.quantity))
      if ('unit_cost_minor' in l && (!Number.isSafeInteger(l.unit_cost_minor) || (l.unit_cost_minor as number)<0)) throw new Error('Neplatná nákupní cena.')
    }
  }
}
export function inventoryError(message: string): string {
  if (message.includes('MODULE_REQUIRED')) return 'Modul není aktivní. Historii si můžete dál prohlížet podle platnosti licence.'
  if (message.includes('FORBIDDEN')) return 'K této operaci nemáte oprávnění.'
  if (message.includes('COUNT_CONFLICT')) return 'Od zahájení inventury se zásoba změnila. Založte novou inventuru s aktuálním stavem.'
  if (message.includes('CONFLICT')) return 'Záznam mezitím někdo změnil. Obnovte stránku před dalším pokusem.'
  if (message.includes('INSUFFICIENT') || message.includes('RESERVED')) return 'Na skladě není dostatek volného množství. Zkontrolujte zásobu a rezervace.'
  if (message.includes('WAREHOUSE_LIMIT')) return 'Testovací konfigurace umožňuje tři aktivní sklady.'
  if (message.includes('STATE')) return 'Tento krok není v aktuálním stavu dokladu možný.'
  if (message.includes('RECEIPT_QUANTITY')) return 'Přijímané množství musí být kladné a nesmí překročit nedodaný zbytek.'
  if (message.includes('duplicate key')) return 'Tento kód nebo název už existuje.'
  return 'Změnu se nepodařilo uložit. Zkontrolujte údaje a zkuste to znovu.'
}
export const money = (minor: number|string) => new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK'}).format(Number(minor)/100)
