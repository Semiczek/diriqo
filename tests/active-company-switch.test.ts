import { describe, expect, it } from 'vitest'

import { resolveActiveCompanySwitch } from '../lib/active-company-switch'

const memberships = [
  { companyId: 'company-a', companyName: 'A' },
  { companyId: 'company-b', companyName: 'B' },
]

describe('active company switch validation', () => {
  it('accepts only a company from the authenticated membership list', () => {
    expect(resolveActiveCompanySwitch('company-b', memberships)).toEqual({
      ok: true,
      company: memberships[1],
    })
  })

  it('trims submitted ids but rejects blank or unassigned companies', () => {
    expect(resolveActiveCompanySwitch(' company-a ', memberships)).toEqual({
      ok: true,
      company: memberships[0],
    })
    expect(resolveActiveCompanySwitch('', memberships)).toEqual({
      ok: false,
      error: 'Company not available',
    })
    expect(resolveActiveCompanySwitch('company-c', memberships)).toEqual({
      ok: false,
      error: 'Company not available',
    })
  })
})

