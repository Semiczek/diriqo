import { getRequestLocale } from '@/lib/i18n/server'
import { requireOfficeContext } from '@/lib/office/context'
import { COMPANY_MODULE_KEYS } from '@/lib/company-settings-shared'
import OfficeClient from './OfficeClient'
import FloatingDiriqent from '@/components/diriqent/FloatingDiriqent'

export const metadata = { title: 'Office' }

export default async function OfficePage() {
  const { actor, active, supabase } = await requireOfficeContext()
  const [locale, modules, products] = await Promise.all([
    getRequestLocale(),
    // Navigation is read-only; opening Office must not create company settings.
    supabase.from('company_modules').select('module_key, is_enabled').eq('company_id', actor.tenantId),
    supabase.rpc('module_navigation', { company: actor.tenantId }),
  ])
  const enabledModules = Object.fromEntries(COMPANY_MODULE_KEYS.map(key => [
    key, !modules.error && (modules.data ?? []).find(row => row.module_key === key)?.is_enabled !== false,
  ]))
  const companies = active.companyMemberships
    .map(company => ({ companyId: company.companyId, companyName: company.companyName }))
  const administrator = ['super_admin', 'company_admin'].includes((active.role ?? '').trim().toLowerCase())
  return (
    <main className="dq-app">
      <OfficeClient tenantId={actor.tenantId} actorId={actor.actorId} readOnly={actor.role === 'reader'}
        companyName={active.companyName} companies={companies} locale={locale}
        navigation={{ enabledModules, availableProducts: products.error || !Array.isArray(products.data) ? [] : products.data,
          showCoreNavigation: administrator, showModuleCatalog: administrator }} />
      <FloatingDiriqent key={`${actor.tenantId}:${actor.actorId}:${actor.role}`} keepWorkspaceOpen />
    </main>
  )
}
