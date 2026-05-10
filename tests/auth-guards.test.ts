import { describe, expect, it } from 'vitest'

import {
  hasAnyCompanyRole,
  hasAnyHubAccessRole,
  hasCompanyMemberRole,
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

  it('keeps company membership roles separate from hub admin roles', () => {
    expect(hasCompanyMemberRole('worker')).toBe(true)
    expect(hasCompanyMemberRole('manager')).toBe(true)
    expect(hasHubAccessRole('manager')).toBe(false)
    expect(hasAnyCompanyRole(' Manager ', ['worker', 'manager'])).toBe(true)
    expect(hasAnyCompanyRole('worker', ['company_admin', 'super_admin'])).toBe(false)
  })
})
