import { NextResponse } from 'next/server'

import { requireAuthenticatedUser, requireCompanyRole } from '@/lib/server-guards'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { getStripe } from '@/lib/stripe'
import { createModuleCheckout, isModuleCheckoutEnabled, ModuleCheckoutError } from '@/lib/platform/module-checkout'

const headers = { 'Cache-Control': 'private, no-store' }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const reply = (error: string, status: number, code?: string) => NextResponse.json({ error, code }, { status, headers })

function configuredOrigin(): string | null {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL?.trim() ?? '')
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return url.protocol === 'https:' || local ? url.origin : null
  } catch { return null }
}

/** Public input selects only an offer; identity, company, price and scope are resolved on the server. */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedUser()
  if (!auth.ok) return reply(auth.error, auth.status)
  const company = await requireCompanyRole('company_admin', 'super_admin')
  if (!company.ok) return reply(company.error, company.status)
  if (!isModuleCheckoutEnabled()) return reply('Nákup modulů zatím není spuštěný.', 503, 'checkout_disabled')

  const appUrl = configuredOrigin()
  if (!appUrl) return reply('Nákup modulů není správně nakonfigurovaný.', 503, 'checkout_unavailable')
  if (request.headers.get('origin') !== appUrl || request.headers.get('sec-fetch-site') === 'cross-site') {
    return reply('Požadavek musí pocházet z aplikace Diriqo.', 403, 'invalid_origin')
  }
  // A stale tab must not silently purchase for a company selected in another tab.
  if (request.headers.get('x-diriqo-company') !== company.value.companyId) {
    return reply('Aktivní firma se změnila. Obnovte stránku před nákupem.', 409, 'company_changed')
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply('Požadavek musí obsahovat JSON.', 415)
  }
  let body: unknown
  try {
    const raw = await request.text()
    if (raw.length > 1024) return reply('Neplatný požadavek.', 400)
    body = JSON.parse(raw)
  } catch { return reply('Neplatný požadavek.', 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !('offerId' in body)
    || typeof body.offerId !== 'string' || !uuid.test(body.offerId)) {
    return reply('Vyberte platnou nabídku modulu.', 400, 'invalid_offer')
  }

  try {
    const checkout = await createModuleCheckout({
      companyId: company.value.companyId, actorAuthUserId: auth.value.user.id,
      offerId: body.offerId, registerId: null, appUrl,
    }, { stripe: getStripe(), admin: createSupabaseAdminClient() })
    return NextResponse.json(checkout, { headers })
  } catch (error) {
    if (error instanceof ModuleCheckoutError) {
      const status = error.status >= 400 && error.status <= 599 ? error.status : 503
      return reply(status === 409
        ? 'Nákup nyní nelze dokončit. Obnovte přehled; ověřte aktivní licence a požadavky modulu.'
        : 'Platební stránku se nepodařilo připravit. Zkuste to znovu.', status, error.code)
    }
    return reply('Platební stránka je dočasně nedostupná. Zkuste to znovu.', 503, 'checkout_unavailable')
  }
}
