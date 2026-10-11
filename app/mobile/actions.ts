'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function signOutMobileAction() {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut({ scope: 'local' })
  redirect('/sign-in')
}
