import { NextRequest, NextResponse } from 'next/server'

import { getPostLoginRedirect } from '@/lib/auth-redirect'
import { ensureUserLegalAcceptancesFromMetadata, getClientIpFromHeaders } from '@/lib/legal'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function safeRedirectPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return null
  }

  return value
}

function buildAuthErrorUrl(requestUrl: URL, errorCode: string, description?: string) {
  const errorUrl = new URL('/auth/error', requestUrl)
  errorUrl.searchParams.set('error_code', errorCode)

  if (description) {
    errorUrl.searchParams.set('error_description', description)
  }

  return errorUrl
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = safeRedirectPath(requestUrl.searchParams.get('next'))
  const supabase = await createSupabaseServerClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      return NextResponse.redirect(buildAuthErrorUrl(requestUrl, 'auth_callback_failed', error.message))
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(buildAuthErrorUrl(requestUrl, 'missing_session'))
  }

  await ensureUserLegalAcceptancesFromMetadata({
    user,
    ipAddress: getClientIpFromHeaders(request.headers),
    userAgent: request.headers.get('user-agent'),
  })

  return NextResponse.redirect(new URL(next ?? (await getPostLoginRedirect(user.id)), request.url))
}
