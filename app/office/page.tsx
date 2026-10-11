import { getRequestLocale } from '@/lib/i18n/server'
import { requireOfficeContext } from '@/lib/office/context'
import OfficeClient from './OfficeClient'

export default async function OfficePage() {
  const { actor, active } = await requireOfficeContext()
  const locale = await getRequestLocale()
  // requireOfficeContext already used the host resolver with the allowed Office roles.
  const companies = active.companyMemberships
    .map(company => ({ companyId: company.companyId, companyName: company.companyName }))
  return (
    <main>
      <nav style={{ padding: '10px 24px' }}>
        {/* Full navigation preserves the editor's unsaved-change beforeunload guard. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/">← Diriqo</a>
      </nav>
      <OfficeClient tenantId={actor.tenantId} actorId={actor.actorId} readOnly={actor.role === 'reader'}
        companyName={active.companyName} companies={companies} locale={locale} />
    </main>
  )
}
