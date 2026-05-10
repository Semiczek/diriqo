import { redirect } from 'next/navigation'

import CompanyOnboardingForm from '@/app/onboarding/company/CompanyOnboardingForm'
import { getActiveCompanyContext } from '@/lib/active-company'
import { getCompanyCountryConfig } from '@/lib/company-country-config'
import { getRequestDictionary, getRequestLocale } from '@/lib/i18n/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type Props = {
  searchParams?: Promise<{
    error?: string
  }>
}

export const dynamic = 'force-dynamic'

function getDefaultCountryCode(locale: string) {
  if (locale === 'en') return 'UK'
  if (locale === 'de') return 'DE'
  return 'CZ'
}

export default async function CompanyOnboardingPage({ searchParams }: Props) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/sign-in')
  }

  const activeCompany = await getActiveCompanyContext()
  if (activeCompany) {
    redirect('/')
  }

  const locale = await getRequestLocale()
  const dictionary = await getRequestDictionary()
  const t = dictionary.auth
  const defaults = getCompanyCountryConfig(getDefaultCountryCode(locale))
  const params = searchParams ? await searchParams : {}
  const hasCompanyNameError = params.error === 'company-name'
  const hasRequiredError = params.error === 'required'
  const hasCreateError = params.error === 'create'

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <div>
          <p style={eyebrowStyle}>{t.companyOnboardingEyebrow}</p>
          <h1 style={titleStyle}>{t.companyOnboardingTitle}</h1>
          <p style={textStyle}>{t.companyOnboardingSubtitle}</p>
        </div>

        <CompanyOnboardingForm
          initialCountryCode={defaults.countryCode}
          hasCompanyNameError={hasCompanyNameError}
          hasRequiredError={hasRequiredError}
          hasCreateError={hasCreateError}
        />
      </section>
    </main>
  )
}

const pageStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: '#f8fafc',
  color: '#0f172a',
} as const

const cardStyle = {
  width: 'min(100%, 780px)',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  gap: 24,
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  boxShadow: '0 22px 60px rgba(15, 23, 42, 0.1)',
  padding: 28,
} as const

const eyebrowStyle = {
  margin: 0,
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
} as const

const titleStyle = {
  margin: '10px 0',
  fontSize: 34,
  lineHeight: 1.05,
} as const

const textStyle = {
  margin: 0,
  color: '#64748b',
  fontSize: 15,
  lineHeight: 1.7,
  fontWeight: 650,
} as const
