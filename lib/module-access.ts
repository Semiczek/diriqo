import 'server-only'

import { getCompanyModules, type CompanyModuleKey } from '@/lib/company-settings'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ModuleAccessError, requirePaidCompanyCapability, type CompanyOperationCapability } from '@/lib/platform/module-operation-access'

// These are operation checks, not menu visibility or permission to read retained history.
const operationCapabilities: Partial<Record<CompanyModuleKey, readonly CompanyOperationCapability[]>> = {
  jobs: ['core.jobs.update', 'core.jobs.create', 'core.jobs.close'],
  workers: ['core.workers.manage'],
  shifts: ['core.time.record', 'core.time.approve'],
  calendar: ['core.calendar.manage'],
  quotes: ['core.quotes.create'],
  invoices: ['invoicing.invoice.issue'],
  photos: ['core.files.upload'],
  payroll: ['core.rates.manage'],
}

export async function isCompanyModuleEnabled(companyId: string, moduleKey: CompanyModuleKey) {
  const modules = await getCompanyModules(companyId)
  return modules[moduleKey] !== false
}

export async function requireCompanyModule(companyId: string, moduleKey: CompanyModuleKey, operation?: CompanyOperationCapability) {
  const supported = operationCapabilities[moduleKey]
  const capability = operation ?? supported?.[0]
  if (!capability || !supported?.includes(capability)) {
    return { ok: false as const, status: 403 as const, error: 'Tato operace zatím nemá podporovanou kontrolu licence.' }
  }
  try {
    const supabase = await createSupabaseServerClient()
    await requirePaidCompanyCapability({ companyId, supabase }, capability)
  } catch (error) {
    return {
      ok: false as const,
      status: error instanceof ModuleAccessError ? error.status : 503 as const,
      error: error instanceof ModuleAccessError ? error.message : 'Oprávnění se nyní nepodařilo ověřit. Zkuste akci později.',
    }
  }
  // Read the legacy setting only after the paid guard: the old loader can create missing defaults.
  if (await isCompanyModuleEnabled(companyId, moduleKey)) {
    return {
      ok: true as const,
    }
  }

  return {
    ok: false as const,
    error: 'Tento modul je pro aktivni firmu vypnuty.',
  }
}
