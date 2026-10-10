import { CAPABILITY_POLICY_VERSION, type CapabilityCode, type Entitlement, type EntitlementSnapshot } from './capabilities'

export const LEGACY_COMPATIBILITY_VERSION = 'legacy-eur-v1' as const
const DAY_MS = 86_400_000
const PLAN_KEYS = ['starter', 'growth', 'business', 'scale'] as const

// An explicit allowlist of existing functionality. Never derive this from the new catalog.
const MODULE_CAPABILITIES = {
  jobs: ['core.jobs.create', 'core.jobs.update', 'core.jobs.close', 'core.customers.manage'],
  workers: ['core.workers.manage', 'core.rates.manage'],
  shifts: ['core.time.record', 'core.time.approve'],
  quotes: ['core.quotes.create'],
  calendar: ['core.calendar.manage', 'core.absences.request', 'core.absences.approve'],
  finance: ['core.advances.request', 'core.advances.pay', 'core.costs.record', 'core.economics.read'],
  photos: ['core.files.upload'],
} as const satisfies Record<string, readonly CapabilityCode[]>
const REQUIRED_MODULES = [...Object.keys(MODULE_CAPABILITIES), 'invoices']
const INVOICE_CAPABILITIES = [
  'invoicing.invoice.issue', 'invoicing.payment.settle', 'invoicing.history.read', 'invoicing.history.export',
] as const satisfies readonly CapabilityCode[]

export type LegacyCompatibilityReason =
  | 'mapped' | 'missing_subscription' | 'invalid_company' | 'unrecognized_plan'
  | 'unsupported_subscription_state' | 'invalid_period' | 'invalid_module_rows'

export type LegacyCompatibilityResult = Readonly<{
  snapshot: EntitlementSnapshot
  reason: LegacyCompatibilityReason
  compatibilityVersion: typeof LEGACY_COMPATIBILITY_VERSION
}>

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const epoch = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null
  const result = Date.parse(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}

/**
 * Pure migration/shadow-read adapter. Inputs MUST be fetched by the server loader.
 * This is not an authorization guard and must not accept request-body grants.
 * No DB writes, plan normalization, default-enabled modules, prices, or renewal.
 */
export function mapLegacyEntitlements(
  companyId: string,
  subscription: unknown,
  moduleRows: unknown,
  now: number,
): LegacyCompatibilityResult {
  const unavailable = (reason: LegacyCompatibilityReason): LegacyCompatibilityResult => ({
    reason, snapshot: { status: 'unavailable' }, compatibilityVersion: LEGACY_COMPATIBILITY_VERSION,
  })
  if (!identifier(companyId)) return unavailable('invalid_company')
  if (!Number.isSafeInteger(now) || now < 0) return unavailable('invalid_period')
  if (subscription === null) return {
    reason: 'missing_subscription', snapshot: { status: 'ready', grants: [] },
    compatibilityVersion: LEGACY_COMPATIBILITY_VERSION,
  }
  if (!record(subscription) || !identifier(subscription.id) || subscription.company_id !== companyId) {
    return unavailable('invalid_company')
  }
  if (!(PLAN_KEYS as readonly unknown[]).includes(subscription.plan_key)) return unavailable('unrecognized_plan')
  if (!['trialing', 'active', 'past_due', 'canceled', 'expired'].includes(String(subscription.status))) {
    return unavailable('unsupported_subscription_state')
  }
  if (typeof subscription.cancel_at_period_end !== 'boolean') return unavailable('invalid_period')
  const cancelAtPeriodEnd = subscription.cancel_at_period_end || subscription.status === 'canceled'

  // Trial origin remains explicit; an unknown paid period is never replaced with a trial.
  const trial = subscription.status === 'trialing'
  const validFrom = epoch(trial ? subscription.trial_started_at : subscription.current_period_start)
  const validUntil = epoch(trial ? subscription.trial_ends_at : subscription.current_period_end)
  if (validFrom === null || validUntil === null || validUntil <= validFrom) return unavailable('invalid_period')
  const graceUntil = subscription.status === 'past_due' ? validUntil + 3 * DAY_MS : null
  if (graceUntil !== null && !Number.isSafeInteger(graceUntil)) return unavailable('invalid_period')

  if (!Array.isArray(moduleRows)) return unavailable('invalid_module_rows')
  const enabled = new Map<string, boolean>()
  for (const row of moduleRows) {
    if (!record(row) || row.company_id !== companyId || typeof row.module_key !== 'string'
      || typeof row.is_enabled !== 'boolean' || enabled.has(row.module_key)) return unavailable('invalid_module_rows')
    enabled.set(row.module_key, row.is_enabled)
  }
  if (REQUIRED_MODULES.some((key) => !enabled.has(key))) return unavailable('invalid_module_rows')

  const core: CapabilityCode[] = []
  for (const [module, capabilities] of Object.entries(MODULE_CAPABILITIES)) {
    if (enabled.get(module) === true) core.push(...capabilities)
  }
  if (core.length) core.push('core.history.read', 'core.history.export')
  const grants: Entitlement[] = []
  const add = (product: 'diriqo_core' | 'invoicing', capabilities: readonly CapabilityCode[]) => {
    if (!capabilities.length) return
    grants.push({
      // Period identity is stable across reads and distinct on renewal. Persist old grants before enforcement.
      id: `${LEGACY_COMPATIBILITY_VERSION}:${subscription.id}:${product}:${validFrom}:${validUntil}`,
      companyId, product, registerId: null, policyVersion: CAPABILITY_POLICY_VERSION,
      origin: trial ? 'trial' : 'legacy_compatibility',
      sourceRef: `company_subscriptions/${subscription.id}/${LEGACY_COMPATIBILITY_VERSION}`,
      state: subscription.status === 'expired' ? 'readonly'
        : subscription.status === 'past_due' && now >= validUntil ? 'grace' : 'active',
      revoked: false, validFrom, validUntil,
      // Preserve existing access only. A later retention policy must backfill immutable history grants.
      historyUntil: graceUntil ?? validUntil, graceUntil,
      capabilities: [...capabilities],
      graceCapabilities: graceUntil === null ? [] : [...capabilities],
      cancelAtPeriodEnd,
    })
  }
  add('diriqo_core', core)
  if (enabled.get('invoices') === true) add('invoicing', INVOICE_CAPABILITIES)
  return { reason: 'mapped', snapshot: { status: 'ready', grants }, compatibilityVersion: LEGACY_COMPATIBILITY_VERSION }
}
