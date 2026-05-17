import { Suspense } from 'react'
import { redirect } from 'next/navigation'

import SignUpForm from '@/app/sign-up/SignUpForm'
import { getPostLoginRedirect } from '@/lib/auth-redirect'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type SignUpPageProps = {
  searchParams?: Promise<{
    plan?: string
    interval?: string
  }>
}

export const dynamic = 'force-dynamic'

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect(await getPostLoginRedirect(user.id))
  }

  const params = searchParams ? await searchParams : {}

  return (
    <Suspense fallback={<main style={fallbackStyle}>Loading...</main>}>
      <SignUpForm plan={params.plan} interval={params.interval} />
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
