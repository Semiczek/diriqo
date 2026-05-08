import { describe, expect, it } from 'vitest'

import {
  isAllowedResponseActionType,
  isLikelyPublicOfferToken,
  normalizeReferrer,
  normalizeVisitorId,
} from '../lib/public-offer-security'
import {
  isAllowedPublicLeadLocale,
  isAllowedPublicLeadSource,
  normalizeHttpUrl,
  normalizeServiceSlug,
} from '../lib/public-lead-security'

describe('public token and lead input helpers', () => {
  it('accepts only bounded hex public offer tokens and visitor ids', () => {
    expect(isLikelyPublicOfferToken('a'.repeat(32))).toBe(true)
    expect(isLikelyPublicOfferToken('z'.repeat(32))).toBe(false)
    expect(isLikelyPublicOfferToken('a'.repeat(129))).toBe(false)

    expect(normalizeVisitorId(` ${'f'.repeat(16)} `)).toBe('f'.repeat(16))
    expect(normalizeVisitorId('not-a-hex-id')).toBeNull()
  })

  it('keeps public form enums and urls scoped to known safe values', () => {
    expect(isAllowedResponseActionType('revision_requested')).toBe(true)
    expect(isAllowedResponseActionType('delete_everything')).toBe(false)

    expect(isAllowedPublicLeadSource('diriqo-web')).toBe(true)
    expect(isAllowedPublicLeadLocale('cs')).toBe(true)
    expect(isAllowedPublicLeadLocale('fr')).toBe(false)

    expect(normalizeServiceSlug(' Cleaning-Office ')).toBe('cleaning-office')
    expect(normalizeServiceSlug('../admin')).toBeNull()
    expect(normalizeHttpUrl('https://example.com/path')).toBe('https://example.com/path')
    expect(normalizeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeReferrer('https://example.com')).toBe('https://example.com')
    expect(normalizeReferrer('file:///etc/passwd')).toBeNull()
  })
})

