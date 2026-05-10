import { NextRequest, NextResponse } from 'next/server'
import https from 'node:https'

import { requireHubAccess } from '@/lib/server-guards'

export const runtime = 'nodejs'

const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 30
const rateLimitByUser = new Map<string, { count: number; resetAt: number }>()

type AresAddress = {
  textovaAdresa?: string | null
  nazevUlice?: string | null
  cisloDomovni?: string | null
  cisloOrientacni?: string | null
  cisloOrientacniPismeno?: string | null
  nazevObce?: string | null
  castObceNazev?: string | null
  psc?: string | null
  nazevStatu?: string | null
}

type AresSubject = {
  ico?: string | null
  dic?: string | null
  obchodniJmeno?: string | null
  sidlo?: AresAddress | null
}

function requestJson(url: string) {
  return new Promise<AresSubject>((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/json',
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 500
        let body = ''

        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => {
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`ARES HTTP ${statusCode}`))
            return
          }

          try {
            resolve(JSON.parse(body) as AresSubject)
          } catch (error) {
            reject(error)
          }
        })
      }
    )

    request.on('error', reject)
  })
}

function sanitizeIco(rawValue: string | null) {
  return (rawValue ?? '').replace(/\D/g, '')
}

function joinAddressParts(parts: Array<string | null | undefined>) {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join(' ')
}

function normalizeText(value: unknown) {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

function checkRateLimit(key: string, now = Date.now()) {
  const existing = rateLimitByUser.get(key)

  if (!existing || existing.resetAt <= now) {
    rateLimitByUser.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    })
    return true
  }

  existing.count += 1

  if (rateLimitByUser.size > 500) {
    for (const [entryKey, entry] of rateLimitByUser.entries()) {
      if (entry.resetAt <= now) {
        rateLimitByUser.delete(entryKey)
      }
    }
  }

  return existing.count <= RATE_LIMIT_MAX_REQUESTS
}

function mapAddress(address: AresAddress | null | undefined) {
  if (!address) {
    return {
      street: null,
      city: null,
      postalCode: null,
      country: null,
    }
  }

  const street =
    normalizeText(address.textovaAdresa) ||
    joinAddressParts([
      normalizeText(address.nazevUlice),
      normalizeText(address.cisloDomovni),
      joinAddressParts([
        normalizeText(address.cisloOrientacni),
        normalizeText(address.cisloOrientacniPismeno),
      ]),
    ]) ||
    null

  const city = normalizeText(address.nazevObce) || normalizeText(address.castObceNazev) || null
  const postalCode = normalizeText(address.psc) || null
  const country = normalizeText(address.nazevStatu) || 'Ceska republika'

  return {
    street,
    city,
    postalCode,
    country,
  }
}

export async function GET(request: NextRequest) {
  const access = await requireHubAccess()

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const activeCompany = access.value
  const rateLimitKey = `${activeCompany.companyId}:${activeCompany.profileId}`

  if (!checkRateLimit(rateLimitKey)) {
    return NextResponse.json(
      { error: 'Prilis mnoho dotazu do ARES. Zkuste to prosim za chvili.' },
      { status: 429 }
    )
  }

  const ico = sanitizeIco(request.nextUrl.searchParams.get('ico'))

  if (ico.length !== 8) {
    return NextResponse.json(
      { error: 'ICO musi mit 8 cislic.' },
      { status: 400 }
    )
  }

  try {
    const subject = await requestJson(
      `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`
    )
    const address = mapAddress(subject.sidlo)

    return NextResponse.json({
      ico: subject.ico?.trim() || ico,
      dic: subject.dic?.trim() || null,
      name: subject.obchodniJmeno?.trim() || null,
      billingStreet: address.street,
      billingCity: address.city,
      billingPostalCode: address.postalCode,
      billingCountry: address.country,
    })
  } catch (error) {
    console.error('ARES lookup failed:', error)
    const message = error instanceof Error ? error.message : 'unknown error'

    return NextResponse.json(
      { error: `Nepodarilo se spojit s ARES. ${message}` },
      { status: 502 }
    )
  }
}
