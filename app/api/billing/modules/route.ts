import { NextResponse } from 'next/server'

import { requireAuthenticatedUser, requireWorkerAccess } from '@/lib/server-guards'
import { CAPABILITIES, PRODUCT_CODES, evaluateCapabilityEntitlement, type CapabilityCode } from '@/lib/platform/capabilities'
import { loadPaidEntitlementSnapshot } from '@/lib/platform/paid-entitlement-loader'
import { loadTestEntitlementSnapshot } from '@/lib/platform/test-entitlement-loader'
import { getPaidCompanyCapabilityAccess } from '@/lib/platform/module-operation-access'

const headers = { 'Cache-Control': 'private, no-store' }

/** Licence status only. Domain operations still require their own role/object/country/budget checks. */
export async function GET() {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers })
  const company = await requireWorkerAccess()
  if (!company.ok) return NextResponse.json({ error: company.error }, { status: company.status, headers })
  const context = {
    supabase: auth.value.supabase, companyId: company.value.companyId, profileId: company.value.profileId,
  }
  const [snapshot, testSnapshot, coreAccess, invoiceAccess] = await Promise.all([
    loadPaidEntitlementSnapshot(context),
    loadTestEntitlementSnapshot(context),
    getPaidCompanyCapabilityAccess(context, 'core.jobs.create').catch(() => null),
    getPaidCompanyCapabilityAccess(context, 'invoicing.invoice.issue').catch(() => null),
  ])
  if (snapshot.status !== 'ready' || testSnapshot.status !== 'ready' || !coreAccess || !invoiceAccess) {
    return NextResponse.json({ error: 'Dostupnost modulů se teď nepodařilo ověřit.' }, { status: 503, headers })
  }
  const now = Date.now()
  const scopes = [...snapshot.grants, ...testSnapshot.grants].map((grant) => grant.registerId)
  const registers = [...new Set(scopes.filter((id): id is string => id !== null))]
  const products = PRODUCT_CODES.flatMap((product) => {
    const productScopes = product === 'pos' ? registers : [null]
    return productScopes.map((registerId) => {
      const paidPeriods = snapshot.grants.filter((grant) => grant.product === product
        && grant.registerId === registerId && !grant.revoked && grant.state === 'active'
        && grant.validFrom <= now && grant.validUntil > now)
      const testPeriods = testSnapshot.grants.filter((grant) => grant.product === product
        && grant.registerId === registerId && !grant.revoked && grant.state === 'active'
        && grant.validFrom <= now && grant.validUntil > now)
      const access = product === 'diriqo_core' ? coreAccess : product === 'invoicing' ? invoiceAccess : null
      return {
        product, registerId, isPaidActive: paidPeriods.length > 0,
        paidUntil: paidPeriods.length > 0
          ? new Date(Math.max(...paidPeriods.map((grant) => grant.validUntil))).toISOString() : null,
        isTestActive: testPeriods.length > 0,
        testUntil: testPeriods.length > 0
          ? new Date(Math.max(...testPeriods.map((grant) => grant.validUntil))).toISOString() : null,
        legacyAccess: access?.reason === 'legacy' && access.allowed,
        purchasedCapabilities: (Object.keys(CAPABILITIES) as CapabilityCode[]).filter((capability) =>
          CAPABILITIES[capability].product === product && evaluateCapabilityEntitlement({
            snapshot, companyId: company.value.companyId, registerId, now, capability,
          }).entitled),
      }
    })
  })
  return NextResponse.json({ companyId: company.value.companyId, source: 'module_licenses', products }, { headers })
}
