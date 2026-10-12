import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getRequestDictionary } from '@/lib/i18n/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

async function logout() {
  'use server'
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) redirect('/logout?error=signout')
  // Account switching must not inherit the previous account's selected company.
  ;(await cookies()).delete('active_company_id')
  redirect('/sign-in')
}

export default async function LogoutPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const dictionary = await getRequestDictionary()
  const params = await searchParams
  // GET/prefetch renders only. Cookie mutation belongs to the explicit POST action.
  return (
    <main style={{ maxWidth: 440, margin: '80px auto', padding: 24 }}>
      <h1>{dictionary.common.logout}</h1>
      {params.error === 'signout' ? <p role="alert">{dictionary.common.logoutFailed}</p> : null}
      <form action={logout}>
        <button type="submit">{dictionary.common.logout}</button>
      </form>
    </main>
  )
}
