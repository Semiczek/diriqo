import { redirect } from 'next/navigation'

type LocalizedBillingPageProps = {
  searchParams?: Promise<Record<string, string | undefined>>
}

export default async function LocalizedBillingPage({ searchParams }: LocalizedBillingPageProps) {
  const params = searchParams ? await searchParams : {}
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }

  const suffix = query.toString()
  redirect(suffix ? `/billing?${suffix}` : '/billing')
}
