type Host = 'hub' | 'diriqo'
type Environment = Record<string, string | undefined>
type Decision =
  | { kind: 'disabled' }
  | { kind: 'allow'; staticAsset: boolean }
  | { kind: 'redirect'; location: '/office' }
  | { kind: 'deny'; status: 403 | 404 | 405 | 503; code: string }

const stageRefs = { hub: 'amuhcvnvubsrvsfclqtg', diriqo: 'pkjzoplczxqqmmstnqgy' } as const
const productionRefs = new Set(['wfcpfraxiuhuglnuaxqj', 'yrxfozthravgbbcqklzy'])
const readMethods = new Set(['GET', 'HEAD'])
const deny = (status: 403 | 404 | 405 | 503, code: string): Decision => ({ kind: 'deny', status, code })

/** Pure, fail-closed routing boundary for these explicitly approved staging branches.
 * It does not replace authentication, tenant membership, CSRF or RPC authorization. */
export function officeStagingDecision(
  host: Host,
  request: { url: string; method: string; origin?: string | null },
  env: Environment,
): Decision {
  if (env.OFFICE_STAGING_ONLY === undefined) return { kind: 'disabled' }
  if (env.OFFICE_STAGING_ONLY !== '1') return deny(503, 'OFFICE_STAGING_CONFIG')
  const expiration = env.OFFICE_STAGING_EXPIRES_AT ?? ''
  const expiresAt = Date.parse(expiration)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expiration)
    || !Number.isFinite(expiresAt) || new Date(expiresAt).toISOString().replace('.000Z', 'Z') !== expiration
    || Date.now() >= expiresAt) return deny(503, 'OFFICE_STAGING_ENDED')
  const ref = env.OFFICE_STAGING_PROJECT_REF
  const supabaseOrigin = 'https://' + stageRefs[host] + '.supabase.co'
  if (!ref || productionRefs.has(ref) || ref !== stageRefs[host]
    || env.NEXT_PUBLIC_SUPABASE_URL !== supabaseOrigin
    || (env.SUPABASE_URL !== undefined && env.SUPABASE_URL !== supabaseOrigin)) {
    return deny(503, 'OFFICE_STAGING_CONFIG')
  }
  let publicOrigin: string
  let url: URL
  try {
    const configured = env.OFFICE_PUBLIC_ORIGIN || (env.VERCEL_URL ? 'https://' + env.VERCEL_URL : '')
    const publicUrl = new URL(configured)
    if (publicUrl.protocol !== 'https:' || publicUrl.origin !== configured
      || publicUrl.username || publicUrl.password || publicUrl.port
      || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(publicUrl.hostname)
      || !publicUrl.hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(publicUrl.hostname)) {
      return deny(503, 'OFFICE_STAGING_CONFIG')
    }
    publicOrigin = publicUrl.origin
    url = new URL(request.url)
    if (url.origin !== publicOrigin || url.username || url.password) return deny(403, 'OFFICE_STAGING_ORIGIN')
  } catch {
    return deny(503, 'OFFICE_STAGING_CONFIG')
  }
  const path = url.pathname, method = request.method.toUpperCase(), read = readMethods.has(method)
  if (path.includes('%') || path.includes('\\') || path.includes('//')) return deny(404, 'OFFICE_STAGING_ROUTE')
  const assets = host === 'hub'
    ? ['/jspd-logo-blue.png', '/icon.png', '/apple-icon.png', '/favicon.ico']
    : ['/diriqo-logo-full.png', '/icon.png', '/apple-icon.png', '/favicon.ico']
  const nextStatic = /^\/_next\/static\/(?:[A-Za-z0-9_@()[\].~-]+\/)*[A-Za-z0-9_@()[\].~-]+\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|svg|ico)$/.test(path)
    && !path.split('/').some(segment => segment === '.' || segment === '..')
  if (assets.includes(path) || nextStatic) {
    return read ? { kind: 'allow', staticAsset: true } : deny(405, 'OFFICE_STAGING_METHOD')
  }
  if (path === '/_next/image') {
    const keys = [...url.searchParams.keys()]
    const image = url.searchParams.get('url') ?? ''
    const width = url.searchParams.get('w') ?? '', quality = url.searchParams.get('q') ?? ''
    if (keys.length !== 3 || new Set(keys).size !== 3 || !keys.every(key => ['url', 'w', 'q'].includes(key))
      || !assets.includes(image) || !/^[1-9]\d{0,3}$/.test(width) || Number(width) > 4096
      || !/^[1-9]\d?$|^100$/.test(quality)) return deny(404, 'OFFICE_STAGING_ROUTE')
    return read ? { kind: 'allow', staticAsset: true } : deny(405, 'OFFICE_STAGING_METHOD')
  }
  const routes: Record<string, string[]> = {
    '/': ['GET', 'HEAD'],
    '/office': ['GET', 'HEAD', 'POST'],
    '/office/settings': ['GET', 'HEAD', 'POST'],
    '/api/office/context': ['GET', 'HEAD'],
    '/api/office/files': ['GET', 'HEAD', 'POST'],
    '/api/active-company': host === 'hub' ? ['GET', 'HEAD', 'PATCH'] : ['GET', 'HEAD', 'POST'],
    '/logout': ['GET', 'HEAD', 'POST'],
    ...(host === 'hub'
      ? { '/login': ['GET', 'HEAD'], '/api/active-company/switch': ['POST'], '/office/select-company': ['GET', 'HEAD'] }
      : { '/sign-in': ['GET', 'HEAD'], '/auth/sign-in': ['POST'], '/api/office/company': ['POST'] }),
  }
  if (!Object.hasOwn(routes, path)) return deny(404, 'OFFICE_STAGING_ROUTE')
  if (!routes[path].includes(method)) return deny(405, 'OFFICE_STAGING_METHOD')
  if (!read && request.origin !== publicOrigin) return deny(403, 'OFFICE_STAGING_ORIGIN')
  if (path === '/') return { kind: 'redirect', location: '/office' }
  return { kind: 'allow', staticAsset: false }
}
