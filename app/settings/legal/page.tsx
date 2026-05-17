import DashboardShell from '@/components/DashboardShell'
import LegalCenter from '@/components/legal/LegalCenter'
import { getRequestLocale } from '@/lib/i18n/server'
import {
  getCurrentLegalVersions,
  getPendingLegalDocuments,
  isLegalAcceptanceStorageAvailable,
} from '@/lib/legal'
import {
  getLegalDocuments,
  type LegalDocumentType,
} from '@/lib/legal-documents'
import { requireAuthenticatedUser } from '@/lib/server-guards'

type SettingsLegalPageProps = {
  searchParams?: Promise<{
    doc?: string
  }>
}

export const dynamic = 'force-dynamic'

function resolveLegalDocumentType(value: string | undefined): LegalDocumentType {
  if (value === 'privacy' || value === 'cookies' || value === 'dpa' || value === 'security') {
    return value
  }

  return 'terms'
}

function getActiveSidebarItem(type: LegalDocumentType) {
  if (type === 'privacy') return 'legalPrivacy'
  if (type === 'dpa') return 'legalGdpr'
  return 'legalTerms'
}

export default async function SettingsLegalPage({ searchParams }: SettingsLegalPageProps) {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) {
    return null
  }

  const locale = await getRequestLocale()
  const params = searchParams ? await searchParams : {}
  const storageAvailable = await isLegalAcceptanceStorageAvailable()
  const activeType = resolveLegalDocumentType(params.doc)
  const [versions, pending] = await Promise.all([
    getCurrentLegalVersions(locale),
    storageAvailable ? getPendingLegalDocuments(auth.value.user.id, locale) : Promise.resolve([]),
  ])

  return (
    <DashboardShell activeItem={getActiveSidebarItem(activeType)}>
      <LegalCenter
        documents={getLegalDocuments(locale)}
        activeType={activeType}
        versions={versions}
        basePath="/settings/legal"
        mode="settings"
        pending={pending}
        storageAvailable={storageAvailable}
      />
    </DashboardShell>
  )
}
