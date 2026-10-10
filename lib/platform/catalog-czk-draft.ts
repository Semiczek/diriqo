import type { CapabilityCode, ProductCode } from './capabilities'

export const DRAFT_CATALOG_VERSION = 'diriqo-czk-2026-10-10-v0.1' as const

/** Half-up to one haler, once per annual unit price. No floating monthly discount. */
export function annualPriceMinor(monthlyMinor: number): number {
  if (!Number.isSafeInteger(monthlyMinor) || monthlyMinor < 0
    || !Number.isSafeInteger(monthlyMinor * 108 + 5)) throw new RangeError('Invalid monthly amount')
  return Math.floor((monthlyMinor * 108 + 5) / 10)
}

function freeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freeze(child)
  }
  return Object.freeze(value)
}

// These combinations govern a future purchase proposal, not current authorization.
export const DRAFT_PRODUCT_RULES = freeze({
  diriqo_core: { technical: ['platform'], commercialRequiresAny: [] },
  inventory: { technical: ['platform', 'shared_items'], commercialRequiresAny: ['diriqo_core', 'pos'] },
  invoicing: { technical: ['platform', 'country_profile'], commercialRequiresAny: ['diriqo_core', 'pos'] },
  smart_quotes: { technical: ['platform', 'core_quotes'], commercialRequiresAny: ['diriqo_core'] },
  fleet: { technical: ['platform'], commercialRequiresAny: ['diriqo_core'] },
  ai_assistant: { technical: ['platform', 'authorized_data', 'usage_budget'], commercialRequiresAny: ['diriqo_core', 'pos'] },
  pos: { technical: ['platform', 'country_profile'], commercialRequiresAny: [] },
} as const satisfies Record<ProductCode, {
  technical: readonly string[]; commercialRequiresAny: readonly ProductCode[]
}>)

export function validateDraftProductCombination(products: readonly unknown[]): Readonly<{
  valid: boolean; reason: 'valid' | 'unknown_product' | 'duplicate_product' | 'missing_base_product' | 'empty_selection'
}> {
  if (!products.length) return { valid: false, reason: 'empty_selection' }
  if (products.some((product) => typeof product !== 'string'
    || !Object.prototype.hasOwnProperty.call(DRAFT_PRODUCT_RULES, product))) return { valid: false, reason: 'unknown_product' }
  if (new Set(products).size !== products.length) return { valid: false, reason: 'duplicate_product' }
  for (const product of products as readonly ProductCode[]) {
    const required: readonly ProductCode[] = DRAFT_PRODUCT_RULES[product].commercialRequiresAny
    if (required.length && !required.some((base) => products.includes(base))) return { valid: false, reason: 'missing_base_product' }
  }
  return { valid: true, reason: 'valid' }
}

export const DRAFT_CORE_CAPABILITIES = Object.freeze([
  'core.jobs.create', 'core.jobs.update', 'core.jobs.close', 'core.customers.manage',
  'core.workers.manage', 'core.rates.manage', 'core.time.record', 'core.time.approve',
  'core.quotes.create', 'core.calendar.manage', 'core.absences.request', 'core.absences.approve',
  'core.advances.request', 'core.advances.pay', 'core.files.upload', 'core.handover.confirm',
  'core.costs.record', 'core.economics.read', 'core.history.read', 'core.history.export',
] as const satisfies readonly CapabilityCode[])

const mini = [
  'pos.sale.create', 'pos.sale.settle', 'pos.catalog.manage', 'pos.shift.close', 'pos.history.read', 'pos.history.export',
] as const satisfies readonly CapabilityCode[]
const classic = [...mini, 'pos.shift.manage', 'pos.offline_cash.sell'] as const satisfies readonly CapabilityCode[]
const gastro = [...classic, 'pos.open_account.manage', 'pos.kitchen.send'] as const satisfies readonly CapabilityCode[]

export type DraftOffer = Readonly<{
  product: ProductCode
  unit: 'company' | 'register' | 'full_user' | 'worker_pack_10' | 'vehicle'
  monthlyMinor: number
  yearlyMinor: number
  proposedCapabilities: readonly CapabilityCode[]
  included: Readonly<{
    fullUsers?: number; additionalWorkers?: number; warehouses?: number; vehicles?: number
    monthlyAiCreditMinor?: number; salesDevices?: number
  }>
}>

const recurring = (
  product: ProductCode, unit: DraftOffer['unit'], monthlyMinor: number,
  proposedCapabilities: readonly CapabilityCode[], included: DraftOffer['included'] = {},
): DraftOffer => ({ product, unit, monthlyMinor, yearlyMinor: annualPriceMinor(monthlyMinor), proposedCapabilities, included })

export const DRAFT_OFFERS = freeze({
  solo: recurring('diriqo_core', 'company', 29900, DRAFT_CORE_CAPABILITIES, { fullUsers: 1, additionalWorkers: 0 }),
  team: recurring('diriqo_core', 'company', 69900, DRAFT_CORE_CAPABILITIES, { fullUsers: 3, additionalWorkers: 10 }),
  company: recurring('diriqo_core', 'company', 129900, DRAFT_CORE_CAPABILITIES, { fullUsers: 5, additionalWorkers: 30 }),
  full_user: recurring('diriqo_core', 'full_user', 14900, [], { fullUsers: 1 }),
  worker_pack_10: recurring('diriqo_core', 'worker_pack_10', 19900, [], { additionalWorkers: 10 }),
  inventory: recurring('inventory', 'company', 29900, [
    'inventory.receipt.post', 'inventory.movement.post', 'inventory.ocr.request', 'inventory.history.read', 'inventory.history.export',
  ], { warehouses: 3 }),
  invoicing: recurring('invoicing', 'company', 19900, [
    'invoicing.invoice.issue', 'invoicing.ocr.request', 'invoicing.payment.settle', 'invoicing.history.read', 'invoicing.history.export',
  ]),
  smart_quotes: recurring('smart_quotes', 'company', 29900, [
    'smart_quotes.template.manage', 'smart_quotes.ocr.request', 'smart_quotes.history.read', 'smart_quotes.history.export',
  ]),
  fleet: recurring('fleet', 'company', 19900, [
    'fleet.vehicle.manage', 'fleet.trip.record', 'fleet.history.read', 'fleet.history.export',
  ], { vehicles: 5 }),
  extra_vehicle: recurring('fleet', 'vehicle', 2900, [], { vehicles: 1 }),
  ai_assistant: recurring('ai_assistant', 'company', 19900, [
    'ai_assistant.conversation.run', 'ai_assistant.history.read', 'ai_assistant.history.export',
  ], { monthlyAiCreditMinor: 10000 }),
  pos_mini: { ...recurring('pos', 'register', 10000, mini, { salesDevices: 1 }), yearlyMinor: 100000 },
  pos_classic: recurring('pos', 'register', 39900, classic, { salesDevices: 1 }),
  pos_gastro: recurring('pos', 'register', 69900, gastro, { salesDevices: 1 }),
} as const satisfies Record<string, DraftOffer>)

export type DraftOfferCode = keyof typeof DRAFT_OFFERS
export const DRAFT_CATALOG = freeze({
  version: DRAFT_CATALOG_VERSION,
  status: 'draft',
  currency: 'CZK',
  minorUnits: 2,
  taxBasis: 'exclusive',
  effectiveAt: null,
  purchasable: false,
  offers: DRAFT_OFFERS,
  trialDays: 30,
  graceDays: 7,
  historyDays: 90,
  automaticPurge: false,
  posOfflineMaxHours: 24,
  creditTopupsMinor: [10000, 30000, 100000],
  includedCreditCadence: 'paid_month_even_on_annual_plan',
  includedCreditExpires: 'end_of_grant_month',
  purchasedCreditExpires: false,
  publicHelpTrialMessages: 30,
} as const)

export function getDraftOffer(code: unknown): DraftOffer | null {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(DRAFT_OFFERS, code)
    ? DRAFT_OFFERS[code as DraftOfferCode] : null
}

/** One unit only; no proration, purchase, entitlement grant or AI-credit disbursement. */
export function previewDraftPrice(code: unknown, interval: 'monthly' | 'yearly') {
  const offer = getDraftOffer(code)
  if (!offer || (interval !== 'monthly' && interval !== 'yearly')) return null
  return {
    catalogVersion: DRAFT_CATALOG_VERSION, currency: DRAFT_CATALOG.currency,
    amountMinor: interval === 'monthly' ? offer.monthlyMinor : offer.yearlyMinor,
    interval, unit: offer.unit, taxBasis: DRAFT_CATALOG.taxBasis, purchasable: false as const,
  }
}
