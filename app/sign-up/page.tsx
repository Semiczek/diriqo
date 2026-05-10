import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import SignUpForm from '@/app/sign-up/SignUpForm'
import { getPostLoginRedirect } from '@/lib/auth-redirect'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export default async function SignUpPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect(await getPostLoginRedirect(user.id))
  }

  return (
    <Suspense fallback={<main style={fallbackStyle}>Loading...</main>}>
      <SignUpForm />
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
