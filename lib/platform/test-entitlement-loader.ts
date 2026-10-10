import 'server-only'

import type { DalContext } from '../dal/auth'
import { readModuleBillingMode } from './module-billing-mode'
import {
  CAPABILITIES, CAPABILITY_POLICY_VERSION, isCapabilityCode, isProductCode,
  type Entitlement, type EntitlementSnapshot,
} from './capabilities'

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const time = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null
  const result = Date.parse(value)
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}

/** Nonfinancial, persisted owner grants. Never adapt a paid receipt or UI toggle. */
export function parseTestEntitlementRows(companyId: string, rows: unknown): EntitlementSnapshot {
  const unavailable = { status: 'unavailable' } as const
  if (!nonempty(companyId) || !Array.isArray(rows) || rows.length > 10_000) return unavailable
  const grants: Entitlement[] = []
  const ids = new Set<string>()
  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable
    const row = value as Record<string, unknown>
    const from = time(row.valid_from), until = time(row.valid_until), history = time(row.history_until)
    if (!nonempty(row.id) || ids.has(row.id) || row.company_id !== companyId || row.livemode !== false
      || !isProductCode(row.product) || row.policy_version !== CAPABILITY_POLICY_VERSION
      || !nonempty(row.source_ref) || row.origin !== 'manual_grant' || row.state !== 'active'
      || typeof row.revoked !== 'boolean' || row.cancel_at_period_end !== false
      || from === null || until === null || history === null || until <= from
      || until - from > 30 * 24 * 60 * 60 * 1000 || history !== until
      || (row.product === 'pos' ? !nonempty(row.register_id) : row.register_id !== null)
      || row.grace_until !== null || !Array.isArray(row.grace_capabilities) || row.grace_capabilities.length !== 0
      || !Array.isArray(row.capabilities) || row.capabilities.length === 0
      || new Set(row.capabilities).size !== row.capabilities.length) return unavailable
    const capabilities = row.capabilities
    if (!capabilities.every((code) => isCapabilityCode(code) && CAPABILITIES[code].product === row.product)) return unavailable
    ids.add(row.id)
    grants.push({
      id: row.id, companyId, product: row.product, registerId: row.register_id as string | null,
      policyVersion: CAPABILITY_POLICY_VERSION, sourceRef: row.source_ref, origin: 'manual_grant', state: 'active',
      revoked: row.revoked, validFrom: from, validUntil: until, historyUntil: history,
      capabilities, graceUntil: null, graceCapabilities: [], cancelAtPeriodEnd: false,
    })
  }
  return { status: 'ready', grants }
}

/** Caller supplies a fresh authenticated DAL client, never a service-role client. */
export async function loadTestEntitlementSnapshot(
  context: Pick<DalContext, 'supabase' | 'companyId' | 'profileId'>,
): Promise<EntitlementSnapshot> {
  const unavailable = { status: 'unavailable' } as const
  const mode = readModuleBillingMode()
  if (mode === null) return unavailable
  // A live deployment neither reads nor accepts a test licence.
  if (mode) return { status: 'ready', grants: [] }
  if (!nonempty(context.companyId) || !nonempty(context.profileId)) return unavailable
  try {
    const auth = await context.supabase.auth.getUser()
    if (auth.error || !auth.data.user) return unavailable
    const profile = await context.supabase.from('profiles').select('id, auth_user_id, user_id')
      .eq('id', context.profileId).maybeSingle()
    if (profile.error || profile.data?.id !== context.profileId
      || profile.data.auth_user_id !== auth.data.user.id
      || (profile.data.user_id && profile.data.auth_user_id !== profile.data.user_id)) return unavailable
    const membership = await context.supabase.from('company_members').select('company_id, profile_id, is_active')
      .eq('company_id', context.companyId).eq('profile_id', context.profileId).eq('is_active', true).maybeSingle()
    if (membership.error || membership.data?.company_id !== context.companyId
      || membership.data.profile_id !== context.profileId || membership.data.is_active !== true) return unavailable
    const result = await context.supabase.rpc('get_company_test_module_entitlements', { target_company_id: context.companyId })
    if (result.error) return unavailable
    return parseTestEntitlementRows(context.companyId, result.data)
  } catch {
    return unavailable
  }
}
