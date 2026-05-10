import { redirect } from 'next/navigation'

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string
    mode?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {}

  if (params.mode === 'sign-up') {
    redirect('/sign-up')
  }

  if (params.error) {
    redirect(`/sign-in?error=${encodeURIComponent(params.error)}`)
  }

  redirect('/sign-in')
}
