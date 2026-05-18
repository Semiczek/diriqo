import { NextRequest, NextResponse } from 'next/server'

import { getPostLoginRedirect } from '@/lib/auth-redirect'
import { createSupabaseServerClient } from '@/lib/supabase-server'

type SignInPayload = {
  email?: unknown
  password?: unknown
}

const noStoreHeaders = {
  'Cache-Control': 'no-store',
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: noStoreHeaders })
}

export async function POST(request: NextRequest) {
  let payload: SignInPayload

  try {
    payload = (await request.json()) as SignInPayload
  } catch {
    return jsonError('Invalid request body.')
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : ''
  const password = typeof payload.password === 'string' ? payload.password : ''

  if (!email || !password) {
    return jsonError('Email and password are required.')
  }

  const supabase = await createSupabaseServerClient()
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) {
    return jsonError(signInError.message, signInError.status || 400)
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return jsonError(userError?.message ?? 'Session was not created.', 401)
  }

  return NextResponse.json(
    {
      ok: true,
      redirectTo: await getPostLoginRedirect(user.id),
    },
    { headers: noStoreHeaders }
  )
}
