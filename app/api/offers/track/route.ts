import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  isAllowedTrackEventType,
  isAllowedTrackSectionKey,
  isLikelyPublicOfferToken,
  MAX_EVENT_VALUE_LENGTH,
  MAX_REFERRER_LENGTH,
  MAX_SECTION_KEY_LENGTH,
  MAX_USER_AGENT_LENGTH,
  normalizeOptionalText,
  normalizeReferrer,
  normalizeVisitorId,
} from '@/lib/public-offer-security'
import { createSupabasePublicClient } from '@/lib/supabase-public'

type TrackPayload = {
  token?: string
  eventType?: string
  sectionKey?: string | null
  eventValue?: string | null
  visitorId?: string | null
  referrer?: string | null
}

const SECTION_EVENT_TYPES = new Set(['section_viewed', 'section_expanded', 'pricing_viewed'])
const ENGAGEMENT_EVENT_TYPES = new Set(['offer_engaged'])

function getDeviceType(userAgent: string) {
  const normalized = userAgent.toLowerCase()

  if (normalized.includes('ipad') || normalized.includes('tablet')) {
    return 'tablet'
  }

  if (normalized.includes('mobi') || normalized.includes('android')) {
    return 'mobile'
  }

  return 'desktop'
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''
    const contentLength = Number(request.headers.get('content-length') || '0')

    if (!contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json({ ok: false, error: 'Invalid content type' }, { status: 400 })
    }

    if (Number.isFinite(contentLength) && contentLength > 8_192) {
      return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 })
    }

    const body = (await request.json()) as TrackPayload
    const token = body.token?.trim() || ''
    const eventType = body.eventType?.trim() || ''

    if (!isLikelyPublicOfferToken(token)) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 400 })
    }

    if (!isAllowedTrackEventType(eventType)) {
      return NextResponse.json({ ok: false, error: 'Invalid eventType' }, { status: 400 })
    }

    const sectionKey = normalizeOptionalText(body.sectionKey, MAX_SECTION_KEY_LENGTH)
    if (SECTION_EVENT_TYPES.has(eventType)) {
      const normalizedSectionKey = eventType === 'pricing_viewed' ? 'pricing' : sectionKey
      if (!normalizedSectionKey || !isAllowedTrackSectionKey(normalizedSectionKey)) {
        return NextResponse.json({ ok: false, error: 'Invalid sectionKey' }, { status: 400 })
      }
    }

    const eventValue = normalizeOptionalText(body.eventValue, MAX_EVENT_VALUE_LENGTH)
    if (ENGAGEMENT_EVENT_TYPES.has(eventType)) {
      const seconds = Number(eventValue)
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) {
        return NextResponse.json({ ok: false, error: 'Invalid eventValue' }, { status: 400 })
      }
    }

    const supabase = createSupabasePublicClient()
    const rawUserAgent = request.headers.get('user-agent') || ''
    const userAgent = normalizeOptionalText(rawUserAgent, MAX_USER_AGENT_LENGTH)
    const referrer = normalizeReferrer(
      normalizeOptionalText(body.referrer || request.headers.get('referer') || null, MAX_REFERRER_LENGTH),
    )
    const visitorId = normalizeVisitorId(body.visitorId)
    const anonymousVisitorId =
      !visitorId && (userAgent || referrer)
        ? createHash('sha256')
            .update([userAgent, referrer].filter(Boolean).join('|'))
            .digest('hex')
            .slice(0, 32)
        : null

    const { data, error } = await supabase.rpc('track_public_offer_event', {
      input_token: token,
      input_event_type: eventType,
      input_section_key: eventType === 'pricing_viewed' ? 'pricing' : sectionKey,
      input_event_value: eventValue,
      input_visitor_id: visitorId ?? anonymousVisitorId,
      input_user_agent: userAgent,
      input_device_type: userAgent ? getDeviceType(userAgent) : 'desktop',
      input_referrer: referrer,
    })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ ok: false, error: 'Offer not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
