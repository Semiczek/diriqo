import { redirect } from 'next/navigation'

type RegisterPageProps = {
  searchParams: Promise<{
    plan?: string
    interval?: string
  }>
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  void (await searchParams)
  redirect('/sign-up')
}
