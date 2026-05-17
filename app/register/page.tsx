import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import SignUpForm from '@/app/sign-up/SignUpForm'
import { getPostLoginRedirect } from '@/lib/auth-redirect'
import { getRequestLocale } from '@/lib/i18n/server'
import { getCurrentLegalVersion } from '@/lib/legal'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type RegisterPageProps = {
  searchParams?: Promise<{
    plan?: string
    interval?: string
    locale?: string
  }>
}

export const dynamic = 'force-dynamic'

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect(await getPostLoginRedirect(user.id))
  }

  const params = searchParams ? await searchParams : {}
  const locale = await getRequestLocale()
  const [termsVersion, privacyVersion] = await Promise.all([
    getCurrentLegalVersion('terms', locale),
    getCurrentLegalVersion('privacy', locale),
  ])

  return (
    <Suspense fallback={<main style={fallbackStyle}>Loading...</main>}>
      <SignUpForm
        plan={params.plan}
        interval={params.interval}
        legalVersions={{
          terms: termsVersion.version,
          privacy: privacyVersion.version,
        }}
      />
    </Suspense>
  )
}

const fallbackStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  background: '#080d2a',
  color: '#ffffff',
} as const
