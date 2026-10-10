import 'server-only'

import type { DalContext } from '../dal/auth'
import { readModuleBillingMode } from './module-billing-mode'
import {
  CAPABILITIES, CAPABILITY_POLICY_VERSION, isCapabilityCode, isProductCode,
  type Entitlement, type EntitlementSnapshot,
} from './capabilities'

const columns = [
  'id', 'company_id', 'product', 'register_id', 'policy_version', 'source_ref', 'origin', 'state',
  'revoked', 'valid_from', 'valid_until', 'history_until', 'capabilities', 'grace_capabilities',
  'grace_until', 'cancel_at_period_end', 'livemode',
].join(', ')
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const time = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null
  const result = Date.parse(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}

/** Strictly reads persisted paid periods. Does not synthesize grants from UI toggles or legacy plans. */
export function parsePaidEntitlementRows(companyId: string, rows: unknown, expectedLivemode: boolean): EntitlementSnapshot {
  const unavailable = { status: 'unavailable' } as const
  if (!nonempty(companyId) || !Array.isArray(rows) || typeof expectedLivemode !== 'boolean') return unavailable
  const grants: Entitlement[] = []
  const ids = new Set<string>()
  for (const value of rows) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return unavailable
    const row = value as Record<string, unknown>
    const from = time(row.valid_from), until = time(row.valid_until), history = time(row.history_until)
    if (!nonempty(row.id) || ids.has(row.id) || row.company_id !== companyId || row.livemode !== expectedLivemode
      || !isProductCode(row.product) || row.policy_version !== CAPABILITY_POLICY_VERSION
      || !nonempty(row.source_ref) || row.origin !== 'paid' || row.state !== 'active'
      || typeof row.revoked !== 'boolean' || typeof row.cancel_at_period_end !== 'boolean'
      || from === null || until === null || history === null || until <= from || history < until
      || (row.product === 'pos' ? !nonempty(row.register_id) : row.register_id !== null)
      || row.grace_until !== null || !Array.isArray(row.grace_capabilities) || row.grace_capabilities.length !== 0
      || !Array.isArray(row.capabilities) || row.capabilities.length === 0
      || new Set(row.capabilities).size !== row.capabilities.length) return unavailable
    const capabilities = row.capabilities
    if (!capabilities.every((code) => isCapabilityCode(code) && CAPABILITIES[code].product === row.product)) {
      return unavailable
    }
    ids.add(row.id)
    grants.push({
      id: row.id, companyId, product: row.product, registerId: row.register_id as string | null,
      policyVersion: CAPABILITY_POLICY_VERSION, sourceRef: row.source_ref, origin: 'paid', state: 'active',
      revoked: row.revoked, validFrom: from, validUntil: until, historyUntil: history,
      capabilities, graceUntil: null, graceCapabilities: [], cancelAtPeriodEnd: row.cancel_at_period_end,
    })
  }
  return { status: 'ready', grants }
}

/** Caller supplies the request's authenticated DAL client, never a service-role client. */
export async function loadPaidEntitlementSnapshot(
  context: Pick<DalContext, 'supabase' | 'companyId' | 'profileId'>,
): Promise<EntitlementSnapshot> {
  const unavailable = { status: 'unavailable' } as const
  const livemode = readModuleBillingMode()
  if (livemode === null) return unavailable
  if (!nonempty(context.companyId) || !nonempty(context.profileId)) return unavailable
  try {
    const auth = await context.supabase.auth.getUser()
    if (auth.error || !auth.data.user) return unavailable
    const profile = await context.supabase.from('profiles').select('id, auth_user_id, user_id')
      .eq('id', context.profileId).maybeSingle()
    if (profile.error || profile.data?.id !== context.profileId
      || (profile.data.auth_user_id ?? profile.data.user_id) !== auth.data.user.id
      || (profile.data.auth_user_id && profile.data.user_id && profile.data.auth_user_id !== profile.data.user_id)) {
      return unavailable
    }
    const membership = await context.supabase.from('company_members').select('company_id, profile_id, is_active')
      .eq('company_id', context.companyId).eq('profile_id', context.profileId).eq('is_active', true).maybeSingle()
    if (membership.error || membership.data?.company_id !== context.companyId
      || membership.data.profile_id !== context.profileId || membership.data.is_active !== true) return unavailable
    // Stable pagination also detects server row caps and concurrent changes to the ledger.
    // Exceeding the explicit safety bound returns unavailable, never a truncated ready snapshot.
    const allRows: unknown[] = []
    let expectedCount: number | null = null
    do {
      const rows = await context.supabase.from('company_module_entitlements').select(columns, { count: 'exact' })
        .eq('company_id', context.companyId).eq('livemode', livemode).order('id')
        .range(allRows.length, allRows.length + 499)
      if (rows.error || !Array.isArray(rows.data) || rows.count === null || rows.count === undefined
        || !Number.isSafeInteger(rows.count) || rows.count < 0 || rows.count > 10_000
        || (expectedCount !== null && rows.count !== expectedCount)) return unavailable
      expectedCount = rows.count
      if (rows.data.length === 0 && allRows.length < expectedCount) return unavailable
      allRows.push(...rows.data)
      if (allRows.length > expectedCount) return unavailable
    } while (allRows.length < expectedCount)
    return parsePaidEntitlementRows(context.companyId, allRows, livemode)
  } catch {
    return unavailable
  }
}
