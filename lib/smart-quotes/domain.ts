export type QuoteItem = {
  id: string
  name: string
  description: string
  quantity: number
  unit: string
  unitPrice: number
  vatRate: number
  costPrice: number
}
export type QuoteVariant = { id: string; name: string; discountPercent: number; items: QuoteItem[] }
export type QuoteDraft = {
  title: string
  customerName: string
  customerEmail: string
  validUntil: string
  deliveryTerms: string
  terms: string
  variants: QuoteVariant[]
}
export type PublicItem = Omit<QuoteItem, 'costPrice'> & { net: number; vat: number; total: number }
export type PublicVariant = Omit<QuoteVariant, 'items'> & {
  items: PublicItem[]; net: number; vat: number; total: number
}
export type PublicSnapshot = Omit<QuoteDraft, 'variants'> & {
  currency: 'CZK'; supplierName: string; variants: PublicVariant[]
}

export const MIN_MARGIN_PERCENT = 20
export const money = (amount: number) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(amount)
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function text(value: unknown, name: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`${name}: zkontrolujte vyplněný text.`)
  return value.trim()
}
function number(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name}: zadejte hodnotu od ${min} do ${max}.`)
  return value
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Neplatná podoba nabídky.')
  return value as Record<string, unknown>
}

/** Canonical allowlist. SQL repeats validation because callers can bypass Server Actions. */
export function validateDraft(value: unknown): QuoteDraft {
  const d = object(value)
  const validUntil = text(d.validUntil, 'Platnost', 10, true)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || new Date(validUntil).toISOString().slice(0, 10) !== validUntil) throw new Error('Zadejte platné datum.')
  if (!Array.isArray(d.variants) || !d.variants.length || d.variants.length > 10) throw new Error('Nabídka musí mít 1 až 10 variant.')
  const ids = new Set<string>()
  const variants = d.variants.map(value => {
    const v = object(value)
    const id = text(v.id, 'ID varianty', 64, true)
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('Varianty musí mít jedinečné identifikátory.')
    ids.add(id)
    if (!Array.isArray(v.items) || !v.items.length || v.items.length > 200) throw new Error('Každá varianta musí mít 1 až 200 položek.')
    const itemIds = new Set<string>()
    return {
      id, name: text(v.name, 'Název varianty', 160, true), discountPercent: number(v.discountPercent, 'Sleva', 0, 100),
      items: v.items.map(value => {
        const i = object(value)
        const itemId = text(i.id, 'ID položky', 64, true)
        if (!/^[a-zA-Z0-9_-]+$/.test(itemId) || itemIds.has(itemId)) throw new Error('Položky musí mít jedinečné identifikátory.')
        itemIds.add(itemId)
        return {
          id: itemId, name: text(i.name, 'Položka', 200, true), description: text(i.description, 'Popis', 2000),
          unit: text(i.unit, 'Jednotka', 20, true), quantity: number(i.quantity, 'Množství', 0.001, 1000000),
          unitPrice: number(i.unitPrice, 'Cena', 0, 100000000), vatRate: number(i.vatRate, 'DPH', 0, 100),
          costPrice: number(i.costPrice, 'Náklad', 0, 100000000),
        }
      }),
    }
  })
  if (variants.some(v => variantTotals(v).total > 999999999)) throw new Error('Celková cena varianty je příliš vysoká.')
  const customerEmail = text(d.customerEmail, 'E-mail', 254)
  if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new Error('Zadejte platný e-mail zákazníka.')
  return { title: text(d.title, 'Název', 200, true), customerName: text(d.customerName, 'Zákazník', 200, true), customerEmail,
    validUntil, deliveryTerms: text(d.deliveryTerms, 'Termín a místo', 4000), terms: text(d.terms, 'Podmínky', 10000), variants }
}

export function variantTotals(variant: QuoteVariant) {
  const lines = variant.items.map(i => {
    const net = roundMoney(i.quantity * i.unitPrice * (1 - variant.discountPercent / 100))
    const vat = roundMoney(net * i.vatRate / 100)
    return { net, vat, total: roundMoney(net + vat), cost: roundMoney(i.quantity * i.costPrice) }
  })
  const net = roundMoney(lines.reduce((s, i) => s + i.net, 0))
  const vat = roundMoney(lines.reduce((s, i) => s + i.vat, 0))
  const cost = roundMoney(lines.reduce((s, i) => s + i.cost, 0))
  return { net, vat, total: roundMoney(net + vat), cost, margin: net === 0 ? (cost > 0 ? -100 : 0) : roundMoney((net - cost) / net * 100) }
}

/** Never spread an internal record into the public document. */
export function customerSnapshot(draft: QuoteDraft, supplierName: string): PublicSnapshot {
  return {
    title: draft.title, customerName: draft.customerName, customerEmail: draft.customerEmail,
    validUntil: draft.validUntil, deliveryTerms: draft.deliveryTerms, terms: draft.terms, supplierName, currency: 'CZK',
    variants: draft.variants.map(v => {
      const totals = variantTotals(v)
      return { id: v.id, name: v.name, discountPercent: v.discountPercent, net: totals.net, vat: totals.vat, total: totals.total,
        items: v.items.map(i => {
          const net = roundMoney(i.quantity * i.unitPrice * (1 - v.discountPercent / 100))
          const vat = roundMoney(net * i.vatRate / 100)
          return { id: i.id, name: i.name, description: i.description, quantity: i.quantity, unit: i.unit,
            unitPrice: i.unitPrice, vatRate: i.vatRate, net, vat, total: roundMoney(net + vat) }
        }) }
    }),
  }
}

export function acceptanceBlockReason(input: { current: boolean; expired: boolean; active: boolean; status: string }): string | null {
  if (input.status === 'accepted') return 'Tato nabídka již byla přijata.'
  if (input.status === 'rejected') return 'Tato nabídka byla odmítnuta.'
  if (!input.current) return 'Tuto verzi nahradila novější nabídka. Vyžádejte si aktuální odkaz.'
  if (input.expired) return 'Platnost nabídky skončila. Kontaktujte dodavatele.'
  if (!input.active) return 'Online přijetí nyní není dostupné. Kontaktujte dodavatele.'
  return null
}
