import 'server-only'

import type { DalContext } from '../dal/auth'
import { LEGACY_COMPATIBILITY_VERSION, mapLegacyEntitlements, type LegacyCompatibilityResult } from './legacy-entitlements'

export type LegacyEntitlementLoadResult = Omit<LegacyCompatibilityResult, 'reason'> & Readonly<{
  reason: LegacyCompatibilityResult['reason'] | 'authentication_required' | 'membership_required' | 'data_unavailable'
}>

const SUBSCRIPTION_COLUMNS = [
  'id', 'company_id', 'plan_key', 'status', 'trial_started_at', 'trial_ends_at',
  'current_period_start', 'current_period_end', 'cancel_at_period_end',
].join(', ')

/**
 * Server-only, read-only shadow loader for the EXISTING EUR subscription contract.
 * Caller must pass a context from requireHubDalContext/requireCompanyRoleDalContext.
 * Auth/profile/membership are rechecked here; the context role never grants a license.
 * It deliberately does not read proposed product entitlements or enable enforcement.
 * Do not cache this across requests or substitute a service-role client.
 */
export async function loadLegacyEntitlementSnapshot(
  context: Pick<DalContext, 'supabase' | 'companyId' | 'profileId'>,
): Promise<LegacyEntitlementLoadResult> {
  const unavailable = (reason: LegacyEntitlementLoadResult['reason']): LegacyEntitlementLoadResult => ({
    reason, snapshot: { status: 'unavailable' }, compatibilityVersion: LEGACY_COMPATIBILITY_VERSION,
  })
  if (!context.companyId?.trim() || !context.profileId?.trim()) return unavailable('membership_required')
  try {
    const auth = await context.supabase.auth.getUser()
    if (auth.error || !auth.data.user) return unavailable('authentication_required')
    const profile = await context.supabase.from('profiles')
      .select('id, auth_user_id, user_id').eq('id', context.profileId).maybeSingle()
    if (profile.error) return unavailable('data_unavailable')
    if (!profile.data || profile.data.id !== context.profileId
      || (profile.data.auth_user_id ?? profile.data.user_id) !== auth.data.user.id
      || (profile.data.auth_user_id && profile.data.user_id && profile.data.auth_user_id !== profile.data.user_id)) {
      return unavailable('membership_required')
    }
    const membership = await context.supabase.from('company_members')
      .select('company_id, profile_id, is_active')
      .eq('company_id', context.companyId).eq('profile_id', context.profileId).eq('is_active', true).maybeSingle()
    if (membership.error) return unavailable('data_unavailable')
    if (!membership.data || membership.data.company_id !== context.companyId
      || membership.data.profile_id !== context.profileId || membership.data.is_active !== true) {
      return unavailable('membership_required')
    }

    const [subscription, modules] = await Promise.all([
      context.supabase.from('company_subscriptions').select(SUBSCRIPTION_COLUMNS)
        .eq('company_id', context.companyId).maybeSingle(),
      context.supabase.from('company_modules').select('company_id, module_key, is_enabled')
        .eq('company_id', context.companyId),
    ])
    if (subscription.error || modules.error) return unavailable('data_unavailable')
    return mapLegacyEntitlements(context.companyId, subscription.data, modules.data, Date.now())
  } catch {
    // No customer records, tokens, or raw infrastructure errors in the returned DTO.
    return unavailable('data_unavailable')
  }
}
