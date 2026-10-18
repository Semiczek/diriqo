import { officeStagingDecision } from '@/lib/office/staging-guard'
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { hasAnyHubAccessRole, hasCompanyMemberRole } from '@/lib/hub-access'
import { hasPlatformAdminAccess } from '@/lib/platform/platform-admin'
import { isMemberWorkspacePath, MOBILE_ENTRY_COOKIE, mobileEntryPath } from '@/lib/mobile-access'
import {
  LOCALE_COUNTRY_HEADER_NAME,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  getFallbackLocaleFromCountry,
  getPreferredLocaleFromHeader,
  normalizeLocale,
} from '@/lib/i18n/config'

const PROTECTED_MATCHERS = [
  '/office',
  '/api/office',
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
  '/inventory',
  '/fleet',
  '/smart-quotes',
  '/pos',
  '/diriqent',
  '/work-shifts',
  '/moje-prace',
  '/mobile',
  '/ucet',
  '/logout',
  '/napoveda',
  '/help',
  '/debug-auth',
  '/dashboard',
  '/api/active-company',
  '/api/company-modules',
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

function isModuleWorkspacePath(pathname: string) {
  return ['/inventory', '/fleet', '/smart-quotes', '/pos', '/diriqent', '/api/active-company', '/api/company-modules']
    .some(path => pathname === path || pathname.startsWith(path + '/'))
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
  const staging = process.env.OFFICE_STAGING_ONLY !== undefined
    ? officeStagingDecision('diriqo', { url: request.url, method: request.method, origin: request.headers.get('origin') }, process.env)
    : null
  if (staging?.kind === 'deny') return NextResponse.json({ error: staging.code }, { status: staging.status, headers: { 'Cache-Control': 'private, no-store' } })
  if (staging?.kind === 'redirect') return NextResponse.redirect(new URL(staging.location, request.url))
  if (staging?.kind === 'allow' && staging.staticAsset) return NextResponse.next()
  if (!staging && !isLegacyProxyPath(request.nextUrl.pathname)) return NextResponse.next()

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
    const mobileApp = request.nextUrl.pathname === '/mobile/my' ? 'my' : request.nextUrl.pathname === '/mobile/manager' ? 'manager' : null
    if (mobileEntryPath(mobileApp)) {
      target.cookies.set({ name: MOBILE_ENTRY_COOKIE, value: mobileApp!, path: '/', sameSite: 'lax', httpOnly: true, secure: request.nextUrl.protocol === 'https:', maxAge: 60 * 60 * 24 * 30 })
    }
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
    error: authError,
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

  if (authError || !user) {
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

  // Any authenticated account may end its own session, including workers and
  // accounts whose company membership has just been removed. No child routes.
  if (pathname === '/logout') return ensureLocaleCookie(response)

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

  // Platform operators may have no company/profile. Check their independent grant first.
  if (isAdminPath(pathname)) {
    if (!(await hasPlatformAdminAccess(supabase))) {
      const loginUrl = new URL('/sign-in', request.url)
      loginUrl.searchParams.set('error', 'no-hub-access')
      return ensureLocaleCookie(NextResponse.redirect(loginUrl))
    }
    return ensureLocaleCookie(response)
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

  const selectedCompanyId = request.cookies.get('active_company_id')?.value?.trim()
  // Let the user explicitly recover an unavailable selection before role routing.
  // API handlers keep their own denial responses and authorize new switch targets.
  if (selectedCompanyId && !pathname.startsWith('/api/') && !memberships.some(
    (item) => item.company_id === selectedCompanyId && hasCompanyMemberRole(item.role)
  )) {
    const recoveryResponse = NextResponse.redirect(new URL('/onboarding/company', request.url))
    for (const cookie of response.cookies.getAll()) recoveryResponse.cookies.set(cookie)
    return ensureLocaleCookie(recoveryResponse)
  }

  const hasHubAccess = hasAnyHubAccessRole(memberships.map((item) => item.role))
  const hasCompanyAccess = memberships.some((item) => hasCompanyMemberRole(item.role))
  // Office performs active-company, role and feature checks at its server boundary.
  if (hasCompanyAccess && (pathname === '/office' || pathname.startsWith('/office/') || pathname.startsWith('/api/office/'))) {
    return ensureLocaleCookie(response)
  }
  // Domain handlers enforce their own role, tenant and licence checks.
  if ((isMemberWorkspacePath(pathname) || isModuleWorkspacePath(pathname)) && hasCompanyAccess) {
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

const LEGACY_PROXY_MATCHERS = [
    '/office/:path*',
    '/api/office/:path*',
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
    '/inventory/:path*',
    '/fleet/:path*',
    '/smart-quotes/:path*',
    '/pos/:path*',
    '/diriqent/:path*',
    '/work-shifts/:path*',
    '/moje-prace',
    '/moje-prace/:path*',
    '/mobile/:path*',
    '/ucet/:path*',
    '/logout',
    '/napoveda/:path*',
    '/help',
    '/help/:path*',
    '/debug-auth/:path*',
    '/api/active-company',
    '/api/company-modules',
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
  ]

// Catch-all staging coverage must not change normal unmatched-route behavior.
function isLegacyProxyPath(pathname: string) {
  const path = pathname.replace(/^\/_next\/data\/[^/]+/, '')
  return LEGACY_PROXY_MATCHERS.some(pattern => {
    if (pattern === '/') return path === '/' || /^\/index(?:\.json)?\/?$/.test(path)
    const nested = pattern.endsWith('/:path*')
    // The preserved host patterns contain literal route segments and :path* only.
    const base = nested ? pattern.slice(0, -7) : pattern
    return new RegExp('^' + base + (nested ? '(?:/[^?#]+)?' : '') + '(?:\\.json)?/?$').test(path)
  })
}

export const config = { matcher: ['/:path*'] }
