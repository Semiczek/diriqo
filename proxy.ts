import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { hasAnyHubAccessRole, hasCompanyMemberRole } from '@/lib/hub-access'
import {
  LOCALE_COUNTRY_HEADER_NAME,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  getFallbackLocaleFromCountry,
  getPreferredLocaleFromHeader,
  normalizeLocale,
} from '@/lib/i18n/config'

const PROTECTED_MATCHERS = [
  '/',
  '/absences',
  '/advance-requests',
  '/jobs',
  '/calendar',
  '/cenove-nabidky',
  '/customers',
  '/poptavky',
  '/workers',
  '/kalkulace',
  '/settings',
  '/billing',
  '/costs',
  '/admin',
  '/invoices',
  '/work-shifts',
  '/moje-prace',
  '/ucet',
  '/logout',
  '/napoveda',
  '/help',
  '/debug-auth',
  '/dashboard',
  '/api/active-company',
  '/api/company-billing',
  '/api/billing',
  '/api/customer-portal-users',
  '/api/invoices',
  '/api/jobs',
  '/api/job-assignments',
  '/api/job-photos',
  '/api/pohoda-exports',
  '/api/quotes',
  '/api/mail/feed',
  '/api/mail/send',
]

function isPortalPath(pathname: string) {
  return pathname === '/portal' || pathname.startsWith('/portal/')
}

function isPortalLoginPath(pathname: string) {
  return pathname === '/portal/login'
}

function isPortalResetPasswordPath(pathname: string) {
  return pathname === '/portal/reset-password'
}

function isProtectedPath(pathname: string) {
  if (pathname === '/') return true

  return PROTECTED_MATCHERS.some((path) => {
    if (path === '/') return false
    return pathname === path || pathname.startsWith(`${path}/`)
  })
}

function isAdminPath(pathname: string) {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

function isWorkerAppPath(pathname: string) {
  return pathname === '/moje-prace' || pathname.startsWith('/moje-prace/')
}

type CookieOptions = {
  domain?: string
  expires?: Date
  httpOnly?: boolean
  maxAge?: number
  path?: string
  sameSite?: 'lax' | 'strict' | 'none' | boolean
  secure?: boolean
}

export async function proxy(request: NextRequest) {
  const detectedCountry =
    request.headers.get('x-vercel-ip-country') ??
    request.headers.get('cf-ipcountry')

  const locale =
    normalizeLocale(request.nextUrl.searchParams.get('locale')) ??
    normalizeLocale(request.cookies.get(LOCALE_COOKIE_NAME)?.value) ??
    getPreferredLocaleFromHeader(request.headers.get('accept-language')) ??
    getFallbackLocaleFromCountry(detectedCountry)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(LOCALE_HEADER_NAME, locale)
  if (detectedCountry) {
    requestHeaders.set(LOCALE_COUNTRY_HEADER_NAME, detectedCountry)
  }

  const createResponse = () =>
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })

  let response = createResponse()

  const ensureLocaleCookie = (target: NextResponse) => {
    if (request.cookies.get(LOCALE_COOKIE_NAME)?.value === locale) {
      return target
    }

    target.cookies.set({
      name: LOCALE_COOKIE_NAME,
      value: locale,
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    })

    return target
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })

          response = createResponse()

          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })

          response = createResponse()

          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  const pathname = request.nextUrl.pathname
  const protectedPath = isProtectedPath(pathname)
  const portalPath = isPortalPath(pathname)
  const portalLoginPath = isPortalLoginPath(pathname)
  const portalResetPasswordPath = isPortalResetPasswordPath(pathname)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const getPortalUserId = async () => {
    const portalUserResponse = await supabase
      .from('customer_portal_users')
      .select('id')
      .eq('auth_user_id', user?.id ?? '')
      .eq('is_active', true)
      .maybeSingle()

    return portalUserResponse.data?.id ?? null
  }

  if (!protectedPath && !portalPath) {
    return ensureLocaleCookie(response)
  }

  if (!user) {
    if (portalPath) {
      if (portalLoginPath || portalResetPasswordPath) {
        return ensureLocaleCookie(response)
      }

      const loginUrl = new URL('/portal/login', request.url)
      return ensureLocaleCookie(NextResponse.redirect(loginUrl))
    }

    const loginUrl = new URL('/sign-in', request.url)
    return ensureLocaleCookie(NextResponse.redirect(loginUrl))
  }

  if (portalPath) {
    const portalUserId = await getPortalUserId()

    if (!portalUserId) {
      if (portalLoginPath || portalResetPasswordPath) {
        return ensureLocaleCookie(response)
      }

      const loginUrl = new URL('/portal/login', request.url)
      loginUrl.searchParams.set('error', 'no-portal-access')
      return ensureLocaleCookie(NextResponse.redirect(loginUrl))
    }

    return ensureLocaleCookie(
      portalLoginPath ? NextResponse.redirect(new URL('/portal', request.url)) : response
    )
  }

  let profileId: string | null = null

  const profileByAuth = await supabase
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (profileByAuth.data?.id) {
    profileId = profileByAuth.data.id
  } else {
    const profileByUser = await supabase
      .from('profiles')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (profileByUser.data?.id) {
      profileId = profileByUser.data.id
    }
  }

  if (!profileId) {
    const portalUserId = await getPortalUserId()

    if (portalUserId) {
      return ensureLocaleCookie(NextResponse.redirect(new URL('/portal', request.url)))
    }

    return ensureLocaleCookie(NextResponse.redirect(new URL('/onboarding/company', request.url)))
  }

  const membershipsResponse = await supabase
    .from('company_members')
    .select('company_id, role, is_active')
    .eq('profile_id', profileId)
    .eq('is_active', true)

  const memberships = membershipsResponse.data ?? []

  if (membershipsResponse.error || memberships.length === 0) {
    const portalUserId = await getPortalUserId()

    if (portalUserId) {
      return ensureLocaleCookie(NextResponse.redirect(new URL('/portal', request.url)))
    }

    return ensureLocaleCookie(NextResponse.redirect(new URL('/onboarding/company', request.url)))
  }

  const hasHubAccess = hasAnyHubAccessRole(memberships.map((item) => item.role))
  const hasCompanyAccess = memberships.some((item) => hasCompanyMemberRole(item.role))
  const isSuperAdmin = memberships.some(
    (item) => (item.role ?? '').toString().trim().toLowerCase() === 'super_admin'
  )

  if (isAdminPath(pathname) && !isSuperAdmin) {
    const loginUrl = new URL('/sign-in', request.url)
    loginUrl.searchParams.set('error', 'no-hub-access')
    return ensureLocaleCookie(NextResponse.redirect(loginUrl))
  }

  if (isWorkerAppPath(pathname) && hasCompanyAccess) {
    return ensureLocaleCookie(response)
  }

  if (!hasHubAccess) {
    const portalUserId = await getPortalUserId()

    if (portalUserId) {
      return ensureLocaleCookie(NextResponse.redirect(new URL('/portal', request.url)))
    }

    if (hasCompanyAccess) {
      return ensureLocaleCookie(NextResponse.redirect(new URL('/moje-prace', request.url)))
    }

    const loginUrl = new URL('/sign-in', request.url)
    loginUrl.searchParams.set('error', 'no-hub-access')
    return ensureLocaleCookie(NextResponse.redirect(loginUrl))
  }

  return ensureLocaleCookie(response)
}

export const config = {
  matcher: [
    '/',
    '/login',
    '/sign-in',
    '/sign-up',
    '/register',
    '/pricing',
    '/dashboard',
    '/dashboard/:path*',
    '/absences/:path*',
    '/advance-requests/:path*',
    '/jobs/:path*',
    '/calendar/:path*',
    '/cenove-nabidky/:path*',
    '/customers/:path*',
    '/poptavky/:path*',
    '/workers/:path*',
    '/kalkulace/:path*',
    '/settings/:path*',
    '/billing',
    '/billing/:path*',
    '/costs',
    '/costs/:path*',
    '/admin',
    '/admin/:path*',
    '/invoices/:path*',
    '/work-shifts/:path*',
    '/moje-prace',
    '/moje-prace/:path*',
    '/ucet/:path*',
    '/logout',
    '/napoveda/:path*',
    '/help',
    '/help/:path*',
    '/debug-auth/:path*',
    '/api/active-company',
    '/api/company-billing',
    '/api/billing/:path*',
    '/api/customer-portal-users',
    '/api/invoices/:path*',
    '/api/jobs/:path*',
    '/api/job-assignments/:path*',
    '/api/job-photos/:path*',
    '/api/pohoda-exports/:path*',
    '/api/quotes/:path*',
    '/api/mail/feed',
    '/api/mail/send',
    '/portal',
    '/portal/:path*',
  ],
}
