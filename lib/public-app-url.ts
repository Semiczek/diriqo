import type { NextRequest } from 'next/server'

const DEFAULT_PUBLIC_APP_BASE_URL = 'https://app.diriqo.com'

function normalizeBaseUrl(value: string | null | undefined) {
  const normalized = value?.trim()
  if (!normalized) return null
  return normalized.replace(/\/$/, '')
}

function isLocalhostUrl(value: string | null | undefined) {
  if (!value) return false

  try {
    const url = new URL(value)
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)
  } catch {
    return false
  }
}

function buildUrlFromHost(host: string | null | undefined, protocol = 'https') {
  const normalizedHost = host?.trim()
  if (!normalizedHost) return null

  if (/^https?:\/\//i.test(normalizedHost)) {
    return normalizeBaseUrl(normalizedHost)
  }

  return `${protocol}://${normalizedHost.replace(/\/$/, '')}`
}

export function getPublicAppBaseUrl(request?: NextRequest): string {
  const appBaseUrl = normalizeBaseUrl(process.env.APP_BASE_URL)
  const explicitBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL)
  const vercelProductionUrl = normalizeBaseUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL)
  const vercelPreviewUrl = normalizeBaseUrl(process.env.VERCEL_URL)

  if (appBaseUrl && !isLocalhostUrl(appBaseUrl)) {
    return appBaseUrl
  }

  if (explicitBaseUrl && !isLocalhostUrl(explicitBaseUrl)) {
    return explicitBaseUrl
  }

  if (vercelProductionUrl) {
    return buildUrlFromHost(vercelProductionUrl) ?? DEFAULT_PUBLIC_APP_BASE_URL
  }

  if (request) {
    const forwardedHost = request.headers.get('x-forwarded-host')
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'
    const forwardedUrl = buildUrlFromHost(forwardedHost, forwardedProto)

    if (forwardedUrl && !isLocalhostUrl(forwardedUrl)) {
      return forwardedUrl
    }

    const requestOrigin = normalizeBaseUrl(request.nextUrl.origin)
    if (requestOrigin && !isLocalhostUrl(requestOrigin)) {
      return requestOrigin
    }
  }

  if (vercelPreviewUrl) {
    return buildUrlFromHost(vercelPreviewUrl) ?? DEFAULT_PUBLIC_APP_BASE_URL
  }

  if (request) {
    const requestOrigin = normalizeBaseUrl(request.nextUrl.origin)
    return requestOrigin && !isLocalhostUrl(requestOrigin) ? requestOrigin : DEFAULT_PUBLIC_APP_BASE_URL
  }

  return DEFAULT_PUBLIC_APP_BASE_URL
}
