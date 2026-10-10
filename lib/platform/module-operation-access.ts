import 'server-only'

import type { DalContext } from '@/lib/dal/auth'
import { readModuleBillingMode } from './module-billing-mode'
import type { CapabilityCode } from './capabilities'

// Only company-scoped new operations without a separate budget requirement are supported here.
// History, settlement, register-scoped POS and metered AI require their own context.
export const COMPANY_OPERATION_CAPABILITIES = [
  'core.jobs.create', 'core.jobs.update', 'core.jobs.close', 'core.customers.manage',
  'core.workers.manage', 'core.rates.manage', 'core.time.record', 'core.time.approve',
  'core.quotes.create', 'core.calendar.manage', 'core.absences.request', 'core.absences.approve',
  'core.advances.request', 'core.advances.pay', 'core.files.upload', 'core.handover.confirm', 'core.costs.record',
  'inventory.receipt.post', 'inventory.movement.post', 'invoicing.invoice.issue',
  'smart_quotes.template.manage', 'fleet.vehicle.manage', 'fleet.trip.record',
] as const satisfies readonly CapabilityCode[]

export type CompanyOperationCapability = typeof COMPANY_OPERATION_CAPABILITIES[number]
export type ModuleOperationContext = {
  companyId: string
  supabase: Pick<DalContext['supabase'], 'auth' | 'rpc'>
}
export type CompanyCapabilityAccess = {
  companyId: string
  capability: CompanyOperationCapability
  enforced: boolean
  allowed: boolean
  reason: 'legacy' | 'paid' | 'test' | 'module_required'
}

export class ModuleAccessError extends Error {
  constructor(message: string, readonly status: 403 | 503) {
    super(message)
    this.name = 'ModuleAccessError'
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unavailable = () => new ModuleAccessError('Placené oprávnění se nyní nepodařilo ověřit. Zkuste akci znovu později.', 503)
const forbidden = () => new ModuleAccessError('Oprávnění k aktivní firmě se změnilo. Obnovte přihlášení a výběr firmy.', 403)
const required = () => new ModuleAccessError('Pro tuto operaci potřebujete aktivní placený modul a jeho požadovaný základ. Otevřete přehled modulů.', 403)

/** License dimension only. Existing role, object, country and module-setting guards remain required. */
export async function getPaidCompanyCapabilityAccess(
  context: ModuleOperationContext,
  capability: CompanyOperationCapability,
): Promise<CompanyCapabilityAccess> {
  if (typeof context.companyId !== 'string' || !uuid.test(context.companyId)) throw forbidden()
  if (!(COMPANY_OPERATION_CAPABILITIES as readonly string[]).includes(capability)) {
    throw new ModuleAccessError('Tato operace zatím nemá podporovanou kontrolu licence.', 403)
  }
  const companyId = context.companyId.toLowerCase()
  let result
  try {
    const auth = await context.supabase.auth.getUser()
    if (auth.error || !auth.data.user) throw forbidden()
    // Mode, current time, membership, purchased capabilities and dependencies come from the database.
    result = await context.supabase.rpc('get_company_capability_access', {
      target_company_id: companyId,
      target_capability: capability,
    })
  } catch (error) {
    if (error instanceof ModuleAccessError) throw error
    throw unavailable()
  }
  if (!result || typeof result !== 'object') throw unavailable()
  const { data, error } = result
  if (error?.message === 'MODULE_CAPABILITY_FORBIDDEN') throw forbidden()
  if (error?.message === 'MODULE_CAPABILITY_UNSUPPORTED') {
    throw new ModuleAccessError('Tato operace zatím nemá podporovanou kontrolu licence.', 403)
  }
  if (error || !data || typeof data !== 'object' || Array.isArray(data)
    || data.company_id !== companyId || data.capability !== capability
    || typeof data.enforced !== 'boolean' || typeof data.allowed !== 'boolean') throw unavailable()

  if (!data.enforced) {
    // Only explicit server-owned rollout state may retain the existing access rules.
    if (!data.allowed || data.reason !== 'legacy' || data.livemode !== null) throw unavailable()
  } else {
    const mode = readModuleBillingMode()
    if (mode === null || typeof data.livemode !== 'boolean' || data.livemode !== mode
      || (data.allowed ? !(data.reason === 'paid' || (data.reason === 'test' && mode === false))
        : data.reason !== 'module_required')) throw unavailable()
  }
  return { companyId, capability, enforced: data.enforced, allowed: data.allowed, reason: data.reason }
}

export async function requirePaidCompanyCapability(context: ModuleOperationContext, capability: CompanyOperationCapability): Promise<void> {
  const access = await getPaidCompanyCapabilityAccess(context, capability)
  if (!access.allowed) throw required()
}
