/** Capability contract. A registered code alone does not mean its domain enforcement is complete. */
export const CAPABILITY_POLICY_VERSION = 'diriqo-capabilities-v0.1' as const
export const PRODUCT_CODES = Object.freeze([
  'diriqo_core', 'inventory', 'invoicing', 'smart_quotes', 'fleet', 'ai_assistant', 'pos',
] as const)
export type ProductCode = (typeof PRODUCT_CODES)[number]
export type CapabilityPurpose = 'new_operation' | 'history_read' | 'history_export' | 'settle_prior_event'

function capability(
  product: ProductCode,
  purpose: CapabilityPurpose,
  scope: 'company' | 'register' = 'company',
  requiresBudget = false,
  settles?: string,
) {
  return Object.freeze({ product, purpose, scope, requiresBudget, settles })
}

// A known code describes a proposed boundary; it does not advertise a delivered feature.
export const CAPABILITIES = Object.freeze({
  'core.jobs.create': capability('diriqo_core', 'new_operation'),
  'core.jobs.update': capability('diriqo_core', 'new_operation'),
  'core.jobs.close': capability('diriqo_core', 'new_operation'),
  'core.customers.manage': capability('diriqo_core', 'new_operation'),
  'core.workers.manage': capability('diriqo_core', 'new_operation'),
  'core.rates.manage': capability('diriqo_core', 'new_operation'),
  'core.time.record': capability('diriqo_core', 'new_operation'),
  'core.time.approve': capability('diriqo_core', 'new_operation'),
  'core.quotes.create': capability('diriqo_core', 'new_operation'),
  'core.calendar.manage': capability('diriqo_core', 'new_operation'),
  'core.absences.request': capability('diriqo_core', 'new_operation'),
  'core.absences.approve': capability('diriqo_core', 'new_operation'),
  'core.advances.request': capability('diriqo_core', 'new_operation'),
  'core.advances.pay': capability('diriqo_core', 'new_operation'),
  'core.files.upload': capability('diriqo_core', 'new_operation'),
  'core.handover.confirm': capability('diriqo_core', 'new_operation'),
  'core.costs.record': capability('diriqo_core', 'new_operation'),
  'core.economics.read': capability('diriqo_core', 'history_read'),
  'core.history.read': capability('diriqo_core', 'history_read'),
  'core.history.export': capability('diriqo_core', 'history_export'),
  'inventory.receipt.post': capability('inventory', 'new_operation'),
  'inventory.movement.post': capability('inventory', 'new_operation'),
  'inventory.ocr.request': capability('inventory', 'new_operation', 'company', true),
  'inventory.history.read': capability('inventory', 'history_read'),
  'inventory.history.export': capability('inventory', 'history_export'),
  'invoicing.invoice.issue': capability('invoicing', 'new_operation'),
  'invoicing.ocr.request': capability('invoicing', 'new_operation', 'company', true),
  'invoicing.payment.settle': capability('invoicing', 'settle_prior_event', 'company', false, 'invoicing.invoice.issue'),
  'invoicing.history.read': capability('invoicing', 'history_read'),
  'invoicing.history.export': capability('invoicing', 'history_export'),
  'smart_quotes.template.manage': capability('smart_quotes', 'new_operation'),
  'smart_quotes.ocr.request': capability('smart_quotes', 'new_operation', 'company', true),
  'smart_quotes.history.read': capability('smart_quotes', 'history_read'),
  'smart_quotes.history.export': capability('smart_quotes', 'history_export'),
  'fleet.vehicle.manage': capability('fleet', 'new_operation'),
  'fleet.trip.record': capability('fleet', 'new_operation'),
  'fleet.history.read': capability('fleet', 'history_read'),
  'fleet.history.export': capability('fleet', 'history_export'),
  'ai_assistant.conversation.run': capability('ai_assistant', 'new_operation', 'company', true),
  'ai_assistant.history.read': capability('ai_assistant', 'history_read'),
  'ai_assistant.history.export': capability('ai_assistant', 'history_export'),
  'pos.sale.create': capability('pos', 'new_operation', 'register'),
  'pos.sale.settle': capability('pos', 'settle_prior_event', 'register', false, 'pos.sale.create'),
  'pos.catalog.manage': capability('pos', 'new_operation', 'register'),
  'pos.shift.close': capability('pos', 'new_operation', 'register'),
  'pos.shift.manage': capability('pos', 'new_operation', 'register'),
  'pos.offline_cash.sell': capability('pos', 'new_operation', 'register'),
  'pos.open_account.manage': capability('pos', 'new_operation', 'register'),
  'pos.kitchen.send': capability('pos', 'new_operation', 'register'),
  'pos.history.read': capability('pos', 'history_read', 'register'),
  'pos.history.export': capability('pos', 'history_export', 'register'),
})
export type CapabilityCode = keyof typeof CAPABILITIES

export function isProductCode(value: unknown): value is ProductCode {
  return typeof value === 'string' && (PRODUCT_CODES as readonly string[]).includes(value)
}

export function isCapabilityCode(value: unknown): value is CapabilityCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CAPABILITIES, value)
}

export function getCapability(value: unknown) {
  return isCapabilityCode(value) ? CAPABILITIES[value] : null
}

export type Entitlement = Readonly<{
  id: string
  companyId: string
  product: ProductCode
  registerId: string | null
  policyVersion: typeof CAPABILITY_POLICY_VERSION
  origin: 'paid' | 'trial' | 'manual_grant' | 'legacy_compatibility'
  sourceRef: string
  state: 'draft' | 'active' | 'grace' | 'readonly' | 'canceled'
  revoked: boolean
  // UTC epoch milliseconds, half-open intervals [from, until).
  validFrom: number
  validUntil: number
  historyUntil: number
  graceUntil: number | null
  capabilities: readonly CapabilityCode[]
  graceCapabilities: readonly CapabilityCode[]
  cancelAtPeriodEnd: boolean
}>

export type EntitlementSnapshot =
  | Readonly<{ status: 'ready'; grants: readonly Entitlement[] }>
  | Readonly<{ status: 'unavailable' }>

/** Must come from a persisted event verified by the domain server, never a request body. */
export type PriorEventReference = Readonly<{
  eventId: string
  entitlementId: string
  companyId: string
  registerId: string | null
  capability: CapabilityCode
  occurredAt: number
}>

export type EntitlementRequest = Readonly<{
  capability: unknown
  companyId: string
  registerId: string | null
  now: number
  snapshot: EntitlementSnapshot
  priorEvent?: PriorEventReference
}>

export type EntitlementDecision = Readonly<{
  entitled: boolean
  reason: 'eligible' | 'unknown_capability' | 'invalid_context' | 'entitlements_unavailable' | 'no_eligible_grant'
  entitlementId: string | null
  policyVersion: typeof CAPABILITY_POLICY_VERSION
}>

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/**
 * Evaluates ONLY the license dimension from a trusted server snapshot. This is NOT
 * an authorization guard. Identity/membership, action and object permissions,
 * country support, operational suspension, credit reservation, event authenticity,
 * refund limits/idempotence and direct DB enforcement must be checked separately.
 * No price, role, UI toggle or client-provided grant is an authority here.
 */
export function evaluateCapabilityEntitlement(request: EntitlementRequest): EntitlementDecision {
  const result = (reason: EntitlementDecision['reason'], id: string | null = null): EntitlementDecision => ({
    entitled: reason === 'eligible', reason, entitlementId: id, policyVersion: CAPABILITY_POLICY_VERSION,
  })
  if (!isCapabilityCode(request.capability)) return result('unknown_capability')
  const code = request.capability
  const definition = CAPABILITIES[code]
  if (!nonempty(request.companyId) || !timestamp(request.now)
    || (definition.scope === 'register' && !nonempty(request.registerId))
    || (definition.scope === 'company' && request.registerId !== null)) return result('invalid_context')
  if (request.snapshot?.status !== 'ready' || !Array.isArray(request.snapshot.grants)) {
    return result('entitlements_unavailable')
  }

  const eligible = request.snapshot.grants.filter((grant) => {
    if (!grant || !nonempty(grant.id) || !nonempty(grant.sourceRef)
      || grant.policyVersion !== CAPABILITY_POLICY_VERSION || grant.revoked !== false
      || !['paid', 'trial', 'manual_grant', 'legacy_compatibility'].includes(grant.origin)
      || !['active', 'grace', 'readonly', 'canceled'].includes(grant.state)
      || grant.companyId !== request.companyId || grant.product !== definition.product
      || grant.registerId !== request.registerId
      || !Array.isArray(grant.capabilities) || !grant.capabilities.includes(code)
      || !Array.isArray(grant.graceCapabilities)
      || !timestamp(grant.validFrom) || !timestamp(grant.validUntil)
      || !timestamp(grant.historyUntil) || grant.validUntil <= grant.validFrom
      || grant.historyUntil < grant.validUntil || request.now < grant.validFrom
      || (grant.graceUntil !== null && (!timestamp(grant.graceUntil) || grant.graceUntil < grant.validUntil))) return false

    if (definition.purpose === 'settle_prior_event') {
      const event = request.priorEvent
      return !!event && nonempty(event.eventId) && event.entitlementId === grant.id
        && event.companyId === request.companyId && event.registerId === request.registerId
        && event.capability === definition.settles && grant.capabilities.includes(event.capability)
        && timestamp(event.occurredAt) && event.occurredAt >= grant.validFrom && event.occurredAt <= request.now
        && (event.occurredAt < grant.validUntil || (grant.graceUntil !== null
          && event.occurredAt < grant.graceUntil && grant.graceCapabilities.includes(event.capability)))
    }
    if (definition.purpose === 'history_read' || definition.purpose === 'history_export') {
      return request.now < grant.historyUntil
    }
    if (grant.state === 'active') return request.now < grant.validUntil
    return grant.state === 'grace' && request.now >= grant.validUntil
      && grant.graceUntil !== null && request.now < grant.graceUntil
      && grant.graceCapabilities.includes(code)
  })
  // Stable selection keeps audit output independent of query row order.
  eligible.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  return eligible.length ? result('eligible', eligible[0].id) : result('no_eligible_grant')
}
