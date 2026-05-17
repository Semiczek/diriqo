import LegalCenter from '@/components/legal/LegalCenter'
import { getRequestLocale } from '@/lib/i18n/server'
import { getCurrentLegalVersions } from '@/lib/legal'
import {
  getLegalDocuments,
  type LegalDocumentType,
} from '@/lib/legal-documents'

type LegalPageProps = {
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

export default async function LegalPage({ searchParams }: LegalPageProps) {
  const locale = await getRequestLocale()
  const params = searchParams ? await searchParams : {}
  const documents = getLegalDocuments(locale)
  const versions = await getCurrentLegalVersions(locale)

  return (
    <LegalCenter
      documents={documents}
      activeType={resolveLegalDocumentType(params.doc)}
      versions={versions}
      basePath="/legal"
      mode="public"
    />
  )
}
