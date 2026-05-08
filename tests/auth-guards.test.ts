import { describe, expect, it } from 'vitest'

import {
  hasAnyHubAccessRole,
  hasHubAccessRole,
  normalizeCompanyRole,
} from '../lib/hub-access'

describe('hub auth role helpers', () => {
  it('normalizes roles before comparing hub access', () => {
    expect(normalizeCompanyRole(' Company_Admin ')).toBe('company_admin')
    expect(hasHubAccessRole(' Company_Admin ')).toBe(true)
    expect(hasHubAccessRole('worker')).toBe(false)
  })

  it('allows access when any role is a hub role', () => {
    expect(hasAnyHubAccessRole(['worker', null, 'super_admin'])).toBe(true)
    expect(hasAnyHubAccessRole(['worker', 'manager'])).toBe(false)
  })
})

