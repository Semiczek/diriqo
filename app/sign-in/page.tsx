import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import SignInForm from '@/app/sign-in/SignInForm'
import { getPostLoginRedirect } from '@/lib/auth-redirect'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function SignInPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect(process.env.OFFICE_STAGING_ONLY === '1' ? '/office' : await getPostLoginRedirect(user.id))
  }

  return (
    <Suspense fallback={<main style={fallbackStyle}>Loading...</main>}>
      <SignInForm />
    </Suspense>
  )
}

const fallbackStyle = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  background: '#f8fafc',
  color: '#111827',
} as const
