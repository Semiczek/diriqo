import 'server-only'

import { getCompanyModules, type CompanyModuleKey } from '@/lib/company-settings'

export async function isCompanyModuleEnabled(companyId: string, moduleKey: CompanyModuleKey) {
  const modules = await getCompanyModules(companyId)
  return modules[moduleKey] !== false
}

export async function requireCompanyModule(companyId: string, moduleKey: CompanyModuleKey) {
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
